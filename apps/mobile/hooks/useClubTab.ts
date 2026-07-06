import { useQuery } from '@tanstack/react-query';
import { getMyClubs } from '../services/clubTabService';
import { timedQuery } from '../lib/timedQuery';

export function useMyClubs(userId: string | undefined) {
  return useQuery({
    queryKey: ['myClubs', userId],
    queryFn: () => timedQuery('myClubs', getMyClubs(userId!)),
    enabled: !!userId,
    staleTime: 60 * 1000,
  });
}
