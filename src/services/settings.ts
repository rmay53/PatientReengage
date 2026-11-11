import { prisma } from "../lib/db";
import { audit } from "../lib/audit";
import { assertCan, ValidationError, type Actor, type RoleKey } from "../lib/auth/permissions";
import { checkPasswordStrength, hashPassword } from "../lib/auth/password";
import { validateTemplate, LENGTH_ESTIMATE_CONTEXT, type MergeContext } from "../lib/rules/templates";
import { validateSegmentRule, type SegmentKey } from "../lib/rules/segments";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------- Users ----------

export async function listUsers(actor: Actor) {
  assertCan(actor, "admin");
  return prisma.user.findMany({ orderBy: { email: "asc" }, include: { location: true } });
}

function checkRoleLocation(role: RoleKey, locationId: string | null) {
  if (role === "approver" && !locationId) throw new ValidationError("Approvers must be assigned to a location.");
}

export async function createUser(actor: Actor, input: { email: string; password: string; role: RoleKey; locationId: string | null }) {
  assertCan(actor, "admin");
  const email = input.email.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email)) throw new ValidationError("Enter a valid email address.");
  const weak = checkPasswordStrength(input.password);
  if (weak) throw new ValidationError(weak);
  checkRoleLocation(input.role, input.locationId);
  if (await prisma.user.findUnique({ where: { email } })) throw new ValidationError("A user with that email already exists.");
  const passwordHash = await hashPassword(input.password);
  return prisma.$transaction(async (tx) => {
    const u = await tx.user.create({ data: { email, passwordHash, role: input.role, locationId: input.locationId } });
    await audit(tx, { userId: actor.id, action: "user.created", entityType: "user", entityId: u.id, details: { role: u.role } });
    return u;
  });
}

export async function updateUser(
  actor: Actor,
  id: string,
  input: { role: RoleKey; locationId: string | null; active: boolean; newPassword?: string },
) {
  assertCan(actor, "admin");
  if (id === actor.id && (input.role !== "admin" || !input.active)) {
    throw new ValidationError("You cannot remove your own admin access.");
  }
  checkRoleLocation(input.role, input.locationId);
  let passwordHash: string | undefined;
  if (input.newPassword) {
    const weak = checkPasswordStrength(input.newPassword);
    if (weak) throw new ValidationError(weak);
    passwordHash = await hashPassword(input.newPassword);
  }
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id },
      data: { role: input.role, locationId: input.locationId, active: input.active, ...(passwordHash ? { passwordHash } : {}) },
    });
    // Deactivating or resetting a password ends existing sessions.
    if (!input.active || passwordHash) await tx.session.deleteMany({ where: { userId: id } });
    await audit(tx, {
      userId: actor.id,
      action: "user.updated",
      entityType: "user",
      entityId: id,
      details: { role: input.role, active: input.active, passwordReset: !!passwordHash },
    });
  });
}

// ---------- Locations & therapists ----------

export async function listLocations() {
  return prisma.location.findMany({ orderBy: { name: "asc" } });
}

export async function listTherapists(locationIds?: string[] | null) {
  return prisma.therapist.findMany({
    where: locationIds ? { locationId: { in: locationIds } } : {},
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    include: { location: true },
  });
}

function checkLocation(input: { name: string; phone: string; bookingLink: string }) {
  if (!input.name.trim()) throw new ValidationError("Location name is required.");
  if (!input.phone.trim()) throw new ValidationError("Location phone is required.");
  if (!/^https?:\/\/\S+$/.test(input.bookingLink.trim())) throw new ValidationError("Booking link must start with http:// or https://");
}

export async function saveLocation(actor: Actor, id: string | null, input: { name: string; phone: string; bookingLink: string }) {
  assertCan(actor, "admin");
  checkLocation(input);
  const data = { name: input.name.trim(), phone: input.phone.trim(), bookingLink: input.bookingLink.trim() };
  return prisma.$transaction(async (tx) => {
    const loc = id ? await tx.location.update({ where: { id }, data }) : await tx.location.create({ data });
    await audit(tx, { userId: actor.id, action: id ? "location.updated" : "location.created", entityType: "location", entityId: loc.id });
    return loc;
  });
}

export async function saveTherapist(
  actor: Actor,
  id: string | null,
  input: { firstName: string; lastName: string; locationId: string; active: boolean },
) {
  assertCan(actor, "admin");
  if (!input.firstName.trim() || !input.lastName.trim()) throw new ValidationError("Therapist first and last name are required.");
  const data = { firstName: input.firstName.trim(), lastName: input.lastName.trim(), locationId: input.locationId, active: input.active };
  return prisma.$transaction(async (tx) => {
    const t = id ? await tx.therapist.update({ where: { id }, data }) : await tx.therapist.create({ data });
    await audit(tx, {
      userId: actor.id,
      action: id ? "therapist.updated" : "therapist.created",
      entityType: "therapist",
      entityId: t.id,
      details: { locationId: t.locationId, active: t.active },
    });
    return t;
  });
}

// ---------- Templates ----------

export async function listTemplates(actor: Actor) {
  assertCan(actor, "admin");
  return prisma.template.findMany({ orderBy: [{ segment: "asc" }, { channel: "asc" }, { name: "asc" }] });
}

/** Longest real location values, so the length check reflects what will actually be sent. */
export async function lengthSampleContext(): Promise<MergeContext> {
  const locations = await prisma.location.findMany();
  const longest = (vals: string[], fallback: string) => vals.reduce((a, b) => (b.length > a.length ? b : a), fallback);
  return {
    ...LENGTH_ESTIMATE_CONTEXT,
    location_name: longest(locations.map((l) => l.name), LENGTH_ESTIMATE_CONTEXT.location_name),
    location_phone: longest(locations.map((l) => l.phone), LENGTH_ESTIMATE_CONTEXT.location_phone),
    booking_link: longest(locations.map((l) => l.bookingLink), LENGTH_ESTIMATE_CONTEXT.booking_link),
  };
}

export async function saveTemplate(
  actor: Actor,
  id: string | null,
  input: { name: string; segment: SegmentKey; channel: "sms" | "email"; subject: string | null; body: string; active: boolean },
) {
  assertCan(actor, "admin");
  if (!input.name.trim()) throw new ValidationError("Template name is required.");
  const errors = validateTemplate(input, await lengthSampleContext());
  if (errors.length > 0) throw new ValidationError(errors.join(" "));
  const data = {
    name: input.name.trim(),
    segment: input.segment,
    channel: input.channel,
    subject: input.channel === "email" ? input.subject?.trim() ?? null : null,
    body: input.body.trim(),
    active: input.active,
  };
  return prisma.$transaction(async (tx) => {
    const t = id ? await tx.template.update({ where: { id }, data }) : await tx.template.create({ data });
    await audit(tx, {
      userId: actor.id,
      action: id ? "template.updated" : "template.created",
      entityType: "template",
      entityId: t.id,
      details: { segment: t.segment, channel: t.channel, active: t.active },
    });
    return t;
  });
}

// ---------- Segment rules ----------

export async function saveSegmentRule(actor: Actor, segment: SegmentKey, minDays: number, maxDays: number) {
  assertCan(actor, "admin");
  const err = validateSegmentRule({ minDays, maxDays });
  if (err) throw new ValidationError(err);
  await prisma.$transaction(async (tx) => {
    await tx.segmentRule.update({ where: { segment }, data: { minDays, maxDays } });
    await audit(tx, { userId: actor.id, action: "segment_rule.updated", entityType: "segment_rule", entityId: segment, details: { minDays, maxDays } });
  });
}
