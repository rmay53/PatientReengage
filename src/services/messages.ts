import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/db";
import { audit } from "../lib/audit";
import { assertCan, assertLocation, patientScopeWhere, ValidationError, type Actor } from "../lib/auth/permissions";
import { canEmail, canText } from "../lib/rules/eligibility";
import { checkEmailBody, checkSmsBody, unsubscribeUrl, withUnsubscribeFooter } from "../lib/rules/templates";
import type { SegmentKey } from "../lib/rules/segments";
import { getEmailSender, getSmsSender } from "../lib/senders";
import { appBaseUrl } from "../lib/config";
import { log } from "../lib/log";

export interface QueueFilters {
  locationId?: string;
  therapistId?: string;
  segment?: SegmentKey;
  channel?: "sms" | "email";
}

export const QUEUE_PAGE_SIZE = 200;

export async function listQueue(actor: Actor, f: QueueFilters = {}) {
  const where: Prisma.MessageWhereInput = {
    status: "drafted",
    ...(f.segment ? { segment: f.segment } : {}),
    ...(f.channel ? { channel: f.channel } : {}),
    patient: {
      ...patientScopeWhere(actor),
      ...(f.locationId ? { locationId: f.locationId } : {}),
      ...(f.therapistId ? { therapistId: f.therapistId } : {}),
    },
  };
  const [total, items] = await Promise.all([
    prisma.message.count({ where }),
    prisma.message.findMany({
      where,
      orderBy: [{ draftedAt: "asc" }, { id: "asc" }],
      take: QUEUE_PAGE_SIZE,
      include: { patient: { include: { therapist: true, location: true } } },
    }),
  ]);
  return { total, items };
}

export async function listOutbox(actor: Actor, f: QueueFilters & { status?: "approved" | "sent" | "failed" } = {}) {
  return prisma.message.findMany({
    where: {
      status: f.status ? f.status : { in: ["approved", "sent", "failed"] },
      ...(f.segment ? { segment: f.segment } : {}),
      ...(f.channel ? { channel: f.channel } : {}),
      patient: { ...patientScopeWhere(actor), ...(f.locationId ? { locationId: f.locationId } : {}) },
    },
    orderBy: [{ sentAt: { sort: "desc", nulls: "first" } }, { decidedAt: "desc" }],
    take: 300,
    include: { patient: { include: { location: true, therapist: true } } },
  });
}

async function loadForDecision(actor: Actor, messageId: string) {
  assertCan(actor, "approve");
  const message = await prisma.message.findUnique({ where: { id: messageId }, include: { patient: true } });
  if (!message) throw new ValidationError("Message not found.");
  assertLocation(actor, message.patient.locationId);
  if (message.status !== "drafted") throw new ValidationError(`This message is already ${message.status}.`);
  return message;
}

export interface Edits {
  subject?: string | null;
  body: string;
}

/**
 * Approves a drafted message (optionally with edits), then sends it through the
 * channel's sender. The approval is always recorded against the acting user
 * before anything is sent.
 */
export async function approveMessage(actor: Actor, messageId: string, edits?: Edits) {
  const message = await loadForDecision(actor, messageId);
  const p = message.patient;

  // Re-check contact rules: the patient may have opted out since drafting.
  if (p.doNotContact) throw new ValidationError("Patient is now flagged do not contact. Reject this message.");
  if (message.channel === "sms" && !canText(p)) throw new ValidationError("Patient can no longer be texted. Reject this message.");
  if (message.channel === "email" && !canEmail(p)) throw new ValidationError("Patient can no longer be emailed. Reject this message.");

  const edited = !!edits && (edits.body !== message.body || (edits.subject ?? message.subject) !== message.subject);
  const body = edited ? edits!.body.trim() : message.body;
  const subject = edited && message.channel === "email" ? (edits!.subject ?? message.subject)?.trim() ?? null : message.subject;
  const errors = message.channel === "sms" ? checkSmsBody(body) : checkEmailBody(subject, body);
  if (errors.length > 0) throw new ValidationError(errors.join(" "));

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const updated = await tx.message.updateMany({
      where: { id: message.id, status: "drafted" },
      data: {
        status: "approved",
        decidedBy: actor.id,
        decidedAt: now,
        ...(edited ? { body, subject, edited: true, originalBody: message.body } : {}),
      },
    });
    if (updated.count !== 1) throw new ValidationError("This message was already decided by someone else.");
    if (edited) {
      await audit(tx, { userId: actor.id, action: "message.edited", entityType: "message", entityId: message.id, details: { patientId: p.id } });
    }
    await audit(tx, {
      userId: actor.id,
      action: "message.approved",
      entityType: "message",
      entityId: message.id,
      details: { patientId: p.id, edited },
    });
  });
  log.info("message.approved", { messageId: message.id, userId: actor.id, channel: message.channel });
  return dispatchMessage(actor, message.id);
}

export async function rejectMessage(actor: Actor, messageId: string) {
  const message = await loadForDecision(actor, messageId);
  await prisma.$transaction(async (tx) => {
    const updated = await tx.message.updateMany({
      where: { id: message.id, status: "drafted" },
      data: { status: "rejected", decidedBy: actor.id, decidedAt: new Date() },
    });
    if (updated.count !== 1) throw new ValidationError("This message was already decided by someone else.");
    await audit(tx, { userId: actor.id, action: "message.rejected", entityType: "message", entityId: message.id, details: { patientId: message.patientId } });
  });
  log.info("message.rejected", { messageId: message.id, userId: actor.id });
}

export interface BulkResult {
  approved: number;
  failed: { id: string; error: string }[];
}

export async function approveMany(actor: Actor, messageIds: string[]): Promise<BulkResult> {
  assertCan(actor, "approve");
  const result: BulkResult = { approved: 0, failed: [] };
  for (const id of messageIds) {
    try {
      const status = await approveMessage(actor, id);
      if (status === "sent") result.approved++;
      else result.failed.push({ id, error: "Approved, but the simulated send failed." });
    } catch (err) {
      result.failed.push({ id, error: err instanceof Error ? err.message : "Unknown error" });
    }
  }
  return result;
}

/**
 * Sends an approved message. Refuses anything without an approval recorded
 * against a named user.
 */
export async function dispatchMessage(actor: Actor, messageId: string): Promise<"sent" | "failed"> {
  const message = await prisma.message.findUnique({ where: { id: messageId }, include: { patient: true } });
  if (!message || message.status !== "approved" || !message.decidedBy) {
    throw new ValidationError("Only messages approved by a named user can be sent.");
  }
  const p = message.patient;
  try {
    if (message.channel === "sms") {
      if (!p.mobile) throw new ValidationError("No mobile number.");
      await getSmsSender().send({ to: p.mobile, body: message.body, messageId: message.id });
    } else {
      if (!p.email) throw new ValidationError("No email address.");
      const body = withUnsubscribeFooter(message.body, unsubscribeUrl(appBaseUrl(), message.id));
      await getEmailSender().send({ to: p.email, subject: message.subject ?? "", body, messageId: message.id });
    }
  } catch (err) {
    log.error("message.send_failed", err, { messageId: message.id, channel: message.channel });
    await prisma.$transaction(async (tx) => {
      await tx.message.update({ where: { id: message.id }, data: { status: "failed" } });
      await audit(tx, { userId: actor.id, action: "message.failed", entityType: "message", entityId: message.id, details: { channel: message.channel } });
    });
    return "failed";
  }
  await prisma.$transaction(async (tx) => {
    await tx.message.update({ where: { id: message.id }, data: { status: "sent", sentAt: new Date() } });
    await audit(tx, { userId: actor.id, action: "message.sent", entityType: "message", entityId: message.id, details: { channel: message.channel, simulated: true } });
  });
  log.info("message.sent", { messageId: message.id, channel: message.channel });
  return "sent";
}
