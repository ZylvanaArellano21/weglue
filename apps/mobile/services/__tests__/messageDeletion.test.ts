/**
 * Guards the single approved message-deletion architecture (deleted-message
 * privacy v9). Every product "delete/unsend for everyone" path must route
 * through the `delete-message` Edge Function and must NEVER hard-delete or write
 * the `messages` table from the client.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mock the Supabase client + the uuid helper before importing the services ──
// vi.hoisted so the spies exist when the hoisted vi.mock factories run.
const { invoke, from, rpc } = vi.hoisted(() => ({
  invoke: vi.fn(),
  from: vi.fn(() => {
    throw new Error('supabase.from() must not be used for message deletion');
  }),
  rpc: vi.fn(() => {
    throw new Error('supabase.rpc() must not be used by new deletion call sites');
  }),
}));

vi.mock('../../lib/supabase', () => ({
  supabase: { functions: { invoke }, from, rpc },
}));
vi.mock('../../lib/chatAttachments', () => ({
  clientUuid: () => 'test-idempotency-uuid',
}));

import { secureDeleteMessage } from '../messageDeletion';
import { unsendMessage } from '../messagingService';
import { deleteMessage as deleteChannelMessage } from '../channelService';

beforeEach(() => {
  invoke.mockReset();
  from.mockClear();
  rpc.mockClear();
  invoke.mockResolvedValue({ data: { status: 'completed' }, error: null });
});

describe('secureDeleteMessage', () => {
  it('invokes the delete-message Edge Function with message_id + idempotency key', async () => {
    const status = await secureDeleteMessage('msg-1');
    expect(status).toBe('completed');
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('delete-message', {
      body: { message_id: 'msg-1', idempotency_key: 'test-idempotency-uuid' },
    });
    // Never a table write.
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('passes through already_deleted / accepted statuses', async () => {
    invoke.mockResolvedValue({ data: { status: 'already_deleted' }, error: null });
    expect(await secureDeleteMessage('msg-1')).toBe('already_deleted');
  });

  it('surfaces the machine-readable error code from a FunctionsHttpError body', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: {
        message: 'Edge Function returned a non-2xx status code',
        context: { json: async () => ({ error: 'secure_deletion_required' }) },
      },
    });
    await expect(secureDeleteMessage('msg-1')).rejects.toThrow('secure_deletion_required');
  });

  it('falls back to the generic message when no body code is present', async () => {
    invoke.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(secureDeleteMessage('msg-1')).rejects.toThrow('boom');
  });
});

describe('thread/DM/group deletion (messagingService.unsendMessage)', () => {
  it('routes through the secure Edge Function, not rpc or a table delete', async () => {
    await unsendMessage('msg-thread');
    expect(invoke).toHaveBeenCalledWith('delete-message', {
      body: { message_id: 'msg-thread', idempotency_key: 'test-idempotency-uuid' },
    });
    expect(rpc).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });
});

describe('club-channel deletion (channelService.deleteMessage)', () => {
  it('routes through the secure Edge Function, not a hard delete', async () => {
    await deleteChannelMessage('msg-channel');
    expect(invoke).toHaveBeenCalledWith('delete-message', {
      body: { message_id: 'msg-channel', idempotency_key: 'test-idempotency-uuid' },
    });
    expect(from).not.toHaveBeenCalled();
  });
});

// ── Static assertion: no product source hard-deletes messages ─────────────────
// Fails if any tracked, non-test source file reintroduces a direct client-side
// delete of the `messages` table (`.from('messages').delete()` across lines) or
// a raw `DELETE FROM messages`. This is the repo-level guard the deletion
// architecture depends on.
describe('static: no direct client hard-delete of messages exists', () => {
  const repoRoot = execSync('git rev-parse --show-toplevel').toString().trim();

  function trackedSourceFiles(): string[] {
    const out = execSync(
      "git ls-files 'apps/*.ts' 'apps/*.tsx' 'packages/*.ts' 'packages/*.tsx' 'scripts/*.ts'",
      { cwd: repoRoot, maxBuffer: 32 * 1024 * 1024 },
    ).toString();
    return out
      .split('\n')
      .filter(Boolean)
      .filter((f) => !f.includes('__tests__') && !f.endsWith('.test.ts') && !f.endsWith('.test.tsx'));
  }

  it('finds zero client-side hard deletes of messages in product code', () => {
    // `.from('messages')` ... `.delete()` possibly spanning lines, and raw SQL.
    const hardDelete = /\.from\(\s*['"]messages['"]\s*\)[\s\S]{0,120}?\.delete\s*\(/;
    const rawSql = /delete\s+from\s+(public\.)?messages\b/i;
    const offenders: string[] = [];
    for (const rel of trackedSourceFiles()) {
      const src = readFileSync(join(repoRoot, rel), 'utf8');
      if (hardDelete.test(src) || rawSql.test(src)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });
});
