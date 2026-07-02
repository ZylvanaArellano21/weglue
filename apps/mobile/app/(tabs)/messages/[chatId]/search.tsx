import { useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@weglue/shared';
import { useChatDetails, useDirectMessages } from '../../../../hooks/useChats';
import { useChannelMessages } from '../../../../hooks/useClubChannels';
import { ChatSearchBar } from '../../../../components/chat/ChatSearchBar';
import { Avatar } from '../../../../components/shared/Avatar';
import { chatColors, chatFonts, chatSizes, chatTypography } from '../../../../components/chat/chatTheme';

interface SearchHit {
  id: string;
  senderId: string;
  senderName: string;
  senderAvatar: string | null;
  content: string;
  createdAt: string;
  highlight: string;
}

function highlightMatch(text: string, query: string): { before: string; match: string; after: string } {
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return { before: text, match: '', after: '' };
  return {
    before: text.slice(0, idx),
    match: text.slice(idx, idx + query.length),
    after: text.slice(idx + query.length),
  };
}

function formatResultDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
}

export default function SearchInChatScreen() {
  const { chatId, channelId } = useLocalSearchParams<{ chatId: string; channelId?: string }>();
  const router = useRouter();
  const { user } = useAuthStore();
  const userId = user?.id ?? '';

  const [query, setQuery] = useState('');

  const { data: chatDetails } = useChatDetails(chatId);
  const isDirect = chatDetails?.type === 'direct';

  const { data: dmPage, isLoading: dmLoading } = useDirectMessages(isDirect ? chatId : undefined);
  const { data: channelPage, isLoading: channelLoading } = useChannelMessages(
    !isDirect && channelId ? channelId : undefined,
  );

  const isLoading = dmLoading || channelLoading;

  const results = useMemo((): SearchHit[] => {
    const q = query.trim();
    if (!q) return [];

    const raw = isDirect
      ? (dmPage?.messages ?? [])
      : (channelPage?.messages ?? []);

    return raw
      .filter((m) => m.content?.toLowerCase().includes(q.toLowerCase()))
      .map((m) => ({
        id: m.id,
        senderId: m.sender_id,
        senderName: m.sender.username,
        senderAvatar: m.sender.avatar_url,
        content: m.content ?? '',
        createdAt: m.created_at,
        highlight: q,
      }));
  }, [query, isDirect, dmPage, channelPage]);

  const grouped = useMemo(() => {
    const map = new Map<string, SearchHit[]>();
    for (const hit of results) {
      const list = map.get(hit.senderId) ?? [];
      list.push(hit);
      map.set(hit.senderId, list);
    }
    return Array.from(map.entries());
  }, [results]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={chatColors.text} />
        </TouchableOpacity>
      </View>

      <View style={styles.searchWrap}>
        <ChatSearchBar value={query} onChangeText={setQuery} onClear={() => setQuery('')} />
      </View>

      {isLoading ? (
        <ActivityIndicator color={chatColors.teal} style={{ marginTop: 32 }} />
      ) : (
        <FlatList
          data={grouped}
          keyExtractor={([senderId]) => senderId}
          renderItem={({ item: [senderId, hits] }) => (
            <View style={styles.group}>
              <Text style={styles.groupHeader}>{hits[0]?.senderName}</Text>
              {hits.map((hit) => {
                const parts = highlightMatch(hit.content, query.trim());
                return (
                  <View key={hit.id} style={styles.resultRow}>
                    <Avatar
                      uri={hit.senderAvatar}
                      size={chatSizes.avatarSuggested}
                      username={hit.senderName}
                    />
                    <View style={styles.resultText}>
                      <Text style={styles.senderName}>{hit.senderName}</Text>
                      <Text style={styles.preview} numberOfLines={2}>
                        {parts.before}
                        <Text style={styles.match}>{parts.match}</Text>
                        {parts.after}
                      </Text>
                      <Text style={styles.date}>{formatResultDate(hit.createdAt)}</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
          ListEmptyComponent={
            query.trim() ? (
              <Text style={styles.empty}>No messages found.</Text>
            ) : (
              <Text style={styles.empty}>Type to search this chat.</Text>
            )
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: chatColors.bg },
  header: { paddingHorizontal: 12, paddingVertical: 8 },
  backBtn: { padding: 4, alignSelf: 'flex-start' },
  searchWrap: { paddingVertical: 8 },
  group: { marginBottom: 8 },
  groupHeader: {
    ...chatTypography.sectionHeader,
    paddingHorizontal: 23,
    paddingVertical: 6,
  },
  resultRow: {
    flexDirection: 'row',
    paddingHorizontal: 23,
    paddingVertical: 10,
    gap: 12,
  },
  resultText: { flex: 1 },
  senderName: {
    fontFamily: chatFonts.semiBold,
    fontSize: 12,
    color: chatColors.text,
  },
  preview: {
    fontFamily: chatFonts.regular,
    fontSize: 12,
    color: chatColors.textMuted,
    marginTop: 2,
  },
  match: {
    fontFamily: chatFonts.semiBold,
    color: chatColors.text,
  },
  date: {
    ...chatTypography.timestamp,
    marginTop: 4,
  },
  empty: {
    fontFamily: chatFonts.regular,
    fontSize: 14,
    color: chatColors.textMuted,
    textAlign: 'center',
    marginTop: 32,
  },
});
