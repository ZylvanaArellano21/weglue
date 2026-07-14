import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Modal,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@weglue/shared';
import {
  useChatDetails,
  useConversationMembership,
  useNonMemberPreview,
} from '../../../hooks/useChats';
import { useRealtimeParticipants } from '../../../hooks/useRealtimeMessages';
import { useQueryClient } from '@tanstack/react-query';
import { NonMemberPreview } from '../../../components/chat/NonMemberPreview';
import { ConversationThread } from '../../../components/chat/ConversationThread';
import { ConversationHub } from '../../../components/chat/ConversationHub';
import { Avatar } from '../../../components/shared/Avatar';
import { useOfficerStore } from '../../../store/officerStore';
import { getOrCreateDirectChat } from '../../../services/chatService';
import { createGroupChat } from '../../../services/messagingService';
import { createChannel, type HubThread } from '../../../services/channelService';
import { recordChannelVisit } from '../../../lib/chatNavigation';
import { chatColors, chatFonts, chatShadow, chatSizes, chatTypography } from '../../../components/chat/chatTheme';

// ─── Conversation screen ────────────────────────────────────────────────────
// direct + custom group threads render here; official club chats redirect to
// their channel thread. Draft modes (nothing saved until the first message):
//   chatId = "new" + draftUserId/draftName/draftAvatar                 → draft DM
//   chatId = "new" + draftParticipantIds/draftNames/draftGroupName     → draft group
//
// Both drafts use the SAME "new" segment and are told apart by their PARAMS,
// never by a second magic segment. A previous attempt keyed the group draft on
// chatId === "new-group", which can never match: app/chat/new-group.tsx is a
// static route with exactly that path, and static routes shadow the dynamic
// [chatId]. Navigating there just reopened the group PICKER (the selection form
// silently reset), so the draft group thread was unreachable, the atomic
// create_group_chat RPC was never wired up, and the first message failed with
// "Conversation not ready" → "Didn't send." on every try.

export default function ChatRoom() {
  const params = useLocalSearchParams<{
    chatId: string;
    ptype?: string;
    pclub?: string;
    pname?: string;
    pavatar?: string;
    jumpToMessageId?: string;
    draftUserId?: string;
    draftName?: string;
    draftAvatar?: string;
    draftParticipantIds?: string;
    draftNames?: string;
    draftGroupName?: string;
  }>();
  const { chatId, ptype, pclub, pname, pavatar, jumpToMessageId } = params;
  const router = useRouter();
  const { user } = useAuthStore();
  const userId = user?.id ?? '';
  const queryClient = useQueryClient();

  // Which draft this is, decided by the PARAMS (see the note above — a
  // "new-group" segment is unreachable). These never change while mounted, so
  // the header, avatar and conversation type stay rock-stable across the first
  // send.
  const isNewDraft = chatId === 'new';
  const hasGroupDraft = !!params.draftParticipantIds;
  const isDraftDmRoute = isNewDraft && !hasGroupDraft;
  const isDraftGroupRoute = isNewDraft && hasGroupDraft;
  const isDraftRoute = isDraftDmRoute || isDraftGroupRoute;

  // The id the first send materializes. Setting this HYDRATES THIS SAME SCREEN
  // — we deliberately do not navigate.
  //
  // The old code called router.replace('/chat/<newId>') here. replace does not
  // add a back-stack entry, which is why it looked safe, but [chatId] is a
  // dynamic segment: replacing "new" with a uuid is a different route, so the
  // draft screen UNMOUNTS and a brand-new chat screen MOUNTS, with a stack
  // transition. That remount is the slide/flash, the second header, and the
  // strip of the previous chat visible on the left (correction IMG_0073).
  // Holding the id in state instead keeps one screen mounted for the whole
  // first-message experience: same header, same input, same keyboard.
  const [resolvedChatId, setResolvedChatId] = useState<string | null>(null);

  const isDraftDm = isDraftDmRoute && !resolvedChatId;
  const isDraftGroup = isDraftGroupRoute && !resolvedChatId;
  const isDraft = isDraftDm || isDraftGroup;
  const realChatId = resolvedChatId ?? (isDraftRoute ? undefined : chatId);

  const { data: chatDetails, isLoading: detailsLoading } = useChatDetails(realChatId);
  const { data: isMember, refetch: refetchMembership } = useConversationMembership(realChatId, userId);

  // Derived from the ROUTE, not the draft flags, so they survive resolution
  // unchanged — a draft DM stays a DM the instant it becomes a real one, with
  // no re-render into a "loading conversation" state.
  const effectiveType = isDraftDmRoute
    ? 'direct'
    : isDraftGroupRoute
      ? 'group'
      : (chatDetails?.type ?? (ptype || undefined));
  const effectiveClubId = chatDetails?.club_id ?? (pclub || undefined);
  const effectiveAvatarUrl = isDraftDmRoute
    ? (params.draftAvatar || chatDetails?.avatar_url || null)
    : (chatDetails?.avatar_url ?? (pavatar || null));

  const isDirect = effectiveType === 'direct';
  const isCustomGroup = effectiveType === 'group';
  const isGroupWithChannels = effectiveType === 'club_group' || effectiveType === 'officer_chat';

  const handleJoined = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['conversationMember', realChatId, userId] });
    queryClient.invalidateQueries({ queryKey: ['myChats', userId] });
    refetchMembership();
  }, [realChatId, userId, queryClient, refetchMembership]);

  useRealtimeParticipants(realChatId, userId, handleJoined);

  // Officer state for the hub's Add Channel affordance.
  const isOfficer = useOfficerStore((s) =>
    effectiveClubId ? s.officerClubIds.includes(effectiveClubId) : false,
  );
  const [addChannelOpen, setAddChannelOpen] = useState(false);
  const [newChannelName, setNewChannelName] = useState('');
  const [creatingChannel, setCreatingChannel] = useState(false);

  const openThreadFromHub = useCallback(
    (t: HubThread) => {
      recordChannelVisit(chatId, t.id);
      router.push({
        pathname: `/chat/${chatId}/${t.id}`,
        params: { pname: chatDetails?.name ?? pname ?? '', pavatar: effectiveAvatarUrl ?? '' },
      } as any);
    },
    [chatId, router, effectiveAvatarUrl],
  );

  const submitNewChannel = useCallback(async () => {
    const name = newChannelName.trim();
    if (!name || creatingChannel) return;
    setCreatingChannel(true);
    try {
      await createChannel(chatId, name);
      queryClient.invalidateQueries({ queryKey: ['conversationHub', chatId, userId] });
      queryClient.invalidateQueries({ queryKey: ['clubChannels', effectiveClubId] });
      setAddChannelOpen(false);
      setNewChannelName('');
    } catch (e: any) {
      Alert.alert(
        'Could not create channel',
        e?.message?.includes('not_authorized')
          ? 'Only club officers can create channels.'
          : 'Please try again.',
      );
    } finally {
      setCreatingChannel(false);
    }
  }, [newChannelName, creatingChannel, chatId, queryClient, userId, effectiveClubId]);

  const { data: previewMessages } = useNonMemberPreview(
    !isDraft && isMember === false && isGroupWithChannels ? chatId : undefined,
  );

  // ── Draft materialization ──
  const draftParticipantIds = useMemo(
    () => (params.draftParticipantIds ? params.draftParticipantIds.split(',').filter(Boolean) : []),
    [params.draftParticipantIds],
  );
  const materializedRef = useRef<string | null>(null);

  const ensureConversation = useCallback(async () => {
    if (materializedRef.current) return materializedRef.current;
    if (isDraftDm && params.draftUserId) {
      const id = await getOrCreateDirectChat(params.draftUserId);
      materializedRef.current = id;
      return id;
    }
    if (isDraftGroup && draftParticipantIds.length > 0) {
      const id = await createGroupChat({
        name: params.draftGroupName || null,
        participantIds: draftParticipantIds,
      });
      materializedRef.current = id;
      return id;
    }
    throw new Error('Conversation not ready');
  }, [isDraftDm, isDraftGroup, params.draftUserId, params.draftGroupName, draftParticipantIds]);

  const createGroupWithFirstMessage = useCallback(
    async (text: string, clientTag: string) => {
      if (materializedRef.current) throw new Error('already-created');
      const id = await createGroupChat({
        name: params.draftGroupName || null,
        participantIds: draftParticipantIds,
        firstMessage: text,
        clientTag,
      });
      materializedRef.current = id;
      return id;
    },
    [params.draftGroupName, draftParticipantIds],
  );

  const onFirstSend = useCallback((conversationId: string) => {
    // NO NAVIGATION. Hydrate the mounted screen with the real conversation id.
    // Everything downstream (useChatDetails, useThread, realtime) is keyed off
    // realChatId, so they simply start resolving against the real conversation
    // while the header, message list and text input stay exactly where they
    // are. See the note on resolvedChatId above for why router.replace was
    // wrong here.
    setResolvedChatId((prev) => prev ?? conversationId);
  }, []);

  // ── Identity ──
  // Route-based, so the title never flickers when the draft resolves. For an
  // unnamed group the server-derived title (autoGroupTitle: "Camila, Jordan" /
  // "Camila, Jordan and 3 others", never including you) becomes canonical as
  // soon as chatDetails lands; until then we show the same names we already
  // know locally, so the two agree.
  const displayName = isDraftDmRoute
    ? (params.draftName || chatDetails?.name || 'New message')
    : isDraftGroupRoute
      ? (params.draftGroupName || chatDetails?.name || params.draftNames || 'New group')
      : (chatDetails?.name ?? (pname || (detailsLoading ? '' : 'Conversation')));

  const otherUser = isDirect && !isDraft
    ? chatDetails?.participants.find((p) => p.user_id !== userId)
    : undefined;
  const otherUserId = isDraftDm ? params.draftUserId : otherUser?.user_id;

  const openProfile = useCallback(
    (uid: string) => {
      router.push(`/profile/${uid}` as any);
    },
    [router],
  );

  if (!isDraft && !chatDetails && !effectiveType) {
    if (!detailsLoading) {
      return (
        <SafeAreaView style={styles.container} edges={['top']}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
              <Ionicons name="chevron-back" size={24} color={chatColors.text} />
            </TouchableOpacity>
          </View>
          <View style={styles.center}>
            <Text style={styles.emptyText}>Couldn't open this chat. Go back and try again.</Text>
          </View>
        </SafeAreaView>
      );
    }
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.center}>
          <ActivityIndicator color={chatColors.teal} />
        </View>
      </SafeAreaView>
    );
  }

  if (!isDraft && isMember === false && isGroupWithChannels) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={24} color={chatColors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {displayName}
          </Text>
          <View style={{ width: 36 }} />
        </View>
        <NonMemberPreview
          messages={previewMessages ?? []}
          chatName={displayName}
          onJoin={() => {
            if (effectiveClubId) router.push(`/club/${effectiveClubId}`);
          }}
        />
      </SafeAreaView>
    );
  }

  if (isGroupWithChannels) {
    // Full-screen conversation hub (Bug 1). The parent title + chevron open the
    // parent Conversation Info (Bug 2); there is intentionally no auto-redirect
    // into a channel — the user chooses Main chat or a hashtag from here.
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={24} color={chatColors.text} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.headerCenter}
            activeOpacity={0.7}
            onPress={() => router.push(`/chat/${chatId}/info` as any)}
            accessibilityLabel={`${displayName} information`}
          >
            <Avatar uri={effectiveAvatarUrl} size={chatSizes.avatarHeader} username={displayName} />
            <Text style={styles.headerTitle} numberOfLines={1}>
              {displayName}
            </Text>
            <Ionicons name="chevron-forward" size={18} color={chatColors.textMuted} />
          </TouchableOpacity>
        </View>

        <ConversationHub
          conversationId={chatId}
          userId={userId}
          isOfficer={isOfficer}
          onOpenThread={openThreadFromHub}
          onAddChannel={() => setAddChannelOpen(true)}
        />

        <Modal
          visible={addChannelOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setAddChannelOpen(false)}
        >
          <KeyboardAvoidingView
            style={styles.modalOverlay}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>New channel</Text>
              <View style={styles.channelInputRow}>
                <Text style={styles.hashPrefix}>#</Text>
                <TextInput
                  style={styles.channelInput}
                  value={newChannelName}
                  onChangeText={setNewChannelName}
                  placeholder="event-planning"
                  placeholderTextColor={chatColors.textMuted}
                  autoFocus
                  autoCapitalize="none"
                  autoCorrect={false}
                  maxLength={40}
                  onSubmitEditing={submitNewChannel}
                />
              </View>
              <View style={styles.modalActions}>
                <TouchableOpacity
                  onPress={() => {
                    setAddChannelOpen(false);
                    setNewChannelName('');
                  }}
                  style={styles.modalBtn}
                >
                  <Text style={styles.modalCancel}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={submitNewChannel}
                  style={[styles.modalBtn, styles.modalSave]}
                  disabled={creatingChannel || !newChannelName.trim()}
                >
                  <Text style={styles.modalSaveLabel}>
                    {creatingChannel ? 'Creating…' : 'Create'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      </SafeAreaView>
    );
  }

  const headerAvatarUri = isDirect ? (otherUser?.avatar_url ?? effectiveAvatarUrl) : effectiveAvatarUrl;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={chatColors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          {/* Header identity → Chat Info (Direct Message Info for DMs). The
              person's profile is reached from INSIDE the info screen. Draft DMs
              have no info screen yet, so they preview the person's profile. */}
          <TouchableOpacity
            onPress={() => {
              if (isDraftDm && otherUserId) openProfile(otherUserId);
              // realChatId, NOT chatId: a materialized draft keeps the route
              // param "new" (the screen hydrates in place instead of navigating),
              // so pushing chatId here opens Chat Info for a conversation that
              // does not exist and it spins forever.
              else if (!isDraft && realChatId) router.push(`/chat/${realChatId}/info` as any);
            }}
            disabled={isDraftGroup}
            style={styles.identityTap}
            activeOpacity={0.7}
          >
            <Avatar uri={headerAvatarUri} size={chatSizes.avatarHeader} username={displayName} />
            <Text style={styles.headerTitle} numberOfLines={1}>
              {displayName}
            </Text>
          </TouchableOpacity>
          {!isDraft && realChatId && (
            <TouchableOpacity
              onPress={() => router.push(`/chat/${realChatId}/info` as any)}
              hitSlop={8}
              accessibilityLabel="Chat information"
            >
              <Ionicons name="chevron-forward" size={18} color={chatColors.textMuted} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <ConversationThread
        conversationId={realChatId ?? materializedRef.current ?? undefined}
        channelId={null}
        currentUserId={userId}
        canModerate={isCustomGroup && chatDetails?.created_by === userId}
        allowPolls={isCustomGroup || isDraftGroup}
        ensureConversation={isDraft ? ensureConversation : undefined}
        createWithFirstMessage={isDraftGroup ? createGroupWithFirstMessage : undefined}
        onFirstSend={isDraft ? onFirstSend : undefined}
        onOpenProfile={openProfile}
        jumpToMessageId={jumpToMessageId}
        emptyLabel={isDraft ? 'Say hi — nothing is saved until you send.' : 'No messages yet'}
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
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: chatColors.border,
  },
  backBtn: { padding: 4, marginRight: 4 },
  headerCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  identityTap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 1,
  },
  headerTitle: {
    ...chatTypography.chatTitle,
    flexShrink: 1,
  },
  emptyText: {
    fontFamily: chatFonts.regular,
    fontSize: 14,
    color: chatColors.textMuted,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  modalCard: {
    backgroundColor: chatColors.bg,
    borderRadius: 16,
    padding: 18,
    width: '100%',
    ...chatShadow,
  },
  modalTitle: {
    ...chatTypography.chatTitle,
    fontSize: 16,
    marginBottom: 12,
  },
  channelInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: chatColors.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: chatColors.border,
    paddingHorizontal: 12,
  },
  hashPrefix: {
    fontFamily: chatFonts.semiBold,
    fontSize: 16,
    color: chatColors.textMuted,
    marginRight: 4,
  },
  channelInput: {
    flex: 1,
    paddingVertical: 10,
    fontFamily: chatFonts.regular,
    fontSize: 14,
    color: chatColors.text,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 14,
  },
  modalBtn: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 20,
  },
  modalSave: {
    backgroundColor: chatColors.teal,
  },
  modalCancel: {
    fontFamily: chatFonts.semiBold,
    fontSize: 13,
    color: chatColors.textMuted,
  },
  modalSaveLabel: {
    fontFamily: chatFonts.semiBold,
    fontSize: 13,
    color: chatColors.cream,
  },
});
