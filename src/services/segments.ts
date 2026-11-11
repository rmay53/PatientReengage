import { prisma } from "../lib/db";
import { assertCan, locationScope, type Actor } from "../lib/auth/permissions";
import {
  DEFAULT_SEGMENT_RULES,
  SEGMENT_ORDER,
  assignSegment,
  type SegmentKey,
  type SegmentRuleInput,
} from "../lib/rules/segments";
import { checkEligibility } from "../lib/rules/eligibility";
import { addDays } from "../lib/dates";

export async function getSegmentRules(): Promise<SegmentRuleInput[]> {
  const rows = await prisma.segmentRule.findMany();
  if (rows.length === 0) return DEFAULT_SEGMENT_RULES;
  return SEGMENT_ORDER.map((key) => rows.find((r) => r.segment === key) ?? DEFAULT_SEGMENT_RULES.find((d) => d.segment === key)!);
}

export interface SegmentCell {
  total: number;
  eligible: number;
  pending: number;
}

export interface SegmentCounts {
  rules: SegmentRuleInput[];
  locations: { id: string; name: string }[];
  /** cells[locationId][segment] */
  cells: Record<string, Record<SegmentKey, SegmentCell>>;
}

/** Counts only - safe for every role. Approvers see their own location. */
export async function segmentCounts(actor: Actor, now = new Date()): Promise<SegmentCounts> {
  assertCan(actor, "view_counts");
  const rules = await getSegmentRules();
  const scope = locationScope(actor);
  const locations = await prisma.location.findMany({
    where: scope ? { id: { in: scope } } : {},
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  const maxDays = Math.max(...rules.map((r) => r.maxDays));
  const patients = await prisma.patient.findMany({
    where: { locationId: { in: locations.map((l) => l.id) }, dischargeDate: { gte: addDays(now, -maxDays) } },
    select: {
      locationId: true,
      dischargeDate: true,
      dischargeType: true,
      email: true,
      mobile: true,
      smsOptIn: true,
      smsOptOut: true,
      emailOptOut: true,
      doNotContact: true,
      messages: { select: { segment: true, status: true, sentAt: true } },
    },
  });

  const cells: SegmentCounts["cells"] = {};
  for (const loc of locations) {
    cells[loc.id] = Object.fromEntries(SEGMENT_ORDER.map((s) => [s, { total: 0, eligible: 0, pending: 0 }])) as Record<
      SegmentKey,
      SegmentCell
    >;
  }
  for (const p of patients) {
    const seg = assignSegment(p, now, rules);
    if (!seg) continue;
    const cell = cells[p.locationId][seg];
    cell.total++;
    if (p.messages.some((m) => m.segment === seg && (m.status === "drafted" || m.status === "approved"))) cell.pending++;
    if (checkEligibility(p, seg, p.messages, now).eligible) cell.eligible++;
  }
  return { rules, locations, cells };
}
