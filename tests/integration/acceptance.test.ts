/**
 * Acceptance checks from the build spec, run against a real PostgreSQL database
 * through the same service layer the web app uses.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildWorld, makePatient, prisma, type World } from "./helpers";
import { buildSampleCsvs } from "../../prisma/sample-csv";
import { commitImport, previewImport } from "../../src/services/imports";
import { draftSegment } from "../../src/services/drafting";
import { approveMany, approveMessage, dispatchMessage, listOutbox, listQueue, rejectMessage } from "../../src/services/messages";
import { listInbox, receiveReply, approveSuggestedReply } from "../../src/services/replies";
import { getPatient, setPatientFlag, searchPatients, unsubscribeByMessage } from "../../src/services/patients";
import { segmentCounts } from "../../src/services/segments";
import { searchAudit } from "../../src/services/audit";
import { createUser, saveTemplate } from "../../src/services/settings";
import { login, actorFromToken } from "../../src/services/auth";
import { ForbiddenError, ValidationError } from "../../src/lib/auth/permissions";

let w: World;
beforeEach(async () => {
  w = await buildWorld();
});
afterAll(async () => {
  await prisma.$disconnect();
});

async function seedSampleCsvPatients() {
  // The sample CSV re-uses these three ids to show flags survive re-uploads.
  await makePatient(w, { externalId: "TEST-00001", smsOptOut: true });
  await makePatient(w, { externalId: "TEST-00002", emailOptOut: true });
  await makePatient(w, { externalId: "TEST-00003", doNotContact: true });
}

describe("upload", () => {
  it("accepts the valid rows of the sample CSV and lists each rejected row with its reason", async () => {
    await seedSampleCsvPatients();
    const { sample } = buildSampleCsvs();
    const preview = await previewImport(w.admin, sample);
    if (!preview.ok) throw new Error(preview.fatal);
    expect(preview.accepted).toHaveLength(42);
    expect(preview.rejected).toHaveLength(8);
    for (const r of preview.rejected) expect(r.reasons.length).toBeGreaterThan(0);
    const all = preview.rejected.flatMap((r) => r.reasons).join(" | ");
    for (const reason of ["Missing contact details", "Bad date", "Unknown location", "Unknown therapist", "discharge_type", "Mobile", "Duplicate", "future"]) {
      expect(all).toContain(reason);
    }
    // Preview writes nothing.
    expect(await prisma.patient.count()).toBe(3);

    const summary = await commitImport(w.admin, "sample-patients.csv", sample);
    expect(summary).toMatchObject({ created: 39, updated: 3, rejected: 8 });
    expect(await prisma.patient.count()).toBe(42);
  });

  it("refuses a CSV with a diagnosis or date-of-birth column and imports nothing", async () => {
    const { refusedDiagnosis, refusedDateOfBirth } = buildSampleCsvs();
    for (const csv of [refusedDiagnosis, refusedDateOfBirth]) {
      const preview = await previewImport(w.admin, csv);
      expect(preview.ok).toBe(false);
      await expect(commitImport(w.admin, "bad.csv", csv)).rejects.toThrow(/refused/);
    }
    expect(await prisma.patient.count()).toBe(0);
  });

  it("re-uploading the same file creates no duplicates and clears no opt-out flags", async () => {
    await seedSampleCsvPatients();
    const { sample } = buildSampleCsvs();
    await commitImport(w.admin, "a.csv", sample);
    const second = await commitImport(w.admin, "a.csv", sample);
    expect(second.created).toBe(0);
    expect(second.updated).toBe(42);
    expect(await prisma.patient.count()).toBe(42);
    const flags = await prisma.patient.findMany({
      where: { externalId: { in: ["TEST-00001", "TEST-00002", "TEST-00003"] } },
      orderBy: { externalId: "asc" },
    });
    expect(flags.map((p) => [p.smsOptOut, p.emailOptOut, p.doNotContact])).toEqual([
      [true, false, false],
      [false, true, false],
      [false, false, true],
    ]);
    // The file says sms_opt_in=yes for TEST-00001, but the opt-out still wins: no texts.
    expect(flags[0].smsOptIn).toBe(true);
  });

  it("limits approvers to rows for their own location", async () => {
    const { sample } = buildSampleCsvs();
    const preview = await previewImport(w.approver, sample);
    if (!preview.ok) throw new Error(preview.fatal);
    expect(preview.accepted.every((r) => r.locationId === w.approver.locationId)).toBe(true);
    expect(preview.rejected.some((r) => r.reasons.some((x) => /your account/.test(x)))).toBe(true);
  });
});

describe("drafting and the never-contact rules", () => {
  it("drafts nobody on the never-contact list", async () => {
    const ok = await makePatient(w);
    const blocked = [
      await makePatient(w, { doNotContact: true }),
      await makePatient(w, { smsOptIn: false, email: null }),
      await makePatient(w, { smsOptOut: true, emailOptOut: true }),
      await makePatient(w, { smsOptIn: false, emailOptOut: true }),
    ];
    const alreadyForSegment = await makePatient(w);
    await prisma.message.create({
      data: { patientId: alreadyForSegment.id, segment: "check_in", channel: "sms", body: "x", status: "sent", sentAt: new Date(Date.now() - 2 * 86400_000), decidedBy: w.admin.id },
    });
    const recent = await makePatient(w);
    await prisma.message.create({
      data: { patientId: recent.id, segment: "lapsed", channel: "sms", body: "x", status: "sent", sentAt: new Date(Date.now() - 10 * 86400_000), decidedBy: w.admin.id },
    });

    const result = await draftSegment(w.admin, "check_in", null);
    expect(result.drafted).toBe(1);
    expect(result.skipped).toMatchObject({ do_not_contact: 1, no_permitted_channel: 3, already_messaged_for_segment: 1, messaged_in_last_30_days: 1 });
    const drafted = await prisma.message.findMany({ where: { status: "drafted" } });
    expect(drafted.map((m) => m.patientId)).toEqual([ok.id]);
    for (const b of [...blocked, alreadyForSegment, recent]) expect(drafted.some((m) => m.patientId === b.id)).toBe(false);
  });

  it("drafts an email, never a text, for a patient without text opt-in", async () => {
    const p = await makePatient(w, { smsOptIn: false });
    await draftSegment(w.admin, "check_in", null);
    const m = await prisma.message.findFirstOrThrow({ where: { patientId: p.id } });
    expect(m.channel).toBe("email");
    expect(m.subject).toBeTruthy();
  });

  it("drafts texts from the template with merge fields filled and opt-out wording", async () => {
    const p = await makePatient(w, { firstName: "Mergey" });
    await draftSegment(w.admin, "check_in", null);
    const m = await prisma.message.findFirstOrThrow({ where: { patientId: p.id } });
    expect(m.channel).toBe("sms");
    expect(m.body).toMatch(/^Hi Mergey, it's Quinn from Northside Physical Therapy\./);
    expect(m.body).toMatch(/Reply STOP to opt out\.$/);
    expect(m.body.length).toBeLessThanOrEqual(300);
  });

  it("does not double-draft when a segment is drafted twice", async () => {
    await makePatient(w);
    await draftSegment(w.admin, "check_in", null);
    const again = await draftSegment(w.admin, "check_in", null);
    expect(again.drafted).toBe(0);
    expect(await prisma.message.count()).toBe(1);
  });

  it("only drafts patients in the segment's window", async () => {
    await makePatient(w, { daysAgo: 10 });
    await makePatient(w, { daysAgo: 90 });
    await makePatient(w, { daysAgo: 30, dischargeType: "lapsed" });
    expect((await draftSegment(w.admin, "check_in", null)).drafted).toBe(0);
    expect((await draftSegment(w.admin, "three_month", null)).drafted).toBe(1);
    expect((await draftSegment(w.admin, "lapsed", null)).drafted).toBe(1);
  });
});

describe("approval and sending", () => {
  it("never puts a message in the outbox without an approval recorded against a named user", async () => {
    const p = await makePatient(w);
    await draftSegment(w.admin, "check_in", null);
    const m = await prisma.message.findFirstOrThrow({ where: { patientId: p.id } });
    await expect(dispatchMessage(w.admin, m.id)).rejects.toThrow(ValidationError);
    expect(await listOutbox(w.admin)).toHaveLength(0);

    expect(await approveMessage(w.approver, m.id)).toBe("sent");
    const sent = await prisma.message.findUniqueOrThrow({ where: { id: m.id } });
    expect(sent).toMatchObject({ status: "sent", decidedBy: w.approver.id });
    expect(sent.sentAt).toBeTruthy();
    expect(await prisma.simulatedDelivery.count({ where: { messageId: m.id } })).toBe(1);
    const outbox = await listOutbox(w.admin);
    expect(outbox).toHaveLength(1);
    expect(outbox.every((o) => o.decidedBy)).toBe(true);
  });

  it("edit-then-approve keeps the original text and refuses edits that break the text rules", async () => {
    await makePatient(w);
    await draftSegment(w.admin, "check_in", null);
    const m = await prisma.message.findFirstOrThrow();
    await expect(approveMessage(w.admin, m.id, { body: "Hi! Come back soon." })).rejects.toThrow(/opt-out/);
    await expect(approveMessage(w.admin, m.id, { body: "x".repeat(290) + " Reply STOP to opt out." })).rejects.toThrow(/300/);
    await approveMessage(w.admin, m.id, { body: "Hi there, hope you're well! Reply STOP to opt out." });
    const after = await prisma.message.findUniqueOrThrow({ where: { id: m.id } });
    expect(after).toMatchObject({ edited: true, originalBody: m.body, status: "sent" });
  });

  it("approve all selected and reject both work and cannot be repeated", async () => {
    for (let i = 0; i < 3; i++) await makePatient(w);
    await draftSegment(w.admin, "check_in", null);
    const [a, b, c] = await prisma.message.findMany({ orderBy: { id: "asc" } });
    await rejectMessage(w.approver, c.id);
    const bulk = await approveMany(w.approver, [a.id, b.id, c.id]);
    expect(bulk.approved).toBe(2);
    expect(bulk.failed).toHaveLength(1);
    await expect(rejectMessage(w.approver, a.id)).rejects.toThrow(/already/);
  });

  it("refuses to approve a draft for a patient who opted out after drafting", async () => {
    const p = await makePatient(w);
    await draftSegment(w.admin, "check_in", null);
    const m = await prisma.message.findFirstOrThrow();
    await prisma.patient.update({ where: { id: p.id }, data: { smsOptOut: true } });
    await expect(approveMessage(w.admin, m.id)).rejects.toThrow(/no longer be texted/);
  });

  it("adds an unsubscribe link to every email, and the link works", async () => {
    const p = await makePatient(w, { smsOptIn: false });
    await draftSegment(w.admin, "check_in", null);
    const m = await prisma.message.findFirstOrThrow();
    await approveMessage(w.admin, m.id);
    const delivery = await prisma.simulatedDelivery.findFirstOrThrow({ where: { messageId: m.id } });
    expect(delivery.body).toContain(`/unsubscribe/${m.id}`);
    expect(await unsubscribeByMessage(m.id)).toBe(true);
    expect((await prisma.patient.findUniqueOrThrow({ where: { id: p.id } })).emailOptOut).toBe(true);
  });
});

describe("roles and locations", () => {
  it("an approver cannot see or act on another location's patients", async () => {
    const mine = await makePatient(w, { locationIndex: 0 });
    const theirs = await makePatient(w, { locationIndex: 1 });
    await draftSegment(w.admin, "check_in", null);
    const theirMsg = await prisma.message.findFirstOrThrow({ where: { patientId: theirs.id } });

    const queue = await listQueue(w.approver);
    expect(queue.items.map((m) => m.patientId)).toEqual([mine.id]);
    expect((await searchPatients(w.approver, "")).items.map((p) => p.id)).toEqual([mine.id]);
    await expect(getPatient(w.approver, theirs.id)).rejects.toThrow(ForbiddenError);
    await expect(approveMessage(w.approver, theirMsg.id)).rejects.toThrow(ForbiddenError);
    await expect(rejectMessage(w.approver, theirMsg.id)).rejects.toThrow(ForbiddenError);
    await expect(receiveReply(w.approver, theirs.id, "hello")).rejects.toThrow(ForbiddenError);
    await expect(setPatientFlag(w.approver, theirs.id, "doNotContact", true)).rejects.toThrow(ForbiddenError);
    await expect(draftSegment(w.approver, "check_in", w.locations[1].id)).rejects.toThrow(ForbiddenError);
    const counts = await segmentCounts(w.approver);
    expect(counts.locations.map((l) => l.id)).toEqual([w.locations[0].id]);
    expect((await prisma.message.findUniqueOrThrow({ where: { id: theirMsg.id } })).status).toBe("drafted");
  });

  it("an approver drafting a segment only drafts their own location", async () => {
    await makePatient(w, { locationIndex: 0 });
    await makePatient(w, { locationIndex: 1 });
    expect((await draftSegment(w.approver, "check_in", null)).drafted).toBe(1);
  });

  it("a viewer can see counts and the audit log but cannot change anything", async () => {
    const p = await makePatient(w);
    await draftSegment(w.admin, "check_in", null);
    const m = await prisma.message.findFirstOrThrow();
    const { sample } = buildSampleCsvs();

    await expect(segmentCounts(w.viewer)).resolves.toBeTruthy();
    await expect(searchAudit(w.viewer)).resolves.toBeTruthy();

    const attempts = [
      () => previewImport(w.viewer, sample),
      () => commitImport(w.viewer, "x.csv", sample),
      () => draftSegment(w.viewer, "check_in", null),
      () => approveMessage(w.viewer, m.id),
      () => rejectMessage(w.viewer, m.id),
      () => approveMany(w.viewer, [m.id]),
      () => receiveReply(w.viewer, p.id, "STOP"),
      () => setPatientFlag(w.viewer, p.id, "doNotContact", true),
      () => listQueue(w.viewer),
      () => getPatient(w.viewer, p.id),
      () => listInbox(w.viewer),
      () => createUser(w.viewer, { email: "x@example.com", password: "long-enough-password", role: "admin", locationId: null }),
      () => saveTemplate(w.viewer, null, { name: "x", segment: "check_in", channel: "sms", subject: null, body: "Hi. Reply STOP to opt out.", active: true }),
    ];
    for (const attempt of attempts) await expect(attempt()).rejects.toThrow(ForbiddenError);
    expect((await prisma.message.findUniqueOrThrow({ where: { id: m.id } })).status).toBe("drafted");
    expect(await prisma.patient.count()).toBe(1);
  });

  it("an approver cannot clear an opt-out; an admin can", async () => {
    const p = await makePatient(w, { smsOptOut: true });
    await expect(setPatientFlag(w.approver, p.id, "smsOptOut", false)).rejects.toThrow(/Only an admin/);
    await setPatientFlag(w.admin, p.id, "smsOptOut", false);
    expect((await prisma.patient.findUniqueOrThrow({ where: { id: p.id } })).smsOptOut).toBe(false);
  });
});

describe("replies", () => {
  async function sentTo(patientId: string) {
    await draftSegment(w.admin, "check_in", null);
    const m = await prisma.message.findFirstOrThrow({ where: { patientId } });
    await approveMessage(w.admin, m.id);
    return m;
  }

  it('a "STOP" reply sets the opt-out flag and the patient is excluded from the next draft', async () => {
    const p = await makePatient(w, { daysAgo: 20 });
    await sentTo(p.id);
    const r = await receiveReply(w.approver, p.id, "STOP");
    expect(r.category).toBe("opt_out");
    const after = await prisma.patient.findUniqueOrThrow({ where: { id: p.id } });
    expect(after.smsOptOut).toBe(true);
    expect(after.emailOptOut).toBe(true);

    const reply = await prisma.reply.findFirstOrThrow({ where: { patientId: p.id } });
    expect(reply.handledAt).toBeTruthy();
    expect(reply.responseBody).toMatch(/unsubscribed/);
    expect(await prisma.simulatedDelivery.count({ where: { replyId: reply.id } })).toBe(1);

    // Move the patient into the 3-month window, 40 days after the last send, and draft again.
    await prisma.patient.update({ where: { id: p.id }, data: { dischargeDate: new Date(Date.now() - 90 * 86400_000) } });
    await prisma.message.updateMany({ where: { patientId: p.id }, data: { sentAt: new Date(Date.now() - 40 * 86400_000) } });
    const result = await draftSegment(w.admin, "three_month", null);
    expect(result.drafted).toBe(0);
    expect(result.skipped.no_permitted_channel).toBe(1);
  });

  it("an opt-out withdraws drafts still waiting for approval", async () => {
    const p = await makePatient(w);
    await draftSegment(w.admin, "check_in", null);
    await receiveReply(w.admin, p.id, "please remove me");
    const m = await prisma.message.findFirstOrThrow({ where: { patientId: p.id } });
    expect(m.status).toBe("rejected");
    expect(await listQueue(w.admin)).toMatchObject({ total: 0 });
  });

  it("a reply mentioning pain goes to the staff inbox as urgent with no suggested reply", async () => {
    const p = await makePatient(w);
    await sentTo(p.id);
    const r = await receiveReply(w.approver, p.id, "Thanks for checking in, but the pain in my shoulder is back");
    expect(r).toMatchObject({ category: "clinical", urgent: true, suggestedReply: null });
    const inbox = await listInbox(w.approver);
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({ category: "clinical", urgent: true, suggestedReply: null, handledAt: null, responseBody: null });
    expect(await prisma.simulatedDelivery.count({ where: { replyId: inbox[0].id } })).toBe(0);
  });

  it("a booking reply gets a suggested response that is only sent after staff approve it", async () => {
    const p = await makePatient(w);
    await sentTo(p.id);
    const r = await receiveReply(w.approver, p.id, "Can I book an appointment for next week?");
    expect(r.category).toBe("booking");
    expect(r.suggestedReply).toContain("https://book.example.com/northside");
    const reply = await prisma.reply.findFirstOrThrow({ where: { patientId: p.id } });
    expect(await prisma.simulatedDelivery.count({ where: { replyId: reply.id } })).toBe(0);
    await approveSuggestedReply(w.approver, reply.id);
    const after = await prisma.reply.findUniqueOrThrow({ where: { id: reply.id } });
    expect(after).toMatchObject({ handledBy: w.approver.id });
    expect(await prisma.simulatedDelivery.count({ where: { replyId: reply.id } })).toBe(1);
  });
});

describe("audit log", () => {
  it("records every upload, approval, edit, rejection and send", async () => {
    await seedSampleCsvPatients();
    const { sample } = buildSampleCsvs();
    const batch = await commitImport(w.admin, "sample.csv", sample);
    await draftSegment(w.admin, "check_in", null);
    const msgs = await prisma.message.findMany({ where: { status: "drafted" }, orderBy: { id: "asc" }, take: 3 });
    expect(msgs.length).toBe(3);
    await approveMessage(w.admin, msgs[0].id);
    await approveMessage(w.admin, msgs[1].id, { body: msgs[1].channel === "sms" ? "Edited text. Reply STOP to opt out." : "Edited email body.", subject: msgs[1].subject });
    await rejectMessage(w.admin, msgs[2].id);

    const rows = await prisma.auditLog.findMany();
    const has = (action: string, entityId: string) => rows.some((r) => r.action === action && r.entityId === entityId && r.userId === w.admin.id);
    expect(has("import.uploaded", batch.batchId)).toBe(true);
    expect(has("message.approved", msgs[0].id)).toBe(true);
    expect(has("message.sent", msgs[0].id)).toBe(true);
    expect(has("message.edited", msgs[1].id)).toBe(true);
    expect(has("message.approved", msgs[1].id)).toBe(true);
    expect(has("message.sent", msgs[1].id)).toBe(true);
    expect(has("message.rejected", msgs[2].id)).toBe(true);
    expect(rows.filter((r) => r.action === "patient.created").length).toBe(batch.created);
    expect(rows.filter((r) => r.action === "message.drafted").length).toBeGreaterThan(0);

    // No personal data in audit details.
    const patients = await prisma.patient.findMany();
    const blob = JSON.stringify(rows);
    for (const p of patients) {
      expect(blob).not.toContain(p.lastName);
      if (p.email) expect(blob).not.toContain(p.email);
    }
  });
});

describe("auth", () => {
  it("signs in with an individual email and password, and refuses wrong passwords and inactive users", async () => {
    expect(await login("approver@example.com", "wrong-password-123")).toBeNull();
    const s = await login("APPROVER@example.com", "integration-test-password");
    expect(s).not.toBeNull();
    const actor = await actorFromToken(s!.token);
    expect(actor).toMatchObject({ id: w.approver.id, role: "approver" });
    const session = await prisma.session.findFirstOrThrow();
    expect(session.tokenHash).not.toBe(s!.token);
    await prisma.user.update({ where: { id: w.approver.id }, data: { active: false } });
    expect(await actorFromToken(s!.token)).toBeNull();
    expect(await login("approver@example.com", "integration-test-password")).toBeNull();
  });
});

describe("application logs", () => {
  it("contain no names, emails, phone numbers or message text", async () => {
    const lines: string[] = [];
    const capture = (...args: unknown[]) => lines.push(args.map(String).join(" "));
    const spyLog = vi.spyOn(console, "log").mockImplementation(capture);
    const spyErr = vi.spyOn(console, "error").mockImplementation(capture);
    const spyWarn = vi.spyOn(console, "warn").mockImplementation(capture);
    const prev = process.env.LOG_LEVEL;
    process.env.LOG_LEVEL = "info";
    try {
      await seedSampleCsvPatients();
      const { sample } = buildSampleCsvs();
      await commitImport(w.admin, "sample.csv", sample);
      await draftSegment(w.admin, "check_in", null);
      await draftSegment(w.admin, "lapsed", null);
      const msgs = await prisma.message.findMany({ where: { status: "drafted" }, take: 4 });
      for (const m of msgs) await approveMessage(w.admin, m.id);
      const p = await prisma.patient.findUniqueOrThrow({ where: { id: msgs[0].patientId } });
      await receiveReply(w.admin, p.id, "my knee hurts");
      await receiveReply(w.admin, p.id, "book me in");
      await receiveReply(w.admin, p.id, "STOP");
      await login("admin@example.com", "nope-wrong-password");
      await login("admin@example.com", "integration-test-password");
    } finally {
      process.env.LOG_LEVEL = prev;
      spyLog.mockRestore();
      spyErr.mockRestore();
      spyWarn.mockRestore();
    }
    expect(lines.length).toBeGreaterThan(5);
    const output = lines.join("\n");
    const patients = await prisma.patient.findMany();
    const messages = await prisma.message.findMany({ where: { status: "sent" } });
    for (const pt of patients) {
      expect(output).not.toContain(pt.firstName);
      expect(output).not.toContain(pt.lastName);
      if (pt.email) expect(output).not.toContain(pt.email);
      if (pt.mobile) expect(output).not.toContain(pt.mobile.slice(-7));
    }
    for (const m of messages) expect(output).not.toContain(m.body.slice(0, 30));
    for (const t of ["knee hurts", "book me in", "admin@example.com"]) expect(output).not.toContain(t);
    expect(output).not.toMatch(/@example\.com/);
    expect(output).not.toMatch(/555-?01\d\d/);
  });
});
