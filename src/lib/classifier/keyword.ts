import type { Classification, ReplyClassifier, ReplyContext } from "./types";

// Opt-out: carrier keywords and common phrases. Erring toward honouring an
// opt-out is deliberate.
const OPT_OUT = [
  /\bstop\b/i,
  /\bstopall\b/i,
  /\bunsubscribe\b/i,
  /\bremove me\b/i,
  /\bopt[\s-]?out\b/i,
  /^\s*(cancel|end|quit)\s*[.!]*\s*$/i,
];

// Clinical: anything that sounds like symptoms, injury or medication.
const CLINICAL = [
  /\bpain(s|ful)?\b/i,
  /\bhurt(s|ing)?\b/i,
  /\bswell(ing|ed)?\b/i,
  /\bswollen\b/i,
  /\bfell\b/i,
  /\bfall(en)?\b/i,
  /\bnumb(ness)?\b/i,
  /\bmedications?\b/i,
  /\bmeds\b/i,
  /\bworse(ning)?\b/i,
  /\bache(s)?\b|\baching\b/i,
  /\binjur(y|ed|ies)\b/i,
  /\btingl(e|ing)\b/i,
];

const BOOKING = [
  /\bbook(ing)?\b/i,
  /\bappointments?\b/i,
  /\bappt\b/i,
  /\bschedul(e|ing)\b/i,
  /\bcome back in\b/i,
];

const matches = (patterns: RegExp[], text: string) => patterns.some((p) => p.test(text));

export function classifyByKeywords(text: string, ctx: ReplyContext): Classification {
  const optOut = matches(OPT_OUT, text);
  const clinical = matches(CLINICAL, text);

  // Clinical always wins: a person mentioning symptoms gets a human, never an automatic answer.
  if (clinical) return { category: "clinical", optOut, urgent: true, suggestedReply: null };
  if (optOut) return { category: "opt_out", optOut: true, urgent: false, suggestedReply: null };
  if (matches(BOOKING, text)) {
    return {
      category: "booking",
      optOut: false,
      urgent: false,
      suggestedReply: `Thanks, ${ctx.firstName}! You can pick a time that suits you here: ${ctx.bookingLink} or call us at ${ctx.locationPhone}. - ${ctx.locationName}`,
    };
  }
  return { category: "other", optOut: false, urgent: false, suggestedReply: null };
}

export class KeywordReplyClassifier implements ReplyClassifier {
  async classify(text: string, context: ReplyContext): Promise<Classification> {
    return classifyByKeywords(text, context);
  }
}

export const OPT_OUT_CONFIRMATION = {
  sms: "You're unsubscribed and won't receive more texts from us. Call the clinic if you need anything.",
  email: "You're unsubscribed and won't receive more emails from us. Call the clinic if you need anything.",
} as const;
