import { prisma } from "../../src/lib/db";
import { hashPassword } from "../../src/lib/auth/password";
import type { Actor } from "../../src/lib/auth/permissions";
import { DEFAULT_SEGMENT_RULES } from "../../src/lib/rules/segments";
import { addDays } from "../../src/lib/dates";
import { LOCATIONS, TEMPLATES, THERAPISTS } from "../../prisma/fixtures";

export { prisma };

export async function resetDb() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE simulated_deliveries, replies, messages, patients, templates, segment_rules,
             import_batches, audit_log, sessions, users, therapists, locations RESTART IDENTITY CASCADE`);
}

export interface World {
  admin: Actor;
  approver: Actor; // location 0
  otherApprover: Actor; // location 1
  viewer: Actor;
  locations: { id: string; name: string }[];
  therapists: { id: string; firstName: string; lastName: string; locationId: string }[];
}

export async function buildWorld(): Promise<World> {
  await resetDb();
  const locations = [];
  for (const l of LOCATIONS) locations.push(await prisma.location.create({ data: l }));
  const therapists = [];
  for (let i = 0; i < THERAPISTS.length; i++) {
    therapists.push(
      await prisma.therapist.create({ data: { firstName: THERAPISTS[i][0], lastName: THERAPISTS[i][1], locationId: locations[Math.floor(i / 3)].id } }),
    );
  }
  const passwordHash = await hashPassword("integration-test-password");
  const mk = async (email: string, role: "admin" | "approver" | "viewer", locationId: string | null): Promise<Actor> => {
    const u = await prisma.user.create({ data: { email, passwordHash, role, locationId } });
    return { id: u.id, email: u.email, role: u.role, locationId: u.locationId };
  };
  await prisma.segmentRule.createMany({ data: DEFAULT_SEGMENT_RULES });
  for (const t of TEMPLATES) await prisma.template.create({ data: { ...t, subject: t.subject ?? null } });
  return {
    admin: await mk("admin@example.com", "admin", null),
    approver: await mk("approver@example.com", "approver", locations[0].id),
    otherApprover: await mk("approver2@example.com", "approver", locations[1].id),
    viewer: await mk("viewer@example.com", "viewer", null),
    locations,
    therapists,
  };
}

let counter = 0;
export async function makePatient(
  w: World,
  o: Partial<{
    locationIndex: number;
    daysAgo: number;
    dischargeType: "completed" | "lapsed";
    email: string | null;
    mobile: string | null;
    smsOptIn: boolean;
    smsOptOut: boolean;
    emailOptOut: boolean;
    doNotContact: boolean;
    externalId: string;
    firstName: string;
  }> = {},
) {
  counter++;
  const loc = w.locations[o.locationIndex ?? 0];
  const therapist = w.therapists.find((t) => t.locationId === loc.id)!;
  return prisma.patient.create({
    data: {
      externalId: o.externalId ?? `INT-${counter}-${Math.random().toString(36).slice(2, 8)}`,
      firstName: o.firstName ?? `Testfirst${counter}`,
      lastName: `Testlast${counter}`,
      email: o.email === undefined ? `int${counter}@example.com` : o.email,
      mobile: o.mobile === undefined ? `+1412555${String(100 + (counter % 100)).padStart(4, "0")}` : o.mobile,
      locationId: loc.id,
      therapistId: therapist.id,
      dischargeDate: addDays(new Date(), -(o.daysAgo ?? 20)),
      dischargeType: o.dischargeType ?? "completed",
      smsOptIn: o.smsOptIn ?? true,
      smsOptOut: o.smsOptOut ?? false,
      emailOptOut: o.emailOptOut ?? false,
      doNotContact: o.doNotContact ?? false,
    },
  });
}
