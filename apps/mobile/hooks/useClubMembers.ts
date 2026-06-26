import { useQuery } from '@tanstack/react-query';
import { getClubMembers } from '../services/clubTabService';

export function useClubMembers(
  clubId: string | undefined,
  viewerId: string | undefined,
  search?: string,
  page = 0,
) {
  return useQuery({
    queryKey: ['clubMembers', clubId, viewerId, search, page],
    queryFn: () => getClubMembers(clubId!, viewerId!, search, page),
    enabled: !!clubId && !!viewerId,
    staleTime: 30 * 1000,
  });
}
