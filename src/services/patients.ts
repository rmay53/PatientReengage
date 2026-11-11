import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/db";
import { audit } from "../lib/audit";
import { assertCan, assertLocation, patientScopeWhere, ForbiddenError, ValidationError, type Actor } from "../lib/auth/permissions";

export async function searchPatients(actor: Actor, q: string, opts: { locationId?: string; take?: number } = {}) {
  const term = q.trim();
  const where: Prisma.PatientWhereInput = {
    ...patientScopeWhere(actor),
    ...(opts.locationId ? { locationId: opts.locationId } : {}),
    ...(term
      ? {
          OR: [
            { firstName: { contains: term, mode: "insensitive" } },
            { lastName: { contains: term, mode: "insensitive" } },
            { externalId: { contains: term, mode: "insensitive" } },
            { email: { contains: term, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const [total, items] = await Promise.all([
    prisma.patient.count({ where }),
    prisma.patient.findMany({
      where,
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      take: opts.take ?? 100,
      include: { location: true, therapist: true },
    }),
  ]);
  return { total, items };
}

export async function getPatient(actor: Actor, id: string) {
  assertCan(actor, "view_patients");
  const patient = await prisma.patient.findUnique({
    where: { id },
    include: {
      location: true,
      therapist: true,
      messages: { orderBy: { draftedAt: "desc" } },
      replies: { orderBy: { receivedAt: "desc" } },
    },
  });
  if (!patient) return null;
  assertLocation(actor, patient.locationId);
  return patient;
}

export type FlagKey = "smsOptIn" | "smsOptOut" | "emailOptOut" | "doNotContact";

/**
 * Staff can switch protective flags on. Only an admin can clear an opt-out or
 * do-not-contact flag, and every change is audited.
 */
export async function setPatientFlag(actor: Actor, patientId: string, flag: FlagKey, value: boolean) {
  assertCan(actor, "approve");
  const patient = await prisma.patient.findUnique({ where: { id: patientId } });
  if (!patient) throw new ValidationError("Patient not found.");
  assertLocation(actor, patient.locationId);
  const protective = flag === "smsOptOut" || flag === "emailOptOut" || flag === "doNotContact";
  if (protective && !value && actor.role !== "admin") {
    throw new ForbiddenError("Only an admin can clear an opt-out or do-not-contact flag.");
  }
  if (flag === "smsOptIn" && value && patient.smsOptOut && actor.role !== "admin") {
    throw new ForbiddenError("This patient opted out of texts. Only an admin can change that.");
  }
  if (patient[flag] === value) return;
  await prisma.$transaction(async (tx) => {
    await tx.patient.update({ where: { id: patientId }, data: { [flag]: value } });
    await audit(tx, { userId: actor.id, action: "patient.flags_changed", entityType: "patient", entityId: patientId, details: { flag, value } });
    // Withdraw pending drafts that the new flag forbids.
    if (value && protective) {
      const channelFilter = flag === "doNotContact" ? {} : { channel: flag === "smsOptOut" ? ("sms" as const) : ("email" as const) };
      const pending = await tx.message.findMany({ where: { patientId, status: "drafted", ...channelFilter }, select: { id: true } });
      for (const m of pending) {
        await tx.message.update({ where: { id: m.id }, data: { status: "rejected", decidedBy: actor.id, decidedAt: new Date() } });
        await audit(tx, { userId: actor.id, action: "message.rejected", entityType: "message", entityId: m.id, details: { reason: `flag_${flag}` } });
      }
    }
  });
}

/** Public unsubscribe link in emails. The message id acts as an unguessable token. */
export async function unsubscribeByMessage(messageId: string): Promise<boolean> {
  const message = await prisma.message.findUnique({ where: { id: messageId }, select: { id: true, patientId: true, channel: true, status: true } });
  if (!message || message.channel !== "email" || message.status !== "sent") return false;
  await prisma.$transaction(async (tx) => {
    await tx.patient.update({ where: { id: message.patientId }, data: { emailOptOut: true } });
    await audit(tx, { userId: null, action: "unsubscribe.email", entityType: "patient", entityId: message.patientId, details: { messageId } });
  });
  return true;
}
