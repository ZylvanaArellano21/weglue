// Web port of the mobile timezone + event-display rules (apps/mobile/lib/
// timezone.ts + eventDisplay.ts). All "what day is it" logic runs on
// America/Chicago — NOT the browser timezone and NOT UTC — so web and mobile
// agree on Today/upcoming/past for the exact same event rows.

export const APP_TIME_ZONE = "America/Chicago";

let dayFormatter: Intl.DateTimeFormat | null = null;
try {
  dayFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
} catch {
  dayFormatter = null;
}

function localDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** The current date in America/Chicago as YYYY-MM-DD. */
export function todayInAppTz(): string {
  return dateInAppTz(new Date());
}

export function dateInAppTz(date: Date): string {
  if (!dayFormatter) return localDateString(date);
  try {
    return dayFormatter.format(date);
  } catch {
    return localDateString(date);
  }
}

let timeFormatter: Intl.DateTimeFormat | null = null;
try {
  timeFormatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: APP_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
} catch {
  timeFormatter = null;
}

function localTimeString(date: Date): string {
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  const s = String(date.getSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

/** Current wall-clock time in America/Chicago as HH:MM:SS (string-sortable). */
export function nowTimeInAppTz(): string {
  const now = new Date();
  if (!timeFormatter) return localTimeString(now);
  try {
    return timeFormatter.format(now).replace(/^24/, "00");
  } catch {
    return localTimeString(now);
  }
}

/**
 * An event is "past" only once its real end datetime (event_date + end_time,
 * America/Chicago wall clock) is behind now — identical rule to mobile so an
 * event never flips to past at UTC midnight while it is still running.
 */
export function isEventPast(
  eventDate: string,
  endTime: string | null | undefined
): boolean {
  const today = todayInAppTz();
  if (eventDate < today) return true;
  if (eventDate > today) return false;
  if (!endTime) return false;
  return endTime < nowTimeInAppTz();
}

// ─── Display formatters (match EventCard on mobile) ──────────────────────────

/** "18 May 2025" */
export function formatEventDate(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00");
  return date.toLocaleDateString("en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** "1:00 pm" */
export function formatEventTime(timeStr: string): string {
  const parts = timeStr.split(":");
  const h = Number(parts[0] ?? 0);
  const m = Number(parts[1] ?? 0);
  const ampm = h >= 12 ? "pm" : "am";
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, "0")} ${ampm}`;
}

/** "Building F, Room 219" with free-text location fallback (mirrors mobile). */
export function formatEventLocation(
  building: string | null | undefined,
  room: string | null | undefined,
  location: string | null | undefined
): string {
  const b = building?.trim();
  const r = room?.trim();
  if (b && r) return `Building ${b}, Room ${r}`;
  if (b) return `Building ${b}`;
  if (r) return `Room ${r}`;
  return location?.trim() ?? "";
}
