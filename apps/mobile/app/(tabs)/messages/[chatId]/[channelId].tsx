import { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@weglue/shared';
import { useQueryClient } from '@tanstack/react-query';
import {
  useChannelMessages,
  useSendMessage,
  useDeleteMessage,
} from '../../../../hooks/useClubChannels';
import { useRealtimeMessages } from '../../../../hooks/useRealtimeChannel';
import { useChatDetails } from '../../../../hooks/useChats';
import { MessageBubble } from '../../../../components/chat/MessageBubble';
import { PollMessage } from '../../../../components/chat/PollMessage';
import { ChatInput } from '../../../../components/chat/ChatInput';
import { ConfirmationModal } from '../../../../components/chat/ConfirmationModal';
import { ChannelDrawer } from '../../../../components/chat/ChannelDrawer';
import {
  DateDivider,
  formatChatDateDivider,
  isSameChatDay,
} from '../../../../components/chat/DateDivider';
import { Avatar } from '../../../../components/shared/Avatar';
import { sendPoll } from '../../../../services/clubPollService';
import { useOfficerStore } from '../../../../store/officerStore';
import { supabase } from '../../../../lib/supabase';
import { recordChannelVisit } from '../../../../lib/chatNavigation';
import { chatColors, chatFonts, chatSizes, chatTypography } from '../../../../components/chat/chatTheme';

export default function ChannelThread() {
  const { chatId, channelId, jumpToMessageId, pname, pavatar } =
    useLocalSearchParams<{
      chatId: string;
      channelId: string;
      jumpToMessageId?: string;
      pname?: string;
      pavatar?: string;
    }>();
  const router = useRouter();
  const { user } = useAuthStore();
  const userId = user?.id ?? '';
  const queryClient = useQueryClient();

  const { data: chatDetails } = useChatDetails(chatId);
  const clubId = chatDetails?.club_id ?? undefined;
  // The route's chatId IS the conversation. The old useClubConversationId
  // lookup always returned the club_group conversation, so messages sent in
  // the OFFICER chat were written to the member conversation — mixed chats.
  const conversationId = chatId;

  const isOfficer = useOfficerStore((s) => (clubId ? s.officerClubIds.includes(clubId) : false));

  const [channelName, setChannelName] = useState('');
  const [isRestricted, setIsRestricted] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeChannelId, setActiveChannelId] = useState(channelId ?? '');

  // Fix 8: record which channel is active so index.tsx can skip the picker next visit
  useEffect(() => {
    if (activeChannelId) recordChannelVisit(chatId, activeChannelId);
  }, [activeChannelId, chatId]);

  useEffect(() => {
    if (!activeChannelId) return;
    supabase
      .from('conversation_channels')
      .select('name, is_restricted, conversation_id')
      .eq('id', activeChannelId)
      .single()
      .then(async ({ data }) => {
        if (!data) return;
        // Defensive: a stale/foreign channel id (e.g. recorded before the
        // member/officer channel separation fix) must never render another
        // conversation's thread — fall back to this conversation's own
        // default channel.
        if (data.conversation_id && data.conversation_id !== chatId) {
          const { data: own } = await supabase
            .from('conversation_channels')
            .select('id, name, is_restricted, is_default, display_order')
            .eq('conversation_id', chatId)
            .order('display_order', { ascending: true });
          const fallback = (own ?? []).find((c: any) => c.is_default) ?? (own ?? [])[0];
          if (fallback) {
            setActiveChannelId(fallback.id);
            setChannelName(fallback.name);
            setIsRestricted(fallback.is_restricted);
          }
          return;
        }
        setChannelName(data.name);
        setIsRestricted(data.is_restricted);
      });
  }, [activeChannelId, chatId]);

  useEffect(() => {
    if (channelId) setActiveChannelId(channelId);
  }, [channelId]);

  const { data: messagesPage, isLoading } = useChannelMessages(activeChannelId);
  const { mutate: send } = useSendMessage(conversationId, activeChannelId, userId);
  const { mutate: deleteMsg } = useDeleteMessage(activeChannelId);

  useRealtimeMessages({
    channelId: activeChannelId,
    conversationId,
    onNewMessage: () => {
      queryClient.invalidateQueries({ queryKey: ['channelMessages', activeChannelId] });
    },
  });

  const flatListRef = useRef<FlatList>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const messages = [...(messagesPage?.messages ?? [])].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );

  useEffect(() => {
    if (!jumpToMessageId || messages.length === 0) return;
    const idx = messages.findIndex((m) => m.id === jumpToMessageId);
    if (idx !== -1) {
      setHighlightedId(jumpToMessageId);
      flatListRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.5 });
      setTimeout(() => setHighlightedId(null), 2000);
    }
  }, [jumpToMessageId, messages.length]);

  const handleConfirmDelete = useCallback(() => {
    if (!deleteTarget) return;
    deleteMsg(deleteTarget);
    setDeleteTarget(null);
  }, [deleteTarget, deleteMsg]);

  async function handleSend({
    content,
    attachmentUrl,
    attachmentType,
  }: {
    content: string;
    attachmentUrl?: string;
    attachmentType?: 'image' | 'file';
  }) {
    if (!conversationId) throw new Error('Conversation not ready');
    send({
      content,
      attachment: attachmentUrl ? { url: attachmentUrl, type: attachmentType ?? 'file' } : undefined,
    });
  }

  async function handleSendPoll(payload: {
    question: string;
    options: string[];
    allowMultiple: boolean;
    startAt?: string;
    endAt?: string;
  }) {
    if (!clubId) return;
    await sendPoll(userId, activeChannelId, clubId, {
      question: payload.question,
      allow_multiple: payload.allowMultiple,
      options: payload.options,
      start_at: payload.startAt,
      end_at: payload.endAt,
    });
    queryClient.invalidateQueries({ queryKey: ['channelMessages', activeChannelId] });
  }

  function handleSelectChannel(id: string, name: string) {
    setActiveChannelId(id);
    setChannelName(name);
    router.setParams({ channelId: id } as any);
  }

  function handleAddChannel() {
    Alert.alert('Add Channel', 'Channel creation is handled by club officers.');
  }

  // Route preview params render the header instantly on direct navigation
  // from a club profile or the chat list (details load in parallel).
  const displayName = chatDetails?.name ?? (pname || 'Group Chat');
  const headerAvatarUrl = chatDetails?.avatar_url ?? (pavatar || null);

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.center}>
          <ActivityIndicator color={chatColors.teal} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={chatColors.text} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.headerCenter}
          onPress={() => router.push(`/(tabs)/messages/${chatId}/info?channelId=${activeChannelId}` as any)}
          activeOpacity={0.7}
        >
          <Avatar uri={headerAvatarUrl} size={chatSizes.avatarHeader} username={displayName} />
          <Text style={styles.headerTitle} numberOfLines={1}>
            {displayName}
          </Text>
          <Ionicons name="chevron-forward" size={18} color={chatColors.textMuted} />
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.channelBar} onPress={() => setDrawerOpen(true)} activeOpacity={0.8}>
        <Ionicons name="menu" size={18} color={chatColors.text} />
        <Text style={styles.channelLabel}>#{channelName}</Text>
      </TouchableOpacity>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          onScrollToIndexFailed={() => {}}
          renderItem={({ item, index }) => {
            const prev = messages[index - 1];
            const showSenderInfo = !prev || prev.sender_id !== item.sender_id;
            const showDateDivider = !prev || !isSameChatDay(prev.created_at, item.created_at);
            const isOwn = item.sender_id === userId;
            const highlighted = item.id === highlightedId;

            return (
              <View>
                {showDateDivider && <DateDivider label={formatChatDateDivider(item.created_at)} />}
                <View style={highlighted ? styles.highlightedRow : undefined}>
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
                    onLongPress={(msgId) => {
                      if (isOwn || isOfficer) setDeleteTarget(msgId);
                    }}
                    pollSlot={
                      item.message_type === 'poll' ? (
                        <PollMessage
                          pollId={item.poll_id ?? ''}
                          messageId={item.id}
                          userId={userId}
                          isOwn={isOwn}
                        />
                      ) : undefined
                    }
                  />
                </View>
              </View>
            );
          }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No messages in #{channelName} yet</Text>
            </View>
          }
        />

        <ChatInput
          mode="group"
          isRestricted={isRestricted}
          isOfficer={isOfficer}
          onSend={handleSend}
          onSendPoll={isOfficer ? handleSendPoll : undefined}
        />
      </KeyboardAvoidingView>

      {clubId && (
        <ChannelDrawer
          visible={drawerOpen}
          clubId={clubId}
          conversationId={chatId}
          activeChannelId={activeChannelId}
          isOfficer={isOfficer}
          onSelectChannel={handleSelectChannel}
          onClose={() => setDrawerOpen(false)}
          onAddChannel={handleAddChannel}
        />
      )}

      <ConfirmationModal
        visible={!!deleteTarget}
        title="Delete message?"
        message="This will permanently remove this message for everyone."
        confirmLabel="Delete"
        destructive
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
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
    backgroundColor: chatColors.bg,
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
  channelBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: chatColors.border,
    backgroundColor: chatColors.bg,
  },
  channelLabel: {
    ...chatTypography.channelName,
  },
  list: { paddingVertical: 8, flexGrow: 1 },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontFamily: chatFonts.regular,
    fontSize: 14,
    color: chatColors.textMuted,
  },
  highlightedRow: {
    backgroundColor: 'rgba(15,166,166,0.08)',
    borderRadius: 8,
  },
});
