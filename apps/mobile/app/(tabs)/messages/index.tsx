import { useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
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
import { Avatar } from '../../../components/shared/Avatar';

export default function MessagesIndex() {
  const router = useRouter();
  const { user } = useAuthStore();
  const userId = user?.id ?? '';

  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);

  const { data: chats, isLoading: chatsLoading } = useMyChats(userId);
  const { data: searchResults, isLoading: searchLoading } = useChatSearch(
    userId,
    searching ? query : '',
  );

  const handlePressChat = useCallback(
    (chatId: string) => { openChat(chatId); },
    [],
  );

  const handlePressUser = useCallback(
    async (otherUserId: string) => {
      await openDirectChatWith(otherUserId);
    },
    [],
  );

  // ── Chat list (default view) ─────────────────────────────────────────────

  function renderChatList() {
    if (chatsLoading) {
      return (
        <View style={styles.center}>
          <ActivityIndicator color="#0FA6A6" />
        </View>
      );
    }

    if (!chats || chats.length === 0) {
      return (
        <View style={styles.center}>
          <Ionicons name="chatbubbles-outline" size={48} color="#D1D5DB" />
          <Text style={styles.emptyTitle}>No conversations yet</Text>
          <Text style={styles.emptyBody}>
            Message someone from their profile or join a club to start chatting.
          </Text>
        </View>
      );
    }

    const sorted = [...chats].sort((a, b) => {
      const ta = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
      const tb = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
      return tb - ta;
    });

    return (
      <FlatList
        data={sorted}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <ChatListItem
            chat={item}
            currentUserId={userId}
            onPress={() => handlePressChat(item.id)}
          />
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />
    );
  }

  // ── Search results ───────────────────────────────────────────────────────

  function renderSearchResults() {
    if (searchLoading) {
      return (
        <View style={styles.center}>
          <ActivityIndicator color="#0FA6A6" />
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
          ...(people.length > 0 ? [{ _section: 'People' }] : []),
          ...people.map((p) => ({ ...p, _type: 'person' as const })),
          ...(chatsResult.length > 0 ? [{ _section: 'Chats' }] : []),
          ...chatsResult.map((c) => ({ ...c, _type: 'chat' as const })),
        ]}
        keyExtractor={(item: any) =>
          item._section ?? item.user_id ?? item.id
        }
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
                <Avatar uri={item.avatar_url} size={40} username={item.username} />
                <View style={styles.searchRowText}>
                  <Text style={styles.searchName}>{item.username}</Text>
                  {item.full_name && (
                    <Text style={styles.searchSub}>{item.full_name}</Text>
                  )}
                </View>
                <Ionicons name="chatbubble-outline" size={18} color="#9CA3AF" />
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
                <Avatar uri={item.avatar_url} size={40} username={item.name ?? 'Chat'} />
                <View style={styles.searchRowText}>
                  <Text style={styles.searchName}>{item.name ?? 'Unnamed chat'}</Text>
                  <Text style={styles.searchSub}>
                    {item.type === 'officer_chat' ? 'Officer chat' : 'Group chat'}
                  </Text>
                </View>
                <Ionicons name="people-outline" size={18} color="#9CA3AF" />
              </TouchableOpacity>
            );
          }
          return null;
        }}
      />
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Messages</Text>
        <TouchableOpacity
          onPress={() => router.push('/profile' as any)}
          activeOpacity={0.7}
        >
          <Ionicons name="create-outline" size={22} color="#0FA6A6" />
        </TouchableOpacity>
      </View>

      {/* Search bar */}
      <View style={styles.searchBar}>
        <Ionicons name="search" size={16} color="#9CA3AF" style={{ marginLeft: 4 }} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search people and chats…"
          placeholderTextColor="#9CA3AF"
          value={query}
          onChangeText={(t) => {
            setQuery(t);
            setSearching(t.trim().length > 0);
          }}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
        {searching && (
          <TouchableOpacity
            onPress={() => { setQuery(''); setSearching(false); }}
          >
            <Ionicons name="close-circle" size={18} color="#9CA3AF" />
          </TouchableOpacity>
        )}
      </View>

      {/* Content */}
      <View style={styles.content}>
        {searching ? renderSearchResults() : renderChatList()}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FEFCF0',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 12,
  },
  headerTitle: {
    fontFamily: 'Zain_700Bold',
    fontSize: 26,
    color: '#1A1A1A',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    borderRadius: 14,
    marginHorizontal: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
    marginBottom: 8,
  },
  searchInput: {
    flex: 1,
    fontFamily: 'Zain_400Regular',
    fontSize: 15,
    color: '#1A1A1A',
  },
  content: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 12,
  },
  emptyTitle: {
    fontFamily: 'Zain_700Bold',
    fontSize: 17,
    color: '#374151',
    textAlign: 'center',
  },
  emptyBody: {
    fontFamily: 'Zain_400Regular',
    fontSize: 14,
    color: '#9CA3AF',
    textAlign: 'center',
    lineHeight: 20,
  },
  separator: {
    height: 1,
    backgroundColor: '#F3F4F6',
    marginLeft: 76,
  },
  sectionHeader: {
    fontFamily: 'Zain_700Bold',
    fontSize: 12,
    color: '#6B7280',
    letterSpacing: 0.8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#F9FAFB',
    textTransform: 'uppercase',
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  searchRowText: {
    flex: 1,
  },
  searchName: {
    fontFamily: 'Zain_700Bold',
    fontSize: 15,
    color: '#1A1A1A',
  },
  searchSub: {
    fontFamily: 'Zain_400Regular',
    fontSize: 13,
    color: '#6B7280',
  },
});
