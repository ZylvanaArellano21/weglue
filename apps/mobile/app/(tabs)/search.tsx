import { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@weglue/shared';
import { Avatar } from '../../components/shared/Avatar';
import {
  useDistinctCategories,
  useDiscoveryClubs,
  useDiscoveryPeople,
  useDiscoverySearch,
  useJoinFromSearch,
} from '../../hooks/useSearch';
import { consumeSearchReset } from '../../lib/discoverNavigation';
import type { DiscoveryClub, DiscoveryPerson, SearchResult } from '../../services/searchService';

// ─── Constants ────────────────────────────────────────────────────────────────
const TEAL = '#0FA6A6';
const CREAM = '#FEFCF0';
const DARK = '#111827';
const MUTED = '#9CA3AF';
const BORDER = '#E5E7EB';
const WHITE = '#fff';

// ─── Search Bar ───────────────────────────────────────────────────────────────
function SearchBar({
  value,
  onChange,
  onClear,
}: {
  value: string;
  onChange: (v: string) => void;
  onClear: () => void;
}) {
  return (
    <View style={styles.searchWrap}>
      <Ionicons name="search-outline" size={18} color={MUTED} style={{ marginRight: 8 }} />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder="Search people and clubs..."
        placeholderTextColor={MUTED}
        style={styles.searchInput}
        returnKeyType="search"
        autoCorrect={false}
        autoCapitalize="none"
      />
      {value.length > 0 && (
        <TouchableOpacity onPress={onClear} activeOpacity={0.7} hitSlop={{ top: 8, left: 8, right: 8, bottom: 8 }}>
          <Ionicons name="close-circle" size={18} color={MUTED} />
        </TouchableOpacity>
      )}
    </View>
  );
}

// ─── Category Pills ───────────────────────────────────────────────────────────
function CategoryPills({
  categories,
  selected,
  onSelect,
}: {
  categories: string[];
  selected: string | null;
  onSelect: (cat: string | null) => void;
}) {
  const all = ['All', ...categories];
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.pillsRow}
    >
      {all.map((cat) => {
        const active = cat === 'All' ? selected === null : selected === cat;
        return (
          <TouchableOpacity
            key={cat}
            onPress={() => onSelect(cat === 'All' ? null : cat)}
            activeOpacity={0.75}
            style={[styles.pill, active && styles.pillActive]}
          >
            <Text style={[styles.pillText, active && styles.pillTextActive]}>{cat}</Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

// ─── Club Card (2-column grid) ────────────────────────────────────────────────
function ClubCard({
  club,
  onJoin,
  joining,
}: {
  club: DiscoveryClub;
  onJoin: (id: string) => void;
  joining: boolean;
}) {
  const router = useRouter();
  return (
    <TouchableOpacity
      style={styles.clubCard}
      onPress={() => router.push({ pathname: '/(tabs)/clubs/[clubId]', params: { clubId: club.id } })}
      activeOpacity={0.85}
    >
      <Avatar uri={club.avatar_url} size={48} username={club.name} />
      <Text style={styles.clubName} numberOfLines={2}>{club.name}</Text>
      <Text style={styles.clubMemberCount}>{club.member_count} members</Text>

      {club.is_member ? (
        <View style={styles.joinedBadge}>
          <Text style={styles.joinedBadgeText}>Joined</Text>
        </View>
      ) : (
        <TouchableOpacity
          onPress={() => onJoin(club.id)}
          disabled={joining}
          activeOpacity={0.85}
          style={styles.joinBtn}
        >
          {joining ? (
            <ActivityIndicator size="small" color={WHITE} />
          ) : (
            <Text style={styles.joinBtnText}>Join</Text>
          )}
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
}

// ─── Person Row (people discovery) ───────────────────────────────────────────
function PersonRow({ person }: { person: DiscoveryPerson }) {
  const router = useRouter();
  return (
    <TouchableOpacity
      style={styles.personRow}
      onPress={() => router.push({ pathname: '/profile/[userId]', params: { userId: person.user_id } })}
      activeOpacity={0.75}
    >
      <Avatar uri={person.avatar_url} size={48} username={person.username} />
      <View style={styles.personText}>
        <Text style={styles.personName} numberOfLines={1}>
          {person.full_name ?? person.username}
        </Text>
        {person.club_name && (
          <Text style={styles.personClub} numberOfLines={1}>
            {person.club_name}
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

// ─── Search Result Row ────────────────────────────────────────────────────────
function SearchResultRow({
  item,
  onJoin,
  joiningId,
}: {
  item: SearchResult;
  onJoin: (id: string) => void;
  joiningId: string | null;
}) {
  const router = useRouter();

  const handlePress = () => {
    if (item.result_type === 'person') {
      router.push({ pathname: '/profile/[userId]', params: { userId: item.id } });
    } else {
      router.push({ pathname: '/(tabs)/clubs/[clubId]', params: { clubId: item.id } });
    }
  };

  return (
    <TouchableOpacity style={styles.searchRow} onPress={handlePress} activeOpacity={0.75}>
      <Avatar uri={item.avatar_url} size={44} username={item.name} />
      <View style={styles.searchRowText}>
        <Text style={styles.searchRowName} numberOfLines={1}>{item.name}</Text>
        {item.sub && (
          <Text style={styles.searchRowSub} numberOfLines={1}>
            {item.result_type === 'person' ? `@${item.sub}` : `${item.sub} members`}
          </Text>
        )}
      </View>
      {item.result_type === 'club' && !item.is_member && (
        <TouchableOpacity
          onPress={() => onJoin(item.id)}
          disabled={joiningId === item.id}
          activeOpacity={0.85}
          style={styles.joinBtnSmall}
        >
          {joiningId === item.id ? (
            <ActivityIndicator size="small" color={WHITE} />
          ) : (
            <Text style={styles.joinBtnText}>Join</Text>
          )}
        </TouchableOpacity>
      )}
      {item.result_type === 'club' && item.is_member && (
        <View style={styles.joinedBadgeSmall}>
          <Text style={styles.joinedBadgeText}>Joined</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function SearchTab() {
  const { session } = useAuthStore();
  const userId = session?.user.id ?? '';

  const [query, setQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [joiningId, setJoiningId] = useState<string | null>(null);

  const searching = query.trim().length > 0;

  // CTA reset: only fires when navigateToDiscover() was called — not on normal tab switch
  useFocusEffect(
    useCallback(() => {
      if (consumeSearchReset()) {
        setQuery('');
        setSelectedCategory(null);
      }
    }, []),
  );

  const { data: categories = [] } = useDistinctCategories();
  const {
    data: clubPages,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading: clubsLoading,
  } = useDiscoveryClubs(userId, selectedCategory);
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

  // ── Search mode ──────────────────────────────────────────────────────────
  if (searching) {
    const people = searchResults.filter((r) => r.result_type === 'person');
    const clubs = searchResults.filter((r) => r.result_type === 'club');

    type ListItem =
      | { _section: string; _key: string }
      | (SearchResult & { _key: string });

    const listData: ListItem[] = [
      ...(people.length > 0 ? [{ _section: 'People', _key: 'sec-people' }] : []),
      ...people.map((p) => ({ ...p, _key: `p-${p.id}` })),
      ...(clubs.length > 0 ? [{ _section: 'Clubs', _key: 'sec-clubs' }] : []),
      ...clubs.map((c) => ({ ...c, _key: `c-${c.id}` })),
    ];

    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <SearchBar value={query} onChange={setQuery} onClear={() => setQuery('')} />
        </View>

        {searchLoading ? (
          <View style={styles.center}>
            <ActivityIndicator color={TEAL} />
          </View>
        ) : listData.length === 0 ? (
          <View style={styles.center}>
            <Ionicons name="search-outline" size={48} color={BORDER} style={{ marginBottom: 12 }} />
            <Text style={styles.emptyTitle}>No results</Text>
            <Text style={styles.emptyBody}>No people or clubs matched "{query}"</Text>
          </View>
        ) : (
          <FlatList
            data={listData}
            keyExtractor={(item) => item._key}
            renderItem={({ item }) => {
              if ('_section' in item) {
                return <Text style={styles.sectionHeader}>{(item as any)._section}</Text>;
              }
              return (
                <SearchResultRow
                  item={item as SearchResult}
                  onJoin={handleJoin}
                  joiningId={joiningId}
                />
              );
            }}
            contentContainerStyle={{ paddingBottom: 32 }}
            keyboardShouldPersistTaps="handled"
          />
        )}
      </SafeAreaView>
    );
  }

  // ── Browse mode ──────────────────────────────────────────────────────────
  const browseHeader = (
    <View>
      {/* Category pills */}
      {categories.length > 0 && (
        <View style={styles.sectionBlock}>
          <CategoryPills
            categories={categories}
            selected={selectedCategory}
            onSelect={setSelectedCategory}
          />
        </View>
      )}

      {/* People discovery */}
      {!peopleLoading && people.length > 0 && (
        <View style={styles.sectionBlock}>
          <Text style={styles.sectionTitle}>People to Connect With</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
          >
            {(people as DiscoveryPerson[]).map((person) => (
              <PersonRow key={person.user_id} person={person} />
            ))}
          </ScrollView>
        </View>
      )}

      {/* Grid heading */}
      <View style={[styles.sectionBlock, { paddingBottom: 4 }]}>
        <Text style={styles.sectionTitle}>
          {selectedCategory ? `${selectedCategory} Clubs` : 'Discover Clubs'}
        </Text>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <SearchBar value={query} onChange={setQuery} onClear={() => setQuery('')} />
      </View>

      {clubsLoading && allClubs.length === 0 ? (
        <>
          {browseHeader}
          <View style={styles.center}>
            <ActivityIndicator color={TEAL} />
          </View>
        </>
      ) : (
        <FlatList
          key="browse"
          data={allClubs}
          keyExtractor={(item) => item.id}
          numColumns={2}
          columnWrapperStyle={styles.gridRow}
          contentContainerStyle={styles.gridContent}
          ListHeaderComponent={browseHeader}
          renderItem={({ item }) => (
            <ClubCard
              club={item}
              onJoin={handleJoin}
              joining={joiningId === item.id}
            />
          )}
          ListEmptyComponent={
            !clubsLoading ? (
              <View style={styles.center}>
                <Ionicons name="people-outline" size={48} color={BORDER} style={{ marginBottom: 12 }} />
                <Text style={styles.emptyTitle}>
                  {selectedCategory ? `No clubs in "${selectedCategory}"` : 'No clubs yet'}
                </Text>
              </View>
            ) : null
          }
          ListFooterComponent={
            isFetchingNextPage ? (
              <View style={{ paddingVertical: 16, alignItems: 'center' }}>
                <ActivityIndicator color={TEAL} />
              </View>
            ) : null
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

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: CREAM },
  header: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: WHITE,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: DARK,
    fontFamily: 'Inter_400Regular',
    paddingVertical: 0,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingBottom: 48,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: DARK,
    fontFamily: 'Inter_700Bold',
    textAlign: 'center',
    marginBottom: 6,
  },
  emptyBody: {
    fontSize: 14,
    color: MUTED,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
  },
  sectionBlock: { paddingTop: 16 },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: DARK,
    fontFamily: 'Zain_800ExtraBold',
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  sectionHeader: {
    fontSize: 13,
    fontWeight: '700',
    color: MUTED,
    fontFamily: 'Inter_700Bold',
    paddingHorizontal: 16,
    paddingVertical: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  // Pills
  pillsRow: { paddingHorizontal: 16, gap: 8 },
  pill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: BORDER,
    backgroundColor: WHITE,
  },
  pillActive: { backgroundColor: TEAL, borderColor: TEAL },
  pillText: { fontSize: 13, color: DARK, fontFamily: 'Inter_500Medium' },
  pillTextActive: { color: WHITE },
  // Club grid
  gridContent: { paddingHorizontal: 16, paddingBottom: 40 },
  gridRow: { gap: 12, marginBottom: 12 },
  clubCard: {
    flex: 1,
    backgroundColor: WHITE,
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 6,
    elevation: 3,
  },
  clubName: {
    fontSize: 13,
    fontWeight: '700',
    color: DARK,
    fontFamily: 'Inter_700Bold',
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 2,
  },
  clubMemberCount: {
    fontSize: 11,
    color: MUTED,
    fontFamily: 'Inter_400Regular',
    marginBottom: 10,
  },
  joinBtn: {
    backgroundColor: TEAL,
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 7,
    minWidth: 60,
    alignItems: 'center',
  },
  joinBtnSmall: {
    backgroundColor: TEAL,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 6,
    minWidth: 52,
    alignItems: 'center',
  },
  joinBtnText: { fontSize: 13, fontWeight: '600', color: WHITE, fontFamily: 'Inter_600SemiBold' },
  joinedBadge: {
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 7,
    borderWidth: 1.5,
    borderColor: TEAL,
  },
  joinedBadgeSmall: {
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderWidth: 1.5,
    borderColor: TEAL,
  },
  joinedBadgeText: { fontSize: 13, fontWeight: '600', color: TEAL, fontFamily: 'Inter_600SemiBold' },
  // People discovery
  personRow: {
    width: 120,
    backgroundColor: WHITE,
    borderRadius: 14,
    padding: 12,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  personText: { alignItems: 'center', marginTop: 8 },
  personName: {
    fontSize: 12,
    fontWeight: '700',
    color: DARK,
    fontFamily: 'Inter_700Bold',
    textAlign: 'center',
  },
  personClub: {
    fontSize: 11,
    color: TEAL,
    fontFamily: 'Inter_500Medium',
    textAlign: 'center',
    marginTop: 2,
  },
  // Search results
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  searchRowText: { flex: 1 },
  searchRowName: {
    fontSize: 15,
    fontWeight: '600',
    color: DARK,
    fontFamily: 'Inter_600SemiBold',
  },
  searchRowSub: {
    fontSize: 13,
    color: MUTED,
    fontFamily: 'Inter_400Regular',
    marginTop: 2,
  },
});
