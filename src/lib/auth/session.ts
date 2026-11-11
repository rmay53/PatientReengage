import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { actorFromToken } from "../../services/auth";
import { can, ForbiddenError, type Actor, type Capability } from "./permissions";
import { secureCookies, sessionTtlHours } from "../config";

export const SESSION_COOKIE = "reengage_session";

export async function setSessionCookie(token: string, expiresAt: Date) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
    maxAge: sessionTtlHours() * 3600,
  });
}

export async function readSessionToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function currentActor(): Promise<Actor | null> {
  return actorFromToken(await readSessionToken());
}

/** For pages: redirects to sign-in, or to /forbidden when the role lacks the capability. */
export async function requirePage(capability?: Capability): Promise<Actor> {
  const actor = await currentActor();
  if (!actor) redirect("/login");
  if (capability && !can(actor, capability)) redirect("/forbidden");
  return actor;
}

/** For server actions: throws instead of redirecting. The service layer checks again. */
export async function requireAction(capability?: Capability): Promise<Actor> {
  const actor = await currentActor();
  if (!actor) throw new ForbiddenError("Your session has ended. Sign in again.");
  if (capability && !can(actor, capability)) throw new ForbiddenError();
  return actor;
}
