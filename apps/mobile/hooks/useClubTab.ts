import { useQuery } from '@tanstack/react-query';
import { getMyClubs } from '../services/clubTabService';

export function useMyClubs(userId: string | undefined) {
  return useQuery({
    queryKey: ['myClubs', userId],
    queryFn: () => getMyClubs(userId!),
    enabled: !!userId,
    staleTime: 60 * 1000,
  });
}
