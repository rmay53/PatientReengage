/** Builds the sample CSVs. Discharge dates are relative to `today`. */
import { FIRST_NAMES, LAST_NAMES, LOCATIONS, THERAPISTS, rng, testEmail, testMobile } from "./fixtures";
import { addDays, isoDate } from "../src/lib/dates";

export function buildSampleCsvs(today: Date = new Date()) {
  const header = ["external_id", "first_name", "last_name", "email", "mobile", "location", "therapist", "discharge_date", "discharge_type", "sms_opt_in"];
  const rand = rng(50);
  const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];
  const fmtMobile = (e164: string) => `(${e164.slice(2, 5)}) ${e164.slice(5, 8)}-${e164.slice(8)}`;
  const windows: [string, number, number][] = [
    ["completed", 14, 30],
    ["completed", 75, 105],
    ["completed", 165, 195],
    ["completed", 350, 380],
    ["lapsed", 14, 90],
  ];

  const rows: string[][] = [];
  for (let i = 1; i <= 50; i++) {
    const n = 9000 + i;
    const first = pick(FIRST_NAMES);
    const last = pick(LAST_NAMES);
    const t = Math.floor(rand() * THERAPISTS.length);
    const [type, lo, hi] = windows[i % windows.length];
    const days = lo + Math.floor(rand() * (hi - lo + 1));
    const optIn = rand() < 0.6;
    rows.push([
      `TEST-${String(n).padStart(5, "0")}`,
      first,
      last,
      rand() < 0.1 ? "" : testEmail(first, last, n),
      fmtMobile(testMobile(n)),
      LOCATIONS[Math.floor(t / 3)].name,
      THERAPISTS[t].join(" "),
      isoDate(addDays(today, -days)),
      type,
      optIn ? "yes" : "no",
    ]);
  }

  // Rows 1-3 match seeded patients who opted out / are do-not-contact, to show
  // that re-uploading never clears those flags (the file says sms_opt_in=yes).
  rows[0][0] = "TEST-00001";
  rows[1][0] = "TEST-00002";
  rows[2][0] = "TEST-00003";

  // Deliberate errors.
  rows[10][3] = ""; rows[10][4] = "";                    // missing contact details
  rows[15][7] = "2026-13-45";                            // bad date
  rows[20][5] = "Westside Physical Therapy";             // unknown location
  rows[25][6] = "Nobody Atall";                          // unknown therapist
  rows[30][8] = "cancelled";                             // bad discharge type
  rows[35][4] = "555-01";                                // bad mobile
  rows[40][0] = rows[39][0];                             // duplicate external_id
  rows[45][7] = isoDate(addDays(today, 30));             // discharge date in the future

  const toCsv = (h: string[], data: string[][]) =>
    [h, ...data].map((r) => r.map((v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(",")).join("\n") + "\n";


  return {
    sample: toCsv(header, rows),
    refusedDiagnosis: toCsv([...header, "diagnosis"], rows.slice(3, 6).map((r) => [...r, "Example condition (fake)"])),
    refusedDateOfBirth: toCsv(
      [...header.slice(0, 3), "date_of_birth", ...header.slice(3)],
      rows.slice(3, 6).map((r) => [...r.slice(0, 3), "1900-01-01", ...r.slice(3)]),
    ),
  };
}
