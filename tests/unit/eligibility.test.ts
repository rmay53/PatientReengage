import { describe, expect, it } from "vitest";
import { checkEligibility, chooseChannel, type ContactFlags, type PriorMessage } from "../../src/lib/rules/eligibility";
import { addDays } from "../../src/lib/dates";

const now = new Date("2026-11-11T12:00:00Z");
const base: ContactFlags = {
  email: "pat@example.com",
  mobile: "+14125550123",
  smsOptIn: true,
  smsOptOut: false,
  emailOptOut: false,
  doNotContact: false,
};
const p = (o: Partial<ContactFlags> = {}): ContactFlags => ({ ...base, ...o });

describe("channel choice", () => {
  it("texts patients who opted in", () => expect(chooseChannel(p())).toBe("sms"));
  it("emails patients without text opt-in", () => expect(chooseChannel(p({ smsOptIn: false }))).toBe("email"));
  it("emails patients who opted out of texts even if they once opted in", () =>
    expect(chooseChannel(p({ smsOptOut: true }))).toBe("email"));
  it("emails patients who opted in but have no mobile", () => expect(chooseChannel(p({ mobile: null }))).toBe("email"));
  it("never texts without opt-in even when email is unavailable", () =>
    expect(chooseChannel(p({ smsOptIn: false, email: null }))).toBeNull());
  it("returns null when email opted out and no text opt-in", () =>
    expect(chooseChannel(p({ smsOptIn: false, emailOptOut: true }))).toBeNull());
});

describe("never-contact rules", () => {
  it("allows an ordinary patient", () => {
    expect(checkEligibility(p(), "check_in", [], now)).toEqual({ eligible: true, channel: "sms" });
  });

  it("excludes do_not_contact even with every opt-in", () => {
    expect(checkEligibility(p({ doNotContact: true }), "check_in", [], now)).toEqual({ eligible: false, reason: "do_not_contact" });
  });

  it("excludes patients with no permitted channel", () => {
    const r = checkEligibility(p({ smsOptIn: false, email: null }), "check_in", [], now);
    expect(r).toEqual({ eligible: false, reason: "no_permitted_channel" });
  });

  it("excludes text opt-outs who also opted out of email", () => {
    const r = checkEligibility(p({ smsOptOut: true, emailOptOut: true }), "three_month", [], now);
    expect(r).toEqual({ eligible: false, reason: "no_permitted_channel" });
  });

  it("excludes anyone who already received a message for the same segment, however long ago", () => {
    const history: PriorMessage[] = [{ segment: "three_month", status: "sent", sentAt: addDays(now, -400) }];
    expect(checkEligibility(p(), "three_month", history, now)).toEqual({ eligible: false, reason: "already_messaged_for_segment" });
  });

  it("excludes anyone with a pending draft or approval for the segment", () => {
    for (const status of ["drafted", "approved"] as const) {
      const history: PriorMessage[] = [{ segment: "check_in", status, sentAt: null }];
      expect(checkEligibility(p(), "check_in", history, now)).toMatchObject({ eligible: false, reason: "already_messaged_for_segment" });
    }
  });

  it("allows a re-draft after a rejected or failed message for the segment", () => {
    const history: PriorMessage[] = [
      { segment: "check_in", status: "rejected", sentAt: null },
      { segment: "check_in", status: "failed", sentAt: null },
    ];
    expect(checkEligibility(p(), "check_in", history, now)).toMatchObject({ eligible: true });
  });

  it("excludes anyone sent any message in the last 30 days", () => {
    const history: PriorMessage[] = [{ segment: "lapsed", status: "sent", sentAt: addDays(now, -29) }];
    expect(checkEligibility(p(), "check_in", history, now)).toEqual({ eligible: false, reason: "messaged_in_last_30_days" });
  });

  it("allows contact once 30 days have passed", () => {
    const history: PriorMessage[] = [{ segment: "lapsed", status: "sent", sentAt: addDays(now, -30) }];
    expect(checkEligibility(p(), "check_in", history, now)).toMatchObject({ eligible: true });
  });

  it("checks do_not_contact before anything else", () => {
    const history: PriorMessage[] = [{ segment: "check_in", status: "sent", sentAt: addDays(now, -2) }];
    expect(checkEligibility(p({ doNotContact: true }), "check_in", history, now)).toMatchObject({ reason: "do_not_contact" });
  });
});
