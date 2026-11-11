import { describe, expect, it } from "vitest";
import { checkHeaders, normalizeMobile, parseDate, validateCsv, type CsvContext } from "../../src/lib/rules/csv";

const ctx = (o: Partial<CsvContext> = {}): CsvContext => ({
  locations: [
    { id: "L1", name: "Northside" },
    { id: "L2", name: "Southside" },
  ],
  therapists: [
    { id: "T1", firstName: "Pat", lastName: "Example", locationId: "L1", active: true },
    { id: "T2", firstName: "Sam", lastName: "Sample", locationId: "L2", active: true },
  ],
  allowedLocationIds: null,
  existingPatientLocations: new Map(),
  today: new Date("2026-11-11T00:00:00Z"),
  ...o,
});

const header = "external_id,first_name,last_name,email,mobile,location,therapist,discharge_date,discharge_type,sms_opt_in";
const good = "P1,Testa,Person,testa@example.com,412-555-0101,Northside,Pat Example,2026-10-20,completed,yes";

describe("CSV headers", () => {
  it("refuses diagnosis and date-of-birth columns", () => {
    expect(checkHeaders([...header.split(","), "diagnosis"])).toMatch(/must not store.*diagnosis/);
    expect(checkHeaders([...header.split(","), "date_of_birth"])).toMatch(/date of birth/);
    expect(checkHeaders([...header.split(","), "DOB"])).toMatch(/date of birth/);
    expect(checkHeaders([...header.split(","), "Insurance Carrier"])).toMatch(/insurance/);
    expect(checkHeaders([...header.split(","), "Home Address"])).toMatch(/address/);
    expect(checkHeaders([...header.split(","), "Body Region"])).toMatch(/body region/);
    expect(checkHeaders([...header.split(","), "clinical_notes"])).toMatch(/clinical notes/);
  });

  it("accepts the expected columns in any order and case", () => {
    expect(checkHeaders(header.split(","))).toBeNull();
    expect(checkHeaders(header.toUpperCase().split(",").reverse())).toBeNull();
  });

  it("refuses missing and unexpected columns", () => {
    expect(checkHeaders(header.split(",").slice(1))).toMatch(/missing column/);
    expect(checkHeaders([...header.split(","), "favorite_color"])).toMatch(/unexpected column/);
  });
});

describe("CSV rows", () => {
  it("accepts a valid row and normalizes values", () => {
    const r = validateCsv(`${header}\n${good}\n`, ctx());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rejected).toEqual([]);
    expect(r.accepted[0]).toMatchObject({ externalId: "P1", mobile: "+14125550101", locationId: "L1", therapistId: "T1", smsOptIn: true });
  });

  it("refuses the whole file when a forbidden column is present", () => {
    const r = validateCsv(`${header},diagnosis\n${good},low back pain\n`, ctx());
    expect(r.ok).toBe(false);
  });

  it("rejects rows with reasons", () => {
    const rows = [
      "P2,No,Contact,,,Northside,Pat Example,2026-10-20,completed,no",
      "P3,Bad,Date,b@example.com,,Northside,Pat Example,2026-13-45,completed,no",
      "P4,Unknown,Loc,c@example.com,,Westside,Pat Example,2026-10-20,completed,no",
      "P5,Wrong,Ther,d@example.com,,Northside,Sam Sample,2026-10-20,completed,no",
      "P6,Bad,Type,e@example.com,,Northside,Pat Example,2026-10-20,cancelled,no",
      "P7,Future,Date,f@example.com,,Northside,Pat Example,2027-01-01,completed,no",
      "P8,Bad,Email,not-an-email,,Northside,Pat Example,2026-10-20,completed,no",
      "P9,Bad,Phone,,12345,Northside,Pat Example,2026-10-20,completed,yes",
      "P1,Dupe,Row,g@example.com,,Northside,Pat Example,2026-10-20,completed,no",
    ];
    const r = validateCsv([header, good, ...rows].join("\n"), ctx());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.accepted.map((a) => a.externalId)).toEqual(["P1"]);
    const reasons = Object.fromEntries(r.rejected.map((x) => [x.externalId + ":" + x.rowNumber, x.reasons.join("; ")]));
    expect(reasons["P2:3"]).toMatch(/Missing contact details/);
    expect(reasons["P3:4"]).toMatch(/Bad date/);
    expect(reasons["P4:5"]).toMatch(/Unknown location/);
    expect(reasons["P5:6"]).toMatch(/Unknown therapist/);
    expect(reasons["P6:7"]).toMatch(/discharge_type/);
    expect(reasons["P7:8"]).toMatch(/future/);
    expect(reasons["P8:9"]).toMatch(/Email/);
    expect(reasons["P9:10"]).toMatch(/Mobile/);
    expect(reasons["P1:11"]).toMatch(/Duplicate/);
  });

  it("limits approvers to their own location", () => {
    const other = "P2,Other,Loc,o@example.com,,Southside,Sam Sample,2026-10-20,completed,no";
    const r = validateCsv([header, good, other].join("\n"), ctx({ allowedLocationIds: ["L1"] }));
    if (!r.ok) throw new Error("unexpected");
    expect(r.accepted.map((a) => a.externalId)).toEqual(["P1"]);
    expect(r.rejected[0].reasons.join()).toMatch(/your account/);
  });

  it("stops approvers moving a patient from another location", () => {
    const r = validateCsv([header, good].join("\n"), ctx({ allowedLocationIds: ["L1"], existingPatientLocations: new Map([["P1", "L2"]]) }));
    if (!r.ok) throw new Error("unexpected");
    expect(r.accepted).toHaveLength(0);
  });

  it("marks rows for known patients as updates", () => {
    const r = validateCsv([header, good].join("\n"), ctx({ existingPatientLocations: new Map([["P1", "L1"]]) }));
    if (!r.ok) throw new Error("unexpected");
    expect(r.accepted[0].isUpdate).toBe(true);
  });
});

describe("value parsing", () => {
  it("parses dates", () => {
    expect(parseDate("2026-02-28")?.toISOString()).toBe("2026-02-28T00:00:00.000Z");
    expect(parseDate("2/3/2026")?.toISOString()).toBe("2026-02-03T00:00:00.000Z");
    expect(parseDate("2026-02-30")).toBeNull();
    expect(parseDate("yesterday")).toBeNull();
  });
  it("normalizes mobiles", () => {
    expect(normalizeMobile("(412) 555-0123")).toBe("+14125550123");
    expect(normalizeMobile("1-412-555-0123")).toBe("+14125550123");
    expect(normalizeMobile("555-0123")).toBeNull();
  });
});
