"use server";
import { redirect } from "next/navigation";
import { requireAction } from "@/lib/auth/session";
import { createUser, saveLocation, saveSegmentRule, saveTemplate, saveTherapist, updateUser } from "@/services/settings";
import { asSegment } from "@/lib/labels";
import { ValidationError, type RoleKey } from "@/lib/auth/permissions";
import { run, str } from "./util";

const ROLES: RoleKey[] = ["admin", "approver", "viewer"];
const role = (v: string): RoleKey => {
  if (!ROLES.includes(v as RoleKey)) throw new ValidationError("Choose a role.");
  return v as RoleKey;
};

async function finish(tab: string, result: { ok: true } | { ok: false; error: string }, okMsg: string) {
  const q = result.ok ? `ok=${encodeURIComponent(okMsg)}` : `err=${encodeURIComponent(result.error)}`;
  redirect(`/settings?tab=${tab}&${q}`);
}

export async function createUserAction(form: FormData) {
  const r = await run("create_user", async () =>
    createUser(await requireAction("admin"), {
      email: str(form, "email"),
      password: str(form, "password"),
      role: role(str(form, "role")),
      locationId: str(form, "locationId") || null,
    }),
  );
  await finish("users", r, "User created.");
}

export async function updateUserAction(form: FormData) {
  const r = await run("update_user", async () =>
    updateUser(await requireAction("admin"), str(form, "id"), {
      role: role(str(form, "role")),
      locationId: str(form, "locationId") || null,
      active: str(form, "active") === "on",
      newPassword: str(form, "newPassword") || undefined,
    }),
  );
  await finish("users", r, "User updated.");
}

export async function saveLocationAction(form: FormData) {
  const r = await run("save_location", async () =>
    saveLocation(await requireAction("admin"), str(form, "id") || null, {
      name: str(form, "name"),
      phone: str(form, "phone"),
      bookingLink: str(form, "bookingLink"),
    }),
  );
  await finish("locations", r, "Location saved.");
}

export async function saveTherapistAction(form: FormData) {
  const r = await run("save_therapist", async () =>
    saveTherapist(await requireAction("admin"), str(form, "id") || null, {
      firstName: str(form, "firstName"),
      lastName: str(form, "lastName"),
      locationId: str(form, "locationId"),
      active: str(form, "active") === "on",
    }),
  );
  await finish("therapists", r, "Therapist saved.");
}

export async function saveTemplateAction(_prev: unknown, form: FormData) {
  const r = await run("save_template", async () => {
    const segment = asSegment(str(form, "segment"));
    if (!segment) throw new ValidationError("Choose a segment.");
    const channel = str(form, "channel");
    if (channel !== "sms" && channel !== "email") throw new ValidationError("Choose a channel.");
    await saveTemplate(await requireAction("admin"), str(form, "id") || null, {
      name: str(form, "name"),
      segment,
      channel,
      subject: str(form, "subject") || null,
      body: str(form, "body"),
      active: str(form, "active") === "on",
    });
  });
  if (!r.ok) return { error: r.error };
  redirect(`/settings?tab=templates&ok=${encodeURIComponent("Template saved.")}`);
}

export async function saveSegmentRuleAction(form: FormData) {
  const r = await run("save_segment_rule", async () => {
    const segment = asSegment(str(form, "segment"));
    if (!segment) throw new ValidationError("Unknown segment.");
    await saveSegmentRule(await requireAction("admin"), segment, Number(str(form, "minDays")), Number(str(form, "maxDays")));
  });
  await finish("segments", r, "Segment range saved.");
}
