import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getNotifications,
  acceptFollowRequest,
  declineFollowRequest,
  markNotificationsRead,
} from '../services/notificationService';
import { followUser } from '../services/followService';
import { createSafeChannel, removeSafeChannel } from '../lib/realtime';
import { refreshOfficerStatus } from '../store/officerStore';

export function useNotifications(userId: string | undefined) {
  return useQuery({
    queryKey: ['notifications', userId],
    queryFn: () => getNotifications(userId!),
    enabled: !!userId,
    staleTime: 30 * 1000,
  });
}

// Live inserts: a new notification lands (follow request, accept, like…) →
// refresh the list immediately, and refresh profile relationship state so
// Requested → Following flips in under a second after an accept.
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
          queryClient.invalidateQueries({ queryKey: ['notifications', userId] });
          const type = (payload.new as { type?: string } | null)?.type;
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
            // Membership/officer change: group chats appear/disappear in
            // Messages, officer-gated UI unlocks or revokes, and the role
            // badge on profiles updates in under a second, app-wide —
            // including on the affected user's own device.
            queryClient.invalidateQueries({ queryKey: ['myChats'] });
            queryClient.invalidateQueries({ queryKey: ['chatDetails'] });
            queryClient.invalidateQueries({ queryKey: ['myClubs'] });
            queryClient.invalidateQueries({ queryKey: ['clubProfile'] });
            queryClient.invalidateQueries({ queryKey: ['officerClubs'] });
            queryClient.invalidateQueries({ queryKey: ['ownProfile'] });
            queryClient.invalidateQueries({ queryKey: ['userProfile'] });
            void refreshOfficerStatus(userId);
          }
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
  return useMutation({
    mutationFn: () => markNotificationsRead(userId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications', userId] });
    },
  });
}
