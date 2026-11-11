/**
 * Writes sample-data/*.csv. Discharge dates are relative to today, so re-run
 * this (npm run sample:csv) if the committed files have drifted.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { buildSampleCsvs } from "../prisma/sample-csv";

const csv = buildSampleCsvs();
const dir = path.join(__dirname, "..", "sample-data");
writeFileSync(path.join(dir, "sample-patients.csv"), csv.sample);
writeFileSync(path.join(dir, "refused-diagnosis-column.csv"), csv.refusedDiagnosis);
writeFileSync(path.join(dir, "refused-date-of-birth-column.csv"), csv.refusedDateOfBirth);
console.log("Wrote sample-data/sample-patients.csv (50 rows, 8 with deliberate errors) and two refused-column samples.");
