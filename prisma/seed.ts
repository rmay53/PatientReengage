/**
 * Seeds invented test data: 4 locations, 12 therapists, 3 users (one per role),
 * templates, segment rules and 600 fictional patients across every segment.
 *
 *   SEED_USER_PASSWORD=... npm run seed            # refuses if patients already exist
 *   SEED_USER_PASSWORD=... npm run seed -- --reset  # wipes ALL data first (test data only!)
 */
import { PrismaClient, type Segment, type Template } from "@prisma/client";
import { hashPassword } from "../src/lib/auth/password";
import { DEFAULT_SEGMENT_RULES } from "../src/lib/rules/segments";
import { addDays } from "../src/lib/dates";
import { FIRST_NAMES, LAST_NAMES, LOCATIONS, TEMPLATES, THERAPISTS, rng, testEmail, testMobile } from "./fixtures";

const prisma = new PrismaClient();
const PATIENT_COUNT = 600;

async function main() {
  const password = process.env.SEED_USER_PASSWORD;
  if (!password || password.length < 12) {
    throw new Error("Set SEED_USER_PASSWORD (at least 12 characters) before seeding. It becomes the password for the three test users.");
  }
  const reset = process.argv.includes("--reset");
  const existing = await prisma.patient.count();
  if (existing > 0 && !reset) {
    console.log(`Database already has ${existing} patients. Re-run with "-- --reset" to wipe and reseed.`);
    return;
  }
  if (reset) {
    console.log("Resetting: deleting all data.");
    await prisma.$transaction([
      prisma.simulatedDelivery.deleteMany(),
      prisma.reply.deleteMany(),
      prisma.message.deleteMany(),
      prisma.patient.deleteMany(),
      prisma.template.deleteMany(),
      prisma.segmentRule.deleteMany(),
      prisma.importBatch.deleteMany(),
      prisma.auditLog.deleteMany(),
      prisma.session.deleteMany(),
      prisma.user.deleteMany(),
      prisma.therapist.deleteMany(),
      prisma.location.deleteMany(),
    ]);
  }

  const today = new Date();
  const rand = rng(20261111);
  const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)];
  const between = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));

  const locations = [];
  for (const l of LOCATIONS) locations.push(await prisma.location.create({ data: l }));

  const therapists = [];
  for (let i = 0; i < THERAPISTS.length; i++) {
    const [firstName, lastName] = THERAPISTS[i];
    therapists.push(await prisma.therapist.create({ data: { firstName, lastName, locationId: locations[Math.floor(i / 3)].id } }));
  }

  const passwordHash = await hashPassword(password);
  const admin = await prisma.user.create({ data: { email: "admin@example.com", passwordHash, role: "admin" } });
  await prisma.user.create({ data: { email: "approver@example.com", passwordHash, role: "approver", locationId: locations[0].id } });
  await prisma.user.create({ data: { email: "viewer@example.com", passwordHash, role: "viewer" } });

  await prisma.segmentRule.createMany({ data: DEFAULT_SEGMENT_RULES });
  const templates: Template[] = [];
  for (const t of TEMPLATES) templates.push(await prisma.template.create({ data: { ...t, subject: t.subject ?? null } }));
  const templateFor = (segment: Segment, channel: "sms" | "email") => templates.find((t) => t.segment === segment && t.channel === channel)!;

  // Spread patients across segments, plus some between segments.
  const buckets: { weight: number; type: "completed" | "lapsed"; days: [number, number]; segment: Segment | null }[] = [
    { weight: 15, type: "completed", days: [14, 30], segment: "check_in" },
    { weight: 14, type: "completed", days: [75, 105], segment: "three_month" },
    { weight: 13, type: "completed", days: [165, 195], segment: "six_month" },
    { weight: 12, type: "completed", days: [350, 380], segment: "twelve_month" },
    { weight: 14, type: "lapsed", days: [14, 90], segment: "lapsed" },
    { weight: 18, type: "completed", days: [0, 400], segment: null },
    { weight: 6, type: "lapsed", days: [0, 300], segment: null },
    { weight: 8, type: "completed", days: [0, 13], segment: null },
  ];
  const totalWeight = buckets.reduce((s, b) => s + b.weight, 0);
  const chooseBucket = () => {
    let r = rand() * totalWeight;
    for (const b of buckets) if ((r -= b.weight) < 0) return b;
    return buckets[0];
  };

  let historyCount = 0;
  for (let n = 1; n <= PATIENT_COUNT; n++) {
    const bucket = chooseBucket();
    const firstName = pick(FIRST_NAMES);
    const lastName = pick(LAST_NAMES);
    const therapist = pick(therapists);
    const daysAgo = between(bucket.days[0], bucket.days[1]);

    let email: string | null = testEmail(firstName, lastName, n);
    let mobile: string | null = testMobile(n);
    const r = rand();
    if (r < 0.1) email = null; // missing email
    else if (r < 0.22) mobile = null; // missing mobile
    let smsOptIn = !!mobile && rand() < 0.65;
    let smsOptOut = rand() < 0.06;
    let emailOptOut = rand() < 0.05;
    let doNotContact = rand() < 0.03;

    // A few fixed cases, also used by the sample CSV to show opt-outs survive re-uploads.
    if (n === 1) [smsOptIn, smsOptOut, mobile] = [true, true, testMobile(1)];
    if (n === 2) [emailOptOut, email] = [true, testEmail(firstName, lastName, 2)];
    if (n === 3) doNotContact = true;

    const patient = await prisma.patient.create({
      data: {
        externalId: `TEST-${String(n).padStart(5, "0")}`,
        firstName,
        lastName,
        email,
        mobile,
        locationId: therapist.locationId,
        therapistId: therapist.id,
        dischargeDate: addDays(today, -daysAgo),
        dischargeType: bucket.type,
        smsOptIn,
        smsOptOut,
        emailOptOut,
        doNotContact,
      },
    });

    // Realistic message history so the never-contact rules have something to bite on.
    const channel = smsOptIn && !smsOptOut ? "sms" : "email";
    const history: { segment: Segment; daysAgoSent: number }[] = [];
    if (bucket.type === "completed" && daysAgo > 60 && rand() < 0.5) history.push({ segment: "check_in", daysAgoSent: daysAgo - between(14, 30) });
    if (bucket.segment && rand() < 0.05) history.push({ segment: bucket.segment, daysAgoSent: between(1, 10) }); // already sent for this segment
    if (bucket.segment && bucket.segment !== "check_in" && rand() < 0.05) history.push({ segment: "lapsed", daysAgoSent: between(2, 25) }); // recent contact
    for (const h of history) {
      if (h.daysAgoSent < 0) continue;
      const t = templateFor(h.segment, channel);
      const sentAt = addDays(today, -h.daysAgoSent);
      await prisma.message.create({
        data: {
          patientId: patient.id,
          templateId: t.id,
          segment: h.segment,
          channel,
          subject: t.subject,
          body: `[seeded history] ${t.name}`,
          status: "sent",
          draftedAt: sentAt,
          decidedBy: admin.id,
          decidedAt: sentAt,
          sentAt,
        },
      });
      historyCount++;
    }
  }

  console.log(`Seeded ${locations.length} locations, ${therapists.length} therapists, 3 users, ${templates.length} templates, ${PATIENT_COUNT} patients, ${historyCount} historical messages.`);
  console.log("Users: admin@example.com, approver@example.com (Northside), viewer@example.com - password is SEED_USER_PASSWORD.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
