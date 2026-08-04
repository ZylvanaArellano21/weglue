"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  blockUser,
  unblockUser,
  getMyBlockedUsers,
  didIBlock,
  isInteractionBlocked,
  type BlockedUser,
  type BlockResult,
} from "../blocking";

// ─── Student blocking: React Query bindings (student web) ───────────────────
//
// Mirrors apps/mobile/hooks/useBlocking.ts. A block changes what the server
// returns for a scattered set of queries, so rather than hand-patch each cache
// entry (which drifts the moment a screen is added), every affected root is
// INVALIDATED after a successful mutation.
//
// The server stays the authority: even a missed cache entry cannot become a
// bypass, because RLS returns zero rows for a blocked profile. The worst case
// is a briefly stale pixel that corrects itself on the next fetch.

export const blockedUsersKey = (userId?: string) => ["blockedUsers", userId] as const;
export const didIBlockKey = (viewerId?: string, targetId?: string) =>
  ["didIBlock", viewerId, targetId] as const;
export const interactionBlockedKey = (viewerId?: string, targetId?: string) =>
  ["interactionBlocked", viewerId, targetId] as const;

/** Query roots whose CONTENTS change when a block is created or removed. */
const BLOCK_SENSITIVE_KEYS: string[] = [
  // profiles + social graph
  "userProfile",
  "userPosts",
  "userWeeklyEvents",
  "ownGluemates",
  // people search (both pickers)
  "memberSearch",
  "eventAudienceMemberSearch",
  "discoverySearch",
  "universityUserSearch",
  // feeds + personal content
  "homePostsFeed",
  "homeEventsFeed",
  "postDetail",
  "postComments",
  "ownPosts",
  // notifications (pre-block rows stop being visible)
  "notifications",
  "unreadSummary",
  // the block surfaces themselves
  "blockedUsers",
  "didIBlock",
  "interactionBlocked",
];

function invalidateBlockSensitive(qc: ReturnType<typeof useQueryClient>) {
  for (const root of BLOCK_SENSITIVE_KEYS) {
    void qc.invalidateQueries({ queryKey: [root] });
  }
}

export function useBlockedUsers(userId?: string) {
  return useQuery<BlockedUser[]>({
    queryKey: blockedUsersKey(userId),
    queryFn: getMyBlockedUsers,
    enabled: !!userId,
    staleTime: 30 * 1000,
  });
}

/** DIRECTIONAL — picks the Block/Unblock label. */
export function useDidIBlock(viewerId?: string, targetId?: string) {
  return useQuery<boolean>({
    queryKey: didIBlockKey(viewerId, targetId),
    queryFn: () => didIBlock(targetId!),
    enabled: !!viewerId && !!targetId && viewerId !== targetId,
    staleTime: 30 * 1000,
  });
}

/** SYMMETRIC — never discloses which direction the block runs in. */
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
      if (result.status !== "ok") return;
      qc.setQueryData(didIBlockKey(userId, targetUserId), true);
      invalidateBlockSensitive(qc);
    },
  });
}

export function useUnblockUser(userId?: string) {
  const qc = useQueryClient();
  return useMutation<{ wasBlocked: boolean }, Error, string>({
    mutationFn: (targetUserId: string) => unblockUser(targetUserId),
    onSuccess: (_result, targetUserId) => {
      qc.setQueryData(didIBlockKey(userId, targetUserId), false);
      // Drop the row immediately — this is the list the user is looking at.
      qc.setQueryData<BlockedUser[]>(blockedUsersKey(userId), (prev) =>
        prev ? prev.filter((b) => b.user_id !== targetUserId) : prev
      );
      invalidateBlockSensitive(qc);
    },
  });
}
