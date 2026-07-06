import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getDistinctCategories,
  getDiscoveryClubs,
  getDiscoveryEvents,
  getDiscoveryPeople,
  searchDiscovery,
  joinClubAndRefetch,
} from '../services/searchService';
import { timedQuery } from '../lib/timedQuery';

const PAGE_SIZE = 20;

export function useDistinctCategories() {
  return useQuery({
    queryKey: ['searchCategories'],
    queryFn: getDistinctCategories,
    staleTime: 5 * 60 * 1000,
  });
}

export function useDiscoveryClubs(userId: string, category: string | null) {
  return useInfiniteQuery({
    queryKey: ['discoveryClubs', userId, category],
    queryFn: ({ pageParam = 0 }) =>
      timedQuery(
        'discoveryClubs',
        getDiscoveryClubs(userId, category, pageParam as number, PAGE_SIZE),
      ),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === PAGE_SIZE ? allPages.length : undefined,
    enabled: !!userId,
    staleTime: 2 * 60 * 1000,
  });
}

export function useDiscoveryPeople(userId: string) {
  return useQuery({
    queryKey: ['discoveryPeople', userId],
    queryFn: () => timedQuery('discoveryPeople', getDiscoveryPeople(userId)),
    enabled: !!userId,
    staleTime: 2 * 60 * 1000,
  });
}

export function useDiscoverySearch(userId: string, query: string) {
  return useQuery({
    queryKey: ['discoverySearch', userId, query],
    queryFn: () => timedQuery('discoverySearch', searchDiscovery(userId, query)),
    enabled: !!userId && query.trim().length > 0,
    staleTime: 30 * 1000,
  });
}

export function useDiscoveryEvents(userId: string) {
  return useInfiniteQuery({
    queryKey: ['discoveryEvents', userId],
    queryFn: ({ pageParam = 0 }) =>
      getDiscoveryEvents(userId, pageParam as number, PAGE_SIZE),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === PAGE_SIZE ? allPages.length : undefined,
    enabled: !!userId,
    staleTime: 2 * 60 * 1000,
  });
}

export function useJoinFromSearch(userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (clubId: string) => joinClubAndRefetch(userId, clubId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['discoveryClubs', userId] });
      queryClient.invalidateQueries({ queryKey: ['discoverySearch', userId] });
      queryClient.invalidateQueries({ queryKey: ['homeEventsFeed', userId] });
    },
  });
}
