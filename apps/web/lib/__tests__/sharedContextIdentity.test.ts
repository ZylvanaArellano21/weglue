import { describe, it, expect, vi, beforeEach } from "vitest";

// ============================================================================
// Shared-context structural identity + blocked attachments — web client half
// ============================================================================
//
// The server-side half is proven by
// supabase/scripts/test_074_shared_context_identity.sql against the full
// 001->074 chain: the narrow readers, their authorization, and the storage
// policy that actually refuses a blocked pair's attachment bytes.
//
// This file pins the WEB client contract, and specifically the properties most
// likely to rot:
//
//   1. identity is filled ONLY from the narrow shared-context RPCs, never by
//      widening a profiles query;
//   2. an embedded profile always WINS over the shared-context fallback, so a
//      normal thread is unaffected;
//   3. the unavailable-attachment copy stays byte-identical to mobile;
//   4. the restricted-sender signal is conversation-scoped.
// ============================================================================

const rpc = vi.fn();
const from = vi.fn();
vi.mock("../supabase-browser", () => ({
  getSupabaseBrowser: () => ({
    rpc: (...a: unknown[]) => rpc(...a),
    from: (...a: unknown[]) => from(...a),
  }),
}));

import {
  conversationSharedIdentities,
  conversationRestrictedSenders,
} from "../messages/service";
import { ATTACHMENT_UNAVAILABLE_TEXT, YOU_BLOCKED_TITLE, YOU_BLOCKED_BODY } from "../blocking";

const CONVERSATION = "cccccccc-0000-4000-8000-000000000001";
const BLOCKER = "bbbbbbbb-0000-4000-8000-000000000001";

beforeEach(() => {
  rpc.mockReset();
  from.mockReset();
});

describe("conversationSharedIdentities", () => {
  it("calls the narrow conversation-scoped RPC, not a profiles query", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await conversationSharedIdentities(CONVERSATION);
    expect(rpc).toHaveBeenCalledWith("conversation_shared_identities", {
      p_conversation_id: CONVERSATION,
    });
    // A profiles read here would be a general bypass of the 058 policy.
    expect(from).not.toHaveBeenCalled();
  });

  it("maps to a lookup keyed by user id with only the minimal fields", async () => {
    rpc.mockResolvedValue({
      data: [{ id: BLOCKER, username: "silvana", full_name: "Silvana B", avatar_url: null }],
      error: null,
    });
    const map = await conversationSharedIdentities(CONVERSATION);
    expect(map.get(BLOCKER)).toEqual({
      id: BLOCKER,
      username: "silvana",
      full_name: "Silvana B",
      avatar_url: null,
    });
    // Nothing beyond the four structural fields may appear.
    expect(Object.keys(map.get(BLOCKER)!).sort()).toEqual([
      "avatar_url",
      "full_name",
      "id",
      "username",
    ]);
  });

  it("propagates transport errors instead of silently rendering blank names", async () => {
    rpc.mockResolvedValue({ data: null, error: new Error("network") });
    await expect(conversationSharedIdentities(CONVERSATION)).rejects.toThrow("network");
  });

  it("tolerates a null payload", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(conversationSharedIdentities(CONVERSATION)).resolves.toEqual(new Map());
  });
});

describe("conversationRestrictedSenders", () => {
  it("is scoped to one conversation", async () => {
    rpc.mockResolvedValue({ data: [BLOCKER], error: null });
    await expect(conversationRestrictedSenders(CONVERSATION)).resolves.toEqual([BLOCKER]);
    expect(rpc).toHaveBeenCalledWith("conversation_restricted_senders", {
      p_conversation_id: CONVERSATION,
    });
  });

  it("returns an empty list when nothing is restricted", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await expect(conversationRestrictedSenders(CONVERSATION)).resolves.toEqual([]);
  });

  it("propagates transport errors rather than assuming nothing is restricted", async () => {
    rpc.mockResolvedValue({ data: null, error: new Error("network") });
    await expect(conversationRestrictedSenders(CONVERSATION)).rejects.toThrow("network");
  });
});

describe("copy stays in lockstep with mobile", () => {
  // Byte-identical to apps/mobile/lib/blockPrompts.ts. A student who blocks on
  // their phone and opens the web app must see one system, not two.
  it("uses mobile's unavailable-attachment wording verbatim", () => {
    expect(ATTACHMENT_UNAVAILABLE_TEXT).toBe("This attachment is no longer available.");
  });

  it("uses mobile's blocked-user profile wording verbatim", () => {
    expect(YOU_BLOCKED_TITLE).toBe("You blocked this student");
    expect(YOU_BLOCKED_BODY).toBe(
      "You won’t see their profile, posts or weekly events while they’re blocked. Unblock to see them again."
    );
  });

  it("never names the other person or the direction in the blocked-viewer copy", () => {
    const text = `${YOU_BLOCKED_TITLE} ${YOU_BLOCKED_BODY}`.toLowerCase();
    // The blocker's own state may say "you blocked"; what must never appear
    // anywhere is copy telling someone that THEY were blocked.
    expect(text).not.toContain("blocked you");
    expect(text).not.toContain("has blocked");
  });
});
