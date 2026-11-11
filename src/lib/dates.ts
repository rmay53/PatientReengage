const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Midnight UTC for the calendar date of `d`. */
export function utcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Whole calendar days from `from` to `to` (positive when `from` is earlier). */
export function daysBetween(from: Date, to: Date): number {
  return Math.round((utcDay(to).getTime() - utcDay(from).getTime()) / MS_PER_DAY);
}

export function addDays(d: Date, days: number): Date {
  return new Date(utcDay(d).getTime() + days * MS_PER_DAY);
}

export function isoDate(d: Date): string {
  return utcDay(d).toISOString().slice(0, 10);
}
