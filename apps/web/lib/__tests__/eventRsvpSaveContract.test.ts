import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// ============================================================================
// RSVP / save on web are explicit desired-state, NOT a toggle
// ============================================================================
//
// A retry after an uncertain success must re-apply the same end-state, never
// reverse it. The behavioural contract is covered by the mobile service test
// (apps/mobile/services/__tests__/eventRsvpSave.test.ts); web keeps 3 inline
// copies of the same logic, so this pins that they don't regress to a
// read-current-then-toggle shape and that every write is error-checked.
// ============================================================================

const src = (rel: string) =>
  readFileSync(decodeURIComponent(new URL(rel, import.meta.url).pathname), "utf8");

const files = [
  "../hooks/useHomeEventsFeed.ts",
  "../hooks/useEventDetail.ts",
  "../hooks/useCalendar.ts",
];

describe("web RSVP/save services are explicit desired-state", () => {
  for (const f of files) {
    const body = src(f);
    it(`${f}: no "existing status === status" toggle in the RSVP path`, () => {
      expect(body).not.toMatch(/existing\s*as\s*any\)?\??\.status\s*===\s*status/);
      expect(body).not.toMatch(/\.status\s*===\s*status\)/);
    });
    it(`${f}: the RSVP service takes an explicit desired end-state`, () => {
      expect(body).toMatch(/rsvpToEvent\([^)]*desired:\s*"going"\s*\|\s*"cant"\s*\|\s*null/);
      // caller resolves the toggle up front
      expect(body).toMatch(/previousStatus === status \? null : status/);
    });
  }

  it("useSavedEvents unsave is delete-only and error-checked", () => {
    const body = src("../hooks/useSavedEvents.ts");
    expect(body).not.toMatch(/toggleSaveEvent/);
    expect(body).toMatch(/\.delete\(\)[\s\S]*if \(error\) throw error/);
  });

  it("useHomeEventsFeed save service is explicit desired boolean", () => {
    const body = src("../hooks/useHomeEventsFeed.ts");
    expect(body).toMatch(/setEventSaved\(userId: string, eventId: string, desired: boolean\)/);
    expect(body).toMatch(/setEventSaved\(userId, eventId, !isSaved\)/);
  });
});
