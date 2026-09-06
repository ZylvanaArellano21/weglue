import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getDistinctCategories,
  getDiscoveryClubs,
  getDiscoveryEvents,
  getDiscoveryPeople,
  getPhoneDiscoveryCategories,
  getPhoneDiscoveryClubs,
  searchDiscovery,
  joinClubAndRefetch,
  type DiscoveryCategory,
} from '../services/searchService';
import { timedQuery } from '../lib/timedQuery';

const PAGE_SIZE = 20;

// `isPhone` = native iPhone / Android phone. On phone, Discovery reads the
// club_interests source of truth via get_phone_discovery_* and the category
// `value` is an interest slug. On iPad-native + web the legacy club_categories
// path is used unchanged and `value` equals the category label (Option B).
export function useDistinctCategories(isPhone: boolean) {
  return useQuery<DiscoveryCategory[]>({
    queryKey: ['searchCategories', isPhone ? 'phone' : 'legacy'],
    queryFn: async () =>
      isPhone
        ? getPhoneDiscoveryCategories()
        : (await getDistinctCategories()).map((c) => ({ value: c, label: c })),
    staleTime: 5 * 60 * 1000,
  });
}

export function useDiscoveryClubs(userId: string, category: string | null, isPhone: boolean) {
  return useInfiniteQuery({
    queryKey: ['discoveryClubs', userId, isPhone ? 'phone' : 'legacy', category],
    queryFn: ({ pageParam = 0 }) =>
      timedQuery(
        'discoveryClubs',
        isPhone
          ? getPhoneDiscoveryClubs(userId, category, pageParam as number, PAGE_SIZE)
          : getDiscoveryClubs(userId, category, pageParam as number, PAGE_SIZE),
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
