/**
 * Message templates. Only these merge fields exist, and none of them can carry
 * clinical information.
 */
export const MERGE_FIELDS = [
  "first_name",
  "therapist_first_name",
  "location_name",
  "location_phone",
  "booking_link",
] as const;

export type MergeField = (typeof MERGE_FIELDS)[number];
export type MergeContext = Record<MergeField, string>;

export const SMS_MAX_LENGTH = 300;
export const SMS_OPT_OUT_PATTERN = /reply\s+stop/i;
export const SMS_OPT_OUT_HINT = 'Texts must end with opt-out wording such as "Reply STOP to opt out."';

const PLACEHOLDER = /\{([^{}]*)\}/g;
const HAS_PLACEHOLDER = /\{[^{}]*\}/;

export function placeholdersIn(text: string): string[] {
  return Array.from(text.matchAll(PLACEHOLDER), (m) => m[1].trim());
}

export function render(text: string, ctx: MergeContext): string {
  return text.replace(PLACEHOLDER, (whole, name: string) => {
    const key = name.trim() as MergeField;
    return (MERGE_FIELDS as readonly string[]).includes(key) ? ctx[key] ?? "" : whole;
  });
}

/** Values used to estimate the rendered length of a text in the editor. */
export const LENGTH_ESTIMATE_CONTEXT: MergeContext = {
  first_name: "Alexandrine",
  therapist_first_name: "Christopher",
  location_name: "Riverside Physical Therapy",
  location_phone: "(412) 555-0100",
  booking_link: "https://book.example.com/riverside",
};

export function checkSmsBody(body: string): string[] {
  const errors: string[] = [];
  if (body.trim().length === 0) errors.push("Message text is empty.");
  if (body.length > SMS_MAX_LENGTH) errors.push(`Text is ${body.length} characters; the limit is ${SMS_MAX_LENGTH}.`);
  if (!SMS_OPT_OUT_PATTERN.test(body)) errors.push(SMS_OPT_OUT_HINT);
  if (HAS_PLACEHOLDER.test(body)) errors.push("Text still contains an unfilled {merge field}.");
  return errors;
}

export function checkEmailBody(subject: string | null | undefined, body: string): string[] {
  const errors: string[] = [];
  if (!subject || subject.trim().length === 0) errors.push("Emails need a subject.");
  if (body.trim().length === 0) errors.push("Message text is empty.");
  if (HAS_PLACEHOLDER.test(body) || (subject && HAS_PLACEHOLDER.test(subject))) errors.push("Email still contains an unfilled {merge field}.");
  return errors;
}

export interface TemplateInput {
  channel: "sms" | "email";
  subject?: string | null;
  body: string;
}

/** Validates a template before it is saved. `sample` sets the longest real values for length checks. */
export function validateTemplate(t: TemplateInput, sample: MergeContext = LENGTH_ESTIMATE_CONTEXT): string[] {
  const errors: string[] = [];
  const fields = [...placeholdersIn(t.body), ...placeholdersIn(t.subject ?? "")];
  const unknown = fields.filter((f) => !(MERGE_FIELDS as readonly string[]).includes(f));
  if (unknown.length > 0) {
    errors.push(`Unknown merge field(s): ${[...new Set(unknown)].map((f) => `{${f}}`).join(", ")}. Allowed: ${MERGE_FIELDS.map((f) => `{${f}}`).join(", ")}.`);
  }
  if (t.body.trim().length === 0) errors.push("Body is required.");
  if (t.channel === "sms") {
    const rendered = render(t.body, sample);
    if (rendered.length > SMS_MAX_LENGTH) {
      errors.push(`With typical names filled in this text is about ${rendered.length} characters; the limit is ${SMS_MAX_LENGTH}.`);
    }
    if (!SMS_OPT_OUT_PATTERN.test(t.body)) errors.push(SMS_OPT_OUT_HINT);
  } else if (!t.subject || t.subject.trim().length === 0) {
    errors.push("Email templates need a subject.");
  }
  return errors;
}

/** Every email gets an unsubscribe link; the sending layer adds it if missing. */
export function unsubscribeUrl(baseUrl: string, messageId: string): string {
  return `${baseUrl.replace(/\/$/, "")}/unsubscribe/${messageId}`;
}

export function withUnsubscribeFooter(body: string, url: string): string {
  if (body.includes(url)) return body;
  return `${body.trimEnd()}\n\n--\nTo stop receiving these emails, unsubscribe here: ${url}`;
}
