import { describe, expect, it } from "vitest";
import { assignSegment, dischargeWindow, DEFAULT_SEGMENT_RULES, validateSegmentRule } from "../../src/lib/rules/segments";
import { addDays } from "../../src/lib/dates";

const today = new Date("2026-11-11T15:30:00Z");
const daysAgo = (n: number) => addDays(today, -n);
const completed = (n: number) => assignSegment({ dischargeType: "completed", dischargeDate: daysAgo(n) }, today);
const lapsed = (n: number) => assignSegment({ dischargeType: "lapsed", dischargeDate: daysAgo(n) }, today);

describe("segment assignment", () => {
  it.each([
    [13, null],
    [14, "check_in"],
    [30, "check_in"],
    [31, null],
    [74, null],
    [75, "three_month"],
    [105, "three_month"],
    [106, null],
    [165, "six_month"],
    [195, "six_month"],
    [196, null],
    [350, "twelve_month"],
    [380, "twelve_month"],
    [381, null],
  ])("completed care %i days ago -> %s", (days, expected) => {
    expect(completed(days)).toBe(expected);
  });

  it.each([
    [13, null],
    [14, "lapsed"],
    [60, "lapsed"],
    [90, "lapsed"],
    [91, null],
    [180, null],
  ])("lapsed %i days ago -> %s", (days, expected) => {
    expect(lapsed(days)).toBe(expected);
  });

  it("never puts lapsed patients in completed-care segments or vice versa", () => {
    expect(lapsed(20)).toBe("lapsed");
    expect(completed(60)).toBeNull();
    expect(lapsed(100)).toBeNull();
  });

  it("ignores discharge dates in the future", () => {
    expect(assignSegment({ dischargeType: "completed", dischargeDate: addDays(today, 5) }, today)).toBeNull();
  });

  it("counts calendar days regardless of time of day", () => {
    const late = new Date("2026-11-11T23:59:00Z");
    expect(assignSegment({ dischargeType: "completed", dischargeDate: new Date("2026-10-28T00:00:00Z") }, late)).toBe("check_in");
  });

  it("uses admin-edited ranges", () => {
    const rules = DEFAULT_SEGMENT_RULES.map((r) => (r.segment === "check_in" ? { ...r, minDays: 7, maxDays: 21 } : r));
    expect(assignSegment({ dischargeType: "completed", dischargeDate: daysAgo(7) }, today, rules)).toBe("check_in");
    expect(assignSegment({ dischargeType: "completed", dischargeDate: daysAgo(25) }, today, rules)).toBeNull();
  });

  it("assigns overlapping edited ranges to the earlier segment only", () => {
    const rules = DEFAULT_SEGMENT_RULES.map((r) => (r.segment === "three_month" ? { ...r, minDays: 25 } : r));
    expect(assignSegment({ dischargeType: "completed", dischargeDate: daysAgo(28) }, today, rules)).toBe("check_in");
  });

  it("computes the discharge window for queries", () => {
    const w = dischargeWindow(DEFAULT_SEGMENT_RULES[0], today);
    expect(w.from.toISOString().slice(0, 10)).toBe("2026-10-12");
    expect(w.to.toISOString().slice(0, 10)).toBe("2026-10-28");
  });

  it("validates edited ranges", () => {
    expect(validateSegmentRule({ minDays: 10, maxDays: 5 })).toMatch(/after/);
    expect(validateSegmentRule({ minDays: -1, maxDays: 5 })).toMatch(/negative/);
    expect(validateSegmentRule({ minDays: 14, maxDays: 30 })).toBeNull();
  });
});
