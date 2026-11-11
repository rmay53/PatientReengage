import { prisma } from "../lib/db";
import { auditMany, type AuditEntry } from "../lib/audit";
import { assertCan, assertLocation, locationScope, type Actor } from "../lib/auth/permissions";
import { assignSegment, dischargeWindow, type SegmentKey } from "../lib/rules/segments";
import { checkEligibility, type SkipReason } from "../lib/rules/eligibility";
import { render } from "../lib/rules/templates";
import { log } from "../lib/log";
import { getSegmentRules } from "./segments";

export type DraftSkipReason = SkipReason | "no_active_template";

export interface DraftResult {
  drafted: number;
  skipped: Partial<Record<DraftSkipReason, number>>;
}

/**
 * Drafts one message per eligible patient in a segment. Nothing is sent.
 * `locationId` narrows to one location; approvers are always limited to their own.
 */
export async function draftSegment(
  actor: Actor,
  segment: SegmentKey,
  locationId: string | null,
  now = new Date(),
): Promise<DraftResult> {
  assertCan(actor, "draft");
  if (locationId) assertLocation(actor, locationId);
  const scope = locationScope(actor);
  const locationFilter = locationId ? [locationId] : scope;

  const rules = await getSegmentRules();
  const rule = rules.find((r) => r.segment === segment);
  if (!rule) throw new Error("Unknown segment");
  const { from, to } = dischargeWindow(rule, now);

  const templates = await prisma.template.findMany({ where: { segment, active: true }, orderBy: { name: "asc" } });
  const templateFor = { sms: templates.find((t) => t.channel === "sms"), email: templates.find((t) => t.channel === "email") };

  const patients = await prisma.patient.findMany({
    where: {
      dischargeType: rule.dischargeType,
      dischargeDate: { gte: from, lte: to },
      ...(locationFilter ? { locationId: { in: locationFilter } } : {}),
    },
    include: {
      location: true,
      therapist: true,
      messages: { select: { segment: true, status: true, sentAt: true } },
    },
  });

  const result: DraftResult = { drafted: 0, skipped: {} };
  const skip = (r: DraftSkipReason) => (result.skipped[r] = (result.skipped[r] ?? 0) + 1);
  const toCreate: {
    patientId: string;
    templateId: string;
    segment: SegmentKey;
    channel: "sms" | "email";
    subject: string | null;
    body: string;
  }[] = [];

  for (const p of patients) {
    // Re-check with the shared rule so overlapping admin ranges cannot double-assign.
    if (assignSegment(p, now, rules) !== segment) continue;
    const elig = checkEligibility(p, segment, p.messages, now);
    if (!elig.eligible) {
      skip(elig.reason);
      continue;
    }
    const template = templateFor[elig.channel];
    if (!template) {
      skip("no_active_template");
      continue;
    }
    const ctx = {
      first_name: p.firstName,
      therapist_first_name: p.therapist?.firstName ?? "your therapist",
      location_name: p.location.name,
      location_phone: p.location.phone,
      booking_link: p.location.bookingLink,
    };
    toCreate.push({
      patientId: p.id,
      templateId: template.id,
      segment,
      channel: elig.channel,
      subject: template.subject ? render(template.subject, ctx) : null,
      body: render(template.body, ctx),
    });
  }

  if (toCreate.length > 0) {
    await prisma.$transaction(
      async (tx) => {
        const created = await tx.message.createManyAndReturn({
          data: toCreate.map((m) => ({ ...m, status: "drafted" as const, draftedAt: now })),
          // A partial unique index (one live message per patient per segment) makes concurrent drafting safe.
          skipDuplicates: true,
          select: { id: true, patientId: true, channel: true },
        });
        const entries: AuditEntry[] = created.map((m) => ({
          userId: actor.id,
          action: "message.drafted",
          entityType: "message",
          entityId: m.id,
          details: { patientId: m.patientId, segment, channel: m.channel },
        }));
        await auditMany(tx, entries);
        const dupes = toCreate.length - created.length;
        if (dupes > 0) result.skipped.already_messaged_for_segment = (result.skipped.already_messaged_for_segment ?? 0) + dupes;
        result.drafted = created.length;
      },
      { timeout: 60_000 },
    );
  }
  log.info("drafting.completed", { userId: actor.id, segment, count: result.drafted });
  return result;
}
