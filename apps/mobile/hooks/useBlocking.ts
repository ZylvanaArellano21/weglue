import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  blockUser,
  unblockUser,
  getMyBlockedUsers,
  didIBlock,
  isInteractionBlocked,
  type BlockedUser,
  type BlockResult,
} from '../services/blockService';
import { subscribeBroadcast } from '../lib/realtime';

// ─── Student blocking: React Query bindings (iOS + Android, identical) ───────
//
// SYNCHRONIZATION MODEL. A block changes what the server will return for a
// large, scattered set of queries — discovery, search, the feed, profiles,
// follow state, Gluemates, conversations and notifications. Rather than try to
// patch each cache entry by hand (which would drift the moment a new screen is
// added), every one of those roots is INVALIDATED after a successful mutation.
// React Query then refetches whatever is actually mounted, and everything else
// refetches on next focus.
//
// The server is the authority throughout: even if a cache entry were somehow
// missed, RLS returns zero rows for a blocked profile and refuses a blocked
// DM insert, so a stale screen cannot become a bypass — only a briefly stale
// pixel that corrects itself on focus.

export const blockedUsersKey = (userId?: string) => ['blockedUsers', userId] as const;
export const didIBlockKey = (viewerId?: string, targetId?: string) =>
  ['didIBlock', viewerId, targetId] as const;
export const interactionBlockedKey = (viewerId?: string, targetId?: string) =>
  ['interactionBlocked', viewerId, targetId] as const;

/**
 * Every query root whose CONTENTS can change when a block is created or
 * removed. Kept as one list, in one place, so a future screen has a single
 * obvious thing to add itself to.
 */
const BLOCK_SENSITIVE_KEYS: string[] = [
  // discovery + search
  'discoveryPeople',
  'discoverySearch',
  'discoveryClubs',
  'discoveryEvents',
  'suggestedPeople',
  'search',
  // profiles + social graph
  'userProfile',
  'userPosts',
  'userPostsFeed',
  'userClubsList',
  'userGluemates',
  'ownGluemates',
  'followStates',
  // feeds + personal content
  'homePostsFeed',
  'homeEventsFeed',
  'postDetail',
  'postComments',
  // messaging
  'myChats',
  'chatDetails',
  'conversationHub',
  'thread',
  'directMessages',
  'chatSearch',
  // notifications (pre-block rows stop being visible)
  'notifications',
  'unreadSummary',
  // the list itself
  'blockedUsers',
  'didIBlock',
  'interactionBlocked',
];

function invalidateBlockSensitive(qc: ReturnType<typeof useQueryClient>) {
  for (const root of BLOCK_SENSITIVE_KEYS) {
    void qc.invalidateQueries({ queryKey: [root] });
  }
}

/** The caller's Blocked Accounts list. */
export function useBlockedUsers(userId?: string) {
  return useQuery<BlockedUser[]>({
    queryKey: blockedUsersKey(userId),
    queryFn: getMyBlockedUsers,
    enabled: !!userId,
    staleTime: 30 * 1000,
  });
}

/**
 * Whether the viewer has blocked this specific person — drives the
 * Block/Unblock label in a profile menu.
 *
 * Only asked for a profile the viewer can actually see. If the OTHER person did
 * the blocking, the profile does not load at all, so this never runs.
 */
export function useDidIBlock(viewerId?: string, targetId?: string) {
  return useQuery<boolean>({
    queryKey: didIBlockKey(viewerId, targetId),
    queryFn: () => didIBlock(targetId!),
    enabled: !!viewerId && !!targetId && viewerId !== targetId,
    staleTime: 30 * 1000,
  });
}

/**
 * SYMMETRIC availability check for a direct conversation.
 *
 * Drives the composer's disabled state. Returns true when either direction of
 * block exists and never reveals which, so the blocked person sees exactly what
 * the blocker sees. `false` on error (rather than a thrown state) would be the
 * wrong default for a safety control, so the caller treats `undefined` as
 * "still loading" and only unlocks the composer on an explicit `false`.
 */
export function useInteractionBlocked(viewerId?: string, targetId?: string) {
  return useQuery<boolean>({
    queryKey: interactionBlockedKey(viewerId, targetId),
    queryFn: () => isInteractionBlocked(targetId!),
    enabled: !!viewerId && !!targetId && viewerId !== targetId,
    staleTime: 15 * 1000,
  });
}

export function useBlockUser(userId?: string) {
  const qc = useQueryClient();
  return useMutation<BlockResult, Error, string>({
    mutationFn: (targetUserId: string) => blockUser(targetUserId),
    onSuccess: (result, targetUserId) => {
      if (result.status !== 'ok') return;
      // Immediate local truth for the one thing the user is looking at, then a
      // broad invalidation for everything else.
      qc.setQueryData(didIBlockKey(userId, targetUserId), true);
      invalidateBlockSensitive(qc);
    },
  });
}

/**
 * Cross-device restoration (Fix 8): unblocking on ONE device/session must
 * restore real identity on every OTHER session belonging to either party too
 * — not just the acting device's local cache. The unblock_user RPC broadcasts
 * to `sync:block:<userId>` for both the unblocker and the unblocked; every
 * signed-in session subscribes to its own topic here and runs the exact same
 * broad invalidation an in-session unblock already does, so a screen open on
 * another device converges without a logout, reinstall, or long cache wait.
 * Mirrors useAccessSynchronization's subscription shape.
 */
export function useBlockSynchronization(userId: string | undefined): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (!userId) return;
    return subscribeBroadcast(`sync:block:${userId}`, 'invalidate', () => invalidateBlockSensitive(qc));
  }, [userId, qc]);
}

export function useUnblockUser(userId?: string) {
  const qc = useQueryClient();
  return useMutation<{ wasBlocked: boolean }, Error, string>({
    mutationFn: (targetUserId: string) => unblockUser(targetUserId),
    onSuccess: (_result, targetUserId) => {
      qc.setQueryData(didIBlockKey(userId, targetUserId), false);
      // Optimistically drop the row so the list updates before the refetch
      // lands — this is the screen the user is looking at while they tap.
      qc.setQueryData<BlockedUser[]>(blockedUsersKey(userId), (prev) =>
        prev ? prev.filter((b) => b.user_id !== targetUserId) : prev,
      );
      invalidateBlockSensitive(qc);
    },
  });
}
