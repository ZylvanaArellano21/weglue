import { supabase } from '../lib/supabase';

// ─── Student-to-student blocking (iOS + Android, identical) ─────────────────
//
// Every function here is a thin wrapper over a migration-057 RPC. There is NO
// direct table write anywhere in this file, and there cannot be: `user_blocks`
// has no INSERT/UPDATE/DELETE policy at all, so PostgREST refuses client
// mutations outright. Blocking is one database transaction (block row + BOTH
// follow directions removed + the DM thread hidden from the blocker) and
// splitting it across client round trips would let a crash leave a Gluemate
// alive next to a block.
//
// NOT related to administrator suspension / platform blocking. That is a
// separate system with separate tables and separate vocabulary. Do not merge
// the two here or anywhere else.

export interface BlockedUser {
  user_id: string;
  username: string;
  full_name: string | null;
  avatar_url: string | null;
  avatar_type: string | null;
  blocked_at: string;
}

/** Outcomes `block_user` can report. `ok` covers the idempotent repeat. */
export type BlockStatus = 'ok' | 'self_target' | 'user_not_found' | 'invalid_target';

export interface BlockResult {
  status: BlockStatus;
  /** True when a block already existed — a successful no-op, not an error. */
  alreadyBlocked: boolean;
}

/**
 * Block another student.
 *
 * Idempotent by design: blocking someone already blocked resolves successfully
 * with `alreadyBlocked: true`. Surfacing an error there would be a side channel
 * (it would confirm prior state) and would make the retry path worse for no
 * benefit.
 */
export async function blockUser(targetUserId: string): Promise<BlockResult> {
  const { data, error } = await supabase.rpc('block_user', { p_target: targetUserId });
  if (error) throw error;
  const row = (data ?? {}) as { status?: string; already_blocked?: boolean };
  return {
    status: (row.status ?? 'invalid_target') as BlockStatus,
    alreadyBlocked: row.already_blocked === true,
  };
}

/**
 * Remove your own block.
 *
 * Restores NOTHING — not the follow, not the Gluemate relationship. That is the
 * product contract, and it is enforced in the database, not here.
 */
export async function unblockUser(targetUserId: string): Promise<{ wasBlocked: boolean }> {
  const { data, error } = await supabase.rpc('unblock_user', { p_target: targetUserId });
  if (error) throw error;
  const row = (data ?? {}) as { was_blocked?: boolean };
  return { wasBlocked: row.was_blocked === true };
}

/** The caller's own Blocked Accounts list. Scoped to auth.uid() server-side. */
export async function getMyBlockedUsers(): Promise<BlockedUser[]> {
  const { data, error } = await supabase.rpc('get_my_blocked_users', {
    p_limit: 200,
    p_offset: 0,
  });
  if (error) throw error;
  return ((data ?? []) as any[]).map((r) => ({
    user_id: r.user_id,
    username: r.username,
    full_name: r.full_name ?? null,
    avatar_url: r.avatar_url ?? null,
    avatar_type: r.avatar_type ?? null,
    blocked_at: r.blocked_at,
  }));
}

/**
 * "Have I blocked this person?" — used to choose the Block / Unblock label in a
 * profile menu.
 *
 * Deliberately DIRECTIONAL. The symmetric question ("is interaction
 * unavailable?") is answered by the profile simply not loading, and asking it
 * here would let a client distinguish "I blocked them" from "they blocked me",
 * which is exactly the disclosure the whole design avoids.
 */
export async function didIBlock(targetUserId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('current_user_blocks', {
    p_target: targetUserId,
  });
  if (error) throw error;
  return data === true;
}

/**
 * "Is interaction with this person unavailable?" — SYMMETRIC.
 *
 * True when EITHER direction of block exists, and deliberately does not say
 * which. This is what the direct-message composer asks: both parties must be
 * stopped from sending, but neither may learn who did the blocking, so both
 * get the same answer and the same neutral copy.
 */
export async function isInteractionBlocked(targetUserId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('target_is_blocked_from_current_user', {
    p_target: targetUserId,
  });
  if (error) throw error;
  return data === true;
}
