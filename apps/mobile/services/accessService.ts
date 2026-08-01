import { supabase } from '../lib/supabase';
import type { AccessStatePayload } from '../lib/accessState';

// ─── Administrator restriction state (iOS + Android) ────────────────────────
//
// Day 10B2. One RPC, `my_access_state()`, which is scoped to auth.uid() inside
// the database function body. There is no parameter through which another
// account's state could be requested, so this cannot be used to probe anyone.
//
// The payload is deliberately minimal: a generic state, an optional suspension
// end date, and the public support address. The internal administrator reason,
// the administrator's identity, the restriction history and the correlation id
// are structurally absent — `my_access_state()` cannot return them.

/**
 * Read the signed-in account's own access state.
 *
 * Throws on transport failure so the caller can decide. Callers deliberately
 * treat a failure as "student" (see `resolveAccessRoute`): a network blip must
 * not lock a healthy student out, and it is safe to fail open here because the
 * server refuses a restricted account regardless of what this returns.
 */
export async function getMyAccessState(): Promise<AccessStatePayload> {
  const { data, error } = await supabase.rpc('my_access_state');
  if (error) throw error;
  const row = (data ?? {}) as Partial<AccessStatePayload>;
  return {
    state: (row.state ?? 'active') as AccessStatePayload['state'],
    suspended_until: row.suspended_until ?? null,
    support_email: row.support_email ?? 'info@weglue.app',
  };
}

/**
 * Does a failed request look like the server refusing a restricted account?
 *
 * Migration 058's RPC guard raises `account_restricted` with SQLSTATE 42501,
 * and the RLS layer simply returns nothing. This lets any protected call that
 * is refused trigger an immediate re-check rather than waiting for the next
 * app resume — the "protected API denial triggers a restriction refetch"
 * requirement.
 */
export function looksLikeRestriction(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; message?: string };
  return e.code === '42501' || (e.message ?? '').includes('account_restricted');
}
