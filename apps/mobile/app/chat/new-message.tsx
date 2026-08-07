import { useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@weglue/shared';
import { useChatSearch, useSuggestedPeople } from '../../hooks/useChats';
import { Avatar } from '../../components/shared/Avatar';
import { displayNameOrFallback, isPlaceholderUsername } from '../../lib/displayName';
import { chatColors, chatFonts, chatSizes, chatTypography } from '../../components/chat/chatTheme';

// ─── New message ─────────────────────────────────────────────────────────────
// Structure follows the reference interaction hierarchy (search · group-chat
// row · suggested people) but keeps We Glue's design. Selecting a person opens
// a DRAFT DM — nothing is saved until the first message is sent.

export default function NewMessageScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const userId = user?.id ?? '';
  const [query, setQuery] = useState('');

  const isTyping = query.trim().length > 0;
  const { data: suggested, isLoading: suggestLoading, isError: suggestFailed } =
    useSuggestedPeople(isTyping ? undefined : userId);
  const { data: searchResults, isLoading: searchLoading } = useChatSearch(userId, query);

  const people = useMemo(
    () => (isTyping ? (searchResults?.people ?? []) : (suggested ?? [])),
    [isTyping, searchResults, suggested],
  );
  const isLoading = isTyping ? searchLoading : suggestLoading;

  function openDraftDm(p: { user_id: string; full_name: string | null; username: string; avatar_url: string | null }) {
    // Never carry a placeholder `user_<hex>` username into the DM header
    // (correction IMG_1568 showed "user_6d4c4487"). Falls back to "We Glue member".
    const name = displayNameOrFallback(p);
    router.replace(
      `/chat/new?draftUserId=${p.user_id}&draftName=${encodeURIComponent(name)}&draftAvatar=${encodeURIComponent(p.avatar_url ?? '')}` as any,
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <Ionicons name="chevron-back" size={24} color={chatColors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>New message</Text>
        <View style={{ width: 32 }} />
      </View>

      <View style={styles.searchWrap}>
        <View style={styles.searchBar}>
          <Ionicons name="search" size={16} color={chatColors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search"
            placeholderTextColor={chatColors.textMuted}
            value={query}
            onChangeText={setQuery}
            autoCorrect={false}
          />
          {isTyping && (
            <TouchableOpacity onPress={() => setQuery('')} hitSlop={8}>
              <Ionicons name="close-circle" size={16} color={chatColors.textMuted} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {!isTyping && (
        <TouchableOpacity
          style={styles.groupRow}
          onPress={() => router.push('/chat/new-group' as any)}
          activeOpacity={0.7}
        >
          <View style={styles.groupIcon}>
            <Ionicons name="people" size={20} color={chatColors.teal} />
          </View>
          <Text style={styles.groupLabel}>Group chat</Text>
          <Ionicons name="chevron-forward" size={18} color={chatColors.textMuted} />
        </TouchableOpacity>
      )}

      <Text style={styles.sectionHeader}>Suggested</Text>

      {isLoading ? (
        <ActivityIndicator color={chatColors.teal} style={{ marginTop: 24 }} />
      ) : (
        <FlatList
          data={people}
          keyExtractor={(item) => item.user_id}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.personRow} onPress={() => openDraftDm(item)} activeOpacity={0.7}>
              <Avatar
                uri={item.avatar_url}
                size={chatSizes.avatarSuggested}
                username={item.full_name?.trim() || item.username}
              />
              <View style={styles.personText}>
                <Text style={styles.personName}>{displayNameOrFallback(item)}</Text>
                {!isPlaceholderUsername(item.username) && (
                  <Text style={styles.personSub}>@{item.username}</Text>
                )}
              </View>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            !isTyping && suggestFailed ? (
              // A failed lookup must never read as "there is nobody to suggest".
              <Text style={styles.error}>
                Couldn’t load suggestions. Check your connection and try again.
              </Text>
            ) : (
              <Text style={styles.hint}>{isTyping ? 'No people found.' : 'No suggestions yet.'}</Text>
            )
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: chatColors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  backBtn: { padding: 4 },
  title: {
    flex: 1,
    textAlign: 'center',
    fontFamily: chatFonts.semiBold,
    fontSize: 17,
    color: chatColors.text,
  },
  searchWrap: { paddingHorizontal: 16, paddingVertical: 8 },
  searchBar: {
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
  groupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  groupIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(15,166,166,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupLabel: {
    flex: 1,
    fontFamily: chatFonts.semiBold,
    fontSize: 15,
    color: chatColors.text,
  },
  sectionHeader: {
    ...chatTypography.sectionHeader,
    paddingHorizontal: 18,
    marginTop: 8,
    marginBottom: 4,
  },
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  personText: { flex: 1 },
  personName: {
    fontFamily: chatFonts.semiBold,
    fontSize: 14,
    color: chatColors.text,
  },
  personSub: {
    fontFamily: chatFonts.regular,
    fontSize: 12,
    color: chatColors.textMuted,
    marginTop: 1,
  },
  hint: {
    fontFamily: chatFonts.regular,
    fontSize: 13,
    color: chatColors.textMuted,
    paddingHorizontal: 18,
    paddingTop: 16,
  },
  error: {
    fontFamily: chatFonts.regular,
    fontSize: 13,
    color: '#DC2626',
    paddingHorizontal: 18,
    paddingTop: 16,
    lineHeight: 18,
  },
});
