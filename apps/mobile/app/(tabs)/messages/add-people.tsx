import { useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@weglue/shared';
import { useChatSearch, useSuggestedPeople } from '../../../hooks/useChats';
import { ChatSearchBar } from '../../../components/chat/ChatSearchBar';
import { SuggestedPersonRow } from '../../../components/chat/ChatListItem';
import { openDirectChatWith } from '../../../lib/chatNavigation';
import { chatColors, chatFonts, chatTypography } from '../../../components/chat/chatTheme';

export default function AddPeopleScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const userId = user?.id ?? '';
  const [query, setQuery] = useState('');

  const isTyping = query.trim().length > 0;

  const { data: suggested, isLoading: suggestLoading } = useSuggestedPeople(isTyping ? undefined : userId);
  const { data: searchResults, isLoading: searchLoading } = useChatSearch(userId, query);

  const people = isTyping ? (searchResults?.people ?? []) : (suggested ?? []);
  const isLoading = isTyping ? searchLoading : suggestLoading;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={chatColors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Add people</Text>
        <View style={{ width: 32 }} />
      </View>

      <View style={styles.searchWrap}>
        <ChatSearchBar value={query} onChangeText={setQuery} onClear={() => setQuery('')} />
      </View>

      <Text style={styles.sectionHeader}>Suggested</Text>

      {isLoading ? (
        <ActivityIndicator color={chatColors.teal} style={{ marginTop: 24 }} />
      ) : (
        <FlatList
          data={people}
          keyExtractor={(item) => item.user_id}
          renderItem={({ item }) => (
            <SuggestedPersonRow
              username={item.username}
              avatarUrl={item.avatar_url}
              onPress={async () => {
                await openDirectChatWith(item.user_id);
              }}
            />
          )}
          ListEmptyComponent={
            <Text style={styles.hint}>
              {isTyping ? 'No people found.' : 'No suggestions yet.'}
            </Text>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: chatColors.bg,
  },
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
    fontSize: 16,
    color: chatColors.text,
  },
  searchWrap: {
    paddingVertical: 8,
  },
  sectionHeader: {
    ...chatTypography.sectionHeader,
    paddingHorizontal: 23,
    marginTop: 8,
    marginBottom: 4,
  },
  hint: {
    fontFamily: chatFonts.regular,
    fontSize: 13,
    color: chatColors.textMuted,
    paddingHorizontal: 23,
    paddingTop: 16,
  },
});
