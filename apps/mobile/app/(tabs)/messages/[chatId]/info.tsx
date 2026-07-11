import { useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Alert,
  Modal,
  TextInput,
  Image,
  Dimensions,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@weglue/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { useChatDetails } from '../../../../hooks/useChats';
import { Avatar } from '../../../../components/shared/Avatar';
import { ConfirmationModal } from '../../../../components/chat/ConfirmationModal';
import { MediaViewer, type ViewerMediaItem } from '../../../../components/chat/MediaViewer';
import { ShareInviteSheet } from '../../../../components/chat/ShareInviteSheet';
import { FollowStateButton } from '../../../../components/shared/FollowStateButton';
import { useFollowStates } from '../../../../hooks/useFollowStates';
import { useOfficerStore } from '../../../../store/officerStore';
import {
  getConversationMedia,
  getConversationFiles,
  getConversationSharedEvents,
  getConversationPollIds,
  hideConversationForMe,
  hideOfficialChatForMe,
  leaveChatOnly,
  leaveGroupChat,
  deleteGroupForEveryone,
  clearOfficialChat,
  removeGroupParticipant,
  removeClubMemberByOfficer,
  demoteClubOfficer,
  addClubOfficerCanonical,
  updateGroupMeta,
} from '../../../../services/messagingService';
import { openReportFlow } from '../../../../components/shared/ReportButton';
import { getClubPoll, type ClubPoll } from '../../../../services/clubPollService';
import { resolveAttachmentUrl, formatFileSize, fileTypeLabel } from '../../../../lib/chatAttachments';
import { displayNameOrFallback, isPlaceholderUsername } from '../../../../lib/displayName';
import { uploadImageToBucket } from '../../../../lib/imageUpload';
import { supabase } from '../../../../lib/supabase';
import { Linking } from 'react-native';
import {
  chatColors,
  chatFonts,
  chatShadow,
  chatSizes,
  chatTypography,
} from '../../../../components/chat/chatTheme';

// ─── Chat Information ────────────────────────────────────────────────────────
// One screen, four conversation types; every difference is role/type
// configuration. Leaving or deleting a chat here ONLY changes chat state —
// club membership, officer roles, RSVPs and club content are never touched.

type ContentTab = 'polls' | 'media' | 'calendar' | 'files';

const GRID_GAP = 2;
const SCREEN_W = Dimensions.get('window').width;

export default function ChatInfo() {
  const { chatId, channelId } = useLocalSearchParams<{ chatId: string; channelId?: string }>();
  const router = useRouter();
  const { user } = useAuthStore();
  const userId = user?.id ?? '';
  const queryClient = useQueryClient();

  const { data: chatDetails, isLoading } = useChatDetails(chatId);
  const clubId = chatDetails?.club_id ?? undefined;
  const type = chatDetails?.type;
  const isDirect = type === 'direct';
  const isCustomGroup = type === 'group';
  const isMembersChat = type === 'club_group';
  const isOfficersChat = type === 'officer_chat';
  const isOfficialChat = isMembersChat || isOfficersChat;
  const isOfficer = useOfficerStore((s) => (clubId ? s.officerClubIds.includes(clubId) : false));
  const isGroupAdmin = isCustomGroup && chatDetails?.created_by === userId;

  const [activeTab, setActiveTab] = useState<ContentTab>('media');
  const [confirm, setConfirm] = useState<
    | null
    | { kind: 'leave-official' }
    | { kind: 'delete-dm' }
    | { kind: 'leave-group' }
    | { kind: 'delete-everyone' }
    | { kind: 'remove-member'; userId: string; name: string }
    | { kind: 'demote-officer'; userId: string; name: string }
    | { kind: 'promote-officer'; userId: string; name: string }
    | { kind: 'remove-from-group'; userId: string; name: string }
  >(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [personMenu, setPersonMenu] = useState<null | { userId: string; name: string }>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  // ── People + follow states ──
  const others = useMemo(
    () => (chatDetails?.participants ?? []).filter((p) => p.user_id !== userId),
    [chatDetails?.participants, userId],
  );
  const { data: followStates } = useFollowStates(
    userId,
    others.map((p) => p.user_id),
  );

  // ── History tabs (derived from canonical messages; realtime-invalidated) ──
  const { data: media } = useQuery({
    queryKey: ['convMedia', chatId, userId],
    queryFn: () => getConversationMedia(chatId, userId),
    enabled: !!chatId && !!userId,
    staleTime: 15 * 1000,
  });
  const { data: files } = useQuery({
    queryKey: ['convFiles', chatId, userId],
    queryFn: () => getConversationFiles(chatId, userId),
    enabled: !!chatId && !!userId && activeTab === 'files',
    staleTime: 15 * 1000,
  });
  const { data: sharedEvents } = useQuery({
    queryKey: ['convEvents', chatId, userId],
    queryFn: () => getConversationSharedEvents(chatId, userId),
    enabled: !!chatId && !!userId && activeTab === 'calendar',
    staleTime: 15 * 1000,
  });
  const { data: pollRefs } = useQuery({
    queryKey: ['convPolls', chatId],
    queryFn: () => getConversationPollIds(chatId),
    enabled: !!chatId && activeTab === 'polls' && !isDirect,
    staleTime: 15 * 1000,
  });
  const { data: polls } = useQuery({
    queryKey: ['convPollDetails', chatId, (pollRefs ?? []).map((p) => p.poll_id).join(',')],
    queryFn: async () => {
      const out: ClubPoll[] = [];
      for (const ref of pollRefs ?? []) {
        const p = await getClubPoll(ref.poll_id, userId);
        if (p) out.push(p);
      }
      return out;
    },
    enabled: !!pollRefs && pollRefs.length > 0,
    staleTime: 15 * 1000,
  });

  const viewerItems: ViewerMediaItem[] = useMemo(
    () =>
      (media ?? []).map((m) => ({
        messageId: m.id,
        source: m.attachment_url!,
        kind: m.message_type === 'video' ? ('video' as const) : ('image' as const),
        senderName: displayNameOrFallback(m.sender),
        sentAt: m.created_at,
      })),
    [media],
  );

  if (isLoading || !chatDetails) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.center}>
          <ActivityIndicator color={chatColors.teal} />
        </View>
      </SafeAreaView>
    );
  }

  const displayName = chatDetails.name ?? 'Conversation';
  const otherUser = isDirect ? others[0] : undefined;

  const tabs: ContentTab[] = isDirect ? ['media', 'calendar', 'files'] : ['polls', 'media', 'calendar', 'files'];

  // ── Role-based control row ──
  const showAdd = (isMembersChat && isOfficer) || isOfficersChat && isOfficer || (isCustomGroup && isGroupAdmin);
  const showShare = (isMembersChat && isOfficer) || (isCustomGroup && isGroupAdmin);
  const showOverflow = (isOfficialChat && isOfficer) || isGroupAdmin;

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: ['chatDetails', chatId] });
    queryClient.invalidateQueries({ queryKey: ['myChats'] });
    queryClient.invalidateQueries({ queryKey: ['thread', chatId] });
  }

  function popToMessages() {
    router.dismissTo?.('/(tabs)/messages' as any) ?? router.replace('/(tabs)/messages' as any);
  }

  // ── Identity taps ──
  function onIdentityPress() {
    if (isOfficialChat && clubId) {
      router.push(`/(tabs)/clubs/${clubId}` as any);
    } else if (isDirect && otherUser) {
      router.push(`/profile/${otherUser.user_id}` as any);
    } else if (isGroupAdmin) {
      setRenameValue(chatDetails?.stored_name ?? '');
      setRenameOpen(true);
    }
  }

  async function onGroupPicturePress() {
    if (!isGroupAdmin) {
      onIdentityPress();
      return;
    }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.85, allowsEditing: true, aspect: [1, 1] });
    if (result.canceled || !result.assets[0]) return;
    try {
      const url = await uploadImageToBucket('avatars', `${userId}/group-${chatId}.jpg`, result.assets[0].uri, 512);
      await updateGroupMeta(chatId, { avatar_url: url });
      invalidateAll();
    } catch {
      Alert.alert('Could not update the group picture.');
    }
  }

  async function saveRename() {
    try {
      await updateGroupMeta(chatId, { name: renameValue.trim() || null });
      setRenameOpen(false);
      invalidateAll();
    } catch {
      Alert.alert('Could not update the group name.');
    }
  }

  // ── Leave / delete flows (chat-state only, never club data) ──
  async function doLeaveOfficial() {
    setConfirm(null);
    try {
      await leaveChatOnly(chatId, userId);
      invalidateAll();
      popToMessages();
    } catch {
      Alert.alert('Could not leave the chat. Please try again.');
    }
  }

  async function doDeleteDm() {
    setConfirm(null);
    try {
      await hideConversationForMe(chatId, userId);
      invalidateAll();
      popToMessages();
    } catch {
      Alert.alert('Could not delete the conversation. Please try again.');
    }
  }

  async function doLeaveGroup() {
    setConfirm(null);
    try {
      const result = await leaveGroupChat(chatId);
      if (result === 'transfer_required') {
        Alert.alert(
          'Transfer ownership first',
          'You are the group admin. Choose a new admin from the People list (⋯ → Make admin), or delete the group for everyone.',
        );
        return;
      }
      invalidateAll();
      popToMessages();
    } catch {
      Alert.alert('Could not leave the group. Please try again.');
    }
  }

  async function doDeleteForEveryone() {
    setConfirm(null);
    try {
      if (isCustomGroup) await deleteGroupForEveryone(chatId);
      else await clearOfficialChat(chatId);
      invalidateAll();
      popToMessages();
    } catch {
      Alert.alert('Could not delete the chat. Please try again.');
    }
  }

  async function doHideForMe() {
    setOverflowOpen(false);
    try {
      await hideOfficialChatForMe(chatId, userId);
      invalidateAll();
      popToMessages();
    } catch {
      Alert.alert('Could not remove the chat from your messages.');
    }
  }

  // ── People moderation ──
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

  async function doDemoteOfficer(target: { userId: string; name: string }) {
    setConfirm(null);
    try {
      await demoteClubOfficer(clubId!, target.userId);
      invalidateAll();
    } catch {
      Alert.alert('Could not remove officer privileges. Please try again.');
    }
  }

  async function doPromoteOfficer(target: { userId: string; name: string }) {
    setConfirm(null);
    try {
      await addClubOfficerCanonical(clubId!, target.userId);
      invalidateAll();
    } catch {
      Alert.alert('Could not add officer. Please try again.');
    }
  }

  async function doRemoveFromGroup(target: { userId: string; name: string }) {
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

  function reportUserFromChat(target: { userId: string; name: string }) {
    setPersonMenu(null);
    openReportFlow({ entityType: 'user', entityId: target.userId, entityName: target.name });
  }

  // ── Add people entry points ──
  function openAddPeople() {
    if (isCustomGroup) {
      router.push(`/(tabs)/messages/manage-people?mode=group&conversationId=${chatId}` as any);
    } else if (isOfficersChat) {
      router.push(`/(tabs)/messages/manage-people?mode=officers&clubId=${clubId}&conversationId=${chatId}` as any);
    } else {
      router.push(`/(tabs)/messages/manage-people?mode=members&clubId=${clubId}&conversationId=${chatId}` as any);
    }
  }

  // ── Renderers ──
  function renderMediaGrid() {
    const items = media ?? [];
    if (items.length === 0) {
      return (
        <View style={styles.emptyTab}>
          <Text style={styles.emptyText}>No photos or videos yet</Text>
        </View>
      );
    }
    const cols = isDirect ? 3 : 4;
    const cell = (SCREEN_W - GRID_GAP * (cols - 1)) / cols;
    return (
      <View style={styles.gridWrap}>
        {items.map((m, idx) => (
          <MediaThumb
            key={m.id}
            path={m.attachment_url!}
            isVideo={m.message_type === 'video'}
            size={cell}
            onPress={() => setViewerIndex(idx)}
          />
        ))}
      </View>
    );
  }

  function renderFiles() {
    const items = files ?? [];
    if (items.length === 0) {
      return (
        <View style={styles.emptyTab}>
          <Text style={styles.emptyText}>No files yet</Text>
        </View>
      );
    }
    return items.map((f) => (
      <TouchableOpacity
        key={f.id}
        style={styles.fileRow}
        activeOpacity={0.75}
        onPress={async () => {
          const url = await resolveAttachmentUrl(f.attachment_url);
          if (url) void Linking.openURL(url);
        }}
      >
        <View style={styles.fileIconWrap}>
          <Ionicons name="document-text-outline" size={20} color={chatColors.teal} />
        </View>
        <View style={styles.fileMeta}>
          <Text style={styles.fileName} numberOfLines={1}>
            {f.attachment_name ?? 'File'}
          </Text>
          <Text style={styles.fileSub} numberOfLines={1}>
            {fileTypeLabel(f.attachment_name, f.attachment_mime)}
            {f.attachment_size ? ` · ${formatFileSize(f.attachment_size)}` : ''}
            {' · '}
            {displayNameOrFallback(f.sender)}
            {' · '}
            {new Date(f.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={chatColors.textMuted} />
      </TouchableOpacity>
    ));
  }

  function renderCalendar() {
    const items = sharedEvents ?? [];
    if (items.length === 0) {
      return (
        <View style={styles.emptyTab}>
          <Text style={styles.emptyText}>No events shared in this chat yet</Text>
        </View>
      );
    }
    return items.map((ev) => (
      <TouchableOpacity
        key={ev.event_id}
        style={styles.eventRow}
        activeOpacity={0.75}
        onPress={() => router.push({ pathname: '/home/event-detail', params: { eventId: ev.event_id } } as any)}
      >
        {ev.cover_image_url ? (
          <Image source={{ uri: ev.cover_image_url }} style={styles.eventThumb} />
        ) : (
          <View style={[styles.eventThumb, styles.eventThumbPlaceholder]}>
            <Ionicons name="calendar-outline" size={18} color={chatColors.textMuted} />
          </View>
        )}
        <View style={styles.fileMeta}>
          <Text style={styles.fileName} numberOfLines={1}>
            {ev.emoji ? `${ev.emoji} ` : ''}
            {ev.title}
          </Text>
          <Text style={styles.fileSub} numberOfLines={1}>
            {ev.club_name ? `${ev.club_name} · ` : ''}
            {new Date(ev.event_date + 'T00:00:00').toLocaleDateString('en-US', {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
            })}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={chatColors.textMuted} />
      </TouchableOpacity>
    ));
  }

  function renderPolls() {
    const items = polls ?? [];
    if (!pollRefs || items.length === 0) {
      return (
        <View style={styles.emptyTab}>
          <Text style={styles.emptyText}>No polls yet</Text>
        </View>
      );
    }
    const now = new Date();
    return items.map((poll) => {
      const ended = poll.end_at ? now > new Date(poll.end_at) : false;
      const winner =
        poll.options.length > 0
          ? poll.options.reduce((a, b) => (a.vote_count >= b.vote_count ? a : b))
          : null;
      return (
        <View key={poll.id} style={styles.pollCard}>
          <View style={styles.pollHeader}>
            <Text style={styles.pollQuestion}>{poll.question}</Text>
            <View style={[styles.pollStatus, ended ? styles.pollStatusEnded : styles.pollStatusActive]}>
              <Text style={[styles.pollStatusText, ended ? { color: chatColors.textMuted } : { color: chatColors.teal }]}>
                {ended ? 'Closed' : 'Active'}
              </Text>
            </View>
          </View>
          <Text style={styles.pollMeta}>
            {new Date(poll.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            {' · '}
            {poll.total_votes} {poll.total_votes === 1 ? 'vote' : 'votes'}
          </Text>
          {poll.options.map((opt) => {
            const pct = poll.total_votes > 0 ? Math.round((opt.vote_count / poll.total_votes) * 100) : 0;
            const isWinner = winner && opt.id === winner.id && opt.vote_count > 0;
            return (
              <View key={opt.id} style={styles.pollOptionRow}>
                <View style={[styles.pollBar, { width: `${Math.max(pct, 2)}%` }, isWinner && styles.pollBarWinner]} />
                <View style={styles.pollOptionContent}>
                  <Text style={[styles.pollOptionText, isWinner && { fontFamily: chatFonts.semiBold }]} numberOfLines={1}>
                    {opt.option_text}
                  </Text>
                  <Text style={styles.pollPct}>
                    {pct}% ({opt.vote_count})
                  </Text>
                </View>
                {opt.voter_usernames.length > 0 && (
                  <Text style={styles.pollVoters} numberOfLines={1}>
                    {opt.voter_usernames.filter(Boolean).join(', ')}
                  </Text>
                )}
              </View>
            );
          })}
        </View>
      );
    });
  }

  const personMenuTarget = personMenu
    ? others.find((p) => p.user_id === personMenu.userId)
    : undefined;
  const personMenuIsOfficer = personMenuTarget
    ? personMenuTarget.role !== 'Member'
    : false;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={chatColors.text} />
        </TouchableOpacity>
        {showOverflow && (
          <TouchableOpacity onPress={() => setOverflowOpen(true)} style={styles.overflowBtn} hitSlop={8}>
            <Ionicons name="ellipsis-horizontal" size={22} color={chatColors.text} />
          </TouchableOpacity>
        )}
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Centered identity block; long names wrap without touching edges. */}
        <View style={styles.profileSection}>
          <TouchableOpacity onPress={onGroupPicturePress} activeOpacity={0.8}>
            <Avatar uri={chatDetails.avatar_url} size={80} username={displayName} />
            {isGroupAdmin && (
              <View style={styles.editBadge}>
                <Ionicons name="camera" size={12} color="#fff" />
              </View>
            )}
          </TouchableOpacity>
          <TouchableOpacity onPress={onIdentityPress} activeOpacity={0.7}>
            <Text style={styles.profileName}>{displayName}</Text>
          </TouchableOpacity>
          {isDirect && otherUser?.username && !isPlaceholderUsername(otherUser.username) ? (
            <TouchableOpacity onPress={onIdentityPress} activeOpacity={0.7}>
              <Text style={styles.profileUsername}>@{otherUser.username}</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <View style={styles.actionRow}>
          {showAdd && (
            <TouchableOpacity style={styles.actionItem} onPress={openAddPeople}>
              <Ionicons name="person-add-outline" size={22} color={chatColors.text} />
              <Text style={chatTypography.infoAction}>Add</Text>
            </TouchableOpacity>
          )}
          {showShare && (
            <TouchableOpacity style={styles.actionItem} onPress={() => setShareOpen(true)}>
              <Ionicons name="share-outline" size={22} color={chatColors.text} />
              <Text style={chatTypography.infoAction}>Share</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.actionItem}
            onPress={() =>
              router.push(
                (channelId
                  ? `/(tabs)/messages/${chatId}/search?channelId=${channelId}`
                  : `/(tabs)/messages/${chatId}/search`) as any,
              )
            }
          >
            <Ionicons name="search-outline" size={22} color={chatColors.text} />
            <Text style={chatTypography.infoAction}>Search</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.actionItem}
            onPress={() => {
              if (isDirect) setConfirm({ kind: 'delete-dm' });
              else if (isCustomGroup) setConfirm({ kind: 'leave-group' });
              else setConfirm({ kind: 'leave-official' });
            }}
          >
            <Ionicons name={isDirect ? 'trash-outline' : 'exit-outline'} size={22} color={chatColors.text} />
            <Text style={chatTypography.infoAction}>{isDirect ? 'Delete' : 'Leave'}</Text>
          </TouchableOpacity>
        </View>

        {/* People — participants of THIS conversation (no old Invite Link row). */}
        {!isDirect && (
          <>
            <Text style={styles.peopleHeader}>People</Text>
            {chatDetails.participants.map((member) => {
              const isSelf = member.user_id === userId;
              const displayPersonName = displayNameOrFallback(member);
              return (
                <View key={member.user_id} style={styles.memberRow}>
                  <TouchableOpacity
                    onPress={() => router.push(`/profile/${member.user_id}` as any)}
                    activeOpacity={0.7}
                  >
                    <Avatar uri={member.avatar_url} size={chatSizes.avatarSuggested} username={displayPersonName} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.memberText}
                    onPress={() => router.push(`/profile/${member.user_id}` as any)}
                    activeOpacity={0.7}
                  >
                    {isOfficialChat && <Text style={chatTypography.roleLabel}>{member.role}</Text>}
                    {isCustomGroup && chatDetails.created_by === member.user_id && (
                      <Text style={chatTypography.roleLabel}>Admin</Text>
                    )}
                    <Text style={chatTypography.rowName}>{displayPersonName}</Text>
                    {!isPlaceholderUsername(member.username) && (
                      <Text style={styles.memberUsername}>@{member.username}</Text>
                    )}
                  </TouchableOpacity>
                  {!isSelf && (
                    <>
                      <TouchableOpacity
                        onPress={() =>
                          router.push(
                            `/(tabs)/messages/new?draftUserId=${member.user_id}&draftName=${encodeURIComponent(displayPersonName)}&draftAvatar=${encodeURIComponent(member.avatar_url ?? '')}` as any,
                          )
                        }
                        style={styles.msgIcon}
                        accessibilityLabel={`Message ${displayPersonName}`}
                      >
                        <Ionicons name="chatbubble-outline" size={18} color={chatColors.text} />
                      </TouchableOpacity>
                      <FollowStateButton
                        viewerId={userId}
                        targetUserId={member.user_id}
                        state={followStates?.[member.user_id] ?? 'follow'}
                      />
                      <TouchableOpacity
                        onPress={() => setPersonMenu({ userId: member.user_id, name: displayPersonName })}
                        style={styles.msgIcon}
                        hitSlop={6}
                        accessibilityLabel={`More options for ${displayPersonName}`}
                      >
                        <Ionicons name="ellipsis-vertical" size={16} color={chatColors.textMuted} />
                      </TouchableOpacity>
                    </>
                  )}
                </View>
              );
            })}
          </>
        )}

        <View style={styles.tabBar}>
          {tabs.map((tab) => {
            const active = activeTab === tab;
            const icon =
              tab === 'polls'
                ? 'checkbox-outline'
                : tab === 'media'
                  ? 'images-outline'
                  : tab === 'calendar'
                    ? 'calendar-outline'
                    : 'attach-outline';
            return (
              <TouchableOpacity
                key={tab}
                style={[styles.tab, active && styles.tabActive]}
                onPress={() => setActiveTab(tab)}
              >
                <Ionicons name={icon as any} size={22} color={active ? chatColors.teal : chatColors.text} />
              </TouchableOpacity>
            );
          })}
        </View>

        {activeTab === 'media' && renderMediaGrid()}
        {activeTab === 'files' && renderFiles()}
        {activeTab === 'calendar' && renderCalendar()}
        {activeTab === 'polls' && !isDirect && renderPolls()}
      </ScrollView>

      {/* ── Full-screen media viewer (same component as in the thread) ── */}
      <MediaViewer
        visible={viewerIndex !== null}
        items={viewerItems}
        initialIndex={viewerIndex ?? 0}
        onClose={() => setViewerIndex(null)}
      />

      <ShareInviteSheet
        visible={shareOpen}
        conversationId={chatId}
        chatTitle={displayName}
        onClose={() => setShareOpen(false)}
      />

      {/* ── Overflow: officer / group-admin deletion options ── */}
      <Modal visible={overflowOpen} transparent animationType="fade" onRequestClose={() => setOverflowOpen(false)}>
        <TouchableOpacity style={styles.menuOverlay} activeOpacity={1} onPress={() => setOverflowOpen(false)}>
          <View style={styles.menuCard}>
            <TouchableOpacity style={styles.menuRow} onPress={doHideForMe}>
              <Ionicons name="eye-off-outline" size={19} color={chatColors.text} />
              <Text style={styles.menuLabel}>Delete for me</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.menuRow}
              onPress={() => {
                setOverflowOpen(false);
                setConfirm({ kind: 'delete-everyone' });
              }}
            >
              <Ionicons name="trash-outline" size={19} color="#C62828" />
              <Text style={[styles.menuLabel, { color: '#C62828' }]}>Delete for everyone</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ── Person menu (report + moderation) ── */}
      <Modal visible={!!personMenu} transparent animationType="fade" onRequestClose={() => setPersonMenu(null)}>
        <TouchableOpacity style={styles.menuOverlay} activeOpacity={1} onPress={() => setPersonMenu(null)}>
          <View style={styles.menuCard}>
            {personMenu && (
              <>
                <TouchableOpacity style={styles.menuRow} onPress={() => reportUserFromChat(personMenu)}>
                  <Ionicons name="flag-outline" size={19} color={chatColors.text} />
                  <Text style={styles.menuLabel}>Report {personMenu.name}</Text>
                </TouchableOpacity>

                {isOfficialChat && isOfficer && isMembersChat && !personMenuIsOfficer && (
                  <TouchableOpacity
                    style={styles.menuRow}
                    onPress={() => {
                      setPersonMenu(null);
                      setConfirm({ kind: 'promote-officer', userId: personMenu.userId, name: personMenu.name });
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
                      setPersonMenu(null);
                      setConfirm({ kind: 'demote-officer', userId: personMenu.userId, name: personMenu.name });
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
                      setPersonMenu(null);
                      setConfirm({ kind: 'remove-member', userId: personMenu.userId, name: personMenu.name });
                    }}
                  >
                    <Ionicons name="person-remove-outline" size={19} color="#C62828" />
                    <Text style={[styles.menuLabel, { color: '#C62828' }]}>Remove from club</Text>
                  </TouchableOpacity>
                )}

                {isCustomGroup && isGroupAdmin && (
                  <>
                    <TouchableOpacity style={styles.menuRow} onPress={() => makeGroupAdmin(personMenu.userId)}>
                      <Ionicons name="key-outline" size={19} color={chatColors.text} />
                      <Text style={styles.menuLabel}>Make admin</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.menuRow}
                      onPress={() => {
                        setPersonMenu(null);
                        setConfirm({ kind: 'remove-from-group', userId: personMenu.userId, name: personMenu.name });
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

      {/* ── Group rename (admin) ── */}
      <Modal visible={renameOpen} transparent animationType="fade" onRequestClose={() => setRenameOpen(false)}>
        <KeyboardAvoidingView
          style={styles.menuOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.renameCard}>
            <Text style={styles.renameTitle}>Group name</Text>
            <TextInput
              style={styles.renameInput}
              value={renameValue}
              onChangeText={setRenameValue}
              placeholder="Optional — leave empty to use member names"
              placeholderTextColor={chatColors.textMuted}
              maxLength={60}
              autoFocus
            />
            <View style={styles.renameActions}>
              <TouchableOpacity onPress={() => setRenameOpen(false)} style={styles.renameBtn}>
                <Text style={styles.renameCancel}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={saveRename} style={[styles.renameBtn, styles.renameSave]}>
                <Text style={styles.renameSaveLabel}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Confirmations ── */}
      <ConfirmationModal
        visible={confirm?.kind === 'delete-dm'}
        title={`Delete conversation?`}
        message={`This removes the conversation from your messages only. ${displayName} keeps their copy. If either of you messages again, the conversation comes back.`}
        confirmLabel="Delete"
        destructive
        onConfirm={doDeleteDm}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmationModal
        visible={confirm?.kind === 'leave-official'}
        title="Leave this chat?"
        message={`You'll stop receiving messages from ${displayName}. You will STAY a ${isOfficersChat ? 'club officer' : 'club member'} — this only removes the chat. You can reopen it anytime from the club profile.`}
        confirmLabel="Leave chat"
        destructive
        onConfirm={doLeaveOfficial}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmationModal
        visible={confirm?.kind === 'leave-group'}
        title="Leave group?"
        message={
          isGroupAdmin
            ? 'You are the group admin. If others remain you must transfer admin first (People → ⋯ → Make admin) or delete the group for everyone.'
            : `You'll leave ${displayName}. This has no effect on any club.`
        }
        confirmLabel="Leave group"
        destructive
        onConfirm={doLeaveGroup}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmationModal
        visible={confirm?.kind === 'delete-everyone'}
        title="Delete for everyone?"
        message={
          isCustomGroup
            ? 'This deletes the group and its messages for all participants. This cannot be undone.'
            : 'This clears the chat history for all participants and removes the chat from their messages. The club, its members and officer roles are not affected — the chat can be reopened clean from the club profile.'
        }
        confirmLabel="Delete for everyone"
        destructive
        onConfirm={doDeleteForEveryone}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmationModal
        visible={confirm?.kind === 'remove-member'}
        title={`Remove from club?`}
        message={`${confirm?.kind === 'remove-member' ? confirm.name : ''} will be removed from the club and its chats. Their We Glue account, posts and other clubs are not affected.`}
        confirmLabel="Remove from club"
        destructive
        onConfirm={() => confirm?.kind === 'remove-member' && doRemoveMember(confirm)}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmationModal
        visible={confirm?.kind === 'demote-officer'}
        title="Remove officer privileges?"
        message="This person will be removed from the Officers chat and will no longer be able to manage the club. They will remain a member of the club."
        confirmLabel="Remove as officer"
        destructive
        onConfirm={() => confirm?.kind === 'demote-officer' && doDemoteOfficer(confirm)}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmationModal
        visible={confirm?.kind === 'promote-officer'}
        title="Add as officer?"
        message={`${confirm?.kind === 'promote-officer' ? confirm.name : ''} will become an officer with full officer permissions: managing members, officers, events, the club profile and official chats.`}
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

function MediaThumb({
  path,
  isVideo,
  size,
  onPress,
}: {
  path: string;
  isVideo: boolean;
  size: number;
  onPress: () => void;
}) {
  const [uri, setUri] = useState<string | null>(path.startsWith('http') ? path : null);
  useState(() => {
    void resolveAttachmentUrl(path).then(setUri);
  });
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85}>
      <View style={{ width: size, height: size, backgroundColor: chatColors.gridPlaceholder }}>
        {uri && <Image source={{ uri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />}
        {isVideo && (
          <View style={styles.thumbPlay}>
            <Ionicons name="play" size={16} color="#fff" />
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: chatColors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  backBtn: { padding: 4 },
  overflowBtn: { padding: 4 },
  scroll: { paddingBottom: 32 },
  profileSection: {
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 32,
  },
  profileName: {
    ...chatTypography.chatTitle,
    marginTop: 10,
    textAlign: 'center',
  },
  profileUsername: {
    fontFamily: chatFonts.regular,
    fontSize: 13,
    color: chatColors.textMuted,
    marginTop: 2,
    textAlign: 'center',
  },
  editBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: chatColors.teal,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: chatColors.bg,
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 36,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: chatColors.border,
  },
  actionItem: {
    alignItems: 'center',
    gap: 4,
  },
  peopleHeader: {
    ...chatTypography.infoRow,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 10,
  },
  memberText: {
    flex: 1,
  },
  memberUsername: {
    fontFamily: chatFonts.regular,
    fontSize: 11,
    color: chatColors.textMuted,
    marginTop: 1,
  },
  msgIcon: {
    padding: 6,
  },
  tabBar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 12,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: chatColors.border,
    marginTop: 8,
  },
  tab: {
    padding: 8,
  },
  tabActive: {
    borderBottomWidth: 2,
    borderBottomColor: chatColors.teal,
  },
  gridWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID_GAP,
  },
  thumbPlay: {
    position: 'absolute',
    right: 4,
    top: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTab: {
    alignItems: 'center',
    paddingVertical: 48,
  },
  emptyText: {
    fontFamily: chatFonts.regular,
    fontSize: 14,
    color: chatColors.textMuted,
  },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: chatColors.border,
  },
  fileIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(15,166,166,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileMeta: { flex: 1 },
  fileName: {
    fontFamily: chatFonts.semiBold,
    fontSize: 13,
    color: chatColors.text,
  },
  fileSub: {
    fontFamily: chatFonts.regular,
    fontSize: 11,
    color: chatColors.textMuted,
    marginTop: 2,
  },
  eventRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: chatColors.border,
  },
  eventThumb: {
    width: 44,
    height: 44,
    borderRadius: 10,
  },
  eventThumbPlaceholder: {
    backgroundColor: chatColors.tagBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pollCard: {
    marginHorizontal: 16,
    marginVertical: 8,
    backgroundColor: chatColors.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: chatColors.border,
    padding: 14,
    ...chatShadow,
  },
  pollHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  pollQuestion: {
    fontFamily: chatFonts.semiBold,
    fontSize: 14,
    color: chatColors.text,
    flex: 1,
  },
  pollStatus: {
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  pollStatusActive: {
    backgroundColor: 'rgba(15,166,166,0.1)',
  },
  pollStatusEnded: {
    backgroundColor: chatColors.tagBg,
  },
  pollStatusText: {
    fontFamily: chatFonts.semiBold,
    fontSize: 10,
  },
  pollMeta: {
    fontFamily: chatFonts.regular,
    fontSize: 11,
    color: chatColors.textMuted,
    marginTop: 2,
    marginBottom: 8,
  },
  pollOptionRow: {
    marginBottom: 8,
  },
  pollBar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(15,166,166,0.12)',
    borderRadius: 8,
  },
  pollBarWinner: {
    backgroundColor: 'rgba(15,166,166,0.28)',
  },
  pollOptionContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  pollOptionText: {
    fontFamily: chatFonts.regular,
    fontSize: 13,
    color: chatColors.text,
    flex: 1,
  },
  pollPct: {
    fontFamily: chatFonts.semiBold,
    fontSize: 12,
    color: chatColors.textMuted,
    marginLeft: 8,
  },
  pollVoters: {
    fontFamily: chatFonts.regular,
    fontSize: 10,
    color: chatColors.textMuted,
    paddingHorizontal: 10,
    marginTop: 1,
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
  renameCard: {
    backgroundColor: chatColors.bg,
    borderRadius: 16,
    padding: 18,
    width: '100%',
    ...chatShadow,
  },
  renameTitle: {
    ...chatTypography.chatTitle,
    fontSize: 16,
    marginBottom: 10,
  },
  renameInput: {
    backgroundColor: chatColors.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: chatColors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: chatFonts.regular,
    fontSize: 14,
    color: chatColors.text,
  },
  renameActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 14,
  },
  renameBtn: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 20,
  },
  renameSave: {
    backgroundColor: chatColors.teal,
  },
  renameCancel: {
    fontFamily: chatFonts.semiBold,
    fontSize: 13,
    color: chatColors.textMuted,
  },
  renameSaveLabel: {
    fontFamily: chatFonts.semiBold,
    fontSize: 13,
    color: chatColors.cream,
  },
});
