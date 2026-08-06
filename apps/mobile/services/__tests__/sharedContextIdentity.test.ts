import { describe, expect, it, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';

// ============================================================================
// Shared-context structural identity + blocked attachments — mobile client half
// ============================================================================
//
// The server-side half is proven by
// supabase/scripts/test_074_shared_context_identity.sql against the full
// 001->074 chain. This file pins the MOBILE client contract and, in particular,
// that it stays byte-identical to the web client: a student blocks on their
// phone and opens the web app, and both must be one system.
// ============================================================================

const rpc = vi.fn();
const from = vi.fn();

vi.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: (...args: unknown[]) => from(...args),
  },
}));

// `blockPrompts` pulls in Alert from react-native, whose published source is
// Flow-typed and cannot be parsed by the node-environment runner the other
// mobile suites use. Only the constants are under test here — same stub as
// apps/mobile/lib/__tests__/blocking.test.ts.
vi.mock('react-native', () => ({ Alert: { alert: vi.fn() } }));

// `chatAttachments` reaches expo-modules-core, which expects the React Native
// `__DEV__` global. Same stub the existing messagesSuggestions suite uses.
vi.mock('../../lib/chatAttachments', () => ({
  CHAT_ATTACHMENTS_BUCKET: 'chat-attachments',
  clientUuid: () => 'attachment-id',
}));

import {
  getConversationSharedIdentities,
  getConversationRestrictedSenders,
} from '../messagingService';
import {
  ATTACHMENT_UNAVAILABLE_TEXT,
  YOU_BLOCKED_TITLE,
  YOU_BLOCKED_BODY,
} from '../../lib/blockPrompts';

const source = (relativePath: string) =>
  readFileSync(decodeURIComponent(new URL(relativePath, import.meta.url).pathname), 'utf8');

const CONVERSATION = 'cccccccc-0000-4000-8000-000000000001';
const BLOCKER = 'bbbbbbbb-0000-4000-8000-000000000001';

beforeEach(() => {
  rpc.mockReset();
  from.mockReset();
});

describe('getConversationSharedIdentities', () => {
  it('calls the narrow conversation-scoped RPC and never queries profiles', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await getConversationSharedIdentities(CONVERSATION);
    expect(rpc).toHaveBeenCalledWith('conversation_shared_identities', {
      p_conversation_id: CONVERSATION,
    });
    // A profiles read here would be a general bypass of the 058 policy.
    expect(from).not.toHaveBeenCalled();
  });

  it('returns only the four structural fields', async () => {
    rpc.mockResolvedValue({
      data: [{ id: BLOCKER, username: 'silvana', full_name: 'Silvana B', avatar_url: null }],
      error: null,
    });
    const map = await getConversationSharedIdentities(CONVERSATION);
    expect(Object.keys(map.get(BLOCKER)!).sort()).toEqual([
      'avatar_url',
      'full_name',
      'id',
      'username',
    ]);
  });

  it('propagates transport errors instead of silently rendering blank names', async () => {
    rpc.mockResolvedValue({ data: null, error: new Error('network') });
    await expect(getConversationSharedIdentities(CONVERSATION)).rejects.toThrow('network');
  });
});

describe('getConversationRestrictedSenders', () => {
  it('is scoped to one conversation', async () => {
    rpc.mockResolvedValue({ data: [BLOCKER], error: null });
    await expect(getConversationRestrictedSenders(CONVERSATION)).resolves.toEqual([BLOCKER]);
    expect(rpc).toHaveBeenCalledWith('conversation_restricted_senders', {
      p_conversation_id: CONVERSATION,
    });
  });

  it('propagates transport errors rather than assuming nothing is restricted', async () => {
    rpc.mockResolvedValue({ data: null, error: new Error('network') });
    await expect(getConversationRestrictedSenders(CONVERSATION)).rejects.toThrow('network');
  });
});

describe('the club member list uses the shared-identity source, not profiles!inner', () => {
  const clubTab = source('../clubTabService.ts');

  it('no longer inner-joins profiles, which used to drop a blocked member', () => {
    expect(clubTab).not.toContain("profiles!inner(id, username, full_name, avatar_url)");
  });

  it('resolves identity through the narrow club RPC', () => {
    expect(clubTab).toContain("supabase.rpc('club_shared_identities', { p_club_id: clubId })");
  });
});

describe('attachment delivery is re-authorized on every fetch', () => {
  const attachments = source('../../lib/chatAttachments.ts');

  // Same defect as web: a signed URL minted before a block still works after
  // it. Proven end-to-end by matrix_attachment_replay.py.
  it('never mints a signed URL for delivery', () => {
    // Match the CALL, not the prose: the header deliberately names
    // createSignedUrl to explain why it is gone.
    expect(attachments).not.toContain('.createSignedUrl(');
  });

  it('fetches through the authenticated storage endpoint with the viewer token', () => {
    expect(attachments).toContain('/storage/v1/object/authenticated/');
    expect(attachments).toContain('Authorization: `Bearer ${accessToken}`');
  });

  it('treats a non-200 as refused rather than trusting the written file', () => {
    expect(attachments).toContain('if (result.status !== 200)');
  });

  it('clears the local cache on an access change', () => {
    expect(attachments).toContain('export async function clearAttachmentCache');
    expect(source('../../lib/studentSynchronization.ts')).toContain('clearAttachmentCache()');
  });
});

describe('copy stays in lockstep with web', () => {
  it('unavailable-attachment wording matches the existing share-card family', () => {
    expect(ATTACHMENT_UNAVAILABLE_TEXT).toBe('This attachment is no longer available.');
  });

  it('blocked-user profile wording is defined once for both platforms', () => {
    expect(YOU_BLOCKED_TITLE).toBe('You blocked this student');
    expect(YOU_BLOCKED_BODY).toBe(
      'You won’t see their profile, posts or weekly events while they’re blocked. Unblock to see them again.',
    );
  });

  it('never tells anybody that they were blocked', () => {
    const text = `${YOU_BLOCKED_TITLE} ${YOU_BLOCKED_BODY}`.toLowerCase();
    expect(text).not.toContain('blocked you');
    expect(text).not.toContain('has blocked');
  });
});

describe('the blocked-profile screen splits by direction', () => {
  const screen = source('../../app/profile/[userId].tsx');

  it('offers Unblock only on the branch gated by the directional RPC', () => {
    expect(screen).toContain('if (!profile && iBlockedThem === true) {');
  });

  it('keeps the generic unavailable state for the person who was blocked', () => {
    const genericIndex = screen.indexOf('{UNAVAILABLE_TITLE}');
    const blockedIndex = screen.indexOf('{YOU_BLOCKED_TITLE}');
    expect(blockedIndex).toBeGreaterThan(-1);
    expect(genericIndex).toBeGreaterThan(blockedIndex);
  });

  it('reuses the single canonical unblock mutation', () => {
    expect(screen).toContain('unblockMutation.mutate(targetUserId!');
    // Exactly one unblock mutation call site — no second implementation.
    expect(screen.split('unblockMutation.mutate(').length - 1).toBe(1);
  });
});
