import { useCallback, useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@weglue/shared';
import { useChatDetails, useConversationMembership, useNonMemberPreview, useDirectMessages } from '../../../../hooks/useChats';
import { useClubChannels } from '../../../../hooks/useClubChannels';
import { useRealtimeDirectMessages, useRealtimeParticipants } from '../../../../hooks/useRealtimeMessages';
import { useQueryClient } from '@tanstack/react-query';
import { NonMemberPreview } from '../../../../components/chat/NonMemberPreview';
import { MessageBubble } from '../../../../components/chat/MessageBubble';
import { EventShareCard } from '../../../../components/chat/EventShareCard';
import { PostShareCard } from '../../../../components/chat/PostShareCard';
import { ChatInput } from '../../../../components/chat/ChatInput';
import { ConfirmationModal } from '../../../../components/chat/ConfirmationModal';
import {
  DateDivider,
  formatChatDateDivider,
  isSameChatDay,
} from '../../../../components/chat/DateDivider';
import { Avatar } from '../../../../components/shared/Avatar';
import { sendDirectMessage, markConversationRead } from '../../../../services/chatService';
import { getLastVisitedChannel } from '../../../../lib/chatNavigation';
import { supabase } from '../../../../lib/supabase';
import { chatColors, chatFonts, chatSizes, chatTypography } from '../../../../components/chat/chatTheme';

export default function ChatRoom() {
  const { chatId, ptype, pclub, pname, pavatar } = useLocalSearchParams<{
    chatId: string;
    ptype?: string;
    pclub?: string;
    pname?: string;
    pavatar?: string;
  }>();
  const router = useRouter();
  const { user } = useAuthStore();
  const userId = user?.id ?? '';
  const queryClient = useQueryClient();
  const listRef = useRef<FlatList>(null);

  const { data: chatDetails, isLoading: detailsLoading } = useChatDetails(chatId);
  const { data: isMember, refetch: refetchMembership } = useConversationMembership(chatId, userId);

  // The chat list already knows the conversation type/club/name, passed along
  // as route params. Using them here means the header renders instantly and
  // the channel/message queries start in parallel with the details fetch
  // instead of serially after it.
  const effectiveType = chatDetails?.type ?? (ptype || undefined);
  const effectiveClubId = chatDetails?.club_id ?? (pclub || undefined);
  const effectiveAvatarUrl = chatDetails?.avatar_url ?? (pavatar || null);

  const isDirect = effectiveType === 'direct';
  const isGroupWithChannels =
    effectiveType === 'club_group' || effectiveType === 'officer_chat';

  const handleJoined = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['conversationMember', chatId, userId] });
    queryClient.invalidateQueries({ queryKey: ['myChats', userId] });
    refetchMembership();
  }, [chatId, userId, queryClient, refetchMembership]);

  useRealtimeParticipants(chatId, userId, handleJoined);

  const { data: channels } = useClubChannels(
    isGroupWithChannels && effectiveClubId ? effectiveClubId : undefined,
  );

  // Fix 8: auto-navigate to last-visited or default channel, bypassing the channel picker
  useEffect(() => {
    if (!isGroupWithChannels || !isMember || !channels || channels.length === 0) return;
    const saved = getLastVisitedChannel(chatId);
    const target = (saved && channels.find((c) => c.id === saved))
      ? saved
      : (channels.find((c) => c.is_default) ?? channels[0])?.id;
    if (target) {
      router.replace(`/(tabs)/messages/${chatId}/${target}` as any);
    }
  }, [isGroupWithChannels, isMember, channels, chatId]);

  const { data: dmPage } = useDirectMessages(isDirect ? chatId : undefined);
  useRealtimeDirectMessages(isDirect ? chatId : undefined);

  const { data: previewMessages } = useNonMemberPreview(
    !isMember && isGroupWithChannels ? chatId : undefined,
  );

  const [confirmDelete, setConfirmDelete] = useState(false);

  async function handleLeave() {
    if (!chatDetails?.club_id) return;
    await supabase
      .from('club_members')
      .delete()
      .eq('club_id', chatDetails.club_id)
      .eq('user_id', userId);
    router.back();
  }

  const messages = [...(dmPage?.messages ?? [])].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );

  useEffect(() => {
    if (isDirect && messages.length > 0) {
      listRef.current?.scrollToEnd({ animated: false });
      // Mark as read when DM messages are visible
      void markConversationRead(chatId);
    }
  }, [isDirect, messages.length, chatId]);

  // Only block on a spinner when we know nothing at all about this chat
  // (e.g. opened from a deep link without preview params).
  if (!chatDetails && !effectiveType) {
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

  const displayName =
    chatDetails?.name ??
    (isDirect
      ? chatDetails?.participants.find((p) => p.user_id !== userId)?.username
      : undefined) ??
    (pname || 'Chat');

  // isMember === undefined means the membership check is still in flight;
  // fall through to the group header + inline spinner instead of flashing the
  // non-member preview at people who are members.
  if (isMember === false && isGroupWithChannels) {
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
        {/* Spinner while auto-redirect fires in useEffect; shows "No channels" if club has none */}
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

  const otherUser = chatDetails?.participants.find((p) => p.user_id !== userId);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={chatColors.text} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.headerCenter}
          onPress={() => router.push(`/(tabs)/messages/${chatId}/info` as any)}
          activeOpacity={0.7}
        >
          <Avatar
            uri={otherUser?.avatar_url}
            size={chatSizes.avatarHeader}
            username={otherUser?.username ?? displayName}
          />
          <Text style={styles.headerTitle} numberOfLines={1}>
            {otherUser?.username ?? displayName}
          </Text>
          <Ionicons name="chevron-forward" size={18} color={chatColors.textMuted} />
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.messageList}
          renderItem={({ item, index }) => {
            const prev = messages[index - 1];
            const showSenderInfo = !prev || prev.sender_id !== item.sender_id;
            const showDateDivider = !prev || !isSameChatDay(prev.created_at, item.created_at);
            const isOwn = item.sender_id === userId;
            return (
              <View>
                {showDateDivider && <DateDivider label={formatChatDateDivider(item.created_at)} />}
                <MessageBubble
                  id={item.id}
                  senderId={item.sender_id}
                  senderUsername={item.sender.username}
                  senderAvatarUrl={item.sender.avatar_url}
                  content={item.content}
                  attachmentUrl={item.attachment_url}
                  messageType={item.message_type}
                  createdAt={item.created_at}
                  isOwn={isOwn}
                  showSenderInfo={showSenderInfo}
                  cardSlot={
                    item.message_type === 'shared_event' && item.shared_event_id ? (
                      <EventShareCard eventId={item.shared_event_id} viewerUserId={userId} />
                    ) : item.message_type === 'shared_post' && item.shared_post_id ? (
                      <PostShareCard postId={item.shared_post_id} viewerUserId={userId} />
                    ) : undefined
                  }
                />
              </View>
            );
          }}
        />

        <ChatInput
          mode="direct"
          onSend={async ({ content, attachmentUrl, attachmentType }) => {
            await sendDirectMessage(chatId, userId, content, attachmentUrl, attachmentType);
            queryClient.invalidateQueries({ queryKey: ['directMessages', chatId] });
          }}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: chatColors.bg },
  flex: { flex: 1 },
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
  headerTitle: {
    ...chatTypography.chatTitle,
    flexShrink: 1,
  },
  channelList: { paddingVertical: 8 },
  channelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: chatColors.border,
  },
  channelHash: {
    fontFamily: chatFonts.semiBold,
    fontSize: 14,
    color: chatColors.teal,
  },
  channelName: {
    ...chatTypography.channelName,
    flex: 1,
  },
  leaveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginTop: 8,
  },
  leaveLabel: {
    fontFamily: chatFonts.regular,
    fontSize: 15,
    color: '#C62828',
  },
  messageList: { paddingVertical: 8, flexGrow: 1 },
  emptyText: {
    fontFamily: chatFonts.regular,
    fontSize: 14,
    color: chatColors.textMuted,
  },
});
