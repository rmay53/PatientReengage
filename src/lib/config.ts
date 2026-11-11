export function appBaseUrl(): string {
  return process.env.APP_BASE_URL ?? "http://localhost:3000";
}

export function sessionTtlHours(): number {
  return Number(process.env.SESSION_TTL_HOURS ?? 12);
}

export function secureCookies(): boolean {
  if (process.env.COOKIE_SECURE) return process.env.COOKIE_SECURE === "true";
  return process.env.NODE_ENV === "production";
}
