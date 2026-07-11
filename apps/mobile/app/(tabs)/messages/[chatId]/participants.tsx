import { useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  FlatList,
  TextInput,
  Modal,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@weglue/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useChatDetails } from '../../../../hooks/useChats';
import { Avatar } from '../../../../components/shared/Avatar';
import { FollowStateButton } from '../../../../components/shared/FollowStateButton';
import { ConfirmationModal } from '../../../../components/chat/ConfirmationModal';
import { useFollowStates } from '../../../../hooks/useFollowStates';
import { useOfficerStore } from '../../../../store/officerStore';
import { openReportFlow } from '../../../../components/shared/ReportButton';
import {
  removeClubMemberByOfficer,
  demoteClubOfficer,
  addClubOfficerCanonical,
  removeGroupParticipant,
} from '../../../../services/messagingService';
import { supabase } from '../../../../lib/supabase';
import { displayNameOrFallback, isPlaceholderUsername } from '../../../../lib/displayName';
import type { ChatParticipant } from '../../../../services/chatService';
import { chatColors, chatFonts, chatShadow, chatSizes, chatTypography } from '../../../../components/chat/chatTheme';

// ─── Full participant roster ─────────────────────────────────────────────────
// The complete, searchable, virtualized list behind Chat Info's "See all N
// people" preview. Every participant appears here (the current user labeled
// "You", pinned to the top) with roles, profile navigation, a Message action,
// Follow/Following state and — for authorized officers / group admins — the
// same moderation actions as Chat Info. Purely chat-scoped: nothing here
// touches club membership except the explicit, server-authorized officer RPCs.

export default function ChatParticipants() {
  const { chatId } = useLocalSearchParams<{ chatId: string }>();
  const router = useRouter();
  const { user } = useAuthStore();
  const userId = user?.id ?? '';
  const queryClient = useQueryClient();

  const { data: chatDetails, isLoading } = useChatDetails(chatId);
  const clubId = chatDetails?.club_id ?? undefined;
  const type = chatDetails?.type;
  const isCustomGroup = type === 'group';
  const isMembersChat = type === 'club_group';
  const isOfficialChat = isMembersChat || type === 'officer_chat';
  const isOfficer = useOfficerStore((s) => (clubId ? s.officerClubIds.includes(clubId) : false));
  const isGroupAdmin = isCustomGroup && chatDetails?.created_by === userId;

  const [query, setQuery] = useState('');
  const [personMenu, setPersonMenu] = useState<null | { userId: string; name: string; role: string }>(null);
  const [confirm, setConfirm] = useState<
    | null
    | { kind: 'remove-member'; userId: string; name: string }
    | { kind: 'demote-officer'; userId: string; name: string }
    | { kind: 'promote-officer'; userId: string; name: string }
    | { kind: 'remove-from-group'; userId: string; name: string }
  >(null);

  const others = useMemo(
    () => (chatDetails?.participants ?? []).filter((p) => p.user_id !== userId),
    [chatDetails?.participants, userId],
  );
  const { data: followStates } = useFollowStates(
    userId,
    others.map((p) => p.user_id),
  );

  // Current user pinned to the top ("You"), then everyone else. The current
  // user is included in the full roster but does not consume a preview slot.
  const ordered = useMemo(() => {
    const parts = chatDetails?.participants ?? [];
    const self = parts.find((p) => p.user_id === userId);
    const rest = parts.filter((p) => p.user_id !== userId);
    return self ? [self, ...rest] : rest;
  }, [chatDetails?.participants, userId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ordered;
    return ordered.filter((p) => {
      const name = displayNameOrFallback(p).toLowerCase();
      const uname = (p.username ?? '').toLowerCase();
      return name.includes(q) || uname.includes(q);
    });
  }, [ordered, query]);

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: ['chatDetails', chatId] });
    queryClient.invalidateQueries({ queryKey: ['myChats'] });
  }

  async function doRemoveMember(target: { userId: string; name: string }) {
    setConfirm(null);
    try {
      await removeClubMemberByOfficer(clubId!, target.userId);
      invalidateAll();
    } catch (e: any) {
      Alert.alert(
        'Could not remove member',
        e?.message?.includes('demote_officer_first')
          ? 'This person is an officer. Remove their officer privileges first.'
          : 'Please try again.',
      );
    }
  }
  async function doDemoteOfficer(target: { userId: string }) {
    setConfirm(null);
    try {
      await demoteClubOfficer(clubId!, target.userId);
      invalidateAll();
    } catch {
      Alert.alert('Could not remove officer privileges. Please try again.');
    }
  }
  async function doPromoteOfficer(target: { userId: string }) {
    setConfirm(null);
    try {
      await addClubOfficerCanonical(clubId!, target.userId);
      invalidateAll();
    } catch {
      Alert.alert('Could not add officer. Please try again.');
    }
  }
  async function doRemoveFromGroup(target: { userId: string }) {
    setConfirm(null);
    try {
      await removeGroupParticipant(chatId, target.userId);
      invalidateAll();
    } catch {
      Alert.alert('Could not remove this person. Please try again.');
    }
  }
  async function makeGroupAdmin(targetUserId: string) {
    setPersonMenu(null);
    try {
      await supabase.from('conversations').update({ created_by: targetUserId }).eq('id', chatId).eq('type', 'group');
      invalidateAll();
      Alert.alert('Admin transferred', 'You can now leave the group if you want.');
    } catch {
      Alert.alert('Could not transfer admin.');
    }
  }

  const personMenuIsOfficer = personMenu ? personMenu.role !== 'Member' : false;

  function renderRow({ item }: { item: ChatParticipant }) {
    const isSelf = item.user_id === userId;
    const name = displayNameOrFallback(item);
    const isAdmin = isCustomGroup && chatDetails?.created_by === item.user_id;
    return (
      <View style={styles.row}>
        <TouchableOpacity onPress={() => router.push(`/profile/${item.user_id}` as any)} activeOpacity={0.7}>
          <Avatar uri={item.avatar_url} size={chatSizes.avatarSuggested} username={name} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.rowText}
          onPress={() => router.push(`/profile/${item.user_id}` as any)}
          activeOpacity={0.7}
        >
          {isOfficialChat && <Text style={chatTypography.roleLabel}>{item.role}</Text>}
          {isAdmin && <Text style={chatTypography.roleLabel}>Admin</Text>}
          <Text style={chatTypography.rowName}>
            {name}
            {isSelf ? '  ·  You' : ''}
          </Text>
          {!isPlaceholderUsername(item.username) && <Text style={styles.username}>@{item.username}</Text>}
        </TouchableOpacity>
        {!isSelf && (
          <>
            <TouchableOpacity
              onPress={() =>
                router.push(
                  `/(tabs)/messages/new?draftUserId=${item.user_id}&draftName=${encodeURIComponent(name)}&draftAvatar=${encodeURIComponent(item.avatar_url ?? '')}` as any,
                )
              }
              style={styles.iconBtn}
              accessibilityLabel={`Message ${name}`}
            >
              <Ionicons name="chatbubble-outline" size={18} color={chatColors.text} />
            </TouchableOpacity>
            <FollowStateButton
              viewerId={userId}
              targetUserId={item.user_id}
              state={followStates?.[item.user_id] ?? 'follow'}
            />
            {(isOfficer || isGroupAdmin) && (
              <TouchableOpacity
                onPress={() => setPersonMenu({ userId: item.user_id, name, role: item.role })}
                style={styles.iconBtn}
                hitSlop={6}
                accessibilityLabel={`More options for ${name}`}
              >
                <Ionicons name="ellipsis-vertical" size={16} color={chatColors.textMuted} />
              </TouchableOpacity>
            )}
          </>
        )}
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <Ionicons name="chevron-back" size={24} color={chatColors.text} />
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>
          {chatDetails ? `${chatDetails.participants.length} people` : 'People'}
        </Text>
        <View style={{ width: 32 }} />
      </View>

      <View style={styles.searchWrap}>
        <View style={styles.searchBar}>
          <Ionicons name="search" size={16} color={chatColors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search people"
            placeholderTextColor={chatColors.textMuted}
            value={query}
            onChangeText={setQuery}
            autoCorrect={false}
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery('')} hitSlop={8}>
              <Ionicons name="close-circle" size={16} color={chatColors.textMuted} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {isLoading || !chatDetails ? (
        <View style={styles.center}>
          <ActivityIndicator color={chatColors.teal} />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.user_id}
          renderItem={renderRow}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={20}
          windowSize={11}
          removeClippedSubviews
          ListEmptyComponent={<Text style={styles.empty}>No people found.</Text>}
        />
      )}

      {/* Moderation menu (officers / group admins) */}
      <Modal visible={!!personMenu} transparent animationType="fade" onRequestClose={() => setPersonMenu(null)}>
        <TouchableOpacity style={styles.menuOverlay} activeOpacity={1} onPress={() => setPersonMenu(null)}>
          <View style={styles.menuCard}>
            {personMenu && (
              <>
                <TouchableOpacity
                  style={styles.menuRow}
                  onPress={() => {
                    const t = personMenu;
                    setPersonMenu(null);
                    openReportFlow({ entityType: 'user', entityId: t.userId, entityName: t.name });
                  }}
                >
                  <Ionicons name="flag-outline" size={19} color={chatColors.text} />
                  <Text style={styles.menuLabel}>Report {personMenu.name}</Text>
                </TouchableOpacity>

                {isMembersChat && isOfficer && !personMenuIsOfficer && (
                  <TouchableOpacity
                    style={styles.menuRow}
                    onPress={() => {
                      setConfirm({ kind: 'promote-officer', userId: personMenu.userId, name: personMenu.name });
                      setPersonMenu(null);
                    }}
                  >
                    <Ionicons name="ribbon-outline" size={19} color={chatColors.text} />
                    <Text style={styles.menuLabel}>Add as officer</Text>
                  </TouchableOpacity>
                )}
                {isOfficialChat && isOfficer && personMenuIsOfficer && (
                  <TouchableOpacity
                    style={styles.menuRow}
                    onPress={() => {
                      setConfirm({ kind: 'demote-officer', userId: personMenu.userId, name: personMenu.name });
                      setPersonMenu(null);
                    }}
                  >
                    <Ionicons name="remove-circle-outline" size={19} color="#C62828" />
                    <Text style={[styles.menuLabel, { color: '#C62828' }]}>Remove officer privileges</Text>
                  </TouchableOpacity>
                )}
                {isMembersChat && isOfficer && !personMenuIsOfficer && (
                  <TouchableOpacity
                    style={styles.menuRow}
                    onPress={() => {
                      setConfirm({ kind: 'remove-member', userId: personMenu.userId, name: personMenu.name });
                      setPersonMenu(null);
                    }}
                  >
                    <Ionicons name="person-remove-outline" size={19} color="#C62828" />
                    <Text style={[styles.menuLabel, { color: '#C62828' }]}>Remove from club</Text>
                  </TouchableOpacity>
                )}
                {isGroupAdmin && (
                  <>
                    <TouchableOpacity style={styles.menuRow} onPress={() => makeGroupAdmin(personMenu.userId)}>
                      <Ionicons name="key-outline" size={19} color={chatColors.text} />
                      <Text style={styles.menuLabel}>Make admin</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.menuRow}
                      onPress={() => {
                        setConfirm({ kind: 'remove-from-group', userId: personMenu.userId, name: personMenu.name });
                        setPersonMenu(null);
                      }}
                    >
                      <Ionicons name="person-remove-outline" size={19} color="#C62828" />
                      <Text style={[styles.menuLabel, { color: '#C62828' }]}>Remove from group</Text>
                    </TouchableOpacity>
                  </>
                )}
              </>
            )}
          </View>
        </TouchableOpacity>
      </Modal>

      <ConfirmationModal
        visible={confirm?.kind === 'remove-member'}
        title="Remove from club?"
        message={`${confirm?.kind === 'remove-member' ? confirm.name : ''} will be removed from the club and its chats. Their account, posts and other clubs are not affected.`}
        confirmLabel="Remove from club"
        destructive
        onConfirm={() => confirm?.kind === 'remove-member' && doRemoveMember(confirm)}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmationModal
        visible={confirm?.kind === 'demote-officer'}
        title="Remove officer privileges?"
        message="This person will be removed from the Officers chat and can no longer manage the club. They remain a club member."
        confirmLabel="Remove as officer"
        destructive
        onConfirm={() => confirm?.kind === 'demote-officer' && doDemoteOfficer(confirm)}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmationModal
        visible={confirm?.kind === 'promote-officer'}
        title="Add as officer?"
        message={`${confirm?.kind === 'promote-officer' ? confirm.name : ''} will become an officer with full officer permissions.`}
        confirmLabel="Add as officer"
        onConfirm={() => confirm?.kind === 'promote-officer' && doPromoteOfficer(confirm)}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmationModal
        visible={confirm?.kind === 'remove-from-group'}
        title="Remove from group?"
        message={`${confirm?.kind === 'remove-from-group' ? confirm.name : ''} will be removed from this group chat. This has no effect on any club.`}
        confirmLabel="Remove"
        destructive
        onConfirm={() => confirm?.kind === 'remove-from-group' && doRemoveFromGroup(confirm)}
        onCancel={() => setConfirm(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: chatColors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 10,
  },
  rowText: { flex: 1 },
  username: {
    fontFamily: chatFonts.regular,
    fontSize: 11,
    color: chatColors.textMuted,
    marginTop: 1,
  },
  iconBtn: { padding: 6 },
  empty: {
    fontFamily: chatFonts.regular,
    fontSize: 13,
    color: chatColors.textMuted,
    textAlign: 'center',
    paddingTop: 24,
  },
  menuOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  menuCard: {
    backgroundColor: chatColors.bg,
    borderRadius: 16,
    paddingVertical: 6,
    minWidth: 260,
    ...chatShadow,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 13,
  },
  menuLabel: {
    fontFamily: chatFonts.medium,
    fontSize: 14,
    color: chatColors.text,
  },
});
