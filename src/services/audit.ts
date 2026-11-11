import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/db";
import { assertCan, type Actor } from "../lib/auth/permissions";

export interface AuditFilters {
  q?: string;
  action?: string;
  userEmail?: string;
  from?: string;
  to?: string;
  page?: number;
}

export const AUDIT_PAGE_SIZE = 100;

export async function searchAudit(actor: Actor, f: AuditFilters = {}) {
  assertCan(actor, "view_counts");
  const where: Prisma.AuditLogWhereInput = {
    ...(f.action ? { action: f.action } : {}),
    ...(f.userEmail ? { user: { email: { contains: f.userEmail.trim(), mode: "insensitive" } } } : {}),
    ...(f.q
      ? {
          OR: [
            { entityId: { contains: f.q.trim() } },
            { entityType: { contains: f.q.trim(), mode: "insensitive" } },
            { details: { contains: f.q.trim() } },
          ],
        }
      : {}),
    ...(f.from || f.to
      ? {
          occurredAt: {
            ...(f.from ? { gte: new Date(`${f.from}T00:00:00Z`) } : {}),
            ...(f.to ? { lte: new Date(`${f.to}T23:59:59Z`) } : {}),
          },
        }
      : {}),
  };
  const page = Math.max(1, f.page ?? 1);
  const [total, items, actions] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { occurredAt: "desc" },
      skip: (page - 1) * AUDIT_PAGE_SIZE,
      take: AUDIT_PAGE_SIZE,
      include: { user: { select: { email: true, role: true } } },
    }),
    prisma.auditLog.findMany({ distinct: ["action"], select: { action: true }, orderBy: { action: "asc" } }),
  ]);
  return { total, items, page, actions: actions.map((a) => a.action) };
}

/**
 * Numbers to bring back from the front-desk walkthrough: approval pace per
 * session and which messages were edited before approval.
 */
export async function walkthroughReport(actor: Actor) {
  assertCan(actor, "view_counts");
  const decisions = await prisma.auditLog.findMany({
    where: { action: { in: ["message.approved", "message.rejected"] } },
    orderBy: { occurredAt: "asc" },
    include: { user: { select: { email: true } } },
  });
  // A "session" is a run of decisions by one user with gaps under 10 minutes.
  type Run = { user: string; start: Date; end: Date; approved: number; rejected: number };
  const runs: Run[] = [];
  const open = new Map<string, Run>();
  for (const d of decisions) {
    const user = d.user?.email ?? "system";
    const run = open.get(user);
    if (run && d.occurredAt.getTime() - run.end.getTime() < 10 * 60_000) {
      run.end = d.occurredAt;
    } else {
      const fresh = { user, start: d.occurredAt, end: d.occurredAt, approved: 0, rejected: 0 };
      runs.push(fresh);
      open.set(user, fresh);
    }
    const current = open.get(user)!;
    if (d.action === "message.approved") current.approved++;
    else current.rejected++;
  }
  const scopeAllowed = actor.role !== "viewer";
  const edited = scopeAllowed
    ? await prisma.message.findMany({
        where: { edited: true, ...(actor.role === "approver" ? { patient: { locationId: actor.locationId ?? "" } } : {}) },
        orderBy: { decidedAt: "desc" },
        take: 100,
        select: { id: true, segment: true, channel: true, originalBody: true, body: true, decidedAt: true, template: { select: { name: true } } },
      })
    : [];
  return { runs: runs.reverse().slice(0, 50), edited, editedVisible: scopeAllowed };
}
