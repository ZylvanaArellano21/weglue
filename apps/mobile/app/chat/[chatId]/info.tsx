import { useEffect, useMemo, useState } from 'react';
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
import { pickMedia, useWeGlueMediaFlow } from '../../../lib/media/pickMedia';
import { useChatDetails } from '../../../hooks/useChats';
import { Avatar } from '../../../components/shared/Avatar';
import { ConfirmationModal } from '../../../components/chat/ConfirmationModal';
import { MediaViewer, type ViewerMediaItem } from '../../../components/chat/MediaViewer';
import { ShareInviteSheet } from '../../../components/chat/ShareInviteSheet';
import { FollowStateButton } from '../../../components/shared/FollowStateButton';
import { useFollowStates } from '../../../hooks/useFollowStates';
import { useOfficerStore } from '../../../store/officerStore';
import {
  getConversationMedia,
  getConversationFiles,
  getConversationSharedEvents,
  getConversationPollIds,
  hideConversationForMe,
  leaveGroupChat,
  deleteGroupForEveryone,
  clearOfficialChat,
  removeGroupParticipant,
  updateGroupMeta,
  setConversationMuted,
  setConversationArchived,
  getMyConversationFlags,
} from '../../../services/messagingService';
import {
  getChannelMeta,
  setChannelAvatar,
  setChannelMuted,
  getChannelMuted,
  setChannelPostPermission,
  getChannelPosters,
  renameChannel,
  deleteChannel,
  type ChannelMeta,
  type PostPermission,
} from '../../../services/channelService';
import { openReportFlow } from '../../../components/shared/ReportButton';
import { useDidIBlock, useBlockUser, useUnblockUser } from '../../../hooks/useBlocking';
import { confirmBlock, confirmUnblock, blockFailedAlert, blockSucceededAlert } from '../../../lib/blockPrompts';
import { getClubPoll, type ClubPoll } from '../../../services/clubPollService';
import {
  resolveAttachmentUrl,
  openAttachmentExternally,
  formatFileSize,
  fileTypeLabel,
} from '../../../lib/chatAttachments';
import { displayNameOrFallback, isPlaceholderUsername } from '../../../lib/displayName';
import { uploadImageToBucket } from '../../../lib/imageUpload';
import { useAndroidKeyboardHeight } from '../../../lib/useAndroidKeyboardHeight';
import {
  chatColors,
  chatFonts,
  chatShadow,
  chatSizes,
  chatTypography,
} from '../../../components/chat/chatTheme';

// ─── Chat Information ────────────────────────────────────────────────────────
// Three distinct screens behind one route, selected by conversation type and
// the presence of a channelId:
//   • Parent Conversation Info (official chat, no channelId) — Bug 3/5/6/7:
//     NO picture, NO content, NO Leave/Delete. Add Person/Share (Members,
//     officers) + Mute + Archive + people list + 3-dot Report.
//   • Main chat / Hashtag Channel Info (official chat, channelId) — Bug 10/11:
//     own picture, Search, Mute, channel-scoped shared content; officers get
//     Edit Permissions and (hashtags only) Rename/Delete. NO people/Leave.
//   • Direct / custom-group info (unchanged) — preserves existing behavior.
// Nothing here ever mutates club membership or officer roles (that lives on the
// Club Profile).

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

  // Which of the three screens are we rendering?
  const isParentInfo = isOfficialChat && !channelId;
  const isThreadInfo = isOfficialChat && !!channelId;

  const [channelMeta, setChannelMeta] = useState<ChannelMeta | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!channelId) {
      setChannelMeta(null);
      return;
    }
    getChannelMeta(channelId).then((m) => {
      if (!cancelled) setChannelMeta(m);
    });
    return () => {
      cancelled = true;
    };
  }, [channelId]);

  const [activeTab, setActiveTab] = useState<ContentTab>('media');
  const [confirm, setConfirm] = useState<
    | null
    | { kind: 'delete-dm' }
    | { kind: 'leave-group' }
    | { kind: 'delete-everyone' }
    | { kind: 'remove-from-group'; userId: string; name: string }
    | { kind: 'delete-channel' }
  >(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [personMenu, setPersonMenu] = useState<null | { userId: string; name: string }>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  // Android: float the rename dialog above the keyboard (iOS keeps KAV).
  const { height: androidKeyboardHeight } = useAndroidKeyboardHeight();
  const [channelRenameOpen, setChannelRenameOpen] = useState(false);
  const [channelRenameValue, setChannelRenameValue] = useState('');
  const [permOpen, setPermOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  // ── People + follow states ──
  const others = useMemo(
    () => (chatDetails?.participants ?? []).filter((p) => p.user_id !== userId),
    [chatDetails?.participants, userId],
  );
  // Blocking. Declared here, alongside the other participant-derived hooks and
  // ABOVE this screen's early returns — `otherUser` is computed after those, so
  // deriving the id from `others` is what keeps hook order unconditional.
  const directOtherId = isDirect ? others[0]?.user_id : undefined;
  const { data: iBlockedThem } = useDidIBlock(userId, directOtherId);
  const blockMutation = useBlockUser(userId);
  const unblockMutation = useUnblockUser(userId);

  const { data: followStates } = useFollowStates(
    userId,
    others.map((p) => p.user_id),
  );

  // ── Mute / archive state ──
  const { data: convFlags } = useQuery({
    queryKey: ['convFlags', chatId, userId],
    queryFn: () => getMyConversationFlags(chatId, userId),
    enabled: !!chatId && !!userId && isParentInfo,
    staleTime: 10 * 1000,
  });
  const { data: channelMuted } = useQuery({
    queryKey: ['channelMuted', channelId, userId],
    queryFn: () => getChannelMuted(channelId!, userId),
    enabled: !!channelId && !!userId && isThreadInfo,
    staleTime: 10 * 1000,
  });

  // ── Content tabs (channel-scoped for thread info; Bug 17) ──
  const contentChannelId = isThreadInfo ? channelId : undefined;
  const contentEnabled = !isParentInfo; // parent info shows no content

  const { data: media } = useQuery({
    queryKey: ['convMedia', chatId, contentChannelId ?? 'all', userId],
    queryFn: () => getConversationMedia(chatId, userId, contentChannelId),
    enabled: !!chatId && !!userId && contentEnabled,
    staleTime: 15 * 1000,
  });
  const { data: files } = useQuery({
    queryKey: ['convFiles', chatId, contentChannelId ?? 'all', userId],
    queryFn: () => getConversationFiles(chatId, userId, contentChannelId),
    enabled: !!chatId && !!userId && contentEnabled && activeTab === 'files',
    staleTime: 15 * 1000,
  });
  const { data: sharedEvents } = useQuery({
    queryKey: ['convEvents', chatId, contentChannelId ?? 'all', userId],
    queryFn: () => getConversationSharedEvents(chatId, userId, contentChannelId),
    enabled: !!chatId && !!userId && contentEnabled && activeTab === 'calendar',
    staleTime: 15 * 1000,
  });
  const { data: pollRefs } = useQuery({
    queryKey: ['convPolls', chatId, contentChannelId ?? 'all'],
    queryFn: () => getConversationPollIds(chatId, contentChannelId),
    enabled: !!chatId && contentEnabled && activeTab === 'polls' && !isDirect,
    staleTime: 15 * 1000,
  });
  const { data: polls } = useQuery({
    queryKey: ['convPollDetails', chatId, contentChannelId ?? 'all', (pollRefs ?? []).map((p) => p.poll_id).join(',')],
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
  const isMainChat = channelMeta?.kind === 'main';
  const threadTitle = isThreadInfo
    ? channelMeta
      ? isMainChat
        ? 'Main chat'
        : `#${channelMeta.name}`
      : ''
    : displayName;

  const tabs: ContentTab[] = isDirect ? ['media', 'calendar', 'files'] : ['polls', 'media', 'calendar', 'files'];

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: ['chatDetails', chatId] });
    queryClient.invalidateQueries({ queryKey: ['myChats'] });
    queryClient.invalidateQueries({ queryKey: ['thread', chatId] });
    queryClient.invalidateQueries({ queryKey: ['conversationHub', chatId] });
    queryClient.invalidateQueries({ queryKey: ['clubChannels', clubId] });
  }

  function popToMessages() {
    router.dismissTo?.('/(tabs)/messages' as any) ?? router.replace('/(tabs)/messages' as any);
  }

  // ── Mute / archive (Bug 7) ──
  async function toggleConversationMute() {
    try {
      await setConversationMuted(chatId, !convFlags?.muted);
      queryClient.invalidateQueries({ queryKey: ['convFlags', chatId, userId] });
      queryClient.invalidateQueries({ queryKey: ['myChats'] });
    } catch {
      Alert.alert('Could not update mute setting.');
    }
  }
  async function toggleArchive() {
    try {
      const next = !convFlags?.archived;
      await setConversationArchived(chatId, next);
      queryClient.invalidateQueries({ queryKey: ['convFlags', chatId, userId] });
      queryClient.invalidateQueries({ queryKey: ['myChats'] });
      if (next) popToMessages();
    } catch {
      Alert.alert('Could not update archive setting.');
    }
  }
  async function toggleChannelMute() {
    if (!channelId) return;
    try {
      await setChannelMuted(channelId, !channelMuted);
      queryClient.invalidateQueries({ queryKey: ['channelMuted', channelId, userId] });
    } catch {
      Alert.alert('Could not update mute setting.');
    }
  }

  // ── Channel picture (officer) ──
  async function onChannelPicturePress() {
    if (!isOfficer || !channelId) return;
    // Android: shared We Glue flow. Tapping the avatar → 'choose' (Take Photo /
    // Photo Library), then camera or picker + confirm preview. iOS keeps its
    // existing library-only path. Square 1:1 avatar preserved.
    let localUri: string;
    if (useWeGlueMediaFlow) {
      const picked = await pickMedia({ source: 'choose', aspect: [1, 1], allowsEditing: true, quality: 0.85 });
      if (!picked) return;
      localUri = picked.uri;
    } else {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) return;
      const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.85, allowsEditing: true, aspect: [1, 1] });
      if (result.canceled || !result.assets[0]) return;
      localUri = result.assets[0].uri;
    }
    try {
      const url = await uploadImageToBucket('avatars', `${userId}/channel-${channelId}.jpg`, localUri, 512);
      await setChannelAvatar(channelId, url);
      setChannelMeta((m) => (m ? { ...m, avatar_url: url } : m));
      invalidateAll();
    } catch {
      Alert.alert('Could not update the channel picture.');
    }
  }

  // ── Channel rename / delete (officer, hashtags only) ──
  async function saveChannelRename() {
    if (!channelId) return;
    try {
      await renameChannel(channelId, channelRenameValue.trim());
      setChannelRenameOpen(false);
      setChannelMeta((m) => (m ? { ...m, name: channelRenameValue.trim().toLowerCase().replace(/\s+/g, '-') } : m));
      invalidateAll();
    } catch (e: any) {
      Alert.alert('Could not rename channel', e?.message?.includes('cannot_rename_main') ? 'The Main chat cannot be renamed.' : 'Please try again.');
    }
  }
  async function doDeleteChannel() {
    setConfirm(null);
    if (!channelId) return;
    try {
      await deleteChannel(channelId);
      invalidateAll();
      // Back to the hub — the channel no longer exists.
      router.dismissTo?.(`/chat/${chatId}` as any) ?? router.replace(`/chat/${chatId}` as any);
    } catch (e: any) {
      Alert.alert('Could not delete channel', e?.message?.includes('cannot_delete_main') ? 'The Main chat cannot be deleted.' : 'Please try again.');
    }
  }

  // ── Custom group flows (unchanged) ──
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
  async function doRemoveFromGroup(target: { userId: string; name: string }) {
    setConfirm(null);
    try {
      await removeGroupParticipant(chatId, target.userId);
      invalidateAll();
    } catch {
      Alert.alert('Could not remove this person. Please try again.');
    }
  }

  function reportUserFromChat(target: { userId: string; name: string }) {
    setPersonMenu(null);
    openReportFlow({ entityType: 'user', entityId: target.userId, entityName: target.name });
  }
  // Block / unblock the OTHER person in a direct conversation. Offered only
  // for `direct`: blocking severs direct contact and never restricts a shared
  // group or club room (founder decision 2), so there is nothing to offer there.
  function blockFromChat() {
    setOverflowOpen(false);
    if (!otherUser) return;
    confirmBlock({
      username: otherUser.username,
      fullName: otherUser.full_name,
      onConfirm: () =>
        blockMutation.mutate(otherUser.user_id, {
          onSuccess: (result) => {
            if (result.status !== 'ok') {
              blockFailedAlert('block');
              return;
            }
            blockSucceededAlert(otherUser.username, otherUser.full_name);
          },
          onError: () => blockFailedAlert('block'),
        }),
    });
  }

  function unblockFromChat() {
    setOverflowOpen(false);
    if (!otherUser) return;
    confirmUnblock({
      username: otherUser.username,
      fullName: otherUser.full_name,
      onConfirm: () =>
        unblockMutation.mutate(otherUser.user_id, {
          onError: () => blockFailedAlert('unblock'),
        }),
    });
  }

  function reportConversation() {
    setOverflowOpen(false);
    if (clubId) openReportFlow({ entityType: 'club', entityId: clubId, entityName: displayName });
  }

  // ── Identity taps (direct/group only) ──
  function onIdentityPress() {
    if (isDirect && otherUser) {
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
    // Android: shared We Glue flow. Tapping the avatar → 'choose' (Take Photo /
    // Photo Library), then camera or picker + confirm preview. iOS keeps its
    // existing library-only path. Square 1:1 avatar preserved.
    let localUri: string;
    if (useWeGlueMediaFlow) {
      const picked = await pickMedia({ source: 'choose', aspect: [1, 1], allowsEditing: true, quality: 0.85 });
      if (!picked) return;
      localUri = picked.uri;
    } else {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) return;
      const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.85, allowsEditing: true, aspect: [1, 1] });
      if (result.canceled || !result.assets[0]) return;
      localUri = result.assets[0].uri;
    }
    try {
      const url = await uploadImageToBucket('avatars', `${userId}/group-${chatId}.jpg`, localUri, 512);
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

  function openAddPeople() {
    // Members Info Add Person: officer-driven, atomic membership add (Bug 4).
    router.push(`/chat/manage-people?mode=members&clubId=${clubId}&conversationId=${chatId}` as any);
  }

  // ── Content renderers (shared) ──
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
          <MediaThumb key={m.id} path={m.attachment_url!} isVideo={m.message_type === 'video'} size={cell} onPress={() => setViewerIndex(idx)} />
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
        onPress={() => {
          // Authenticated fetch: current authorization decides, every time.
          void openAttachmentExternally(f.attachment_url);
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
            {new Date(ev.event_date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
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
      // A poll with a future start hasn't opened yet — it is neither Active nor
      // Closed. Without this it read "Active" here while the poll card in the
      // thread correctly said "Poll not started".
      const notStarted = !ended && !!poll.start_at && now < new Date(poll.start_at);
      const status = ended ? 'Closed' : notStarted ? 'Scheduled' : 'Active';
      const muted = ended || notStarted;
      const winner = poll.options.length > 0 ? poll.options.reduce((a, b) => (a.vote_count >= b.vote_count ? a : b)) : null;
      return (
        <View key={poll.id} style={styles.pollCard}>
          <View style={styles.pollHeader}>
            <Text style={styles.pollQuestion}>{poll.question}</Text>
            <View style={[styles.pollStatus, muted ? styles.pollStatusEnded : styles.pollStatusActive]}>
              <Text style={[styles.pollStatusText, { color: muted ? chatColors.textMuted : chatColors.teal }]}>{status}</Text>
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
                  <Text style={styles.pollPct}>{pct}% ({opt.vote_count})</Text>
                </View>
              </View>
            );
          })}
        </View>
      );
    });
  }

  // ── Content tab bar + body (used by thread + direct/group) ──
  const contentBlock = (
    <>
      <View style={styles.tabBar}>
        {tabs.map((tab) => {
          const active = activeTab === tab;
          const icon =
            tab === 'polls' ? 'checkbox-outline' : tab === 'media' ? 'images-outline' : tab === 'calendar' ? 'calendar-outline' : 'attach-outline';
          return (
            <TouchableOpacity key={tab} style={[styles.tab, active && styles.tabActive]} onPress={() => setActiveTab(tab)}>
              <Ionicons name={icon as any} size={22} color={active ? chatColors.teal : chatColors.text} />
            </TouchableOpacity>
          );
        })}
      </View>
      {activeTab === 'media' && renderMediaGrid()}
      {activeTab === 'files' && renderFiles()}
      {activeTab === 'calendar' && renderCalendar()}
      {activeTab === 'polls' && !isDirect && renderPolls()}
    </>
  );

  const showTopOverflow = isOfficialChat || (isOfficialChat && isOfficer) || isGroupAdmin;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={chatColors.text} />
        </TouchableOpacity>
        {(showTopOverflow || (isCustomGroup && isGroupAdmin)) && (
          <TouchableOpacity onPress={() => setOverflowOpen(true)} style={styles.overflowBtn} hitSlop={8}>
            <Ionicons name="ellipsis-horizontal" size={22} color={chatColors.text} />
          </TouchableOpacity>
        )}
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* ─── Identity block ─── */}
        {isParentInfo ? (
          // Parent conversation: NO picture (Bug 2).
          <View style={styles.profileSection}>
            <Text style={styles.profileName}>{displayName}</Text>
          </View>
        ) : (
          <View style={styles.profileSection}>
            <TouchableOpacity onPress={isThreadInfo ? onChannelPicturePress : onGroupPicturePress} activeOpacity={0.8}>
              <Avatar uri={isThreadInfo ? channelMeta?.avatar_url ?? null : chatDetails.avatar_url} size={80} username={threadTitle || displayName} />
              {((isThreadInfo && isOfficer) || isGroupAdmin) && (
                <View style={styles.editBadge}>
                  <Ionicons name="camera" size={12} color="#fff" />
                </View>
              )}
            </TouchableOpacity>
            <TouchableOpacity onPress={isThreadInfo ? undefined : onIdentityPress} activeOpacity={0.7} disabled={isThreadInfo}>
              <Text style={styles.profileName}>{threadTitle || displayName}</Text>
            </TouchableOpacity>
            {isThreadInfo && (
              <Text style={styles.profileUsername}>{displayName}</Text>
            )}
            {isDirect && otherUser?.username && !isPlaceholderUsername(otherUser.username) ? (
              <TouchableOpacity onPress={onIdentityPress} activeOpacity={0.7}>
                <Text style={styles.profileUsername}>@{otherUser.username}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        )}

        {/* ─── Action row ─── */}
        <View style={styles.actionRow}>
          {isParentInfo && isMembersChat && isOfficer && (
            <TouchableOpacity style={styles.actionItem} onPress={openAddPeople}>
              <Ionicons name="person-add-outline" size={22} color={chatColors.text} />
              <Text style={chatTypography.infoAction}>Add Person</Text>
            </TouchableOpacity>
          )}
          {isParentInfo && isMembersChat && isOfficer && (
            <TouchableOpacity style={styles.actionItem} onPress={() => setShareOpen(true)}>
              <Ionicons name="share-outline" size={22} color={chatColors.text} />
              <Text style={chatTypography.infoAction}>Share</Text>
            </TouchableOpacity>
          )}
          {isParentInfo && (
            <>
              <TouchableOpacity style={styles.actionItem} onPress={toggleConversationMute}>
                <Ionicons name={convFlags?.muted ? 'notifications-off' : 'notifications-off-outline'} size={22} color={chatColors.text} />
                <Text style={chatTypography.infoAction}>{convFlags?.muted ? 'Unmute' : 'Mute'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionItem} onPress={toggleArchive}>
                <Ionicons name={convFlags?.archived ? 'archive' : 'archive-outline'} size={22} color={chatColors.text} />
                <Text style={chatTypography.infoAction}>{convFlags?.archived ? 'Unarchive' : 'Archive'}</Text>
              </TouchableOpacity>
            </>
          )}

          {isThreadInfo && (
            <>
              <TouchableOpacity
                style={styles.actionItem}
                onPress={() => router.push(`/chat/${chatId}/search?channelId=${channelId}` as any)}
              >
                <Ionicons name="search-outline" size={22} color={chatColors.text} />
                <Text style={chatTypography.infoAction}>Search</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionItem} onPress={toggleChannelMute}>
                <Ionicons name={channelMuted ? 'notifications-off' : 'notifications-off-outline'} size={22} color={chatColors.text} />
                <Text style={chatTypography.infoAction}>{channelMuted ? 'Unmute' : 'Mute'}</Text>
              </TouchableOpacity>
              {isOfficer && (
                <TouchableOpacity style={styles.actionItem} onPress={() => setPermOpen(true)}>
                  <Ionicons name="lock-closed-outline" size={22} color={chatColors.text} />
                  <Text style={chatTypography.infoAction}>Permissions</Text>
                </TouchableOpacity>
              )}
            </>
          )}

          {/* Direct / custom group keep Search + Delete/Leave. */}
          {!isOfficialChat && (
            <>
              {isCustomGroup && isGroupAdmin && (
                <TouchableOpacity style={styles.actionItem} onPress={() => router.push(`/chat/manage-people?mode=group&conversationId=${chatId}` as any)}>
                  <Ionicons name="person-add-outline" size={22} color={chatColors.text} />
                  <Text style={chatTypography.infoAction}>Add</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.actionItem} onPress={() => router.push(`/chat/${chatId}/search` as any)}>
                <Ionicons name="search-outline" size={22} color={chatColors.text} />
                <Text style={chatTypography.infoAction}>Search</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.actionItem}
                onPress={() => (isDirect ? setConfirm({ kind: 'delete-dm' }) : setConfirm({ kind: 'leave-group' }))}
              >
                <Ionicons name={isDirect ? 'trash-outline' : 'exit-outline'} size={22} color={chatColors.text} />
                <Text style={chatTypography.infoAction}>{isDirect ? 'Delete' : 'Leave'}</Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        {/* ─── People (parent info + custom group; NOT thread info) ─── */}
        {(isParentInfo || (isCustomGroup && !isDirect)) && (
          <>
            <View style={styles.peopleHeaderRow}>
              <Text style={styles.peopleHeader}>{isOfficersChat ? 'Officers' : 'People'}</Text>
              <Text style={styles.peopleCount}>{chatDetails.participants.length}</Text>
            </View>
            {others.slice(0, 4).map((member) => {
              const displayPersonName = displayNameOrFallback(member);
              return (
                <View key={member.user_id} style={styles.memberRow}>
                  <TouchableOpacity onPress={() => router.push(`/profile/${member.user_id}` as any)} activeOpacity={0.7}>
                    <Avatar uri={member.avatar_url} size={chatSizes.avatarSuggested} username={displayPersonName} />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.memberText} onPress={() => router.push(`/profile/${member.user_id}` as any)} activeOpacity={0.7}>
                    {isOfficialChat && <Text style={chatTypography.roleLabel}>{member.role}</Text>}
                    {isCustomGroup && chatDetails.created_by === member.user_id && <Text style={chatTypography.roleLabel}>Admin</Text>}
                    <Text style={chatTypography.rowName}>{displayPersonName}</Text>
                    {!isPlaceholderUsername(member.username) && <Text style={styles.memberUsername}>@{member.username}</Text>}
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() =>
                      router.push(
                        `/chat/new?draftUserId=${member.user_id}&draftName=${encodeURIComponent(displayPersonName)}&draftAvatar=${encodeURIComponent(member.avatar_url ?? '')}` as any,
                      )
                    }
                    style={styles.msgIcon}
                    accessibilityLabel={`Message ${displayPersonName}`}
                  >
                    <Ionicons name="chatbubble-outline" size={18} color={chatColors.text} />
                  </TouchableOpacity>
                  <FollowStateButton viewerId={userId} targetUserId={member.user_id} state={followStates?.[member.user_id] ?? 'follow'} />
                  <TouchableOpacity
                    onPress={() => setPersonMenu({ userId: member.user_id, name: displayPersonName })}
                    style={styles.msgIcon}
                    hitSlop={6}
                    accessibilityLabel={`More options for ${displayPersonName}`}
                  >
                    <Ionicons name="ellipsis-vertical" size={16} color={chatColors.textMuted} />
                  </TouchableOpacity>
                </View>
              );
            })}
            {others.length > 4 && (
              <TouchableOpacity style={styles.seeAllRow} onPress={() => router.push(`/chat/${chatId}/participants` as any)} activeOpacity={0.7}>
                <Text style={styles.seeAllText}>See all {chatDetails.participants.length} people</Text>
                <Ionicons name="chevron-forward" size={16} color={chatColors.teal} />
              </TouchableOpacity>
            )}
          </>
        )}

        {/* ─── Content (thread info + direct/group; NEVER parent info) ─── */}
        {!isParentInfo && contentBlock}
      </ScrollView>

      <MediaViewer visible={viewerIndex !== null} items={viewerItems} initialIndex={viewerIndex ?? 0} onClose={() => setViewerIndex(null)} currentUserId={userId} />

      <ShareInviteSheet visible={shareOpen} conversationId={chatId} chatTitle={displayName} onClose={() => setShareOpen(false)} />

      {/* ─── Top overflow menu ─── */}
      <Modal visible={overflowOpen} transparent animationType="fade" onRequestClose={() => setOverflowOpen(false)}>
        <TouchableOpacity style={styles.menuOverlay} activeOpacity={1} onPress={() => setOverflowOpen(false)}>
          <View style={styles.menuCard}>
            {/* Officer hashtag Rename/Delete */}
            {isThreadInfo && isOfficer && !isMainChat && (
              <>
                <TouchableOpacity
                  style={styles.menuRow}
                  onPress={() => {
                    setOverflowOpen(false);
                    setChannelRenameValue(channelMeta?.name ?? '');
                    setChannelRenameOpen(true);
                  }}
                >
                  <Ionicons name="create-outline" size={19} color={chatColors.text} />
                  <Text style={styles.menuLabel}>Rename channel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.menuRow}
                  onPress={() => {
                    setOverflowOpen(false);
                    setConfirm({ kind: 'delete-channel' });
                  }}
                >
                  <Ionicons name="trash-outline" size={19} color="#C62828" />
                  <Text style={[styles.menuLabel, { color: '#C62828' }]}>Delete channel</Text>
                </TouchableOpacity>
              </>
            )}
            {/* Block / Unblock (direct conversations only) */}
            {isDirect && otherUser && (
              iBlockedThem ? (
                <TouchableOpacity style={styles.menuRow} onPress={unblockFromChat}>
                  <Ionicons name="checkmark-circle-outline" size={19} color={chatColors.text} />
                  <Text style={styles.menuLabel}>Unblock</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={styles.menuRow} onPress={blockFromChat}>
                  <Ionicons name="ban-outline" size={19} color="#C62828" />
                  <Text style={[styles.menuLabel, { color: '#C62828' }]}>Block</Text>
                </TouchableOpacity>
              )
            )}
            {/* Report (official chats) */}
            {isOfficialChat && (
              <TouchableOpacity style={styles.menuRow} onPress={reportConversation}>
                <Ionicons name="flag-outline" size={19} color={chatColors.text} />
                <Text style={styles.menuLabel}>Report</Text>
              </TouchableOpacity>
            )}
            {/* Custom group admin delete-for-everyone */}
            {isCustomGroup && isGroupAdmin && (
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
            )}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ─── Person menu (Report only; moderation lives on the Club Profile) ─── */}
      <Modal visible={!!personMenu} transparent animationType="fade" onRequestClose={() => setPersonMenu(null)}>
        <TouchableOpacity style={styles.menuOverlay} activeOpacity={1} onPress={() => setPersonMenu(null)}>
          <View style={styles.menuCard}>
            {personMenu && (
              <>
                <TouchableOpacity style={styles.menuRow} onPress={() => reportUserFromChat(personMenu)}>
                  <Ionicons name="flag-outline" size={19} color={chatColors.text} />
                  <Text style={styles.menuLabel}>Report {personMenu.name}</Text>
                </TouchableOpacity>
                {/* Blocking a co-member does NOT remove either of you from this
                    conversation and does not filter its history — it only stops
                    direct contact. */}
                <TouchableOpacity
                  style={styles.menuRow}
                  onPress={() => {
                    const target = personMenu;
                    setPersonMenu(null);
                    confirmBlock({
                      username: target.name.replace(/^@/, ''),
                      onConfirm: () =>
                        blockMutation.mutate(target.userId, {
                          onError: () => blockFailedAlert('block'),
                        }),
                    });
                  }}
                >
                  <Ionicons name="ban-outline" size={19} color="#C62828" />
                  <Text style={[styles.menuLabel, { color: '#C62828' }]}>Block {personMenu.name}</Text>
                </TouchableOpacity>
                {isCustomGroup && isGroupAdmin && (
                  <TouchableOpacity
                    style={styles.menuRow}
                    onPress={() => {
                      const target = personMenu;
                      setPersonMenu(null);
                      setConfirm({ kind: 'remove-from-group', userId: target.userId, name: target.name });
                    }}
                  >
                    <Ionicons name="person-remove-outline" size={19} color="#C62828" />
                    <Text style={[styles.menuLabel, { color: '#C62828' }]}>Remove from group</Text>
                  </TouchableOpacity>
                )}
              </>
            )}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ─── Permission editor (officer) ─── */}
      {isThreadInfo && channelId && (
        <PermissionEditor
          visible={permOpen}
          channelId={channelId}
          isOfficersChat={isOfficersChat}
          participants={others.map((p) => ({ userId: p.user_id, name: displayNameOrFallback(p), avatarUrl: p.avatar_url }))}
          currentPermission={channelMeta?.post_permission ?? 'everyone'}
          onClose={() => setPermOpen(false)}
          onSaved={(perm) => {
            setChannelMeta((m) => (m ? { ...m, post_permission: perm } : m));
            invalidateAll();
            setPermOpen(false);
          }}
        />
      )}

      {/* ─── Group rename (admin) ─── */}
      <Modal visible={renameOpen} transparent animationType="fade" onRequestClose={() => setRenameOpen(false)}>
        <KeyboardAvoidingView
          style={[
            styles.menuOverlay,
            Platform.OS === 'android' ? { paddingBottom: androidKeyboardHeight } : null,
          ]}
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

      {/* ─── Channel rename (officer) ─── */}
      <Modal visible={channelRenameOpen} transparent animationType="fade" onRequestClose={() => setChannelRenameOpen(false)}>
        <KeyboardAvoidingView
          style={[
            styles.menuOverlay,
            Platform.OS === 'android' ? { paddingBottom: androidKeyboardHeight } : null,
          ]}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.renameCard}>
            <Text style={styles.renameTitle}>Rename channel</Text>
            <TextInput
              style={styles.renameInput}
              value={channelRenameValue}
              onChangeText={setChannelRenameValue}
              placeholder="event-planning"
              placeholderTextColor={chatColors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={40}
              autoFocus
            />
            <View style={styles.renameActions}>
              <TouchableOpacity onPress={() => setChannelRenameOpen(false)} style={styles.renameBtn}>
                <Text style={styles.renameCancel}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={saveChannelRename} style={[styles.renameBtn, styles.renameSave]}>
                <Text style={styles.renameSaveLabel}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ─── Confirmations ─── */}
      <ConfirmationModal
        visible={confirm?.kind === 'delete-dm'}
        title="Delete conversation?"
        message={`This removes the conversation from your messages only. ${displayName} keeps their copy. If either of you messages again, the conversation comes back.`}
        confirmLabel="Delete"
        destructive
        onConfirm={doDeleteDm}
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
        message="This deletes the group and its messages for all participants. This cannot be undone."
        confirmLabel="Delete for everyone"
        destructive
        onConfirm={doDeleteForEveryone}
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
      <ConfirmationModal
        visible={confirm?.kind === 'delete-channel'}
        title="Delete channel?"
        message={`#${channelMeta?.name ?? ''} and all of its messages, media, files and polls will be permanently removed for everyone. This cannot be undone.`}
        confirmLabel="Delete channel"
        destructive
        onConfirm={doDeleteChannel}
        onCancel={() => setConfirm(null)}
      />
    </SafeAreaView>
  );
}

// ─── Certain-people posting permission editor (officer only) ─────────────────
function PermissionEditor({
  visible,
  channelId,
  isOfficersChat,
  participants,
  currentPermission,
  onClose,
  onSaved,
}: {
  visible: boolean;
  channelId: string;
  isOfficersChat: boolean;
  participants: Array<{ userId: string; name: string; avatarUrl: string | null }>;
  currentPermission: PostPermission;
  onClose: () => void;
  onSaved: (perm: PostPermission) => void;
}) {
  const [perm, setPerm] = useState<PostPermission>(currentPermission);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setPerm(currentPermission);
    if (currentPermission === 'certain') {
      getChannelPosters(channelId).then((ids) => setSelected(new Set(ids)));
    } else {
      setSelected(new Set());
    }
  }, [visible, currentPermission, channelId]);

  const everyoneLabel = isOfficersChat ? 'All officers' : 'Everyone';

  async function save() {
    setSaving(true);
    try {
      await setChannelPostPermission(channelId, perm, perm === 'certain' ? Array.from(selected) : undefined);
      onSaved(perm);
    } catch {
      Alert.alert('Could not update permissions', 'Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetOverlay}>
        <View style={styles.sheetCard}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Who can post</Text>
          {([
            ['everyone', everyoneLabel, 'Every member of this conversation can post.'],
            ['officers', 'Only officers', 'Members can read; only officers can post.'],
            ['certain', 'Certain people', 'Only the people you select can post.'],
          ] as Array<[PostPermission, string, string]>).map(([value, label, desc]) => (
            <TouchableOpacity key={value} style={styles.permRow} onPress={() => setPerm(value)} activeOpacity={0.7}>
              <Ionicons name={perm === value ? 'radio-button-on' : 'radio-button-off'} size={20} color={perm === value ? chatColors.teal : chatColors.textMuted} />
              <View style={styles.permText}>
                <Text style={styles.permLabel}>{label}</Text>
                <Text style={styles.permDesc}>{desc}</Text>
              </View>
            </TouchableOpacity>
          ))}

          {perm === 'certain' && (
            <ScrollView style={styles.selectorList}>
              {participants.map((p) => {
                const on = selected.has(p.userId);
                return (
                  <TouchableOpacity
                    key={p.userId}
                    style={styles.selectorRow}
                    onPress={() => {
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (next.has(p.userId)) next.delete(p.userId);
                        else next.add(p.userId);
                        return next;
                      });
                    }}
                    activeOpacity={0.7}
                  >
                    <Avatar uri={p.avatarUrl} size={30} username={p.name} />
                    <Text style={styles.selectorName} numberOfLines={1}>{p.name}</Text>
                    <Ionicons name={on ? 'checkbox' : 'square-outline'} size={20} color={on ? chatColors.teal : chatColors.textMuted} />
                  </TouchableOpacity>
                );
              })}
              {participants.length === 0 && <Text style={styles.emptyText}>No eligible people.</Text>}
            </ScrollView>
          )}

          <View style={styles.sheetActions}>
            <TouchableOpacity onPress={onClose} style={styles.renameBtn}>
              <Text style={styles.renameCancel}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={save} style={[styles.renameBtn, styles.renameSave]} disabled={saving}>
              <Text style={styles.renameSaveLabel}>{saving ? 'Saving…' : 'Save'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function MediaThumb({ path, isVideo, size, onPress }: { path: string; isVideo: boolean; size: number; onPress: () => void }) {
  const [uri, setUri] = useState<string | null>(path.startsWith('http') ? path : null);
  useEffect(() => {
    if (!path.startsWith('http')) void resolveAttachmentUrl(path).then(setUri);
  }, [path]);
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
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 8 },
  backBtn: { padding: 4 },
  overflowBtn: { padding: 4 },
  scroll: { paddingBottom: 32 },
  profileSection: { alignItems: 'center', paddingVertical: 12, paddingHorizontal: 32 },
  profileName: { ...chatTypography.chatTitle, marginTop: 10, textAlign: 'center' },
  profileUsername: { fontFamily: chatFonts.regular, fontSize: 13, color: chatColors.textMuted, marginTop: 2, textAlign: 'center' },
  editBadge: {
    position: 'absolute', right: -2, bottom: -2, width: 24, height: 24, borderRadius: 12,
    backgroundColor: chatColors.teal, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: chatColors.bg,
  },
  actionRow: { flexDirection: 'row', justifyContent: 'center', gap: 28, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: chatColors.border, flexWrap: 'wrap' },
  actionItem: { alignItems: 'center', gap: 4, minWidth: 56 },
  peopleHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  peopleHeader: { ...chatTypography.infoRow },
  peopleCount: { fontFamily: chatFonts.semiBold, fontSize: 13, color: chatColors.textMuted },
  seeAllRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14 },
  seeAllText: { fontFamily: chatFonts.semiBold, fontSize: 14, color: chatColors.teal },
  memberRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, gap: 10 },
  memberText: { flex: 1 },
  memberUsername: { fontFamily: chatFonts.regular, fontSize: 11, color: chatColors.textMuted, marginTop: 1 },
  msgIcon: { padding: 6 },
  tabBar: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 12, borderTopWidth: 1, borderBottomWidth: 1, borderColor: chatColors.border, marginTop: 8 },
  tab: { padding: 8 },
  tabActive: { borderBottomWidth: 2, borderBottomColor: chatColors.teal },
  gridWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP },
  thumbPlay: { position: 'absolute', right: 4, top: 4, width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  emptyTab: { alignItems: 'center', paddingVertical: 48 },
  emptyText: { fontFamily: chatFonts.regular, fontSize: 14, color: chatColors.textMuted },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: chatColors.border },
  fileIconWrap: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(15,166,166,0.1)', alignItems: 'center', justifyContent: 'center' },
  fileMeta: { flex: 1 },
  fileName: { fontFamily: chatFonts.semiBold, fontSize: 13, color: chatColors.text },
  fileSub: { fontFamily: chatFonts.regular, fontSize: 11, color: chatColors.textMuted, marginTop: 2 },
  eventRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: chatColors.border },
  eventThumb: { width: 44, height: 44, borderRadius: 10 },
  eventThumbPlaceholder: { backgroundColor: chatColors.tagBg, alignItems: 'center', justifyContent: 'center' },
  pollCard: { marginHorizontal: 16, marginVertical: 8, backgroundColor: chatColors.white, borderRadius: 14, borderWidth: 1, borderColor: chatColors.border, padding: 14, ...chatShadow },
  pollHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  pollQuestion: { fontFamily: chatFonts.semiBold, fontSize: 14, color: chatColors.text, flex: 1 },
  pollStatus: { borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 },
  pollStatusActive: { backgroundColor: 'rgba(15,166,166,0.1)' },
  pollStatusEnded: { backgroundColor: chatColors.tagBg },
  pollStatusText: { fontFamily: chatFonts.semiBold, fontSize: 10 },
  pollMeta: { fontFamily: chatFonts.regular, fontSize: 11, color: chatColors.textMuted, marginTop: 2, marginBottom: 8 },
  pollOptionRow: { marginBottom: 8 },
  pollBar: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: 'rgba(15,166,166,0.12)', borderRadius: 8 },
  pollBarWinner: { backgroundColor: 'rgba(15,166,166,0.28)' },
  pollOptionContent: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 10, paddingVertical: 7 },
  pollOptionText: { fontFamily: chatFonts.regular, fontSize: 13, color: chatColors.text, flex: 1 },
  pollPct: { fontFamily: chatFonts.semiBold, fontSize: 12, color: chatColors.textMuted, marginLeft: 8 },
  menuOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center', padding: 32 },
  menuCard: { backgroundColor: chatColors.bg, borderRadius: 16, paddingVertical: 6, minWidth: 260, ...chatShadow },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingVertical: 13 },
  menuLabel: { fontFamily: chatFonts.medium, fontSize: 14, color: chatColors.text },
  renameCard: { backgroundColor: chatColors.bg, borderRadius: 16, padding: 18, width: '100%', ...chatShadow },
  renameTitle: { ...chatTypography.chatTitle, fontSize: 16, marginBottom: 10 },
  renameInput: { backgroundColor: chatColors.white, borderRadius: 12, borderWidth: 1, borderColor: chatColors.border, paddingHorizontal: 12, paddingVertical: 10, fontFamily: chatFonts.regular, fontSize: 14, color: chatColors.text },
  renameActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 14 },
  renameBtn: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 20 },
  renameSave: { backgroundColor: chatColors.teal },
  renameCancel: { fontFamily: chatFonts.semiBold, fontSize: 13, color: chatColors.textMuted },
  renameSaveLabel: { fontFamily: chatFonts.semiBold, fontSize: 13, color: chatColors.cream },
  sheetOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheetCard: { backgroundColor: chatColors.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18, maxHeight: '80%' },
  sheetHandle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: chatColors.border, marginBottom: 12 },
  sheetTitle: { ...chatTypography.chatTitle, fontSize: 17, marginBottom: 12 },
  permRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  permText: { flex: 1 },
  permLabel: { fontFamily: chatFonts.semiBold, fontSize: 14, color: chatColors.text },
  permDesc: { fontFamily: chatFonts.regular, fontSize: 12, color: chatColors.textMuted, marginTop: 1 },
  selectorList: { maxHeight: 240, marginTop: 8, borderTopWidth: 1, borderTopColor: chatColors.border },
  selectorRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  selectorName: { flex: 1, fontFamily: chatFonts.medium, fontSize: 14, color: chatColors.text },
  sheetActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 16 },
});
