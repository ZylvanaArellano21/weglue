import { describe, expect, it } from "vitest";
import { isEventPast, isEventPastAt, splitPastAndUpcoming } from "../datetime";

describe("event expiration", () => {
  it("uses the exact America/Chicago end boundary", () => {
    const justBefore = new Date("2026-08-03T18:59:59.000Z"); // 1:59:59 PM CDT
    const atEnd = new Date("2026-08-03T19:00:00.000Z"); // 2:00 PM CDT
    const after = new Date("2026-08-03T19:00:01.000Z");

    expect(isEventPast("2026-08-03", "14:00:00", justBefore)).toBe(false);
    expect(isEventPast("2026-08-03", "14:00:00", atEnd)).toBe(true);
    expect(isEventPast("2026-08-03", "14:00:00", after)).toBe(true);
  });

  it("uses a canonical timestamp across Central daylight-saving transitions", () => {
    // 2 PM America/Chicago is 19:00Z while daylight saving is in effect.
    expect(isEventPastAt("2026-08-03T19:00:00.000Z", new Date("2026-08-03T18:59:59.999Z"))).toBe(false);
    expect(isEventPastAt("2026-08-03T19:00:00.000Z", new Date("2026-08-03T19:00:00.000Z"))).toBe(true);
    // 2 PM America/Chicago is 20:00Z after the November fallback.
    expect(isEventPastAt("2026-11-03T20:00:00.000Z", new Date("2026-11-03T20:00:00.000Z"))).toBe(true);
  });

  it("uses event_end_at rather than browser-local date strings when splitting Past Events", () => {
    const atEnd = new Date("2026-08-03T19:00:00.000Z");
    const result = splitPastAndUpcoming([
      { id: "ended", event_date: "2026-08-03", start_time: "10:00", end_time: "14:00", event_end_at: "2026-08-03T19:00:00.000Z" },
      { id: "later", event_date: "2026-08-03", start_time: "14:00", end_time: "15:00", event_end_at: "2026-08-03T20:00:00.000Z" },
    ].map((event) => ({ ...event })), atEnd);

    // The collection test proves canonical event_end_at is part of the split
    // contract rather than relying on browser-local date parsing.
    expect(result.past.map((event) => event.id)).toEqual(["ended"]);
    expect(result.upcoming.map((event) => event.id)).toContain("later");
  });
});
