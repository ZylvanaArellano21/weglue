import { useQuery } from '@tanstack/react-query';
import { getClubProfile } from '../services/clubService';

export function useClubProfile(clubId: string | undefined, userId: string | undefined) {
  return useQuery({
    queryKey: ['clubProfile', clubId, userId],
    queryFn: () => getClubProfile(clubId!, userId!),
    enabled: !!clubId && !!userId,
    staleTime: 2 * 60 * 1000,
  });
}

// Join/leave mutations moved to hooks/useClubMembership.ts (useJoinClubMutation /
// useLeaveClubMutation) so Home, Club Profile, and Event Details all share one
// optimistic-update implementation instead of three divergent ones.
