import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../lib/db";
import { audit } from "../lib/audit";
import { hashPassword, verifyPassword } from "../lib/auth/password";
import type { Actor } from "../lib/auth/permissions";
import { sessionTtlHours } from "../lib/config";
import { log } from "../lib/log";

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

// Compared against when the email is unknown, so both cases take the same time.
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= hashPassword(randomBytes(16).toString("hex")));

export async function login(email: string, password: string): Promise<{ token: string; expiresAt: Date } | null> {
  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  const ok = await verifyPassword(password, user?.passwordHash ?? (await getDummyHash()));
  if (!user || !user.active || !ok) {
    if (user) {
      await prisma.$transaction((tx) =>
        audit(tx, { userId: user.id, action: "auth.login_failed", entityType: "user", entityId: user.id }),
      );
    }
    log.warn("auth.login_failed", { userId: user?.id ?? null });
    return null;
  }
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + sessionTtlHours() * 3600_000);
  await prisma.$transaction(async (tx) => {
    const session = await tx.session.create({ data: { tokenHash: hashToken(token), userId: user.id, expiresAt } });
    await audit(tx, { userId: user.id, action: "auth.login", entityType: "session", entityId: session.id });
  });
  log.info("auth.login", { userId: user.id, role: user.role });
  return { token, expiresAt };
}

export async function actorFromToken(token: string | undefined): Promise<Actor | null> {
  if (!token) return null;
  const session = await prisma.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  if (!session || session.expiresAt < new Date() || !session.user.active) return null;
  const u = session.user;
  return { id: u.id, email: u.email, role: u.role, locationId: u.locationId };
}

export async function logout(token: string | undefined) {
  if (!token) return;
  const session = await prisma.session.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!session) return;
  await prisma.$transaction(async (tx) => {
    await tx.session.delete({ where: { id: session.id } });
    await audit(tx, { userId: session.userId, action: "auth.logout", entityType: "session", entityId: session.id });
  });
}
