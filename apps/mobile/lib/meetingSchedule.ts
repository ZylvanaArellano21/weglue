// Multi-day club meeting schedule: parsing, ordering, and the smart grouped
// display used everywhere a schedule appears. Days that share the same
// start/end time collapse into one line ("Monday and Tuesday 10:00 AM -
// 11:00 AM"); different times stay on their own lines. Times are always
// user-friendly (never database-looking like 13:00:00).

export interface MeetingSlot {
  day: string;
  /** 'HH:MM' or 'HH:MM:SS' — normalized on format. */
  start: string | null;
  /** 'HH:MM' or 'HH:MM:SS'. */
  end: string | null;
}

export const WEEK_DAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

const DAY_ORDER = new Map<string, number>(WEEK_DAYS.map((d, i) => [d, i]));

export function formatTime12h(time: string | null | undefined): string {
  if (!time) return '';
  const [hRaw, mRaw] = time.split(':');
  const h = Number(hRaw);
  const m = Number(mRaw ?? 0);
  if (Number.isNaN(h) || Number.isNaN(m)) return '';
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${ampm}`;
}

export function formatTimeRange(start: string | null, end: string | null): string {
  const s = formatTime12h(start);
  const e = formatTime12h(end);
  if (s && e) return `${s} - ${e}`;
  return s || e || '';
}

/** Parses clubs.meeting_schedule (jsonb) with a legacy single-day fallback. */
export function parseMeetingSchedule(
  meetingSchedule: unknown,
  legacyDay: string | null,
  legacyStart: string | null,
  legacyEnd: string | null,
): MeetingSlot[] {
  let slots: MeetingSlot[] = [];

  if (Array.isArray(meetingSchedule)) {
    slots = meetingSchedule
      .filter(
        (s): s is { day: string; start?: string | null; end?: string | null } =>
          !!s && typeof s === 'object' && typeof (s as any).day === 'string',
      )
      .map((s) => ({
        day: s.day,
        start: s.start ?? null,
        end: s.end ?? null,
      }))
      .filter((s) => DAY_ORDER.has(s.day));
  }

  if (slots.length === 0 && legacyDay && DAY_ORDER.has(legacyDay)) {
    slots = [{ day: legacyDay, start: legacyStart, end: legacyEnd }];
  }

  // One slot per day, week order.
  const byDay = new Map<string, MeetingSlot>();
  for (const slot of slots) {
    if (!byDay.has(slot.day)) byDay.set(slot.day, slot);
  }
  return [...byDay.values()].sort(
    (a, b) => (DAY_ORDER.get(a.day) ?? 0) - (DAY_ORDER.get(b.day) ?? 0),
  );
}

export interface GroupedScheduleLine {
  /** e.g. "Monday and Tuesday", "Monday, Wednesday and Friday" */
  daysLabel: string;
  /** e.g. "10:00 AM - 11:00 AM" (may be empty when no time set) */
  timeLabel: string;
}

function joinDays(days: string[]): string {
  if (days.length <= 1) return days[0] ?? '';
  if (days.length === 2) return `${days[0]} and ${days[1]}`;
  return `${days.slice(0, -1).join(', ')} and ${days[days.length - 1]}`;
}

/** Groups days sharing identical start+end into single display lines. */
export function groupScheduleForDisplay(slots: MeetingSlot[]): GroupedScheduleLine[] {
  const byTime = new Map<string, { days: string[]; timeLabel: string }>();
  for (const slot of slots) {
    const key = `${slot.start ?? ''}|${slot.end ?? ''}`;
    const entry = byTime.get(key) ?? { days: [], timeLabel: formatTimeRange(slot.start, slot.end) };
    entry.days.push(slot.day);
    byTime.set(key, entry);
  }
  // Preserve week order: groups sort by their earliest day.
  return [...byTime.values()]
    .sort(
      (a, b) => (DAY_ORDER.get(a.days[0]) ?? 0) - (DAY_ORDER.get(b.days[0]) ?? 0),
    )
    .map((g) => ({ daysLabel: joinDays(g.days), timeLabel: g.timeLabel }));
}

/** Concise one-line version for small cards: "Mon & Tue 10 AM · Fri 12 PM". */
export function formatScheduleConcise(slots: MeetingSlot[]): string {
  const lines = groupScheduleForDisplay(slots);
  return lines
    .map((l) => {
      const days = l.daysLabel
        .replace(/, /g, ' & ')
        .replace(/ and /g, ' & ')
        .replace(/(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/g, (d) =>
          d.slice(0, 3),
        );
      const startOnly = l.timeLabel.split(' - ')[0] ?? '';
      return startOnly ? `${days} ${startOnly}` : days;
    })
    .join(' · ');
}

/** 'HH:MM:SS' for DB writes from a Date's wall-clock time. */
export function toDbTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:00`;
}

/** Parses 'HH:MM[:SS]' into a Date today at that wall-clock time. */
export function dbTimeToDate(time: string | null): Date {
  const d = new Date();
  d.setSeconds(0, 0);
  if (time) {
    const [h, m] = time.split(':').map(Number);
    if (!Number.isNaN(h)) d.setHours(h, Number.isNaN(m) ? 0 : m);
  }
  return d;
}
