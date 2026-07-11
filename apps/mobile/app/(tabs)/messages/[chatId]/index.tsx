import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@weglue/shared';
import {
  useChatDetails,
  useConversationMembership,
  useNonMemberPreview,
} from '../../../../hooks/useChats';
import { useClubChannels } from '../../../../hooks/useClubChannels';
import { useRealtimeParticipants } from '../../../../hooks/useRealtimeMessages';
import { useQueryClient } from '@tanstack/react-query';
import { NonMemberPreview } from '../../../../components/chat/NonMemberPreview';
import { ConversationThread } from '../../../../components/chat/ConversationThread';
import { Avatar } from '../../../../components/shared/Avatar';
import { getOrCreateDirectChat } from '../../../../services/chatService';
import { createGroupChat } from '../../../../services/messagingService';
import { getLastVisitedChannel } from '../../../../lib/chatNavigation';
import { chatColors, chatFonts, chatSizes, chatTypography } from '../../../../components/chat/chatTheme';

// ─── Conversation screen ────────────────────────────────────────────────────
// direct + custom group threads render here; official club chats redirect to
// their channel thread. Draft modes (nothing saved until the first message):
//   chatId = "new"        + draftUserId/draftName/draftAvatar  → draft DM
//   chatId = "new-group"  + draftParticipantIds/draftNames/draftGroupName → draft group

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

  const isDraftDm = chatId === 'new';
  const isDraftGroup = chatId === 'new-group';
  const isDraft = isDraftDm || isDraftGroup;
  const realChatId = isDraft ? undefined : chatId;

  const { data: chatDetails, isLoading: detailsLoading } = useChatDetails(realChatId);
  const { data: isMember, refetch: refetchMembership } = useConversationMembership(realChatId, userId);

  const effectiveType = isDraftDm
    ? 'direct'
    : isDraftGroup
      ? 'group'
      : (chatDetails?.type ?? (ptype || undefined));
  const effectiveClubId = chatDetails?.club_id ?? (pclub || undefined);
  const effectiveAvatarUrl = isDraftDm
    ? (params.draftAvatar || null)
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

  const { data: channels } = useClubChannels(
    isGroupWithChannels && effectiveClubId ? effectiveClubId : undefined,
  );

  // Official chats auto-forward into the right channel thread.
  useEffect(() => {
    if (!isGroupWithChannels || !isMember || !channels || channels.length === 0) return;
    const ownChannels = channels.filter((c) => c.conversation_id === chatId);
    if (ownChannels.length === 0) return;
    const saved = getLastVisitedChannel(chatId);
    const target = (saved && ownChannels.find((c) => c.id === saved))
      ? saved
      : (ownChannels.find((c) => c.is_default) ?? ownChannels[0])?.id;
    if (target) {
      router.replace(`/(tabs)/messages/${chatId}/${target}` as any);
    }
  }, [isGroupWithChannels, isMember, channels, chatId]);

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

  const onFirstSend = useCallback(
    (conversationId: string) => {
      // Swap the draft route for the real conversation without stacking.
      router.replace(`/(tabs)/messages/${conversationId}` as any);
    },
    [router],
  );

  // ── Identity ──
  const displayName = isDraftDm
    ? (params.draftName || 'New message')
    : isDraftGroup
      ? (params.draftGroupName || params.draftNames || 'New group')
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
            if (effectiveClubId) router.push(`/(tabs)/clubs/${effectiveClubId}`);
          }}
        />
      </SafeAreaView>
    );
  }

  if (isGroupWithChannels) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={24} color={chatColors.text} />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Avatar uri={effectiveAvatarUrl} size={chatSizes.avatarHeader} username={displayName} />
            <Text style={styles.headerTitle} numberOfLines={1}>
              {displayName}
            </Text>
          </View>
        </View>
        {!channels || channels.length > 0 ? (
          <View style={styles.center}>
            <ActivityIndicator color={chatColors.teal} />
          </View>
        ) : (
          <View style={styles.center}>
            <Text style={styles.emptyText}>No channels yet</Text>
          </View>
        )}
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
          {/* DM identity: avatar and name both open the person's profile. */}
          <TouchableOpacity
            onPress={() => {
              if (isDirect && otherUserId) openProfile(otherUserId);
              else if (!isDraft) router.push(`/(tabs)/messages/${chatId}/info` as any);
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
          {!isDraft && (
            <TouchableOpacity
              onPress={() => router.push(`/(tabs)/messages/${chatId}/info` as any)}
              hitSlop={8}
              accessibilityLabel="Chat information"
            >
              <Ionicons name="chevron-forward" size={18} color={chatColors.textMuted} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <ConversationThread
        conversationId={materializedRef.current ?? realChatId}
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
});
