import { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuthStore } from '@weglue/shared';
import { openChat, openDirectChatWith } from '../../../lib/chatNavigation';
import { useMyChats, useChatSearch } from '../../../hooks/useChats';
import { ChatListItem } from '../../../components/chat/ChatListItem';
import { ChatSearchBar } from '../../../components/chat/ChatSearchBar';
import { FilterPills, type ChatFilter } from '../../../components/chat/FilterPills';
import { GroupEmptyState } from '../../../components/chat/GroupEmptyState';
import { Avatar } from '../../../components/shared/Avatar';
import { chatColors, chatFonts, chatSizes, chatTypography } from '../../../components/chat/chatTheme';

export default function MessagesIndex() {
  const router = useRouter();
  const { user } = useAuthStore();
  const userId = user?.id ?? '';

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ChatFilter>('single');
  const searching = query.trim().length > 0;

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

  const handlePressChat = useCallback((chatId: string) => {
    openChat(chatId);
  }, []);

  const handlePressUser = useCallback(async (otherUserId: string) => {
    await openDirectChatWith(otherUserId);
  }, []);

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
                onPress={() => handlePressUser(item.user_id)}
                activeOpacity={0.7}
              >
                <Avatar uri={item.avatar_url} size={chatSizes.avatarSuggested} username={item.username} />
                <View style={styles.searchRowText}>
                  <Text style={styles.searchName}>{item.username}</Text>
                  {item.full_name && <Text style={styles.searchSub}>{item.full_name}</Text>}
                </View>
              </TouchableOpacity>
            );
          }
          if (item._type === 'chat') {
            return (
              <TouchableOpacity
                style={styles.searchRow}
                onPress={() => handlePressChat(item.id)}
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
    return (
      <View style={styles.suggestedWrap}>
        <Text style={styles.suggestedHeader}>Suggested</Text>
        <Text style={styles.suggestedHint}>
          Search above to find people, or browse clubs to meet members.
        </Text>
      </View>
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
          onBrowseClubs={() => router.push('/(tabs)/clubs' as any)}
          onNewGroupChat={() => router.push('/(tabs)/messages/add-people' as any)}
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

    return (
      <FlatList
        data={sorted}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <ChatListItem
            chat={item}
            currentUserId={userId}
            onPress={() => handlePressChat(item.id)}
          />
        )}
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
          <FilterPills value={filter} onChange={setFilter} />
          <TouchableOpacity
            style={styles.newChatBtn}
            onPress={() => router.push('/(tabs)/messages/add-people' as any)}
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
  suggestedWrap: {
    paddingTop: 16,
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
