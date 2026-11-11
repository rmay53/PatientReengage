import { addDays, daysBetween } from "../dates";

export type SegmentKey = "check_in" | "three_month" | "six_month" | "twelve_month" | "lapsed";
export type DischargeTypeKey = "completed" | "lapsed";

export interface SegmentRuleInput {
  segment: SegmentKey;
  label: string;
  dischargeType: DischargeTypeKey;
  minDays: number;
  maxDays: number;
  purpose: string;
}

export const SEGMENT_ORDER: SegmentKey[] = ["check_in", "three_month", "six_month", "twelve_month", "lapsed"];

/** Defaults from the build spec. Admins can change the day ranges in Settings. */
export const DEFAULT_SEGMENT_RULES: SegmentRuleInput[] = [
  { segment: "check_in", label: "Check-in", dischargeType: "completed", minDays: 14, maxDays: 30, purpose: "How are you doing; ask for a review" },
  { segment: "three_month", label: "3-month", dischargeType: "completed", minDays: 75, maxDays: 105, purpose: "Offer a re-check; ask for referrals" },
  { segment: "six_month", label: "6-month", dischargeType: "completed", minDays: 165, maxDays: 195, purpose: "Seasonal or tune-up reminder" },
  { segment: "twelve_month", label: "12-month", dischargeType: "completed", minDays: 350, maxDays: 380, purpose: "Annual check-in" },
  { segment: "lapsed", label: "Lapsed", dischargeType: "lapsed", minDays: 14, maxDays: 90, purpose: "Invite them back to finish their plan" },
];

export function segmentLabel(segment: SegmentKey, rules: SegmentRuleInput[] = DEFAULT_SEGMENT_RULES): string {
  return rules.find((r) => r.segment === segment)?.label ?? segment;
}

/**
 * Which segment a patient falls into today, or null if none.
 * Day ranges are inclusive. If admin-edited ranges overlap, the first rule in
 * SEGMENT_ORDER wins so a patient is only ever in one segment.
 */
export function assignSegment(
  patient: { dischargeType: DischargeTypeKey; dischargeDate: Date },
  today: Date,
  rules: SegmentRuleInput[] = DEFAULT_SEGMENT_RULES,
): SegmentKey | null {
  const days = daysBetween(patient.dischargeDate, today);
  if (days < 0) return null;
  for (const key of SEGMENT_ORDER) {
    const rule = rules.find((r) => r.segment === key);
    if (!rule) continue;
    if (rule.dischargeType === patient.dischargeType && days >= rule.minDays && days <= rule.maxDays) {
      return key;
    }
  }
  return null;
}

/** Inclusive discharge-date window for a segment, for database queries. */
export function dischargeWindow(rule: SegmentRuleInput, today: Date): { from: Date; to: Date } {
  return { from: addDays(today, -rule.maxDays), to: addDays(today, -rule.minDays) };
}

export function validateSegmentRule(rule: { minDays: number; maxDays: number }): string | null {
  if (!Number.isInteger(rule.minDays) || !Number.isInteger(rule.maxDays)) return "Day ranges must be whole numbers.";
  if (rule.minDays < 0) return "Start day cannot be negative.";
  if (rule.maxDays < rule.minDays) return "End day must be on or after the start day.";
  if (rule.maxDays > 1000) return "End day must be 1000 or less.";
  return null;
}
