"use server";
import { redirect } from "next/navigation";
import { login, logout } from "@/services/auth";
import { clearSessionCookie, readSessionToken, setSessionCookie } from "@/lib/auth/session";
import { str } from "./util";

export async function loginAction(_prev: { error?: string } | undefined, form: FormData) {
  const session = await login(str(form, "email"), str(form, "password"));
  if (!session) return { error: "Email or password is incorrect." };
  await setSessionCookie(session.token, session.expiresAt);
  redirect("/");
}

export async function logoutAction() {
  await logout(await readSessionToken());
  await clearSessionCookie();
  redirect("/login");
}
