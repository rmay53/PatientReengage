import type { SegmentKey } from "./rules/segments";

export const SEGMENT_LABELS: Record<SegmentKey, string> = {
  check_in: "Check-in",
  three_month: "3-month",
  six_month: "6-month",
  twelve_month: "12-month",
  lapsed: "Lapsed",
};

export const CATEGORY_LABELS = { opt_out: "Opt-out", booking: "Booking", clinical: "Clinical", other: "Other" } as const;
export const CHANNEL_LABELS = { sms: "Text", email: "Email" } as const;

export function fmtDateTime(d: Date | null | undefined): string {
  if (!d) return "";
  return d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: process.env.DISPLAY_TIME_ZONE ?? "America/New_York" });
}

export function fmtDate(d: Date | null | undefined): string {
  if (!d) return "";
  return d.toISOString().slice(0, 10);
}

export function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export const SEGMENT_KEYS = Object.keys(SEGMENT_LABELS) as SegmentKey[];
export function asSegment(v: string | undefined): SegmentKey | undefined {
  return SEGMENT_KEYS.includes(v as SegmentKey) ? (v as SegmentKey) : undefined;
}
