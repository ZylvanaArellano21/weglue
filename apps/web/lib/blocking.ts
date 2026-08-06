import { getSupabaseBrowser } from "./supabase-browser";

// ─── Student-to-student blocking (student web) ──────────────────────────────
//
// Mirrors apps/mobile/services/blockService.ts exactly: same RPCs, same
// idempotency contract, same directional-vs-symmetric split. The two clients
// must not drift, because a student can block on their phone and unblock on the
// web and has to see one coherent system.
//
// Every mutation is an RPC. There is no direct table write and there cannot be:
// `user_blocks` has no INSERT/UPDATE/DELETE policy, so PostgREST refuses client
// mutations outright.
//
// NOT related to administrator suspension / platform blocking, which is a
// separate system (Day 10B2) with its own tables and vocabulary.

export interface BlockedUser {
  user_id: string;
  username: string;
  full_name: string | null;
  avatar_url: string | null;
  avatar_type: string | null;
  blocked_at: string;
}

export type BlockStatus = "ok" | "self_target" | "user_not_found" | "invalid_target";

export interface BlockResult {
  status: BlockStatus;
  /** True when a block already existed — a successful no-op, not an error. */
  alreadyBlocked: boolean;
}

export async function blockUser(targetUserId: string): Promise<BlockResult> {
  const supabase = getSupabaseBrowser();
  const { data, error } = await supabase.rpc("block_user", { p_target: targetUserId });
  if (error) throw error;
  const row = (data ?? {}) as { status?: string; already_blocked?: boolean };
  return {
    status: (row.status ?? "invalid_target") as BlockStatus,
    alreadyBlocked: row.already_blocked === true,
  };
}

/** Removes only the caller's own block. Restores no follow and no Gluemate. */
export async function unblockUser(targetUserId: string): Promise<{ wasBlocked: boolean }> {
  const supabase = getSupabaseBrowser();
  const { data, error } = await supabase.rpc("unblock_user", { p_target: targetUserId });
  if (error) throw error;
  const row = (data ?? {}) as { was_blocked?: boolean };
  return { wasBlocked: row.was_blocked === true };
}

export async function getMyBlockedUsers(): Promise<BlockedUser[]> {
  const supabase = getSupabaseBrowser();
  const { data, error } = await supabase.rpc("get_my_blocked_users", {
    p_limit: 200,
    p_offset: 0,
  });
  if (error) throw error;
  return ((data ?? []) as Record<string, string | null>[]).map((r) => ({
    user_id: r.user_id as string,
    username: r.username as string,
    full_name: r.full_name ?? null,
    avatar_url: r.avatar_url ?? null,
    avatar_type: r.avatar_type ?? null,
    blocked_at: r.blocked_at as string,
  }));
}

/**
 * DIRECTIONAL: "have I blocked them?" — chooses the Block/Unblock label.
 * Only meaningful for a profile the viewer can see; if the other person did the
 * blocking, the profile does not load at all.
 */
export async function didIBlock(targetUserId: string): Promise<boolean> {
  const supabase = getSupabaseBrowser();
  const { data, error } = await supabase.rpc("current_user_blocks", { p_target: targetUserId });
  if (error) throw error;
  return data === true;
}

/**
 * SYMMETRIC: "is interaction unavailable?" — true for either direction, and
 * deliberately silent about which. Both parties get the same answer.
 */
export async function isInteractionBlocked(targetUserId: string): Promise<boolean> {
  const supabase = getSupabaseBrowser();
  const { data, error } = await supabase.rpc("target_is_blocked_from_current_user", {
    p_target: targetUserId,
  });
  if (error) throw error;
  return data === true;
}

// ── Copy (kept identical to apps/mobile/lib/blockPrompts.ts) ────────────────
//
// The unavailable strings are shared by blocked, deleted and never-existed
// accounts. If they differed, the state itself would disclose which occurred.

export const UNAVAILABLE_TITLE = "This account isn’t available";
export const UNAVAILABLE_BODY = "This account can’t be viewed right now.";
// Kept byte-identical to apps/mobile/lib/blockPrompts.ts.
export const ATTACHMENT_UNAVAILABLE_TEXT = "This attachment is no longer available.";
export const YOU_BLOCKED_TITLE = "You blocked this student";
export const YOU_BLOCKED_BODY =
  "You won’t see their profile, posts or weekly events while they’re blocked. Unblock to see them again.";
export const BLOCKED_EMPTY_TITLE = "You haven’t blocked anyone";
export const BLOCKED_EMPTY_BODY =
  "People you block will appear here. They won’t be told, and you can unblock them at any time.";

export function blockConfirmMessage(username: string | null | undefined): string {
  const who = username ? `@${username}` : "this account";
  return (
    `Block ${who}?\n\n` +
    `They won’t be able to message you or find your profile, and you won’t see theirs. ` +
    `They won’t be told.\n\n` +
    `You’ll both stay in any clubs, events and group chats you already share.`
  );
}

export function unblockConfirmMessage(username: string | null | undefined): string {
  const who = username ? `@${username}` : "this account";
  return (
    `Unblock ${who}?\n\n` +
    `They’ll be able to find your profile and message you again.\n\n` +
    `This won’t restore your previous Gluemate connection.`
  );
}
