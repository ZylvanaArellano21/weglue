import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getNotifications,
  acceptFollowRequest,
  markNotificationsRead,
} from '../services/notificationService';
import { followUser } from '../services/followService';

export function useNotifications(userId: string | undefined) {
  return useQuery({
    queryKey: ['notifications', userId],
    queryFn: () => getNotifications(userId!),
    enabled: !!userId,
    staleTime: 30 * 1000,
  });
}

export function useAcceptFollowRequest(userId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (requesterId: string) => acceptFollowRequest(requesterId, userId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications', userId] });
    },
  });
}

export function useFollowBack(viewerUserId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (targetUserId: string) => followUser(viewerUserId!, targetUserId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications', viewerUserId] });
    },
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
