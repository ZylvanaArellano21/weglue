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
export function todayInAppTz(now: Date = new Date()): string {
  return dateInAppTz(now);
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

// 24-hour HH:MM:SS wall-clock time formatter for America/Chicago; same
// fallback rules as the day formatter above.
let timeFormatter: Intl.DateTimeFormat | null = null;
try {
  timeFormatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: APP_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
} catch {
  timeFormatter = null;
}

function localTimeString(date: Date): string {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

// The current wall-clock time in America/Chicago as HH:MM:SS — string-sortable
// against events.start_time/end_time (both stored as wall-clock time strings).
export function nowTimeInAppTz(now: Date = new Date()): string {
  if (!timeFormatter) return localTimeString(now);
  try {
    // en-GB hour12:false can yield "24:xx:xx" at midnight on some ICU builds.
    return timeFormatter.format(now).replace(/^24/, '00');
  } catch {
    return localTimeString(now);
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

// ─── Current Monday–Sunday week ────────────────────────────────────────────
// Mirrors apps/web/lib/datetime.ts's currentWeekRange so mobile and web can
// never disagree about which week it is.

export interface WeekRange {
  /** Monday, YYYY-MM-DD */
  start: string;
  /** Sunday, YYYY-MM-DD */
  end: string;
}

export function currentWeekRange(now: Date = new Date()): WeekRange {
  const today = dateInAppTz(now);
  // Noon-UTC anchored so the weekday can never shift by a timezone hour.
  const weekday = new Date(today + 'T12:00:00Z').getUTCDay(); // 0 = Sunday
  const sinceMonday = (weekday + 6) % 7;
  const start = addDaysToDateString(today, -sinceMonday);
  return { start, end: addDaysToDateString(start, 6) };
}
