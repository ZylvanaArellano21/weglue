import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getNotifications,
  acceptFollowRequest,
  declineFollowRequest,
  markNotificationsRead,
  type NotificationSection,
} from '../services/notificationService';
import { followUser } from '../services/followService';
import { createSafeChannel, removeSafeChannel } from '../lib/realtime';
import { refreshOfficerStatus } from '../store/officerStore';
import { publishNotificationInsert, type BannerNotificationRow } from '../lib/notifications/bannerBus';

export function useNotifications(userId: string | undefined) {
  return useQuery({
    queryKey: ['notifications', userId],
    queryFn: () => getNotifications(userId!),
    enabled: !!userId,
    staleTime: 30 * 1000,
  });
}

// The single always-on `notifications` subscription for the session. It is the
// sole owner of `notifications:<uid>` — `useUnreadSummary` used to open a second
// `notifications` INSERT channel (`unread-summary:<uid>`) for the same rows,
// which on the free-plan Realtime service doubled the per-row RLS-evaluation
// cost for every active user. That channel is gone; this one now also refreshes
// the unread badge, and carries the UPDATE binding for cross-device read sync.
//
// INSERT: a new notification (follow request, accept, like, club/officer
// change…) refreshes the list + badge, feeds the foreground banner, and
// refreshes any relationship/permission state a change implies.
// UPDATE: a read elsewhere (another device) marks rows read here too.
export function applyNotificationInsert(
  queryClient: ReturnType<typeof useQueryClient>,
  userId: string,
  row: BannerNotificationRow | null,
) {
  queryClient.invalidateQueries({ queryKey: ['notifications', userId] });
  queryClient.invalidateQueries({ queryKey: ['unreadSummary', userId] });
  const type = row?.type;
  // Correction 3: the ONE feed for the foreground banner — no second realtime
  // subscription. actor-safe by construction (domain triggers never insert a
  // row where user_id = actor_id), but a defensive check lives in the banner's
  // own decision function too.
  if (row) publishNotificationInsert(row);
  if (type === 'follow_accepted' || type === 'gluemate' || type === 'new_follower') {
    // Relationship changed — profiles the viewer has open must update.
    queryClient.invalidateQueries({ queryKey: ['userProfile'] });
    queryClient.invalidateQueries({ queryKey: ['ownProfile', userId] });
  }
  if (
    type === 'club_chat_added' ||
    type === 'officer_chat_added' ||
    type === 'officer_role' ||
    type === 'officer_removed' ||
    type === 'club_joined'
  ) {
    // Membership/officer change: group chats appear/disappear in Messages,
    // officer-gated UI unlocks or revokes, and the role badge on profiles
    // updates in under a second, app-wide — including on the affected user's
    // own device.
    queryClient.invalidateQueries({ queryKey: ['myChats'] });
    queryClient.invalidateQueries({ queryKey: ['chatDetails'] });
    queryClient.invalidateQueries({ queryKey: ['myClubs'] });
    queryClient.invalidateQueries({ queryKey: ['clubProfile'] });
    queryClient.invalidateQueries({ queryKey: ['officerClubs'] });
    queryClient.invalidateQueries({ queryKey: ['ownProfile'] });
    queryClient.invalidateQueries({ queryKey: ['userProfile'] });
    void refreshOfficerStatus(userId);
  }
}

export function useRealtimeNotifications(userId: string | undefined) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!userId) return;

    const channel = createSafeChannel(`notifications:${userId}`, [
      {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${userId}`,
        callback: (payload) => {
          applyNotificationInsert(queryClient, userId, payload.new as BannerNotificationRow | null);
        },
      },
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${userId}`,
        callback: () => {
          // A read on another device must flip this device's badge + list rows.
          queryClient.invalidateQueries({ queryKey: ['unreadSummary', userId] });
          queryClient.invalidateQueries({ queryKey: ['notifications', userId] });
        },
      },
    ]);

    return () => {
      removeSafeChannel(channel);
    };
  }, [userId, queryClient]);
}

function invalidateRelationshipQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  userId: string | undefined,
) {
  queryClient.invalidateQueries({ queryKey: ['notifications', userId] });
  queryClient.invalidateQueries({ queryKey: ['userProfile'] });
  queryClient.invalidateQueries({ queryKey: ['ownProfile', userId] });
  queryClient.invalidateQueries({ queryKey: ['ownGluemates', userId] });
}

export function useAcceptFollowRequest(userId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (requesterId: string) => acceptFollowRequest(requesterId, userId!),
    onSuccess: () => invalidateRelationshipQueries(queryClient, userId),
  });
}

export function useDeclineFollowRequest(userId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (requesterId: string) => declineFollowRequest(requesterId, userId!),
    onSuccess: () => invalidateRelationshipQueries(queryClient, userId),
  });
}

export function useFollowBack(viewerUserId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (targetUserId: string) => followUser(viewerUserId!, targetUserId),
    onSuccess: () => invalidateRelationshipQueries(queryClient, viewerUserId),
  });
}

export function useMarkNotificationsRead(userId: string | undefined) {
  const queryClient = useQueryClient();
  const key = ['notifications', userId];
  // Flips every row to read in the cached list the instant the tap happens
  // instead of waiting on the round trip + a follow-up refetch — that wait
  // was the "Mark all as read feels slow" complaint. onError restores the
  // exact previous cache so a real backend failure is never hidden.
  return useMutation<void, Error, void, { previous?: NotificationSection[] }>({
    mutationFn: () => markNotificationsRead(userId!),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<NotificationSection[]>(key);
      if (previous) {
        queryClient.setQueryData<NotificationSection[]>(key, (current) =>
          (current ?? []).map((section) => ({
            ...section,
            data: section.data.map((n) => (n.is_read ? n : { ...n, is_read: true })),
          })),
        );
      }
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous !== undefined) queryClient.setQueryData(key, context.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: key });
      // Entry badge + app icon badge react immediately.
      queryClient.invalidateQueries({ queryKey: ['unreadSummary', userId] });
    },
  });
}
