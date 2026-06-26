import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getClubProfile, joinClub, leaveClub } from '../services/clubService';

export function useClubProfile(clubId: string | undefined, userId: string | undefined) {
  return useQuery({
    queryKey: ['clubProfile', clubId, userId],
    queryFn: () => getClubProfile(clubId!, userId!),
    enabled: !!clubId && !!userId,
    staleTime: 2 * 60 * 1000,
  });
}

export function useJoinClub(userId: string | undefined, clubId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => joinClub(userId!, clubId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clubProfile', clubId, userId] });
      queryClient.invalidateQueries({ queryKey: ['homeEventsFeed', userId] });
    },
  });
}

export function useLeaveClub(userId: string | undefined, clubId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => leaveClub(userId!, clubId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clubProfile', clubId, userId] });
      queryClient.invalidateQueries({ queryKey: ['homeEventsFeed', userId] });
    },
  });
}
