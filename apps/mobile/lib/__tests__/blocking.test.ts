import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Student blocking — client contract tests (iOS + Android, one code path)
// ============================================================================
//
// These pin the CLIENT-SIDE half of the contract. The server-side half is
// proven by supabase/scripts/test_057_student_blocking.sql, which runs the real
// migration against a production-shaped database.
//
// What matters here:
//   • every mutation goes through an RPC, never a table write
//   • the idempotent repeat is reported as success, not as an error
//   • the DIRECTIONAL and SYMMETRIC questions use DIFFERENT RPCs, because
//     mixing them up is how a client would leak who blocked whom
//   • the confirmation copy never claims the other person is notified, and the
//     unavailable copy is identical across block / deleted / never-existed
// ============================================================================

const rpc = vi.fn();
vi.mock('../supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

// `blockPrompts` pulls in Alert from react-native, whose published source is
// Flow-typed and cannot be parsed by the node-environment test runner the other
// mobile suites use. Only the constants are under test here, so a minimal stub
// keeps this suite pure — the same reason the existing mobile tests avoid RN.
const alertSpy = vi.fn();
vi.mock('react-native', () => ({ Alert: { alert: (...a: unknown[]) => alertSpy(...a) } }));

import {
  blockUser,
  unblockUser,
  getMyBlockedUsers,
  didIBlock,
  isInteractionBlocked,
} from '../../services/blockService';
import {
  UNAVAILABLE_TITLE,
  UNAVAILABLE_BODY,
  DM_UNAVAILABLE_TEXT,
  BLOCKED_EMPTY_TITLE,
  BLOCKED_EMPTY_BODY,
} from '../blockPrompts';

const TARGET = 'bbbbbbbb-0000-4000-8000-000000000002';

beforeEach(() => rpc.mockReset());

describe('blockService — every mutation is an RPC, never a table write', () => {
  it('blockUser calls block_user with the target and reports ok', async () => {
    rpc.mockResolvedValue({ data: { status: 'ok', already_blocked: false }, error: null });
    const res = await blockUser(TARGET);
    expect(rpc).toHaveBeenCalledWith('block_user', { p_target: TARGET });
    expect(res).toEqual({ status: 'ok', alreadyBlocked: false });
  });

  it('treats a DUPLICATE block as success, not an error', async () => {
    // Surfacing an error here would confirm prior state to the caller and make
    // the retry path worse for no benefit.
    rpc.mockResolvedValue({ data: { status: 'ok', already_blocked: true }, error: null });
    const res = await blockUser(TARGET);
    expect(res.status).toBe('ok');
    expect(res.alreadyBlocked).toBe(true);
  });

  it('surfaces self_target and user_not_found without throwing', async () => {
    for (const status of ['self_target', 'user_not_found'] as const) {
      rpc.mockResolvedValue({ data: { status }, error: null });
      await expect(blockUser(TARGET)).resolves.toMatchObject({ status });
    }
  });

  it('maps a missing/garbled payload to invalid_target rather than a false ok', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(blockUser(TARGET)).resolves.toMatchObject({ status: 'invalid_target' });
  });

  it('propagates a transport error so the UI can show a retry', async () => {
    rpc.mockResolvedValue({ data: null, error: new Error('offline') });
    await expect(blockUser(TARGET)).rejects.toThrow('offline');
  });

  it('unblockUser calls unblock_user and reports whether a row existed', async () => {
    rpc.mockResolvedValue({ data: { status: 'ok', was_blocked: true }, error: null });
    await expect(unblockUser(TARGET)).resolves.toEqual({ wasBlocked: true });
    expect(rpc).toHaveBeenCalledWith('unblock_user', { p_target: TARGET });
  });

  it('repeated unblock is idempotent (was_blocked false, still resolves)', async () => {
    rpc.mockResolvedValue({ data: { status: 'ok', was_blocked: false }, error: null });
    await expect(unblockUser(TARGET)).resolves.toEqual({ wasBlocked: false });
  });
});

describe('blockService — directional vs symmetric questions use DIFFERENT RPCs', () => {
  it('didIBlock asks the DIRECTIONAL rpc (drives the Block/Unblock label)', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    await expect(didIBlock(TARGET)).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith('current_user_blocks', { p_target: TARGET });
  });

  it('isInteractionBlocked asks the SYMMETRIC rpc (drives the composer)', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    await expect(isInteractionBlocked(TARGET)).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith('target_is_blocked_from_current_user', { p_target: TARGET });
  });

  it('never sends a caller-supplied viewer id — identity is always auth.uid()', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    await didIBlock(TARGET);
    await isInteractionBlocked(TARGET);
    await blockUser(TARGET);
    await unblockUser(TARGET);
    for (const call of rpc.mock.calls) {
      const args = (call[1] ?? {}) as Record<string, unknown>;
      expect(Object.keys(args)).toEqual(['p_target']);
      expect(args).not.toHaveProperty('p_user_id');
      expect(args).not.toHaveProperty('p_viewer_id');
    }
  });

  it('coerces a non-boolean payload to false rather than a truthy object', async () => {
    rpc.mockResolvedValue({ data: 'yes', error: null });
    await expect(didIBlock(TARGET)).resolves.toBe(false);
  });
});

describe('blockService — getMyBlockedUsers', () => {
  it('normalizes rows and never requests another user’s list', async () => {
    rpc.mockResolvedValue({
      data: [
        { user_id: TARGET, username: 'bobby', full_name: 'Bobby Brown', blocked_at: '2026-07-31T00:00:00Z' },
      ],
      error: null,
    });
    const rows = await getMyBlockedUsers();
    expect(rpc).toHaveBeenCalledWith('get_my_blocked_users', { p_limit: 200, p_offset: 0 });
    expect(rows).toEqual([
      {
        user_id: TARGET,
        username: 'bobby',
        full_name: 'Bobby Brown',
        avatar_url: null,
        avatar_type: null,
        blocked_at: '2026-07-31T00:00:00Z',
      },
    ]);
  });

  it('returns an empty array (never undefined) so the empty state renders', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(getMyBlockedUsers()).resolves.toEqual([]);
  });
});

describe('blockPrompts — copy cannot disclose a block', () => {
  it('never claims or implies the blocked person is notified', () => {
    const all = [
      UNAVAILABLE_TITLE,
      UNAVAILABLE_BODY,
      DM_UNAVAILABLE_TEXT,
      BLOCKED_EMPTY_TITLE,
      BLOCKED_EMPTY_BODY,
    ].join(' ').toLowerCase();
    expect(all).not.toContain('notified');
    expect(all).not.toContain('we told');
    expect(all).not.toContain('has been told');
  });

  it('the unavailable copy is GENERIC — it must fit blocked, deleted and never-existed alike', () => {
    const text = `${UNAVAILABLE_TITLE} ${UNAVAILABLE_BODY}`.toLowerCase();
    // If any of these words appeared, the state itself would reveal WHICH case
    // it is, which is exactly what a block must not leak.
    for (const leak of ['block', 'blocked', 'deleted', 'suspended', 'banned', 'restricted']) {
      expect(text).not.toContain(leak);
    }
  });

  it('the DM composer text is symmetric — it names neither party nor a direction', () => {
    const text = DM_UNAVAILABLE_TEXT.toLowerCase();
    for (const leak of ['block', 'they', 'them', 'this user has']) {
      expect(text).not.toContain(leak);
    }
    // Addressed to "you", so both parties can be shown the identical string.
    expect(text).toContain('you');
  });
});
