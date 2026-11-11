"use server";
import { redirect } from "next/navigation";
import { requireAction } from "@/lib/auth/session";
import { setPatientFlag, type FlagKey } from "@/services/patients";
import { run, str } from "./util";

const FLAGS: FlagKey[] = ["smsOptIn", "smsOptOut", "emailOptOut", "doNotContact"];

export async function setFlagAction(form: FormData) {
  const patientId = str(form, "patientId");
  const flag = str(form, "flag") as FlagKey;
  const value = str(form, "value") === "true";
  const result = await run("set_flag", async () => {
    if (!FLAGS.includes(flag)) throw new Error("bad flag");
    await setPatientFlag(await requireAction("approve"), patientId, flag, value);
  });
  const q = result.ok ? "ok=Flag+updated." : `err=${encodeURIComponent(result.error)}`;
  redirect(`/patients/${encodeURIComponent(patientId)}?${q}`);
}
