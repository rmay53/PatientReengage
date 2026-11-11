import { describe, expect, it } from "vitest";
import { classifyByKeywords, KeywordReplyClassifier } from "../../src/lib/classifier/keyword";

const ctx = { firstName: "Testy", locationName: "Northside", locationPhone: "(412) 555-0101", bookingLink: "https://book.example.com/n" };
const c = (t: string) => classifyByKeywords(t, ctx);

describe("reply sorting", () => {
  it.each(["STOP", "stop", "Stop.", "please stop texting me", "UNSUBSCRIBE", "unsubscribe me", "Remove me from this list", "opt out", "STOPALL", "cancel"])(
    "%s -> opt_out",
    (t) => {
      const r = c(t);
      expect(r.category).toBe("opt_out");
      expect(r.optOut).toBe(true);
      expect(r.suggestedReply).toBeNull();
    },
  );

  it.each([
    "I'd like to book another visit",
    "Can I get an appointment next week?",
    "how do I schedule",
    "I want to come back in",
  ])("%s -> booking with a suggested reply containing the booking link", (t) => {
    const r = c(t);
    expect(r.category).toBe("booking");
    expect(r.suggestedReply).toContain(ctx.bookingLink);
    expect(r.urgent).toBe(false);
  });

  it.each([
    "My knee pain is back",
    "it hurts when I climb stairs",
    "some swelling since Tuesday",
    "I fell last night",
    "my fingers feel numb",
    "should I change my medication?",
    "getting worse",
  ])("%s -> clinical, urgent, no suggested reply", (t) => {
    const r = c(t);
    expect(r.category).toBe("clinical");
    expect(r.urgent).toBe(true);
    expect(r.suggestedReply).toBeNull();
  });

  it("chooses clinical over booking when both appear", () => {
    const r = c("I need to book an appointment, the pain is worse");
    expect(r.category).toBe("clinical");
    expect(r.suggestedReply).toBeNull();
  });

  it("still honours an opt-out inside a clinical reply, but keeps it clinical and urgent", () => {
    const r = c("Stop texting me, my back hurts");
    expect(r.category).toBe("clinical");
    expect(r.optOut).toBe(true);
    expect(r.urgent).toBe(true);
  });

  it.each(["Thanks, doing great!", "Who is this?", "ok", ""])("%s -> other with no automatic answer", (t) => {
    const r = c(t);
    expect(r.category).toBe("other");
    expect(r.suggestedReply).toBeNull();
    expect(r.optOut).toBe(false);
  });

  it("does not treat words containing keywords as matches", () => {
    expect(c("I loved the facebook group").category).toBe("other");
    expect(c("Painting the house this week").category).toBe("other");
  });

  it("is available through the ReplyClassifier interface", async () => {
    const r = await new KeywordReplyClassifier().classify("STOP", ctx);
    expect(r.category).toBe("opt_out");
  });
});
