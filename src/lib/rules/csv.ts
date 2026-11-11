import Papa from "papaparse";
import { utcDay } from "../dates";

export const EXPECTED_COLUMNS = [
  "external_id",
  "first_name",
  "last_name",
  "email",
  "mobile",
  "location",
  "therapist",
  "discharge_date",
  "discharge_type",
  "sms_opt_in",
] as const;

/**
 * Column names that suggest clinical or sensitive data. A file containing any
 * of these is refused outright.
 */
const FORBIDDEN_COLUMN_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /diagnos|^dx|icd|condition|injur/, label: "diagnosis" },
  { pattern: /bodyregion|bodypart|region|bodysite/, label: "body region" },
  { pattern: /insur|payer|payor|policy|memberid/, label: "insurance" },
  { pattern: /dob|birth|^age$/, label: "date of birth" },
  { pattern: /address|street|city|zip|postal|state$/, label: "address" },
  { pattern: /note|clinical|medic|treatment|soap|assessment/, label: "clinical notes" },
  { pattern: /ssn|socialsecurity/, label: "social security number" },
];

export interface LocationLookup {
  id: string;
  name: string;
}
export interface TherapistLookup {
  id: string;
  firstName: string;
  lastName: string;
  locationId: string;
  active: boolean;
}

export interface CsvContext {
  locations: LocationLookup[];
  therapists: TherapistLookup[];
  /** null = may import for any location (admin). */
  allowedLocationIds: string[] | null;
  /** external_id -> location_id for patients already on file. */
  existingPatientLocations: Map<string, string>;
  today: Date;
}

export interface ValidRow {
  rowNumber: number;
  externalId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  mobile: string | null;
  locationId: string;
  locationName: string;
  therapistId: string;
  therapistName: string;
  dischargeDate: Date;
  dischargeType: "completed" | "lapsed";
  smsOptIn: boolean;
  isUpdate: boolean;
}

export interface RejectedRow {
  rowNumber: number;
  externalId: string;
  reasons: string[];
}

export type CsvResult =
  | { ok: false; fatal: string }
  | { ok: true; accepted: ValidRow[]; rejected: RejectedRow[] };

export const MAX_ROWS = 5000;

const normalizeHeader = (h: string) => h.trim().toLowerCase().replace(/[\s-]+/g, "_");
const squash = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeMobile(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

export function formatMobile(e164: string | null): string {
  if (!e164) return "";
  const d = e164.replace(/\D/g, "").slice(-10);
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : e164;
}

export function parseDate(raw: string): Date | null {
  const s = raw.trim();
  let y: number, m: number, d: number;
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (match) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if ((match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s))) {
    [m, d, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else {
    return null;
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date;
}

function parseBool(raw: string): boolean | null {
  const s = raw.trim().toLowerCase();
  if (["y", "yes", "true", "1"].includes(s)) return true;
  if (["", "n", "no", "false", "0"].includes(s)) return false;
  return null;
}

/** Checks the header row only. Returns an error message or null. */
export function checkHeaders(headers: string[]): string | null {
  const forbidden = new Set<string>();
  for (const h of headers) {
    const sq = squash(h);
    for (const f of FORBIDDEN_COLUMN_PATTERNS) {
      if (f.pattern.test(sq)) forbidden.add(`"${h.trim()}" (${f.label})`);
    }
  }
  if (forbidden.size > 0) {
    return `File refused: it contains columns this tool must not store: ${[...forbidden].join(", ")}. Remove them and upload again. Nothing was imported.`;
  }
  const normalized = headers.map(normalizeHeader);
  const missing = EXPECTED_COLUMNS.filter((c) => !normalized.includes(c));
  if (missing.length > 0) return `File refused: missing column(s): ${missing.join(", ")}.`;
  const extra = normalized.filter((h) => h !== "" && !(EXPECTED_COLUMNS as readonly string[]).includes(h));
  if (extra.length > 0) {
    return `File refused: unexpected column(s): ${extra.join(", ")}. Only these columns are allowed: ${EXPECTED_COLUMNS.join(", ")}.`;
  }
  const dupes = normalized.filter((h, i) => normalized.indexOf(h) !== i);
  if (dupes.length > 0) return `File refused: duplicate column(s): ${[...new Set(dupes)].join(", ")}.`;
  return null;
}

export function validateCsv(text: string, ctx: CsvContext): CsvResult {
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: normalizeHeader,
  });
  const headers = parsed.meta.fields ?? [];
  if (headers.length === 0) return { ok: false, fatal: "File refused: it has no header row." };
  // Check the raw header names, before normalisation hides anything.
  const rawHeaderLine = text.replace(/^﻿/, "").split(/\r?\n/, 1)[0] ?? "";
  const rawHeaders = Papa.parse<string[]>(rawHeaderLine).data[0] ?? headers;
  const headerError = checkHeaders(rawHeaders);
  if (headerError) return { ok: false, fatal: headerError };
  if (parsed.data.length === 0) return { ok: false, fatal: "File refused: it has no data rows." };
  if (parsed.data.length > MAX_ROWS) return { ok: false, fatal: `File refused: more than ${MAX_ROWS} rows.` };

  const locationsByName = new Map(ctx.locations.map((l) => [l.name.trim().toLowerCase(), l]));
  const today = utcDay(ctx.today);
  const seen = new Set<string>();
  const accepted: ValidRow[] = [];
  const rejected: RejectedRow[] = [];

  parsed.data.forEach((raw, i) => {
    const rowNumber = i + 2; // header is row 1
    const get = (k: string) => (raw[k] ?? "").trim();
    const reasons: string[] = [];

    const externalId = get("external_id");
    if (!externalId) reasons.push("Missing external_id");
    else if (seen.has(externalId)) reasons.push("Duplicate external_id earlier in this file");

    const firstName = get("first_name");
    const lastName = get("last_name");
    if (!firstName || !lastName) reasons.push("Missing first or last name");

    const emailRaw = get("email").toLowerCase();
    const mobileRaw = get("mobile");
    let email: string | null = null;
    let mobile: string | null = null;
    if (emailRaw) {
      if (EMAIL_PATTERN.test(emailRaw)) email = emailRaw;
      else reasons.push("Email address is not valid");
    }
    if (mobileRaw) {
      mobile = normalizeMobile(mobileRaw);
      if (!mobile) reasons.push("Mobile number is not a valid 10-digit number");
    }
    if (!emailRaw && !mobileRaw) reasons.push("Missing contact details (no email or mobile)");

    const locationName = get("location");
    const location = locationsByName.get(locationName.toLowerCase());
    if (!locationName) reasons.push("Missing location");
    else if (!location) reasons.push(`Unknown location "${locationName}"`);
    else if (ctx.allowedLocationIds && !ctx.allowedLocationIds.includes(location.id)) {
      reasons.push("Location is not one your account can import for");
    }

    const existingLocation = externalId ? ctx.existingPatientLocations.get(externalId) : undefined;
    if (existingLocation && ctx.allowedLocationIds && !ctx.allowedLocationIds.includes(existingLocation)) {
      reasons.push("Patient is on file at a location your account cannot change");
    }

    const therapistName = get("therapist");
    let therapist: TherapistLookup | undefined;
    if (!therapistName) reasons.push("Missing therapist");
    else if (location) {
      const wanted = therapistName.toLowerCase().replace(/\s+/g, " ");
      therapist = ctx.therapists.find(
        (t) => t.locationId === location.id && `${t.firstName} ${t.lastName}`.toLowerCase() === wanted,
      );
      if (!therapist) reasons.push(`Unknown therapist "${therapistName}" at ${location.name}`);
    }

    const dateRaw = get("discharge_date");
    const dischargeDate = dateRaw ? parseDate(dateRaw) : null;
    if (!dateRaw) reasons.push("Missing discharge_date");
    else if (!dischargeDate) reasons.push(`Bad date "${dateRaw}" (use YYYY-MM-DD)`);
    else if (dischargeDate.getTime() > today.getTime()) reasons.push("Discharge date is in the future");

    const typeRaw = get("discharge_type").toLowerCase();
    if (typeRaw !== "completed" && typeRaw !== "lapsed") {
      reasons.push(`discharge_type must be "completed" or "lapsed"${typeRaw ? `, not "${typeRaw}"` : ""}`);
    }

    const smsOptIn = parseBool(get("sms_opt_in"));
    if (smsOptIn === null) reasons.push(`sms_opt_in must be yes or no, not "${get("sms_opt_in")}"`);

    if (externalId) seen.add(externalId);

    if (reasons.length > 0 || !location || !therapist || !dischargeDate) {
      rejected.push({ rowNumber, externalId, reasons });
      return;
    }
    accepted.push({
      rowNumber,
      externalId,
      firstName,
      lastName,
      email,
      mobile,
      locationId: location.id,
      locationName: location.name,
      therapistId: therapist.id,
      therapistName: `${therapist.firstName} ${therapist.lastName}`,
      dischargeDate,
      dischargeType: typeRaw as "completed" | "lapsed",
      smsOptIn: smsOptIn ?? false,
      isUpdate: ctx.existingPatientLocations.has(externalId),
    });
  });

  return { ok: true, accepted, rejected };
}
