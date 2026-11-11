import { ForbiddenError, ValidationError } from "@/lib/auth/permissions";
import { log } from "@/lib/log";

export type ActionResult<T = undefined> = { ok: true; data?: T; message?: string } | { ok: false; error: string };

/** Turns expected errors into messages for the UI; anything else is logged by code only. */
export async function run<T>(name: string, fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    if (err instanceof ValidationError || err instanceof ForbiddenError) return { ok: false, error: err.message };
    log.error(`action.${name}.failed`, err);
    return { ok: false, error: "Something went wrong. Nothing was changed." };
  }
}

export function str(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === "string" ? v : "";
}
