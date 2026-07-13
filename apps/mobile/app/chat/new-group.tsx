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
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@weglue/shared';
import { useChatSearch, useSuggestedPeople } from '../../hooks/useChats';
import { Avatar } from '../../components/shared/Avatar';
import { chatColors, chatFonts, chatSizes, chatTypography } from '../../components/chat/chatTheme';

// ─── New group chat ──────────────────────────────────────────────────────────
// Full-screen keyboard-safe creation flow. The group stays a LOCAL DRAFT until
// the first message is sent — selecting people here creates nothing on the
// server. "Next" opens the draft thread which materializes on first send.

interface Selected {
  user_id: string;
  name: string;
  username: string;
  avatar_url: string | null;
}

export default function NewGroupScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const userId = user?.id ?? '';

  const [groupName, setGroupName] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Selected[]>([]);

  const isTyping = query.trim().length > 0;
  const { data: suggested, isLoading: suggestLoading } = useSuggestedPeople(isTyping ? undefined : userId);
  const { data: searchResults, isLoading: searchLoading } = useChatSearch(userId, query);

  const people = useMemo(
    () => (isTyping ? (searchResults?.people ?? []) : (suggested ?? [])),
    [isTyping, searchResults, suggested],
  );
  const isLoading = isTyping ? searchLoading : suggestLoading;
  const selectedIds = useMemo(() => new Set(selected.map((s) => s.user_id)), [selected]);

  function toggle(p: { user_id: string; full_name: string | null; username: string; avatar_url: string | null }) {
    setSelected((prev) =>
      prev.some((s) => s.user_id === p.user_id)
        ? prev.filter((s) => s.user_id !== p.user_id)
        : [...prev, { user_id: p.user_id, name: p.full_name?.trim() || p.username, username: p.username, avatar_url: p.avatar_url }],
    );
  }

  function next() {
    if (selected.length === 0) return;
    const ids = selected.map((s) => s.user_id).join(',');
    const names = selected.map((s) => s.name).join(', ');
    // MUST be /chat/new-group, not /chat/new. The conversation screen decides
    // draft type purely from this segment: "new" => draft DM, "new-group" =>
    // draft group. Sending a group to /chat/new made it isDraftDm, so
    // createWithFirstMessage (the atomic create_group_chat RPC) was never
    // wired up and ensureConversation found no draftUserId — it threw
    // "Conversation not ready", which is the "Didn't send." on the first
    // message, and it threw again on every retry. The group was never created
    // at all, which is also why the title never persisted.
    router.replace(
      (`/chat/new-group?` +
        `draftParticipantIds=${ids}` +
        `&draftNames=${encodeURIComponent(names)}` +
        `&draftGroupName=${encodeURIComponent(groupName.trim())}`) as any,
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <Ionicons name="chevron-back" size={24} color={chatColors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>New group chat</Text>
        <TouchableOpacity onPress={next} disabled={selected.length === 0} hitSlop={8}>
          <Text style={[styles.next, selected.length === 0 && styles.nextDisabled]}>Next</Text>
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TextInput
          style={styles.nameInput}
          placeholder="Group name (optional)"
          placeholderTextColor={chatColors.textMuted}
          value={groupName}
          onChangeText={setGroupName}
          maxLength={60}
        />

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
          </View>
        </View>

        {selected.length > 0 && (
          <FlatList
            data={selected}
            horizontal
            keyExtractor={(s) => s.user_id}
            style={styles.chipsRow}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
            renderItem={({ item }) => (
              <View style={styles.chip}>
                <View>
                  <Avatar uri={item.avatar_url} size={48} username={item.name} />
                  <TouchableOpacity style={styles.chipRemove} onPress={() => toggle({ ...item, full_name: item.name })}>
                    <Ionicons name="close" size={12} color="#fff" />
                  </TouchableOpacity>
                </View>
                <Text style={styles.chipName} numberOfLines={1}>
                  {item.name.split(' ')[0]}
                </Text>
              </View>
            )}
          />
        )}

        <Text style={styles.sectionHeader}>Suggested</Text>

        {isLoading ? (
          <ActivityIndicator color={chatColors.teal} style={{ marginTop: 24 }} />
        ) : (
          <FlatList
            data={people}
            keyExtractor={(item) => item.user_id}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => {
              const isSel = selectedIds.has(item.user_id);
              return (
                <TouchableOpacity style={styles.personRow} onPress={() => toggle(item)} activeOpacity={0.7}>
                  <Avatar
                    uri={item.avatar_url}
                    size={chatSizes.avatarSuggested}
                    username={item.full_name?.trim() || item.username}
                  />
                  <View style={styles.personText}>
                    <Text style={styles.personName}>{item.full_name?.trim() || item.username}</Text>
                    <Text style={styles.personSub}>@{item.username}</Text>
                  </View>
                  <View style={[styles.radio, isSel && styles.radioSel]}>
                    {isSel && <Ionicons name="checkmark" size={14} color="#fff" />}
                  </View>
                </TouchableOpacity>
              );
            }}
            ListEmptyComponent={
              <Text style={styles.hint}>{isTyping ? 'No people found.' : 'No suggestions yet.'}</Text>
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
  next: {
    fontFamily: chatFonts.semiBold,
    fontSize: 15,
    color: chatColors.teal,
    paddingHorizontal: 4,
  },
  nextDisabled: {
    color: chatColors.textMuted,
  },
  nameInput: {
    marginHorizontal: 16,
    marginTop: 8,
    backgroundColor: chatColors.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: chatColors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: chatFonts.regular,
    fontSize: 15,
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
  chipsRow: {
    maxHeight: 92,
    marginVertical: 4,
  },
  chip: {
    alignItems: 'center',
    width: 56,
  },
  chipRemove: {
    position: 'absolute',
    right: -2,
    top: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: chatColors.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipName: {
    fontFamily: chatFonts.regular,
    fontSize: 11,
    color: chatColors.text,
    marginTop: 4,
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
  radio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: chatColors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSel: {
    backgroundColor: chatColors.teal,
    borderColor: chatColors.teal,
  },
  hint: {
    fontFamily: chatFonts.regular,
    fontSize: 13,
    color: chatColors.textMuted,
    paddingHorizontal: 18,
    paddingTop: 16,
  },
});
