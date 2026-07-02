import { useCallback, useState } from 'react';
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
import { useChatDetails, useConversationMembership, useNonMemberPreview } from '../../../../hooks/useChats';
import { useClubChannels } from '../../../../hooks/useClubChannels';
import { useRealtimeDirectMessages, useRealtimeParticipants } from '../../../../hooks/useRealtimeMessages';
import { useDirectMessages, useSendDirectMessage } from '../../../../hooks/useChats';
import { useQueryClient } from '@tanstack/react-query';
import { NonMemberPreview } from '../../../../components/chat/NonMemberPreview';
import { MessageBubble } from '../../../../components/chat/MessageBubble';
import { PollMessage } from '../../../../components/chat/PollMessage';
import { ChatInput } from '../../../../components/chat/ChatInput';
import { ConfirmationModal } from '../../../../components/chat/ConfirmationModal';
import { sendDirectMessage } from '../../../../services/chatService';
import { sendPoll } from '../../../../services/clubPollService';
import { supabase } from '../../../../lib/supabase';

export default function ChatRoom() {
  const { chatId } = useLocalSearchParams<{ chatId: string }>();
  const router = useRouter();
  const { user } = useAuthStore();
  const userId = user?.id ?? '';
  const queryClient = useQueryClient();

  const { data: chatDetails, isLoading: detailsLoading } = useChatDetails(chatId);
  const { data: isMember, refetch: refetchMembership } = useConversationMembership(chatId, userId);

  const isDirect = chatDetails?.type === 'direct';
  const isGroupWithChannels = chatDetails?.type === 'club_group' || chatDetails?.type === 'officer_chat';

  // ── Membership upgrade: when user joins club, update immediately ─────────
  const handleJoined = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['conversationMember', chatId, userId] });
    queryClient.invalidateQueries({ queryKey: ['myChats', userId] });
    refetchMembership();
  }, [chatId, userId, queryClient, refetchMembership]);

  useRealtimeParticipants(chatId, userId, handleJoined);

  // ── For group chats: redirect to channels ─────────────────────────────────
  const { data: channels } = useClubChannels(
    isGroupWithChannels && chatDetails?.club_id ? chatDetails.club_id : undefined,
  );

  // ── For DMs: show full thread ─────────────────────────────────────────────
  const { data: dmPage } = useDirectMessages(isDirect ? chatId : undefined);
  const { mutate: sendDM } = useSendDirectMessage(chatId, userId);

  useRealtimeDirectMessages(isDirect ? chatId : undefined);

  // ── Non-member preview ────────────────────────────────────────────────────
  const { data: previewMessages } = useNonMemberPreview(
    !isMember && isGroupWithChannels ? chatId : undefined,
  );

  const [confirmLeave, setConfirmLeave] = useState(false);

  async function handleLeave() {
    if (!chatDetails?.club_id) return;
    await supabase
      .from('club_members')
      .delete()
      .eq('club_id', chatDetails.club_id)
      .eq('user_id', userId);
    router.back();
  }

  async function handleDelete() {
    // Delete a DM conversation (removes all messages visible to this user)
    await supabase.from('conversation_participants').delete()
      .eq('conversation_id', chatId)
      .eq('user_id', userId);
    router.back();
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (detailsLoading || !chatDetails) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.center}>
          <ActivityIndicator color="#0FA6A6" />
        </View>
      </SafeAreaView>
    );
  }

  const displayName = chatDetails.name
    ?? (isDirect
      ? chatDetails.participants.find((p) => p.user_id !== userId)?.username
      : 'Chat')
    ?? 'Chat';

  // ── Non-member group chat preview ─────────────────────────────────────────
  if (!isMember && isGroupWithChannels) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={24} color="#1A1A1A" />
          </TouchableOpacity>
          <Text style={styles.headerTitle} numberOfLines={1}>{displayName}</Text>
          <View style={{ width: 36 }} />
        </View>
        <NonMemberPreview
          messages={previewMessages ?? []}
          chatName={displayName}
          onJoin={() => router.push(`/(tabs)/clubs/${chatDetails.club_id}`)}
        />
      </SafeAreaView>
    );
  }

  // ── Group chat: show channel list ─────────────────────────────────────────
  if (isGroupWithChannels) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={24} color="#1A1A1A" />
          </TouchableOpacity>
          <Text style={styles.headerTitle} numberOfLines={1}>{displayName}</Text>
          <TouchableOpacity
            onPress={() => router.push(`/(tabs)/messages/${chatId}/info`)}
            style={styles.infoBtn}
          >
            <Ionicons name="information-circle-outline" size={24} color="#0FA6A6" />
          </TouchableOpacity>
        </View>

        <FlatList
          data={channels ?? []}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.channelList}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.channelRow}
              onPress={() =>
                router.push(`/(tabs)/messages/${chatId}/${item.id}`)
              }
              activeOpacity={0.7}
            >
              <View style={styles.channelIcon}>
                <Text style={styles.channelHashtag}>#</Text>
              </View>
              <View style={styles.channelInfo}>
                <Text style={styles.channelName}>{item.name}</Text>
                {item.is_restricted && (
                  <View style={styles.officersTag}>
                    <Text style={styles.officersTagText}>Officers only</Text>
                  </View>
                )}
              </View>
              <Ionicons name="chevron-forward" size={18} color="#D1D5DB" />
            </TouchableOpacity>
          )}
          ListFooterComponent={
            <TouchableOpacity
              style={styles.leaveRow}
              onPress={() => setConfirmLeave(true)}
            >
              <Ionicons name="exit-outline" size={18} color="#EF4444" />
              <Text style={styles.leaveLabel}>Leave group</Text>
            </TouchableOpacity>
          }
        />

        <ConfirmationModal
          visible={confirmLeave}
          title="Leave group?"
          message={`Are you sure you want to leave ${displayName}? You'll lose access to all messages.`}
          confirmLabel="Leave"
          destructive
          onConfirm={handleLeave}
          onCancel={() => setConfirmLeave(false)}
        />
      </SafeAreaView>
    );
  }

  // ── Direct message thread ─────────────────────────────────────────────────
  const messages = [...(dmPage?.messages ?? [])].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );

  const otherUser = chatDetails.participants.find((p) => p.user_id !== userId);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color="#1A1A1A" />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.headerUser}
          onPress={() => otherUser && router.push(`/profile/${otherUser.user_id}`)}
          activeOpacity={0.7}
        >
          <Text style={styles.headerTitle} numberOfLines={1}>
            {otherUser?.username ?? displayName}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.infoBtn}
          onPress={() => setConfirmLeave(true)}
        >
          <Ionicons name="trash-outline" size={20} color="#EF4444" />
        </TouchableOpacity>
      </View>

      <FlatList
        data={messages}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.messageList}
        renderItem={({ item, index }) => {
          const prev = messages[index - 1];
          const showSenderInfo = !prev || prev.sender_id !== item.sender_id;
          const isOwn = item.sender_id === userId;
          return (
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
              pollSlot={
                item.message_type === 'poll' && item.poll_id ? (
                  <PollMessage
                    pollId={item.poll_id}
                    messageId={item.id}
                    userId={userId}
                    isOwn={isOwn}
                  />
                ) : undefined
              }
            />
          );
        }}
      />

      <ChatInput
        onSend={async ({ content, attachmentUrl, attachmentType }) => {
          await sendDirectMessage(chatId, userId, content, attachmentUrl, attachmentType);
          queryClient.invalidateQueries({ queryKey: ['directMessages', chatId] });
        }}
      />

      <ConfirmationModal
        visible={confirmLeave}
        title="Delete conversation?"
        message="This will remove you from this conversation. The other person can still see their messages."
        confirmLabel="Delete"
        destructive
        onConfirm={handleDelete}
        onCancel={() => setConfirmLeave(false)}
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
  headerUser: { flex: 1 },
  headerTitle: {
    fontFamily: 'Zain_700Bold',
    fontSize: 17,
    color: '#1A1A1A',
    flex: 1,
  },
  infoBtn: { padding: 4 },
  channelList: { paddingVertical: 8 },
  channelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  channelIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  channelHashtag: {
    fontFamily: 'Zain_700Bold',
    fontSize: 18,
    color: '#6B7280',
  },
  channelInfo: { flex: 1, gap: 3 },
  channelName: {
    fontFamily: 'Zain_700Bold',
    fontSize: 15,
    color: '#1A1A1A',
  },
  officersTag: {
    backgroundColor: '#FEF3C7',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    alignSelf: 'flex-start',
  },
  officersTagText: {
    fontFamily: 'Zain_700Bold',
    fontSize: 10,
    color: '#92400E',
  },
  leaveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  leaveLabel: {
    fontFamily: 'Zain_400Regular',
    fontSize: 15,
    color: '#EF4444',
  },
  messageList: { padding: 8, flexGrow: 1 },
});
