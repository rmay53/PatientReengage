import type { Tx } from "./db";

export type AuditAction =
  | "auth.login"
  | "auth.login_failed"
  | "auth.logout"
  | "import.uploaded"
  | "patient.created"
  | "patient.updated"
  | "patient.flags_changed"
  | "message.drafted"
  | "message.edited"
  | "message.approved"
  | "message.rejected"
  | "message.sent"
  | "message.failed"
  | "reply.received"
  | "reply.opt_out_applied"
  | "reply.response_approved"
  | "reply.handled"
  | "unsubscribe.email"
  | "user.created"
  | "user.updated"
  | "location.created"
  | "location.updated"
  | "therapist.created"
  | "therapist.updated"
  | "template.created"
  | "template.updated"
  | "segment_rule.updated";

export interface AuditEntry {
  userId: string | null;
  action: AuditAction;
  entityType: string;
  entityId: string;
  /** Ids, counts and statuses only. */
  details?: Record<string, string | number | boolean | null>;
}

/** Always call inside the same transaction as the change it records. */
export async function audit(tx: Tx, entry: AuditEntry) {
  await tx.auditLog.create({
    data: {
      userId: entry.userId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      details: entry.details ? JSON.stringify(entry.details) : null,
    },
  });
}

export async function auditMany(tx: Tx, entries: AuditEntry[]) {
  if (entries.length === 0) return;
  await tx.auditLog.createMany({
    data: entries.map((e) => ({
      userId: e.userId,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId,
      details: e.details ? JSON.stringify(e.details) : null,
    })),
  });
}
