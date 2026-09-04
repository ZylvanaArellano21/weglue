import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// ============================================================================
// providers.tsx load guards — risk #11 (access-state) and risk #16 (nav
// invalidation)
// ============================================================================
//
// Both the access-state RPC and the 27-root student-content invalidation used
// to fire on EVERY route change. At ~50 active users clicking through tabs that
// is a steady stream of my_access_state RPCs and invalidation storms. The real
// signals (the opaque broadcasts, a 42501 on any protected query, auth events,
// window focus) still run unthrottled; only the belt-and-suspenders
// navigation re-check is coalesced.
// ============================================================================

const src = readFileSync(
  decodeURIComponent(new URL("../../app/providers.tsx", import.meta.url).pathname),
  "utf8"
);

describe("access-state gate (risk #11)", () => {
  it("navigation re-check is not forced", () => {
    expect(src).toMatch(/\}, \[pathname\]\);/);
    expect(src).toMatch(/checkRef\.current\(\{ force: false \}\)/);
  });

  it("check() honors a recency window when not forced", () => {
    expect(src).toMatch(/ACCESS_RECHECK_MS\s*=\s*15_000/);
    expect(src).toMatch(/if \(!force && Date\.now\(\) - lastCheckAt < ACCESS_RECHECK_MS\) return/);
  });

  it("out-of-band signals still force a check", () => {
    // broadcast, 42501 query error, auth events, timed-suspension interval all
    // call check()/checkRef.current() with no args => force defaults true.
    expect(src).toMatch(/subscribeBroadcast\(\s*`sync:access:\$\{nextUserId\}`[\s\S]*?\(\) => void check\(\)/);
    expect(src).toMatch(/error\?\.code === "42501"[\s\S]*?void check\(\)/);
    expect(src).toMatch(/const check = async \(\{ force = true \}/);
  });
});

describe("student-content navigation invalidation (risk #16)", () => {
  it("is coalesced by a time window", () => {
    expect(src).toMatch(/STUDENT_NAV_INVALIDATE_MS\s*=\s*10_000/);
    expect(src).toMatch(/Date\.now\(\) - lastNavInvalidateRef\.current < STUDENT_NAV_INVALIDATE_MS.*return/);
  });

  it("the university broadcast and focus-recovery paths are NOT throttled", () => {
    // refreshPermissionSensitiveStudentContent (broadcast) and
    // invalidateStudentContentQueries (subscribeBrowserCanonicalRecovery) are
    // called directly without the nav window guard.
    expect(src).toMatch(/`sync:university:\$\{universityId\}`[\s\S]*?refreshPermissionSensitiveStudentContent\(queryClient\)/);
    expect(src).toMatch(/const recover = \(\) => invalidateStudentContentQueries\(queryClient\)/);
  });

  it("(re)subscribing to the campus broadcast does NOT clear — only a received message does", () => {
    // subscribeBroadcast(topic, event, onMessage, onSubscribed). onSubscribed
    // fires on the initial connect AND on every socket reconnect (token-refresh
    // re-auth, network blip, refocus). Using the clearing form there blanked
    // every open screen back to a skeleton on every reconnect; the reconnect
    // path must be a background invalidation.
    const call = src.match(
      /subscribeBroadcast\(\s*`sync:university:\$\{universityId\}`,[\s\S]*?\);/,
    );
    expect(call).not.toBeNull();
    const [onMessageCb, onSubscribedCb] = (call![0].match(/\(\) => \w+\(queryClient\)/g) ?? []);
    expect(onMessageCb).toContain("refreshPermissionSensitiveStudentContent");
    expect(onSubscribedCb).toContain("invalidateStudentContentQueries");
  });
});
