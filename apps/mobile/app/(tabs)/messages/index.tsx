import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  View,
  Text,
  FlatList,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuthStore } from '@weglue/shared';
import { openChat } from '../../../lib/chatNavigation';
import { navigateToDiscover } from '../../../lib/discoverNavigation';
import { useMyChats, useChatSearch, useSuggestedPeople } from '../../../hooks/useChats';
import { messageBadgeCounts, useUnreadSummaryValue } from '../../../hooks/useUnreadSummary';
import { MESSAGE_SUGGESTION_LIMIT } from '../../../services/chatService';
import { ChatListItem, SuggestedPersonRow } from '../../../components/chat/ChatListItem';
import { ChatSearchBar } from '../../../components/chat/ChatSearchBar';
import { FilterPills, type ChatFilter } from '../../../components/chat/FilterPills';
import { GroupEmptyState } from '../../../components/chat/GroupEmptyState';
import { Avatar } from '../../../components/shared/Avatar';
import { chatColors, chatFonts, chatSizes, chatTypography } from '../../../components/chat/chatTheme';

export default function MessagesIndex() {
  const router = useRouter();
  const { user } = useAuthStore();
  const userId = user?.id ?? '';

  // A successful invitation-driven join lands here via
  // `/(tabs)/messages?filter=group` (Fix 4 — "Back always returns to
  // Messages → Group"). Read it once as the initial tab, matching how the
  // screen behaves for a fresh mount; a `useEffect` below also applies it if
  // this screen was already mounted (tab navigators keep siblings alive), but
  // only the FIRST time a given param value arrives, so a manual tap back to
  // Single afterward is never fought.
  const { filter: filterParam } = useLocalSearchParams<{ filter?: string }>();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ChatFilter>(filterParam === 'group' ? 'group' : 'single');
  const [showArchived, setShowArchived] = useState(false);
  const searching = query.trim().length > 0;
  const consumedFilterParam = useRef(filterParam);
  useEffect(() => {
    if (filterParam && filterParam !== consumedFilterParam.current) {
      consumedFilterParam.current = filterParam;
      if (filterParam === 'group') setFilter('group');
    }
  }, [filterParam]);

  const queryClient = useQueryClient();
  // Re-derive the conversation list from current authorized participation each
  // time the tab regains focus: a club chat restored from the club profile
  // (Bug 8), a chat left/joined elsewhere, or membership changes all show
  // immediately without a stale cached list.
  useFocusEffect(
    useCallback(() => {
      queryClient.invalidateQueries({ queryKey: ['myChats'] });
    }, [queryClient]),
  );

  const { data: chats, isLoading: chatsLoading } = useMyChats(userId);
  const { data: searchResults, isLoading: searchLoading } = useChatSearch(
    userId,
    searching ? query : '',
  );

  const directChats = useMemo(
    () => (chats ?? []).filter((c) => c.type === 'direct'),
    [chats],
  );
  const groupChats = useMemo(
    () =>
      (chats ?? []).filter((c) =>
        ['club_group', 'officer_chat', 'group'].includes(c.type),
      ),
    [chats],
  );

  const filteredChats = filter === 'single' ? directChats : groupChats;
  const {
    data: suggestedPeople = [],
    isLoading: suggestedLoading,
    isError: suggestedFailed,
  } = useSuggestedPeople(userId, filter === 'single' && directChats.length === 0 && !searching);

  // Category badges come from the SAME canonical RPC as the Messages tab icon
  // (get_unread_summary), so the tab number always equals Single + Groups.
  const { data: unreadSummary } = useUnreadSummaryValue(userId);
  const { single: singleUnread, groups: groupUnread } = messageBadgeCounts(unreadSummary);

  const handlePressChat = useCallback(
    (
      chatId: string,
      preview?: {
        type: string;
        club_id: string | null;
        name: string | null;
        avatar_url: string | null;
        default_channel_id?: string | null;
      },
    ) => {
      openChat(
        chatId,
        preview
          ? {
              type: preview.type,
              clubId: preview.club_id,
              name: preview.name,
              avatarUrl: preview.avatar_url,
              defaultChannelId: preview.default_channel_id ?? null,
            }
          : undefined,
      );
    },
    [],
  );

  // Tapping a person in search opens a DRAFT DM — nothing is saved until the
  // first message is sent (no empty conversations, no duplicate threads).
  const handlePressUser = useCallback(
    (person: { user_id: string; full_name: string | null; username: string; avatar_url: string | null }) => {
      const name = person.full_name?.trim() || person.username;
      router.push(
        `/chat/new?draftUserId=${person.user_id}&draftName=${encodeURIComponent(name)}&draftAvatar=${encodeURIComponent(person.avatar_url ?? '')}` as any,
      );
    },
    [router],
  );

  function renderGlobalSearch() {
    if (searchLoading) {
      return (
        <View style={styles.center}>
          <ActivityIndicator color={chatColors.teal} />
        </View>
      );
    }

    const people = searchResults?.people ?? [];
    const chatsResult = searchResults?.chats ?? [];

    if (people.length === 0 && chatsResult.length === 0) {
      return (
        <View style={styles.center}>
          <Text style={styles.emptyBody}>No results for "{query}"</Text>
        </View>
      );
    }

    return (
      <FlatList
        data={[
          ...(people.length > 0 ? [{ _section: 'People' as const }] : []),
          ...people.map((p) => ({ ...p, _type: 'person' as const })),
          ...(chatsResult.length > 0 ? [{ _section: 'Chats' as const }] : []),
          ...chatsResult.map((c) => ({ ...c, _type: 'chat' as const })),
        ]}
        keyExtractor={(item: any) => item._section ?? item.user_id ?? item.id}
        renderItem={({ item }: { item: any }) => {
          if (item._section) {
            return <Text style={styles.sectionHeader}>{item._section}</Text>;
          }
          if (item._type === 'person') {
            return (
              <TouchableOpacity
                style={styles.searchRow}
                onPress={() => handlePressUser(item)}
                activeOpacity={0.7}
              >
                <Avatar
                  uri={item.avatar_url}
                  size={chatSizes.avatarSuggested}
                  username={item.full_name?.trim() || item.username}
                />
                <View style={styles.searchRowText}>
                  <Text style={styles.searchName}>{item.full_name?.trim() || item.username}</Text>
                  <Text style={styles.searchSub}>@{item.username}</Text>
                </View>
              </TouchableOpacity>
            );
          }
          if (item._type === 'chat') {
            return (
              <TouchableOpacity
                style={styles.searchRow}
                onPress={() => handlePressChat(item.id, item)}
                activeOpacity={0.7}
              >
                <Avatar uri={item.avatar_url} size={chatSizes.avatarSuggested} username={item.name ?? 'Chat'} />
                <View style={styles.searchRowText}>
                  <Text style={styles.searchName}>{item.name ?? 'Unnamed chat'}</Text>
                  <Text style={styles.searchSub}>
                    {item.type === 'officer_chat' ? 'Officer chat' : 'Group chat'}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          }
          return null;
        }}
      />
    );
  }

  function renderSingleEmpty() {
    // Ten suggestions no longer fit a short screen, so this region scrolls.
    return (
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.suggestedWrap}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.suggestedHeader}>Suggested</Text>
        {suggestedLoading ? (
          <ActivityIndicator style={styles.suggestedLoading} color={chatColors.teal} />
        ) : suggestedFailed ? (
          // A failed lookup must never read as "there is nobody to suggest".
          <Text style={styles.suggestedError}>
            Couldn’t load suggestions. Check your connection and try again.
          </Text>
        ) : suggestedPeople.length > 0 ? (
          suggestedPeople.slice(0, MESSAGE_SUGGESTION_LIMIT).map((person) => (
            <SuggestedPersonRow
              key={person.user_id}
              username={person.username}
              fullName={person.full_name}
              avatarUrl={person.avatar_url}
              onPress={() => handlePressUser(person)}
            />
          ))
        ) : (
          <Text style={styles.suggestedHint}>
            Search above to find people, or browse clubs to meet members.
          </Text>
        )}
      </ScrollView>
    );
  }

  function renderChatList() {
    if (chatsLoading) {
      return (
        <View style={styles.center}>
          <ActivityIndicator color={chatColors.teal} />
        </View>
      );
    }

    if (filter === 'group' && groupChats.length === 0) {
      return (
        <GroupEmptyState
          onBrowseClubs={() => navigateToDiscover()}
          onNewGroupChat={() => router.push('/chat/new-group' as any)}
        />
      );
    }

    if (filter === 'single' && directChats.length === 0) {
      return renderSingleEmpty();
    }

    const sorted = [...filteredChats].sort((a, b) => {
      const ta = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
      const tb = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
      return tb - ta;
    });
    // Archived conversations leave the normal list and live in their own
    // collapsible section; a new message never pulls them back (Bug 7).
    const activeChats = sorted.filter((c) => !c.archived);
    const archivedChats = sorted.filter((c) => c.archived);

    return (
      <FlatList
        data={activeChats}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <ChatListItem chat={item} currentUserId={userId} onPress={() => handlePressChat(item.id, item)} />
        )}
        ListHeaderComponent={
          archivedChats.length > 0 ? (
            <View>
              <TouchableOpacity
                style={styles.archivedHeader}
                onPress={() => setShowArchived((v) => !v)}
                activeOpacity={0.7}
              >
                <Ionicons name="archive-outline" size={18} color={chatColors.textMuted} />
                <Text style={styles.archivedHeaderText}>Archived ({archivedChats.length})</Text>
                <Ionicons
                  name={showArchived ? 'chevron-up' : 'chevron-down'}
                  size={18}
                  color={chatColors.textMuted}
                />
              </TouchableOpacity>
              {showArchived &&
                archivedChats.map((item) => (
                  <ChatListItem
                    key={item.id}
                    chat={item}
                    currentUserId={userId}
                    onPress={() => handlePressChat(item.id, item)}
                  />
                ))}
            </View>
          ) : null
        }
      />
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.topSection}>
        <ChatSearchBar
          value={query}
          onChangeText={setQuery}
          onClear={() => setQuery('')}
        />

        <View style={styles.toolbar}>
          <FilterPills
            value={filter}
            onChange={setFilter}
            singleUnread={singleUnread}
            groupUnread={groupUnread}
          />
          <TouchableOpacity
            style={styles.newChatBtn}
            onPress={() => router.push('/chat/new-message' as any)}
            accessibilityLabel="New chat"
          >
            <Ionicons name="add" size={26} color={chatColors.text} />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.content}>
        {searching ? renderGlobalSearch() : renderChatList()}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: chatColors.bg,
  },
  flex: { flex: 1 },
  topSection: {
    paddingTop: 8,
    gap: 12,
    paddingBottom: 8,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: 20,
  },
  newChatBtn: {
    padding: 4,
  },
  content: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  listContent: {
    paddingTop: 4,
    paddingBottom: 16,
  },
  archivedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 23,
    paddingVertical: 14,
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: chatColors.border,
  },
  archivedHeaderText: {
    flex: 1,
    fontFamily: chatFonts.semiBold,
    fontSize: 13,
    color: chatColors.textMuted,
  },
  suggestedWrap: {
    paddingTop: 16,
    paddingBottom: 24,
  },
  suggestedHeader: {
    ...chatTypography.sectionHeader,
    paddingHorizontal: 23,
    marginBottom: 8,
  },
  suggestedHint: {
    fontFamily: chatFonts.regular,
    fontSize: 13,
    color: chatColors.textMuted,
    paddingHorizontal: 23,
    lineHeight: 18,
  },
  suggestedLoading: {
    marginTop: 16,
  },
  suggestedError: {
    fontFamily: chatFonts.regular,
    fontSize: 13,
    color: '#DC2626',
    paddingHorizontal: 23,
    lineHeight: 18,
  },
  emptyBody: {
    fontFamily: chatFonts.regular,
    fontSize: 14,
    color: chatColors.textMuted,
    textAlign: 'center',
  },
  sectionHeader: {
    fontFamily: chatFonts.semiBold,
    fontSize: 12,
    color: chatColors.textMuted,
    letterSpacing: 0.8,
    paddingHorizontal: 23,
    paddingVertical: 10,
    textTransform: 'uppercase',
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 23,
    paddingVertical: 12,
    gap: 12,
  },
  searchRowText: {
    flex: 1,
  },
  searchName: {
    fontFamily: chatFonts.semiBold,
    fontSize: 12,
    color: chatColors.text,
  },
  searchSub: {
    fontFamily: chatFonts.regular,
    fontSize: 12,
    color: chatColors.textMuted,
    marginTop: 2,
  },
});
