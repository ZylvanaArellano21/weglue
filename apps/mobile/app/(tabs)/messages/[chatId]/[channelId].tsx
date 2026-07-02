import { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@weglue/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useChannelMessages, useSendMessage, useDeleteMessage, useClubConversationId } from '../../../../hooks/useClubChannels';
import { useRealtimeMessages } from '../../../../hooks/useRealtimeChannel';
import { useChatDetails } from '../../../../hooks/useChats';
import { MessageBubble } from '../../../../components/chat/MessageBubble';
import { PollMessage } from '../../../../components/chat/PollMessage';
import { ChatInput } from '../../../../components/chat/ChatInput';
import { ConfirmationModal } from '../../../../components/chat/ConfirmationModal';
import { sendPoll } from '../../../../services/clubPollService';
import { useOfficerStore } from '../../../../store/officerStore';
import { supabase } from '../../../../lib/supabase';

export default function ChannelThread() {
  const { chatId, channelId, jumpToMessageId } =
    useLocalSearchParams<{ chatId: string; channelId: string; jumpToMessageId?: string }>();
  const router = useRouter();
  const { user } = useAuthStore();
  const userId = user?.id ?? '';
  const queryClient = useQueryClient();

  const { data: chatDetails } = useChatDetails(chatId);
  const clubId = chatDetails?.club_id ?? undefined;
  const { data: conversationId } = useClubConversationId(clubId);

  const isOfficer = useOfficerStore((s) => clubId ? s.isOfficer(clubId) : false);

  // Channel metadata from the channel list (we need is_restricted + name)
  const [channelName, setChannelName] = useState('');
  const [isRestricted, setIsRestricted] = useState(false);

  useEffect(() => {
    if (!channelId) return;
    supabase
      .from('conversation_channels')
      .select('name, is_restricted')
      .eq('id', channelId)
      .single()
      .then(({ data }) => {
        if (data) {
          setChannelName(data.name);
          setIsRestricted(data.is_restricted);
        }
      });
  }, [channelId]);

  // ── Messages ─────────────────────────────────────────────────────────────
  const { data: messagesPage, isLoading } = useChannelMessages(channelId);
  const { mutate: send } = useSendMessage(conversationId ?? '', channelId, userId);
  const { mutate: deleteMsg } = useDeleteMessage(channelId);

  // Realtime subscription
  useRealtimeMessages({
    channelId,
    conversationId: conversationId ?? '',
    onNewMessage: () => {
      queryClient.invalidateQueries({ queryKey: ['channelMessages', channelId] });
    },
  });

  // ── Jump-to-message ──────────────────────────────────────────────────────
  const flatListRef = useRef<FlatList>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

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

  // ── Delete confirmation ──────────────────────────────────────────────────
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const handleConfirmDelete = useCallback(() => {
    if (!deleteTarget) return;
    deleteMsg(deleteTarget);
    setDeleteTarget(null);
  }, [deleteTarget, deleteMsg]);

  // ── Send handlers ────────────────────────────────────────────────────────
  async function handleSend({ content, attachmentUrl, attachmentType }: {
    content: string;
    attachmentUrl?: string;
    attachmentType?: 'image' | 'file';
  }) {
    if (!conversationId) throw new Error('Conversation not ready');
    send({ content, attachment: attachmentUrl ? { url: attachmentUrl, type: attachmentType ?? 'file' } : undefined });
  }

  async function handleSendPoll(payload: {
    question: string;
    options: string[];
    allowMultiple: boolean;
    startAt?: string;
    endAt?: string;
  }) {
    if (!clubId) return;
    await sendPoll(userId, channelId, clubId, {
      question: payload.question,
      allow_multiple: payload.allowMultiple,
      options: payload.options,
      start_at: payload.startAt,
      end_at: payload.endAt,
    });
    queryClient.invalidateQueries({ queryKey: ['channelMessages', channelId] });
  }

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.center}>
          <ActivityIndicator color="#0FA6A6" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color="#1A1A1A" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerHash}>#</Text>
          <Text style={styles.headerTitle} numberOfLines={1}>{channelName}</Text>
          {isRestricted && (
            <View style={styles.officerBadge}>
              <Text style={styles.officerBadgeText}>Officers</Text>
            </View>
          )}
        </View>
        <TouchableOpacity
          onPress={() => router.push(`/(tabs)/messages/${chatId}/info`)}
          style={styles.infoBtn}
        >
          <Ionicons name="information-circle-outline" size={22} color="#0FA6A6" />
        </TouchableOpacity>
      </View>

      {/* Message thread */}
      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        onScrollToIndexFailed={() => {}}
        renderItem={({ item, index }) => {
          const prev = messages[index - 1];
          const showSenderInfo = !prev || prev.sender_id !== item.sender_id;
          const isOwn = item.sender_id === userId;
          const highlighted = item.id === highlightedId;

          return (
            <View style={highlighted && styles.highlightedRow}>
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
                      pollId={item.id}
                      messageId={item.id}
                      userId={userId}
                      isOwn={isOwn}
                    />
                  ) : undefined
                }
              />
            </View>
          );
        }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No messages in #{channelName} yet</Text>
          </View>
        }
      />

      {/* Input bar (respects is_restricted + isOfficer) */}
      <ChatInput
        isRestricted={isRestricted}
        isOfficer={isOfficer}
        onSend={handleSend}
        onSendPoll={isOfficer ? handleSendPoll : undefined}
      />

      {/* Delete confirmation */}
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
  container: { flex: 1, backgroundColor: '#FEFCF0' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  backBtn: { padding: 4, marginRight: 8 },
  headerCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  headerHash: {
    fontFamily: 'Zain_700Bold',
    fontSize: 18,
    color: '#6B7280',
  },
  headerTitle: {
    fontFamily: 'Zain_700Bold',
    fontSize: 17,
    color: '#1A1A1A',
    flex: 1,
  },
  officerBadge: {
    backgroundColor: '#FEF3C7',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  officerBadgeText: {
    fontFamily: 'Zain_700Bold',
    fontSize: 10,
    color: '#92400E',
  },
  infoBtn: { padding: 4 },
  list: { padding: 8, flexGrow: 1 },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontFamily: 'Zain_400Regular',
    fontSize: 14,
    color: '#9CA3AF',
  },
  highlightedRow: {
    backgroundColor: '#0FA6A615',
    borderRadius: 8,
  },
});
