import { describe, expect, it } from "vitest";
import { sanitizeLogFields } from "../../src/lib/log";

describe("log sanitizer", () => {
  it("keeps ids, counts and statuses", () => {
    expect(sanitizeLogFields({ messageId: "ckabc123", status: "sent", count: 3, channel: "sms" })).toEqual({
      messageId: "ckabc123",
      status: "sent",
      count: 3,
      channel: "sms",
    });
  });
  it("drops fields that could carry personal data", () => {
    const out = sanitizeLogFields({ name: "Testa Person", email: "t@example.com", mobile: "+14125550101", body: "Hi", messageId: "m1" });
    expect(out).toEqual({ messageId: "m1" });
  });
  it("redacts free text that sneaks into an allowed key", () => {
    expect(sanitizeLogFields({ patientId: "Testa Person <t@example.com>" })).toEqual({ patientId: "[redacted]" });
  });
});
