import { useQuery } from '@tanstack/react-query';
import { getClubMembers } from '../services/clubTabService';

export function useClubMembers(
  clubId: string | undefined,
  viewerId: string | undefined,
  search?: string,
  page = 0,
  gluematesOnly = false,
) {
  return useQuery({
    queryKey: ['clubMembers', clubId, viewerId, search, page, gluematesOnly],
    queryFn: () => getClubMembers(clubId!, viewerId!, search, page, gluematesOnly),
    enabled: !!clubId && !!viewerId,
    staleTime: 30 * 1000,
  });
}
