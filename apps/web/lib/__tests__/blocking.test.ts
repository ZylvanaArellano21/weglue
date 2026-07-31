import { describe, it, expect, vi, beforeEach } from "vitest";

// ============================================================================
// Student blocking — student-web client contract
// ============================================================================
//
// The server-side half is proven by supabase/scripts/test_057_student_blocking.sql
// against a production-shaped database. This file pins the WEB client half, and
// in particular the two properties most likely to rot:
//
//   1. web and mobile must stay in lockstep — a student blocks on their phone
//      and unblocks on the web, and both must be the same system;
//   2. the unavailable copy must stay generic, so the state cannot disclose
//      whether an account is blocked, deleted, or never existed.
// ============================================================================

const rpc = vi.fn();
vi.mock("../supabase-browser", () => ({
  getSupabaseBrowser: () => ({ rpc: (...a: unknown[]) => rpc(...a) }),
}));

import {
  blockUser,
  unblockUser,
  getMyBlockedUsers,
  didIBlock,
  isInteractionBlocked,
  blockConfirmMessage,
  unblockConfirmMessage,
  UNAVAILABLE_TITLE,
  UNAVAILABLE_BODY,
  BLOCKED_EMPTY_TITLE,
  BLOCKED_EMPTY_BODY,
} from "../blocking";

const TARGET = "bbbbbbbb-0000-4000-8000-000000000002";

beforeEach(() => rpc.mockReset());

describe("web blocking — mutations are RPC-only", () => {
  it("blockUser calls block_user and reports ok", async () => {
    rpc.mockResolvedValue({ data: { status: "ok", already_blocked: false }, error: null });
    await expect(blockUser(TARGET)).resolves.toEqual({ status: "ok", alreadyBlocked: false });
    expect(rpc).toHaveBeenCalledWith("block_user", { p_target: TARGET });
  });

  it("treats a duplicate block as success, not an error", async () => {
    rpc.mockResolvedValue({ data: { status: "ok", already_blocked: true }, error: null });
    await expect(blockUser(TARGET)).resolves.toMatchObject({ status: "ok", alreadyBlocked: true });
  });

  it("maps a garbled payload to invalid_target rather than a false ok", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(blockUser(TARGET)).resolves.toMatchObject({ status: "invalid_target" });
  });

  it("propagates transport errors so the UI can offer a retry", async () => {
    rpc.mockResolvedValue({ data: null, error: new Error("network") });
    await expect(blockUser(TARGET)).rejects.toThrow("network");
    rpc.mockResolvedValue({ data: null, error: new Error("network") });
    await expect(unblockUser(TARGET)).rejects.toThrow("network");
  });

  it("unblock is idempotent and reports whether a row existed", async () => {
    rpc.mockResolvedValue({ data: { status: "ok", was_blocked: false }, error: null });
    await expect(unblockUser(TARGET)).resolves.toEqual({ wasBlocked: false });
    expect(rpc).toHaveBeenCalledWith("unblock_user", { p_target: TARGET });
  });

  it("getMyBlockedUsers returns [] rather than undefined so the empty state renders", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(getMyBlockedUsers()).resolves.toEqual([]);
    expect(rpc).toHaveBeenCalledWith("get_my_blocked_users", { p_limit: 200, p_offset: 0 });
  });
});

describe("web blocking — directional vs symmetric", () => {
  it("didIBlock uses the DIRECTIONAL rpc", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    await expect(didIBlock(TARGET)).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith("current_user_blocks", { p_target: TARGET });
  });

  it("isInteractionBlocked uses the SYMMETRIC rpc", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    await expect(isInteractionBlocked(TARGET)).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith("target_is_blocked_from_current_user", {
      p_target: TARGET,
    });
  });

  it("never sends a caller-supplied viewer identity", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    await didIBlock(TARGET);
    await isInteractionBlocked(TARGET);
    await blockUser(TARGET);
    await unblockUser(TARGET);
    for (const call of rpc.mock.calls) {
      expect(Object.keys((call[1] ?? {}) as object)).toEqual(["p_target"]);
    }
  });
});

describe("web blocking — copy cannot disclose a block", () => {
  it("the unavailable copy fits blocked, deleted and never-existed alike", () => {
    const text = `${UNAVAILABLE_TITLE} ${UNAVAILABLE_BODY}`.toLowerCase();
    for (const leak of ["block", "deleted", "suspended", "banned", "restricted"]) {
      expect(text).not.toContain(leak);
    }
  });

  it("no copy claims the blocked person is notified", () => {
    const all = [
      UNAVAILABLE_TITLE,
      UNAVAILABLE_BODY,
      BLOCKED_EMPTY_TITLE,
      BLOCKED_EMPTY_BODY,
      blockConfirmMessage("bobby"),
      unblockConfirmMessage("bobby"),
    ]
      .join(" ")
      .toLowerCase();
    expect(all).not.toContain("notified");
    expect(all).not.toContain("has been told");
  });

  it("the block confirmation states what blocking does NOT do", () => {
    const msg = blockConfirmMessage("bobby").toLowerCase();
    expect(msg).toContain("won’t be told");
    // The two most common support questions are "will they know?" and "did I
    // just leave the club?" — both must be answered before the user taps.
    expect(msg).toContain("clubs");
    expect(msg).toContain("group chats");
  });

  it("the unblock confirmation warns that nothing is restored", () => {
    const msg = unblockConfirmMessage("bobby").toLowerCase();
    expect(msg).toContain("won’t restore");
    expect(msg).toContain("gluemate");
  });

  it("handles a missing username without rendering 'undefined'", () => {
    for (const msg of [blockConfirmMessage(null), unblockConfirmMessage(undefined)]) {
      expect(msg).toContain("this account");
      expect(msg).not.toContain("undefined");
      expect(msg).not.toContain("null");
    }
  });
});

describe("web blocking — parity with the mobile client", () => {
  it("uses exactly the same five RPC names as apps/mobile/services/blockService.ts", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    await blockUser(TARGET);
    await unblockUser(TARGET);
    await didIBlock(TARGET);
    await isInteractionBlocked(TARGET);
    rpc.mockResolvedValue({ data: [], error: null });
    await getMyBlockedUsers();

    expect(new Set(rpc.mock.calls.map((c) => c[0]))).toEqual(
      new Set([
        "block_user",
        "unblock_user",
        "current_user_blocks",
        "target_is_blocked_from_current_user",
        "get_my_blocked_users",
      ])
    );
  });
});
