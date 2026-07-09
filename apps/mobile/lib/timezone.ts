// Central timezone handling. All user-facing "what day is it" logic in the
// app (Today/Tomorrow labels, week buckets, feed cutoffs, notification
// grouping) runs on America/Chicago — NOT the device timezone and NOT UTC.
// Events store a plain YYYY-MM-DD date + local wall-clock times, so comparing
// them against a UTC-derived "today" (new Date().toISOString()) shifts the
// day after 7pm Chicago and made tomorrow's events show "Today!".

export const APP_TIME_ZONE = 'America/Chicago';

// en-CA formats as YYYY-MM-DD, which matches events.event_date exactly.
// Falls back to the device-local calendar date if this device's ICU data
// is missing the zone — wrong for travelers but never crashes.
let dayFormatter: Intl.DateTimeFormat | null = null;
try {
  dayFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
} catch {
  dayFormatter = null;
}

function localDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// The current date in America/Chicago as YYYY-MM-DD.
export function todayInAppTz(): string {
  return dateInAppTz(new Date());
}

// Any instant → its calendar date in America/Chicago as YYYY-MM-DD.
export function dateInAppTz(date: Date): string {
  if (!dayFormatter) return localDateString(date);
  try {
    return dayFormatter.format(date);
  } catch {
    return localDateString(date);
  }
}

// YYYY-MM-DD + n days → YYYY-MM-DD (pure calendar math, timezone-safe
// because the string is re-anchored at UTC noon before shifting).
export function addDaysToDateString(dateStr: string, days: number): string {
  const base = new Date(dateStr + 'T12:00:00Z');
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().split('T')[0];
}

// Whole-day difference between two YYYY-MM-DD strings (b - a).
export function dayDiff(a: string, b: string): number {
  const aMs = new Date(a + 'T12:00:00Z').getTime();
  const bMs = new Date(b + 'T12:00:00Z').getTime();
  return Math.round((bMs - aMs) / 86_400_000);
}
