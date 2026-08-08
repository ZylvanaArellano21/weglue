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
export function nowTimeInAppTz(now: Date = new Date()): string {
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
  endTime: string | null | undefined,
  now: Date = new Date()
): boolean {
  const today = dateInAppTz(now);
  if (eventDate < today) return true;
  if (eventDate > today) return false;
  if (!endTime) return false;
  // An event becomes past at its complete end instant. The equality matters:
  // there is no grace period at the exact America/Chicago end wall-clock time.
  return endTime <= nowTimeInAppTz(now);
}

/** Canonical database timestamp check used when event_end_at is available. */
export function isEventPastAt(eventEndAt: string | null | undefined, now: Date = new Date()): boolean {
  if (!eventEndAt) return false;
  const endMs = Date.parse(eventEndAt);
  return Number.isFinite(endMs) && endMs <= now.getTime();
}

/**
 * Split events into upcoming vs past by real end datetime (mirrors mobile's
 * lib/eventDisplay.splitPastAndUpcoming): upcoming ascending, past descending.
 */
export function splitPastAndUpcoming<
  T extends {
    event_date: string;
    start_time: string;
    end_time: string | null;
    /** Preferred canonical boundary. Older callers may not have migrated yet. */
    event_end_at?: string | null;
  }
>(events: T[], now: Date = new Date()): { upcoming: T[]; past: T[] } {
  const upcoming: T[] = [];
  const past: T[] = [];
  for (const e of events) {
    // event_end_at is a real UTC instant derived in PostgreSQL from an
    // America/Chicago wall-clock event time. Use it wherever it is present;
    // the legacy date/time fallback only supports pre-migration callers.
    const hasEnded = e.event_end_at
      ? isEventPastAt(e.event_end_at, now)
      : isEventPast(e.event_date, e.end_time, now);
    (hasEnded ? past : upcoming).push(e);
  }
  upcoming.sort(
    (a, b) => a.event_date.localeCompare(b.event_date) || a.start_time.localeCompare(b.start_time)
  );
  past.sort(
    (a, b) => b.event_date.localeCompare(a.event_date) || b.start_time.localeCompare(a.start_time)
  );
  return { upcoming, past };
}

// ─── Display formatters (match EventCard on mobile) ──────────────────────────

/** YYYY-MM-DD + n days → YYYY-MM-DD (UTC-noon anchored, timezone-safe). */
export function addDaysToDateString(dateStr: string, days: number): string {
  const base = new Date(dateStr + "T12:00:00Z");
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().split("T")[0]!;
}

/** Whole-day difference between two YYYY-MM-DD strings (b - a). */
export function dayDiff(a: string, b: string): number {
  const aMs = new Date(a + "T12:00:00Z").getTime();
  const bMs = new Date(b + "T12:00:00Z").getTime();
  return Math.round((bMs - aMs) / 86_400_000);
}

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

/** Compact relative time: "now", "5m", "3h", "2d", "4w", else a date. */
export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 60) return "now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ─── Current Monday–Sunday week ──────────────────────────────────────────────
// One definition of "this week" for the whole web app, anchored to
// America/Chicago exactly like every other date rule here. Used by the Club-tab
// sidebar (schedule vs. this-week event) and by the Club Profile's Upcoming
// Events colours, so those two can never disagree about which week it is.

export interface WeekRange {
  /** Monday, YYYY-MM-DD */
  start: string;
  /** Sunday, YYYY-MM-DD */
  end: string;
}

export function currentWeekRange(now: Date = new Date()): WeekRange {
  const today = dateInAppTz(now);
  // Noon-UTC anchored so the weekday can never shift by a timezone hour.
  const weekday = new Date(today + "T12:00:00Z").getUTCDay(); // 0 = Sunday
  const sinceMonday = (weekday + 6) % 7;
  const start = addDaysToDateString(today, -sinceMonday);
  return { start, end: addDaysToDateString(start, 6) };
}

/** True when a YYYY-MM-DD date falls inside the current Monday–Sunday week. */
export function isInCurrentWeek(dateStr: string, now: Date = new Date()): boolean {
  const { start, end } = currentWeekRange(now);
  return dateStr >= start && dateStr <= end;
}

// ─── Recurring meeting schedule ──────────────────────────────────────────────
// Web counterpart of apps/mobile/lib/meetingSchedule.ts. Same parsing rules
// (clubs.meeting_schedule jsonb, legacy single-day columns as the fallback) and
// the same "days that share a time collapse onto one line" grouping, rendered
// in the web's lowercase am/pm style: "Monday, 3:00 pm - 4:00 pm" and
// "Monday, Wednesday, 3:00 pm - 4:00 pm".

export interface MeetingSlot {
  day: string;
  /** 'HH:MM' or 'HH:MM:SS' */
  start: string | null;
  end: string | null;
}

export const WEEK_DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

const DAY_ORDER = new Map<string, number>(WEEK_DAYS.map((d, i) => [d, i]));

/** Parses clubs.meeting_schedule (jsonb) with the legacy single-day fallback. */
export function parseMeetingSchedule(
  meetingSchedule: unknown,
  legacyDay: string | null | undefined,
  legacyStart: string | null | undefined,
  legacyEnd: string | null | undefined
): MeetingSlot[] {
  let slots: MeetingSlot[] = [];

  if (Array.isArray(meetingSchedule)) {
    slots = (meetingSchedule as unknown[])
      .filter(
        (s): s is { day: string; start?: string | null; end?: string | null } =>
          !!s && typeof s === "object" && typeof (s as { day?: unknown }).day === "string"
      )
      .map((s) => ({ day: s.day, start: s.start ?? null, end: s.end ?? null }))
      .filter((s) => DAY_ORDER.has(s.day));
  }

  if (slots.length === 0 && legacyDay && DAY_ORDER.has(legacyDay)) {
    slots = [{ day: legacyDay, start: legacyStart ?? null, end: legacyEnd ?? null }];
  }

  // One slot per day, in week order.
  const byDay = new Map<string, MeetingSlot>();
  for (const slot of slots) if (!byDay.has(slot.day)) byDay.set(slot.day, slot);
  return [...byDay.values()].sort((a, b) => (DAY_ORDER.get(a.day) ?? 0) - (DAY_ORDER.get(b.day) ?? 0));
}

/**
 * Display lines for a recurring schedule. Days sharing the same start+end
 * collapse into one line; different times get their own line.
 *   [{Monday 15:00-16:00}]                     → ["Monday, 3:00 pm - 4:00 pm"]
 *   [{Monday 15:00-16:00},{Wednesday 15:00-16:00}]
 *                                              → ["Monday, Wednesday, 3:00 pm - 4:00 pm"]
 * A day with no time set renders as just the day name.
 */
export function formatMeetingSchedule(slots: MeetingSlot[]): string[] {
  const byTime = new Map<string, { days: string[]; time: string }>();
  for (const slot of slots) {
    const key = `${slot.start ?? ""}|${slot.end ?? ""}`;
    const start = slot.start ? formatEventTime(slot.start) : "";
    const end = slot.end ? formatEventTime(slot.end) : "";
    const time = start && end ? `${start} - ${end}` : start || end || "";
    const entry = byTime.get(key) ?? { days: [], time };
    entry.days.push(slot.day);
    byTime.set(key, entry);
  }
  return [...byTime.values()]
    .sort((a, b) => (DAY_ORDER.get(a.days[0]!) ?? 0) - (DAY_ORDER.get(b.days[0]!) ?? 0))
    .map((group) => (group.time ? `${group.days.join(", ")}, ${group.time}` : group.days.join(", ")));
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
