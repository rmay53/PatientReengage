import { describe, expect, it } from "vitest";
import { checkSmsBody, render, validateTemplate, withUnsubscribeFooter, unsubscribeUrl } from "../../src/lib/rules/templates";

const example =
  "Hi {first_name}, it's {therapist_first_name} from {location_name}. Just checking in to see how you're feeling. Reply here or call {location_phone} if we can help. Reply STOP to opt out.";

describe("templates", () => {
  it("accepts the spec's example text", () => {
    expect(validateTemplate({ channel: "sms", body: example })).toEqual([]);
  });

  it("renders merge fields", () => {
    expect(
      render("Hi {first_name} from {location_name}", {
        first_name: "Ann",
        therapist_first_name: "Bo",
        location_name: "Eastside",
        location_phone: "x",
        booking_link: "y",
      }),
    ).toBe("Hi Ann from Eastside");
  });

  it("rejects unknown merge fields, including anything clinical", () => {
    const errors = validateTemplate({ channel: "sms", body: "Hi {first_name}, how is your {diagnosis}? Reply STOP to opt out." });
    expect(errors.join(" ")).toMatch(/Unknown merge field.*diagnosis/);
  });

  it("requires opt-out wording on texts", () => {
    expect(validateTemplate({ channel: "sms", body: "Hi {first_name}" }).join(" ")).toMatch(/opt-out/);
  });

  it("caps texts at 300 characters", () => {
    const long = "x".repeat(290) + " Reply STOP to opt out.";
    expect(validateTemplate({ channel: "sms", body: long }).join(" ")).toMatch(/limit is 300/);
    expect(checkSmsBody(long).join(" ")).toMatch(/limit is 300/);
  });

  it("checks edited texts for opt-out wording and unfilled fields", () => {
    expect(checkSmsBody("Hi {first_name}. Reply STOP to opt out.").join(" ")).toMatch(/unfilled/);
    expect(checkSmsBody("Hi there")).toHaveLength(1);
    expect(checkSmsBody("Hi there. Reply STOP to opt out.")).toEqual([]);
  });

  it("requires a subject on email templates", () => {
    expect(validateTemplate({ channel: "email", body: "Hello" }).join(" ")).toMatch(/subject/);
  });

  it("adds an unsubscribe link to every email exactly once", () => {
    const url = unsubscribeUrl("http://localhost:3000/", "msg123");
    expect(url).toBe("http://localhost:3000/unsubscribe/msg123");
    const once = withUnsubscribeFooter("Hello", url);
    expect(once).toContain(url);
    expect(withUnsubscribeFooter(once, url)).toBe(once);
  });
});
