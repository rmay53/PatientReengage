import { prisma } from "../lib/db";
import { audit, auditMany } from "../lib/audit";
import { assertCan, assertLocation, patientScopeWhere, ValidationError, type Actor } from "../lib/auth/permissions";
import { getReplyClassifier } from "../lib/classifier";
import { OPT_OUT_CONFIRMATION } from "../lib/classifier/keyword";
import { canEmail, canText } from "../lib/rules/eligibility";
import { getEmailSender, getSmsSender } from "../lib/senders";
import { log } from "../lib/log";

/**
 * Records a reply from a patient (entered by a tester in the prototype),
 * sorts it, and applies the result.
 */
export async function receiveReply(actor: Actor, patientId: string, text: string, channelOverride?: "sms" | "email") {
  assertCan(actor, "handle_inbox");
  const body = text.trim();
  if (!body) throw new ValidationError("Reply text is empty.");
  if (body.length > 2000) throw new ValidationError("Reply is too long for a test (2000 characters max).");
  const patient = await prisma.patient.findUnique({ where: { id: patientId }, include: { location: true } });
  if (!patient) throw new ValidationError("Patient not found.");
  assertLocation(actor, patient.locationId);

  const lastSent = await prisma.message.findFirst({
    where: { patientId, status: "sent" },
    orderBy: { sentAt: "desc" },
  });
  const channel = channelOverride ?? lastSent?.channel ?? (patient.mobile ? "sms" : "email");

  const result = await getReplyClassifier().classify(body, {
    firstName: patient.firstName,
    locationName: patient.location.name,
    locationPhone: patient.location.phone,
    bookingLink: patient.location.bookingLink,
  });
  const now = new Date();

  const reply = await prisma.$transaction(async (tx) => {
    const reply = await tx.reply.create({
      data: {
        patientId,
        messageId: lastSent?.id ?? null,
        channel,
        body,
        receivedAt: now,
        category: result.category,
        urgent: result.urgent,
        suggestedReply: result.suggestedReply,
        // Pure opt-outs are fully handled by the system; everything else waits for staff.
        handledAt: result.category === "opt_out" ? now : null,
      },
    });
    await audit(tx, {
      userId: actor.id,
      action: "reply.received",
      entityType: "reply",
      entityId: reply.id,
      details: { patientId, category: result.category, urgent: result.urgent, simulated: true },
    });

    if (result.optOut) {
      // Opt-out applies at once, to texts and email alike, so the patient is excluded from every future draft.
      await tx.patient.update({ where: { id: patientId }, data: { smsOptOut: true, emailOptOut: true } });
      await audit(tx, { userId: actor.id, action: "reply.opt_out_applied", entityType: "patient", entityId: patientId, details: { replyId: reply.id } });
      // Withdraw anything still waiting for approval.
      const pending = await tx.message.findMany({ where: { patientId, status: "drafted" }, select: { id: true } });
      if (pending.length > 0) {
        await tx.message.updateMany({ where: { id: { in: pending.map((m) => m.id) } }, data: { status: "rejected", decidedAt: now } });
        await auditMany(
          tx,
          pending.map((m) => ({
            userId: actor.id,
            action: "message.rejected" as const,
            entityType: "message",
            entityId: m.id,
            details: { reason: "patient_opted_out", replyId: reply.id },
          })),
        );
      }
    }
    return reply;
  });

  if (result.optOut) {
    // One-line confirmation, sent on the channel they replied on.
    const confirmation = OPT_OUT_CONFIRMATION[channel];
    try {
      if (channel === "sms" && patient.mobile) {
        await getSmsSender().send({ to: patient.mobile, body: confirmation, replyId: reply.id });
      } else if (channel === "email" && patient.email) {
        await getEmailSender().send({ to: patient.email, subject: "You're unsubscribed", body: confirmation, replyId: reply.id });
      }
      await prisma.reply.update({ where: { id: reply.id }, data: { responseBody: confirmation, responseSentAt: new Date() } });
    } catch (err) {
      log.error("reply.optout_confirmation_failed", err, { replyId: reply.id });
    }
  }
  log.info("reply.received", { replyId: reply.id, category: result.category, urgent: result.urgent });
  return { replyId: reply.id, ...result };
}

export async function listInbox(actor: Actor, opts: { showHandled?: boolean } = {}) {
  assertCan(actor, "handle_inbox");
  return prisma.reply.findMany({
    where: {
      patient: patientScopeWhere(actor),
      ...(opts.showHandled ? {} : { handledAt: null }),
    },
    orderBy: [{ urgent: "desc" }, { receivedAt: "asc" }],
    take: 300,
    include: { patient: { include: { location: true, therapist: true } } },
  });
}

async function loadReply(actor: Actor, replyId: string) {
  assertCan(actor, "handle_inbox");
  const reply = await prisma.reply.findUnique({ where: { id: replyId }, include: { patient: true } });
  if (!reply) throw new ValidationError("Reply not found.");
  assertLocation(actor, reply.patient.locationId);
  if (reply.handledAt) throw new ValidationError("This reply has already been handled.");
  return reply;
}

/** Staff approve (and optionally edit) the suggested response to a booking reply. */
export async function approveSuggestedReply(actor: Actor, replyId: string, editedText?: string) {
  const reply = await loadReply(actor, replyId);
  if (reply.category !== "booking" || !reply.suggestedReply) {
    throw new ValidationError("Only booking replies have a suggested response.");
  }
  const text = (editedText ?? reply.suggestedReply).trim();
  if (!text) throw new ValidationError("Response is empty.");
  const p = reply.patient;
  if (reply.channel === "sms" ? !canText(p) : !canEmail(p)) {
    throw new ValidationError("Patient can no longer be contacted on this channel.");
  }
  const now = new Date();
  // Record the decision first, then send.
  await prisma.$transaction(async (tx) => {
    const updated = await tx.reply.updateMany({
      where: { id: reply.id, handledAt: null },
      data: { handledBy: actor.id, handledAt: now, responseBody: text },
    });
    if (updated.count !== 1) throw new ValidationError("This reply was already handled by someone else.");
    await audit(tx, {
      userId: actor.id,
      action: "reply.response_approved",
      entityType: "reply",
      entityId: reply.id,
      details: { patientId: p.id, edited: text !== reply.suggestedReply },
    });
  });
  if (reply.channel === "sms") await getSmsSender().send({ to: p.mobile!, body: text, replyId: reply.id });
  else await getEmailSender().send({ to: p.email!, subject: "Booking your next visit", body: text, replyId: reply.id });
  await prisma.reply.update({ where: { id: reply.id }, data: { responseSentAt: new Date() } });
  log.info("reply.response_sent", { replyId: reply.id, channel: reply.channel });
}

export async function markReplyHandled(actor: Actor, replyId: string) {
  const reply = await loadReply(actor, replyId);
  await prisma.$transaction(async (tx) => {
    const updated = await tx.reply.updateMany({
      where: { id: reply.id, handledAt: null },
      data: { handledBy: actor.id, handledAt: new Date() },
    });
    if (updated.count !== 1) throw new ValidationError("This reply was already handled by someone else.");
    await audit(tx, { userId: actor.id, action: "reply.handled", entityType: "reply", entityId: reply.id, details: { category: reply.category } });
  });
}
