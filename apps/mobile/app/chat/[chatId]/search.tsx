import { useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@weglue/shared';
import { Avatar } from '../../../components/shared/Avatar';
import { searchConversation, type ConversationSearchHit } from '../../../services/messagingService';
import { displayNameOrFallback } from '../../../lib/displayName';
import { chatColors, chatFonts, chatSizes, chatTypography } from '../../../components/chat/chatTheme';

// ─── In-conversation search ─────────────────────────────────────────────────
// Full-screen, keyboard-safe. Searches the WHOLE accessible history server-side
// (text · file names · poll questions · shared event/post titles) — not just
// the messages currently loaded in the thread. Selecting a result jumps to the
// exact message; Back returns to the results + the query.

function typeIndicator(field: ConversationSearchHit['matchField']): { icon: keyof typeof Ionicons.glyphMap; label: string } {
  switch (field) {
    case 'file_name':
      return { icon: 'document-outline', label: 'File' };
    case 'poll_question':
      return { icon: 'checkbox-outline', label: 'Poll' };
    case 'shared_event':
      return { icon: 'calendar-outline', label: 'Event' };
    case 'shared_post':
      return { icon: 'image-outline', label: 'Post' };
    default:
      return { icon: 'chatbubble-outline', label: 'Message' };
  }
}

function Highlighted({ text, query }: { text: string; query: string }) {
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) {
    return (
      <Text style={styles.preview} numberOfLines={2}>
        {text}
      </Text>
    );
  }
  // Show a little context before the match on long strings.
  const start = Math.max(0, idx - 20);
  const prefix = start > 0 ? '…' : '';
  return (
    <Text style={styles.preview} numberOfLines={2}>
      {prefix}
      {text.slice(start, idx)}
      <Text style={styles.match}>{text.slice(idx, idx + query.length)}</Text>
      {text.slice(idx + query.length)}
    </Text>
  );
}

export default function SearchInChatScreen() {
  const { chatId, channelId } = useLocalSearchParams<{ chatId: string; channelId?: string }>();
  const router = useRouter();
  const { user } = useAuthStore();
  const userId = user?.id ?? '';

  const [query, setQuery] = useState('');
  const trimmed = query.trim();

  const { data: hits, isFetching } = useQuery({
    queryKey: ['conversationSearch', chatId, trimmed],
    queryFn: () => searchConversation(chatId, userId, trimmed),
    enabled: !!chatId && trimmed.length > 0,
    staleTime: 10 * 1000,
  });

  const results = useMemo(() => hits ?? [], [hits]);

  function openHit(hit: ConversationSearchHit) {
    const m = hit.message;
    if (m.channel_id) {
      router.push({
        pathname: `/chat/${chatId}/${m.channel_id}` as any,
        params: { jumpToMessageId: m.id },
      });
    } else {
      router.push({
        pathname: `/chat/${chatId}` as any,
        params: { jumpToMessageId: m.id },
      });
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <Ionicons name="chevron-back" size={24} color={chatColors.text} />
        </TouchableOpacity>
        <View style={styles.searchBar}>
          <Ionicons name="search" size={16} color={chatColors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search this chat"
            placeholderTextColor={chatColors.textMuted}
            value={query}
            onChangeText={setQuery}
            autoFocus
            autoCorrect={false}
          />
          {trimmed.length > 0 && (
            <TouchableOpacity onPress={() => setQuery('')} hitSlop={8}>
              <Ionicons name="close-circle" size={16} color={chatColors.textMuted} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {isFetching ? (
          <ActivityIndicator color={chatColors.teal} style={{ marginTop: 32 }} />
        ) : (
          <FlatList
            data={results}
            keyExtractor={(item) => item.message.id}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            contentContainerStyle={styles.list}
            renderItem={({ item }) => {
              const ind = typeIndicator(item.matchField);
              const senderName = displayNameOrFallback(item.message.sender);
              return (
                <TouchableOpacity style={styles.resultRow} onPress={() => openHit(item)} activeOpacity={0.7}>
                  <Avatar
                    uri={item.message.sender.avatar_url}
                    size={chatSizes.avatarSuggested}
                    username={senderName}
                  />
                  <View style={styles.resultText}>
                    <View style={styles.resultTop}>
                      <Text style={styles.senderName} numberOfLines={1}>
                        {senderName}
                      </Text>
                      <View style={styles.typeChip}>
                        <Ionicons name={ind.icon} size={11} color={chatColors.textMuted} />
                        <Text style={styles.typeLabel}>{ind.label}</Text>
                      </View>
                    </View>
                    <Highlighted text={item.matchText} query={trimmed} />
                    <Text style={styles.date}>
                      {new Date(item.message.created_at).toLocaleDateString('en-US', {
                        month: 'long',
                        day: 'numeric',
                      })}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            }}
            ListEmptyComponent={
              <Text style={styles.empty}>
                {trimmed ? `No matches for "${trimmed}"` : 'Search messages, files, polls, and shared items.'}
              </Text>
            }
          />
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: chatColors.bg },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  backBtn: { padding: 4 },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: chatColors.white,
    borderRadius: chatSizes.searchBarRadius,
    paddingHorizontal: 14,
    height: chatSizes.searchBarHeight,
    borderWidth: 1,
    borderColor: chatColors.border,
  },
  searchInput: {
    flex: 1,
    fontFamily: chatFonts.regular,
    fontSize: 14,
    color: chatColors.text,
  },
  list: { paddingVertical: 6 },
  resultRow: {
    flexDirection: 'row',
    paddingHorizontal: 18,
    paddingVertical: 12,
    gap: 12,
  },
  resultText: { flex: 1 },
  resultTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  senderName: {
    fontFamily: chatFonts.semiBold,
    fontSize: 13,
    color: chatColors.text,
    flex: 1,
  },
  typeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: chatColors.tagBg,
    borderRadius: 20,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  typeLabel: {
    fontFamily: chatFonts.regular,
    fontSize: 10,
    color: chatColors.textMuted,
  },
  preview: {
    fontFamily: chatFonts.regular,
    fontSize: 13,
    color: chatColors.textMuted,
    marginTop: 3,
  },
  match: {
    fontFamily: chatFonts.semiBold,
    color: chatColors.text,
    backgroundColor: 'rgba(15,166,166,0.18)',
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
    marginTop: 40,
    paddingHorizontal: 32,
  },
});
