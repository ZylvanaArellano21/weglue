import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { QueryClient, QueryObserver } from "@tanstack/react-query";

const source = (rel: string) =>
  readFileSync(decodeURIComponent(new URL(rel, import.meta.url).pathname), "utf8");

// ============================================================================
// Unread-summary fallback poll — regression test (rollout task 12)
// ============================================================================
//
// `useUnreadSummary`'s poll was widened 60s -> 5min. The realtime `notifications`
// subscription + the `sync:message-inbox` broadcast keep the badge live; the
// poll is only the self-heal for a MISSED realtime event.
//
// Pins:
//   1. the interval is 5 minutes (regression: it was 60s) and is longer than
//      the query stale time, so every poll tick actually refetches;
//   2. a poll tick (== react-query's `refetch()`, which its `refetchInterval`
//      scheduler calls on the timer) heals a badge count that a missed realtime
//      event left stale — repeatedly.
// ============================================================================

const rpc = vi.hoisted(() => vi.fn());
vi.mock("../../lib/supabase", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
// Keep the expo/RN native surface out of the node test — only the query knobs
// and the fetcher matter here.
vi.mock("expo-notifications", () => ({ setBadgeCountAsync: vi.fn(() => Promise.resolve()) }));
vi.mock("../../lib/realtime", () => ({
  createSafeChannel: vi.fn(() => ({})),
  removeSafeChannel: vi.fn(),
  subscribeBroadcast: vi.fn(() => () => {}),
}));

import {
  fetchUnreadSummary,
  UNREAD_SUMMARY_STALE_MS,
  UNREAD_SUMMARY_POLL_MS,
} from "../useUnreadSummary";

function rpcSummary(unread: number) {
  return {
    data: {
      unread_notifications: unread,
      unread_threads: 0,
      unread_direct_messages: 0,
      unread_group_messages: 0,
      unread_conversations: [],
    },
    error: null,
  };
}

beforeEach(() => {
  rpc.mockReset();
  // A sane default so the observer's initial auto-fetch on subscribe never
  // hits an undefined mock (which would make fetchUnreadSummary throw).
  rpc.mockResolvedValue(rpcSummary(0));
});

describe("interval value", () => {
  it("polls every 5 minutes, not the old 60s", () => {
    expect(UNREAD_SUMMARY_POLL_MS).toBe(5 * 60 * 1000);
    expect(UNREAD_SUMMARY_POLL_MS).toBeGreaterThan(60 * 1000);
  });

  it("the poll interval exceeds the stale time, so every tick refetches", () => {
    expect(UNREAD_SUMMARY_STALE_MS).toBeLessThan(UNREAD_SUMMARY_POLL_MS);
  });
});

describe("a poll tick heals a missed realtime update", () => {
  it("restores the badge count when nothing invalidated the query", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const observer = new QueryObserver<Awaited<ReturnType<typeof fetchUnreadSummary>>>(client, {
      queryKey: ["unreadSummary", "u1"],
      queryFn: fetchUnreadSummary,
      staleTime: UNREAD_SUMMARY_STALE_MS,
    });
    const stop = observer.subscribe(() => {});
    const unread = () => observer.getCurrentResult().data?.unread_notifications;

    rpc.mockResolvedValue(rpcSummary(0));
    await observer.refetch();
    expect(unread()).toBe(0);
    expect(rpc).toHaveBeenCalledTimes(1);

    // A notification is created server-side; its realtime event never reaches
    // this client, so nothing invalidates the query — the badge is now stale.
    rpc.mockResolvedValue(rpcSummary(3));
    expect(unread()).toBe(0);

    // The 5-minute poll tick fires (== refetch) and heals it.
    await observer.refetch();
    expect(unread()).toBe(3);

    // A second missed event is healed by the next tick too.
    rpc.mockResolvedValue(rpcSummary(8));
    await observer.refetch();
    expect(unread()).toBe(8);

    // The realtime path, when it IS received, is an invalidation — same fetcher.
    rpc.mockResolvedValue(rpcSummary(2));
    await client.invalidateQueries({ queryKey: ["unreadSummary", "u1"] });
    expect(unread()).toBe(2);

    stop();
    client.clear();
  });
});

describe("returning to the foreground heals a stale badge without waiting for the poll", () => {
  // A missed realtime event otherwise stays visible until the 5-minute poll.
  // The self-heal on refocus comes from two pieces of always-on wiring, pinned
  // here by source assertion (this repo's convention for RN app-shell wiring —
  // see useInvitePushPermission.test.ts):
  //   1. _layout.tsx bridges react-query's focusManager to AppState, counting a
  //      genuine `background -> active` return as a refocus;
  //   2. the query keeps the app-wide `refetchOnWindowFocus: true` default and
  //      goes stale after 15s, so that refocus refetches it right away.
  const layoutSrc = source("../../app/_layout.tsx");
  const hookSrc = source("../useUnreadSummary.ts");

  it("_layout wires focusManager to a real AppState background->active return", () => {
    expect(layoutSrc).toMatch(/focusManager\.setEventListener/);
    expect(layoutSrc).toMatch(/AppState\.addEventListener\(\s*["']change["']/);
    expect(layoutSrc).toMatch(/lastAppState === "background"[\s\S]*handleFocus\(true\)/);
    expect(layoutSrc).toMatch(/refetchOnWindowFocus:\s*true/);
  });

  it("the unread-summary query does not opt out of refetch-on-focus and stays briefly stale", () => {
    expect(hookSrc).not.toMatch(/refetchOnWindowFocus:\s*false/);
    // 15s stale window: long enough to dedupe render churn, short enough that a
    // refocus (or the next poll) always refetches.
    expect(UNREAD_SUMMARY_STALE_MS).toBeLessThanOrEqual(30 * 1000);
  });
});
