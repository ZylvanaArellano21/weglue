import { describe, expect, it } from "vitest";
import {
  currentWeekRange,
  formatMeetingSchedule,
  isInCurrentWeek,
  parseMeetingSchedule,
} from "../datetime";

// The two rules the Club-tab sidebar (fix 2) and the Club Profile's Upcoming
// Events colours (fix 8) are built on. Both are anchored to America/Chicago, so
// these assertions are written in UTC to prove the timezone is respected rather
// than the machine's local zone.

describe("current Monday–Sunday week", () => {
  it("runs Monday to Sunday around a mid-week day", () => {
    // Wed 2026-08-05, 12:00 CDT.
    expect(currentWeekRange(new Date("2026-08-05T17:00:00.000Z"))).toEqual({
      start: "2026-08-03",
      end: "2026-08-09",
    });
  });

  it("treats Monday as the FIRST day of the week, not the last", () => {
    expect(currentWeekRange(new Date("2026-08-03T17:00:00.000Z"))).toEqual({
      start: "2026-08-03",
      end: "2026-08-09",
    });
  });

  it("treats Sunday as the LAST day of the same week", () => {
    expect(currentWeekRange(new Date("2026-08-09T17:00:00.000Z"))).toEqual({
      start: "2026-08-03",
      end: "2026-08-09",
    });
    // The very next day starts a new week.
    expect(currentWeekRange(new Date("2026-08-10T17:00:00.000Z")).start).toBe("2026-08-10");
  });

  it("uses the America/Chicago day, not UTC", () => {
    // 2026-08-10T02:00Z is still Sunday 9 August, 21:00 in Chicago — so the
    // week must still be the one ENDING that Sunday.
    expect(currentWeekRange(new Date("2026-08-10T02:00:00.000Z"))).toEqual({
      start: "2026-08-03",
      end: "2026-08-09",
    });
  });

  it("includes only dates inside the window", () => {
    const now = new Date("2026-08-08T17:00:00.000Z"); // Saturday
    expect(isInCurrentWeek("2026-08-03", now)).toBe(true); // Monday
    expect(isInCurrentWeek("2026-08-09", now)).toBe(true); // Sunday
    expect(isInCurrentWeek("2026-08-02", now)).toBe(false); // previous Sunday
    expect(isInCurrentWeek("2026-08-10", now)).toBe(false); // next Monday
    // The event in the correction screenshot: 20 August is NOT this week, so
    // it must render black rather than red.
    expect(isInCurrentWeek("2026-08-20", now)).toBe(false);
  });
});

describe("recurring meeting schedule", () => {
  it("renders a single day with its time range", () => {
    const slots = parseMeetingSchedule(
      [{ day: "Monday", start: "15:00:00", end: "16:00:00" }],
      null,
      null,
      null
    );
    expect(formatMeetingSchedule(slots)).toEqual(["Monday, 3:00 pm - 4:00 pm"]);
  });

  it("collapses days that share a time onto one line", () => {
    const slots = parseMeetingSchedule(
      [
        { day: "Monday", start: "15:00:00", end: "16:00:00" },
        { day: "Wednesday", start: "15:00:00", end: "16:00:00" },
      ],
      null,
      null,
      null
    );
    expect(formatMeetingSchedule(slots)).toEqual(["Monday, Wednesday, 3:00 pm - 4:00 pm"]);
  });

  it("keeps days with different times on their own lines, in week order", () => {
    const slots = parseMeetingSchedule(
      [
        { day: "Friday", start: "09:00:00", end: "10:00:00" },
        { day: "Monday", start: "15:00:00", end: "16:00:00" },
      ],
      null,
      null,
      null
    );
    expect(formatMeetingSchedule(slots)).toEqual([
      "Monday, 3:00 pm - 4:00 pm",
      "Friday, 9:00 am - 10:00 am",
    ]);
  });

  it("falls back to the legacy single-day columns when the jsonb is absent", () => {
    const slots = parseMeetingSchedule(null, "Tuesday", "13:00:00", "14:00:00");
    expect(formatMeetingSchedule(slots)).toEqual(["Tuesday, 1:00 pm - 2:00 pm"]);
  });

  it("prefers the jsonb over the legacy columns when both exist", () => {
    const slots = parseMeetingSchedule(
      [
        { day: "Monday", start: "15:00:00", end: "16:00:00" },
        { day: "Wednesday", start: "15:00:00", end: "16:00:00" },
      ],
      "Monday",
      "15:00:00",
      "16:00:00"
    );
    expect(formatMeetingSchedule(slots)).toEqual(["Monday, Wednesday, 3:00 pm - 4:00 pm"]);
  });

  it("renders the day alone when no time is recorded", () => {
    const slots = parseMeetingSchedule([{ day: "Saturday", start: null, end: null }], null, null, null);
    expect(formatMeetingSchedule(slots)).toEqual(["Saturday"]);
  });

  it("ignores junk entries and de-duplicates repeated days", () => {
    const slots = parseMeetingSchedule(
      [
        { day: "Monday", start: "15:00:00", end: "16:00:00" },
        { day: "Monday", start: "18:00:00", end: "19:00:00" },
        { day: "Someday", start: "10:00:00", end: "11:00:00" },
        null,
        "Monday",
      ],
      null,
      null,
      null
    );
    expect(slots).toHaveLength(1);
    expect(formatMeetingSchedule(slots)).toEqual(["Monday, 3:00 pm - 4:00 pm"]);
  });

  it("produces nothing when a club has no schedule at all", () => {
    expect(formatMeetingSchedule(parseMeetingSchedule(null, null, null, null))).toEqual([]);
  });
});
