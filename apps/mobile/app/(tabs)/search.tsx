import { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { useAuthStore } from '@weglue/shared';
import { SearchBar } from '../../components/search/SearchBar';
import { CategoryPillRow } from '../../components/search/CategoryPillRow';
import { ClubDiscoveryCard } from '../../components/search/ClubDiscoveryCard';
import { PersonDiscoveryCard } from '../../components/search/PersonDiscoveryCard';
import {
  SearchResultRow,
  SearchSectionHeader,
} from '../../components/search/SearchResultRow';
import { SearchEmptyState } from '../../components/search/SearchEmptyState';
import { SearchBrowseSkeleton, PeopleDiscoverySkeleton } from '../../components/search/SearchBrowseSkeleton';
import { searchColors, searchSizes, searchTypography } from '../../components/search/searchTheme';
import { chatColors } from '../../components/chat/chatTheme';
import {
  useDistinctCategories,
  useDiscoveryClubs,
  useDiscoveryPeople,
  useDiscoverySearch,
  useJoinFromSearch,
} from '../../hooks/useSearch';
import { consumeSearchReset } from '../../lib/discoverNavigation';
import { useTabBarBottomPadding } from '../../lib/tabBar';
import type { DiscoveryPerson, SearchResult } from '../../services/searchService';

// Same breakpoint the Home tab uses to tell phone from tablet. Native phone
// Discovery reads the club_interests source of truth; iPad-native keeps the
// legacy club_categories path (Option B).
const TABLET_BREAKPOINT = 768;

export default function SearchTab() {
  const { session } = useAuthStore();
  const userId = session?.user.id ?? '';
  const bottomPad = useTabBarBottomPadding();
  const isPhone = useWindowDimensions().width < TABLET_BREAKPOINT;

  const [query, setQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [joiningId, setJoiningId] = useState<string | null>(null);

  const searching = query.trim().length > 0;

  useFocusEffect(
    useCallback(() => {
      if (consumeSearchReset()) {
        setQuery('');
        setSelectedCategory(null);
      }
    }, []),
  );

  const { data: categories = [] } = useDistinctCategories(isPhone);
  const categoryLabels = useMemo(() => categories.map((c) => c.label), [categories]);
  const selectedCategoryValue = useMemo(() => {
    if (!selectedCategory) return null;
    return categories.find((c) => c.label === selectedCategory)?.value ?? null;
  }, [categories, selectedCategory]);
  const {
    data: clubPages,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading: clubsLoading,
  } = useDiscoveryClubs(userId, selectedCategoryValue, isPhone);
  const { data: people = [], isLoading: peopleLoading } = useDiscoveryPeople(userId);
  const { data: searchResults = [], isLoading: searchLoading } = useDiscoverySearch(userId, query);
  const { mutate: joinMutate } = useJoinFromSearch(userId);

  const allClubs = useMemo(() => clubPages?.pages.flatMap((p) => p) ?? [], [clubPages]);

  const handleJoin = useCallback(
    (clubId: string) => {
      setJoiningId(clubId);
      joinMutate(clubId, {
        onSettled: () => setJoiningId(null),
      });
    },
    [joinMutate],
  );

  const searchBar = (
    <SearchBar value={query} onChange={setQuery} onClear={() => setQuery('')} />
  );

  // ── Active search mode ───────────────────────────────────────────────────
  if (searching) {
    const peopleResults = searchResults.filter((r) => r.result_type === 'person');
    const clubResults = searchResults.filter((r) => r.result_type === 'club');

    type ListItem =
      | { _section: string; _key: string }
      | (SearchResult & { _key: string });

    const listData: ListItem[] = [
      ...(peopleResults.length > 0 ? [{ _section: 'People', _key: 'sec-people' }] : []),
      ...peopleResults.map((p) => ({ ...p, _key: `p-${p.id}` })),
      ...(clubResults.length > 0 ? [{ _section: 'Clubs', _key: 'sec-clubs' }] : []),
      ...clubResults.map((c) => ({ ...c, _key: `c-${c.id}` })),
    ];

    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>{searchBar}</View>

        {searchLoading ? (
          <View style={styles.center}>
            <ActivityIndicator color={chatColors.teal} />
          </View>
        ) : listData.length === 0 ? (
          <SearchEmptyState variant="no-search-results" query={query.trim()} />
        ) : (
          <FlatList
            data={listData}
            keyExtractor={(item) => item._key}
            renderItem={({ item }) => {
              if ('_section' in item) {
                return <SearchSectionHeader title={(item as { _section: string })._section} />;
              }
              return (
                <SearchResultRow
                  item={item as SearchResult}
                  onJoin={handleJoin}
                  joiningId={joiningId}
                />
              );
            }}
            contentContainerStyle={[styles.searchListContent, { paddingBottom: bottomPad }]}
            keyboardShouldPersistTaps="handled"
          />
        )}
      </SafeAreaView>
    );
  }

  // ── Default browse mode ────────────────────────────────────────────────────
  const browseHeader = (
    <View style={styles.pillsSection}>
      <CategoryPillRow
        categories={categoryLabels}
        selected={selectedCategory}
        onSelect={setSelectedCategory}
      />
    </View>
  );

  const peopleFooter = peopleLoading ? (
    <PeopleDiscoverySkeleton />
  ) : people.length > 0 ? (
    <View style={styles.peopleSection}>
      <Text style={styles.peopleTitle}>People discovery</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.peopleRow}
      >
        {(people as DiscoveryPerson[]).map((person) => (
          <PersonDiscoveryCard key={person.user_id} person={person} />
        ))}
      </ScrollView>
    </View>
  ) : null;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>{searchBar}</View>

      {clubsLoading && allClubs.length === 0 ? (
        <SearchBrowseSkeleton showPeople={!peopleLoading} />
      ) : (
        <FlatList
          key="browse"
          data={allClubs}
          keyExtractor={(item) => item.id}
          numColumns={2}
          columnWrapperStyle={styles.gridRow}
          contentContainerStyle={[styles.gridContent, { paddingBottom: bottomPad }]}
          ListHeaderComponent={browseHeader}
          renderItem={({ item }) => (
            <ClubDiscoveryCard
              club={item}
              onJoin={handleJoin}
              joining={joiningId === item.id}
            />
          )}
          ListEmptyComponent={
            !clubsLoading ? (
              <SearchEmptyState
                variant={selectedCategory ? 'no-clubs-in-category' : 'no-clubs'}
                category={selectedCategory}
              />
            ) : null
          }
          ListFooterComponent={
            <>
              {peopleFooter}
              {isFetchingNextPage ? (
                <View style={styles.footerLoader}>
                  <ActivityIndicator color={searchColors.teal} />
                </View>
              ) : null}
            </>
          }
          onEndReached={() => {
            if (hasNextPage && !isFetchingNextPage) fetchNextPage();
          }}
          onEndReachedThreshold={0.5}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: searchColors.bg,
  },
  header: {
    paddingHorizontal: searchSizes.screenPaddingH,
    paddingTop: 8,
    paddingBottom: 4,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  searchListContent: {
    paddingBottom: 32,
  },
  pillsSection: {
    paddingTop: 12,
    paddingBottom: 4,
  },
  gridContent: {
    paddingHorizontal: searchSizes.screenPaddingH,
    paddingBottom: 40,
  },
  gridRow: {
    gap: searchSizes.gridGap,
    marginBottom: searchSizes.gridGap,
  },
  peopleSection: {
    paddingTop: 20,
    paddingBottom: 8,
  },
  peopleTitle: {
    ...searchTypography.sectionTitle,
    paddingHorizontal: searchSizes.screenPaddingH,
    marginBottom: 12,
  },
  peopleRow: {
    paddingHorizontal: searchSizes.screenPaddingH,
    // Vertical room for searchCardShadow's spread (offset height 6 + radius
    // 10, ~16px). A horizontal ScrollView clips its content to its own
    // bounds, so with zero vertical padding here the shadow was hard-cut at
    // the card's edge — the section read as a flat "cut-off strip" instead
    // of individually raised, fully rounded cards.
    paddingVertical: 16,
    gap: 14,
  },
  footerLoader: {
    paddingVertical: 16,
    alignItems: 'center',
  },
});
