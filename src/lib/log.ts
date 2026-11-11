/**
 * Application logger. Records ids, counts and statuses ONLY - never names,
 * contact details or message text. Fields are filtered against an allow-list
 * so a careless call cannot leak personal data into logs.
 */
type Value = string | number | boolean | null | undefined;

const ALLOWED_KEY = /(^id$|Id$|_id$|Ids$|^status$|^count$|Count$|^category$|^channel$|^role$|^segment$|^action$|^durationMs$|^code$|^ok$|^urgent$)/;
const SAFE_STRING = /^[A-Za-z0-9_.:\-]{0,64}$/;

export function sanitizeLogFields(fields: Record<string, Value | Value[]>): Record<string, Value | Value[]> {
  const out: Record<string, Value | Value[]> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (!ALLOWED_KEY.test(k)) continue;
    const clean = (x: Value) => (typeof x === "string" && !SAFE_STRING.test(x) ? "[redacted]" : x);
    out[k] = Array.isArray(v) ? v.map(clean) : clean(v);
  }
  return out;
}

function write(level: "info" | "warn" | "error", event: string, fields: Record<string, Value | Value[]> = {}) {
  if (process.env.LOG_LEVEL === "silent") return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...sanitizeLogFields(fields) });
  if (level === "error") console.error(line);
  else console.log(line);
}

export const log = {
  info: (event: string, fields?: Record<string, Value | Value[]>) => write("info", event, fields),
  warn: (event: string, fields?: Record<string, Value | Value[]>) => write("warn", event, fields),
  /** Logs the error's class and code only; error messages can contain data. */
  error: (event: string, err: unknown, fields?: Record<string, Value | Value[]>) =>
    write("error", event, {
      ...fields,
      code: (err as { code?: string })?.code ?? (err instanceof Error ? err.name : "unknown"),
    }),
};
