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
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@weglue/shared';
import { Avatar } from '../../components/shared/Avatar';
import { useAndroidKeyboardHeight } from '../../lib/useAndroidKeyboardHeight';
import {
  getEligibleUniversityPeople,
  addClubMemberByOfficer,
  addClubOfficerCanonical,
  addGroupParticipants,
} from '../../services/messagingService';
import { chatColors, chatFonts, chatSizes, chatTypography } from '../../components/chat/chatTheme';

// ─── Add people (members chat / officers chat / custom group) ───────────────
// Full-screen, keyboard-safe. Search at the top, multiple selection, an Add
// action at the top, eligible same-university users, and clear confirmation
// for the officer path (grants full officer permissions).

type Mode = 'members' | 'officers' | 'group';

export default function ManagePeopleScreen() {
  const { mode, clubId, conversationId } = useLocalSearchParams<{
    mode: Mode;
    clubId?: string;
    conversationId?: string;
  }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const userId = user?.id ?? '';

  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  // Android: lift the people list above the keyboard (iOS keeps KAV padding).
  const { height: androidKeyboardHeight } = useAndroidKeyboardHeight();

  const { data: people, isLoading } = useQuery({
    queryKey: ['eligiblePeople', userId, query.trim(), mode, clubId],
    // Members mode excludes existing club members (Bug 4).
    queryFn: () => getEligibleUniversityPeople(userId, query.trim(), mode === 'members' ? clubId : undefined),
    enabled: !!userId,
    staleTime: 10 * 1000,
  });

  const selectedPeople = useMemo(
    () => (people ?? []).filter((p) => selected.has(p.user_id)),
    [people, selected],
  );

  const title = mode === 'officers' ? 'Add officers' : mode === 'group' ? 'Add to group' : 'Add members';

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function performAdd(ids: string[]) {
    if (mode === 'members') {
      for (const id of ids) await addClubMemberByOfficer(clubId!, id);
    } else if (mode === 'officers') {
      for (const id of ids) await addClubOfficerCanonical(clubId!, id);
    } else {
      await addGroupParticipants(conversationId!, ids);
    }
  }

  async function handleAdd() {
    if (selected.size === 0 || submitting) return;
    const ids = Array.from(selected);

    if (mode === 'officers') {
      Alert.alert(
        'Add as officers?',
        'These people will become officers with full officer permissions: managing members, officers, events, the club profile and official chats.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Add as officers', onPress: () => runAdd(ids) },
        ],
      );
      return;
    }
    runAdd(ids);
  }

  async function runAdd(ids: string[]) {
    setSubmitting(true);
    try {
      await performAdd(ids);
      queryClient.invalidateQueries({ queryKey: ['chatDetails', conversationId] });
      queryClient.invalidateQueries({ queryKey: ['myChats'] });
      queryClient.invalidateQueries({ queryKey: ['clubMembers', clubId] });
      queryClient.invalidateQueries({ queryKey: ['conversationHub', conversationId] });
      queryClient.invalidateQueries({ queryKey: ['clubChannels', clubId] });
      queryClient.invalidateQueries({ queryKey: ['eligiblePeople', userId] });
      router.back();
    } catch (e: any) {
      Alert.alert(
        'Could not add everyone',
        e?.message?.includes('different_university')
          ? 'Some people are from a different university and can only be at their own clubs.'
          : 'Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <Ionicons name="chevron-back" size={24} color={chatColors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>{title}</Text>
        <TouchableOpacity onPress={handleAdd} disabled={selected.size === 0 || submitting} hitSlop={8}>
          {submitting ? (
            <ActivityIndicator size="small" color={chatColors.teal} />
          ) : (
            <Text style={[styles.add, selected.size === 0 && styles.addDisabled]}>
              Add{selected.size > 0 ? ` (${selected.size})` : ''}
            </Text>
          )}
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        style={[
          styles.flex,
          Platform.OS === 'android' ? { paddingBottom: androidKeyboardHeight } : null,
        ]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.searchWrap}>
          <View style={styles.searchBar}>
            <Ionicons name="search" size={16} color={chatColors.textMuted} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search your university"
              placeholderTextColor={chatColors.textMuted}
              value={query}
              onChangeText={setQuery}
              autoFocus
              autoCorrect={false}
            />
          </View>
        </View>

        {selectedPeople.length > 0 && (
          <FlatList
            data={selectedPeople}
            horizontal
            keyExtractor={(p) => p.user_id}
            style={styles.chipsRow}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
            renderItem={({ item }) => (
              <View style={styles.chip}>
                <View>
                  <Avatar uri={item.avatar_url} size={44} username={item.full_name?.trim() || item.username} />
                  <TouchableOpacity style={styles.chipRemove} onPress={() => toggle(item.user_id)}>
                    <Ionicons name="close" size={11} color="#fff" />
                  </TouchableOpacity>
                </View>
                <Text style={styles.chipName} numberOfLines={1}>
                  {(item.full_name?.trim() || item.username).split(' ')[0]}
                </Text>
              </View>
            )}
          />
        )}

        {isLoading ? (
          <ActivityIndicator color={chatColors.teal} style={{ marginTop: 24 }} />
        ) : (
          <FlatList
            data={people ?? []}
            keyExtractor={(item) => item.user_id}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            renderItem={({ item }) => {
              const isSel = selected.has(item.user_id);
              return (
                <TouchableOpacity style={styles.personRow} onPress={() => toggle(item.user_id)} activeOpacity={0.7}>
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
              <Text style={styles.hint}>
                {query.trim() ? 'No matching people at your university.' : 'Start typing to find people.'}
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
  add: {
    fontFamily: chatFonts.semiBold,
    fontSize: 15,
    color: chatColors.teal,
    paddingHorizontal: 4,
  },
  addDisabled: {
    color: chatColors.textMuted,
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
    maxHeight: 88,
    marginVertical: 4,
  },
  chip: {
    alignItems: 'center',
    width: 52,
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
    fontSize: 10,
    color: chatColors.text,
    marginTop: 4,
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
