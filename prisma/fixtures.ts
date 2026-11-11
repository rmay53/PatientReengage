/** Invented test data shared by the seed script and the sample CSV generator. */

export const LOCATIONS = [
  { name: "Northside Physical Therapy", phone: "(412) 555-0100", bookingLink: "https://book.example.com/northside" },
  { name: "Riverside Physical Therapy", phone: "(412) 555-0101", bookingLink: "https://book.example.com/riverside" },
  { name: "Hilltop Physical Therapy", phone: "(412) 555-0102", bookingLink: "https://book.example.com/hilltop" },
  { name: "Lakeview Physical Therapy", phone: "(412) 555-0103", bookingLink: "https://book.example.com/lakeview" },
];

/** Three therapists per location, in LOCATIONS order. */
export const THERAPISTS: [string, string][] = [
  ["Quinn", "Placeholder"], ["Rory", "Mockwell"], ["Sasha", "Fictive"],
  ["Tatum", "Samplesby"], ["Umi", "Demoreaux"], ["Vale", "Testington"],
  ["Wren", "Exampleton"], ["Xan", "Notreal"], ["Yael", "Pretendo"],
  ["Zuri", "Madeupson"], ["Arlo", "Fakely"], ["Bex", "Stubbins"],
];

export const FIRST_NAMES = [
  "Avery", "Blair", "Casey", "Dakota", "Emerson", "Finley", "Gray", "Harper", "Indigo", "Jules",
  "Kai", "Lane", "Morgan", "Noel", "Oakley", "Parker", "Reese", "Sage", "Taylor", "Val",
  "Wynn", "Alex", "Briar", "Cove", "Drew", "Ellis", "Frankie", "Hollis", "Jordan", "Kendall",
];

export const LAST_NAMES = [
  "Testperson", "Sampleton", "Fakerson", "Mockridge", "Demoski", "Placeholdt", "Exemplar", "Dummington",
  "Pseudonym", "Testwell", "Fauxley", "Imaginary", "Specimen", "Trialsworth", "Notaperson", "Prototypo",
  "Inventsky", "Madeline-Up", "Fictionson", "Sandboxer",
];

const AREA_CODES = ["412", "724", "878", "202", "312"];

/** Reserved test number in the 555-0100 to 555-0199 range. */
export function testMobile(n: number): string {
  return `+1${AREA_CODES[n % AREA_CODES.length]}5550${String(100 + (n % 100)).padStart(3, "0")}`;
}

export function testEmail(first: string, last: string, n: number): string {
  return `${first}.${last}.${n}`.toLowerCase().replace(/[^a-z0-9.]/g, "") + "@example.com";
}

/** Small deterministic PRNG so the seed is repeatable. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const TEMPLATES: { name: string; segment: "check_in" | "three_month" | "six_month" | "twelve_month" | "lapsed"; channel: "sms" | "email"; subject?: string; body: string }[] = [
  {
    name: "Check-in text",
    segment: "check_in",
    channel: "sms",
    body: "Hi {first_name}, it's {therapist_first_name} from {location_name}. Just checking in to see how you're feeling. Reply here or call {location_phone} if we can help. Reply STOP to opt out.",
  },
  {
    name: "Check-in email",
    segment: "check_in",
    channel: "email",
    subject: "How are you doing, {first_name}?",
    body: "Hi {first_name},\n\nIt's {therapist_first_name} from {location_name}. It's been a couple of weeks since you finished with us, and I wanted to check in and see how you're feeling.\n\nIf you have a minute, we'd be grateful for a review of your visits. And if anything comes up, call us at {location_phone}.\n\nAll the best,\n{therapist_first_name}",
  },
  {
    name: "3-month text",
    segment: "three_month",
    channel: "sms",
    body: "Hi {first_name}, {location_name} here. It's been about 3 months - want a quick re-check? Book at {booking_link} or call {location_phone}. Know someone we could help? Send them our way! Reply STOP to opt out.",
  },
  {
    name: "3-month email",
    segment: "three_month",
    channel: "email",
    subject: "A quick re-check from {location_name}",
    body: "Hi {first_name},\n\nIt's been about three months since you finished your visits at {location_name}. If you'd like a quick re-check to make sure you're staying on track, you can book here: {booking_link}\n\nAnd if you know someone who could use our help, we'd be glad to see them.\n\nThe team at {location_name}\n{location_phone}",
  },
  {
    name: "6-month text",
    segment: "six_month",
    channel: "sms",
    body: "Hi {first_name}, it's {location_name}. New season, good time for a tune-up visit to stay active. Book at {booking_link} or call {location_phone}. Reply STOP to opt out.",
  },
  {
    name: "6-month email",
    segment: "six_month",
    channel: "email",
    subject: "Time for a tune-up?",
    body: "Hi {first_name},\n\nA new season is a great time for a tune-up visit to keep you moving well. You can pick a time here: {booking_link} or call us at {location_phone}.\n\nThe team at {location_name}",
  },
  {
    name: "12-month text",
    segment: "twelve_month",
    channel: "sms",
    body: "Hi {first_name}, it's been a year since you finished at {location_name}! We'd love to hear how you're doing. Annual check-in: {booking_link} or {location_phone}. Reply STOP to opt out.",
  },
  {
    name: "12-month email",
    segment: "twelve_month",
    channel: "email",
    subject: "One year on - how are you, {first_name}?",
    body: "Hi {first_name},\n\nIt's been a year since you finished with {therapist_first_name} at {location_name}. We'd love to hear how you're doing. If an annual check-in would help, book here: {booking_link}\n\nThe team at {location_name}\n{location_phone}",
  },
  {
    name: "Lapsed text",
    segment: "lapsed",
    channel: "sms",
    body: "Hi {first_name}, it's {therapist_first_name} at {location_name}. We'd love to help you finish your plan - pick a time at {booking_link} or call {location_phone}. Reply STOP to opt out.",
  },
  {
    name: "Lapsed email",
    segment: "lapsed",
    channel: "email",
    subject: "Let's finish what we started, {first_name}",
    body: "Hi {first_name},\n\nIt's {therapist_first_name} from {location_name}. We noticed you haven't been in for a while and we'd love to help you finish your plan. You can pick a time that suits you here: {booking_link} or call {location_phone}.\n\n{therapist_first_name}",
  },
];
