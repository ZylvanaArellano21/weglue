import { describe, expect, it } from "vitest";
import {
  applyThreadVisibility,
  isMessageVisible,
  type ThreadVisibility,
} from "@weglue/shared";

/**
 * The shared thread-visibility contract is the single place where "delete for
 * me" and the conversation-delete watermark are enforced for BOTH platforms.
 * Before it existed the web thread applied neither rule, which is what let a
 * message deleted on a phone stay visible in the browser. These tests pin the
 * rules so that regression cannot return silently on either platform.
 */

const visibility = (hidden: string[], clearedBefore: string | null = null): ThreadVisibility => ({
  hiddenIds: new Set(hidden),
  clearedBefore,
});

const msg = (id: string, created_at: string) => ({ id, created_at });

describe("applyThreadVisibility", () => {
  it("keeps every message when nothing is hidden or cleared", () => {
    const rows = [msg("a", "2026-08-01T10:00:00Z"), msg("b", "2026-08-01T11:00:00Z")];
    expect(applyThreadVisibility(rows, visibility([]))).toEqual(rows);
  });

  it("removes messages this viewer deleted for themselves", () => {
    const rows = [msg("a", "2026-08-01T10:00:00Z"), msg("b", "2026-08-01T11:00:00Z")];
    expect(applyThreadVisibility(rows, visibility(["a"])).map((r) => r.id)).toEqual(["b"]);
  });

  it("removes history at or before the conversation-delete watermark", () => {
    const rows = [
      msg("old", "2026-08-01T09:00:00Z"),
      msg("exact", "2026-08-01T10:00:00Z"),
      msg("new", "2026-08-01T11:00:00Z"),
    ];
    // The watermark is inclusive: a message sent at the exact clearing instant
    // belongs to the cleared history, not to the restored conversation.
    const kept = applyThreadVisibility(rows, visibility([], "2026-08-01T10:00:00Z"));
    expect(kept.map((r) => r.id)).toEqual(["new"]);
  });

  it("applies hides and the watermark together", () => {
    const rows = [
      msg("old", "2026-08-01T09:00:00Z"),
      msg("hidden", "2026-08-01T12:00:00Z"),
      msg("visible", "2026-08-01T13:00:00Z"),
    ];
    const kept = applyThreadVisibility(rows, visibility(["hidden"], "2026-08-01T10:00:00Z"));
    expect(kept.map((r) => r.id)).toEqual(["visible"]);
  });

  it("can filter a page down to nothing without throwing", () => {
    const rows = [msg("a", "2026-08-01T10:00:00Z")];
    expect(applyThreadVisibility(rows, visibility(["a"]))).toEqual([]);
  });

  it("does not mutate the input page", () => {
    const rows = [msg("a", "2026-08-01T10:00:00Z"), msg("b", "2026-08-01T11:00:00Z")];
    applyThreadVisibility(rows, visibility(["a"]));
    expect(rows).toHaveLength(2);
  });

  it("compares instants, not strings, across timezone offsets", () => {
    // 2026-08-01T09:30:00Z expressed as a +02:00 local time is 11:30, which
    // sorts AFTER the watermark as text but before it as an instant.
    const rows = [msg("earlier", "2026-08-01T11:30:00+02:00")];
    const kept = applyThreadVisibility(rows, visibility([], "2026-08-01T10:00:00Z"));
    expect(kept).toEqual([]);
  });
});

describe("isMessageVisible", () => {
  it("mirrors applyThreadVisibility for a single joined row", () => {
    const row = msg("poll-parent", "2026-08-01T10:00:00Z");
    expect(isMessageVisible(row, visibility([]))).toBe(true);
    expect(isMessageVisible(row, visibility(["poll-parent"]))).toBe(false);
    expect(isMessageVisible(row, visibility([], "2026-08-01T11:00:00Z"))).toBe(false);
  });
});
