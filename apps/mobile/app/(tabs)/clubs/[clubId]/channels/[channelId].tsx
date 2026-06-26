import { useState, useRef, useCallback } from 'react';
import { View, Text, TouchableOpacity, FlatList, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@weglue/shared';
import { useChannelMessages, useSendMessage } from '../../../../../hooks/useClubChannels';
import { useRealtimeMessages } from '../../../../../hooks/useRealtimeChannel';
import { useQueryClient } from '@tanstack/react-query';
import { Avatar } from '../../../../../components/shared/Avatar';
import { Skeleton } from '../../../../../components/shared/SkeletonLoader';
import type { MessageWithSender } from '../../../../../services/channelService';

export type ChannelChatParams = {
  clubId: string;
  channelId: string;
  channelName?: string;
};

function formatMessageTime(isoString: string): string {
  const date = new Date(isoString);
  const h = date.getHours();
  const m = date.getMinutes();
  const ampm = h >= 12 ? 'pm' : 'am';
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${ampm}`;
}

function MessageBubble({
  message,
  isOwn,
}: {
  message: MessageWithSender;
  isOwn: boolean;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: 8,
        marginBottom: 12,
        paddingHorizontal: 16,
        justifyContent: isOwn ? 'flex-end' : 'flex-start',
      }}
    >
      {!isOwn && (
        <Avatar uri={message.sender.avatar_url} size={32} username={message.sender.username} />
      )}
      <View style={{ maxWidth: '75%' }}>
        {!isOwn && (
          <Text style={{ fontSize: 12, color: '#6B7280', fontFamily: 'Inter_500Medium', marginBottom: 3 }}>
            {message.sender.username}
          </Text>
        )}
        <View
          style={{
            backgroundColor: isOwn ? '#0FA6A6' : '#fff',
            borderRadius: 16,
            borderBottomRightRadius: isOwn ? 4 : 16,
            borderBottomLeftRadius: isOwn ? 16 : 4,
            paddingHorizontal: 14,
            paddingVertical: 10,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 1 },
            shadowOpacity: 0.06,
            shadowRadius: 3,
            elevation: 1,
          }}
        >
          {message.content && (
            <Text
              style={{
                fontSize: 15,
                color: isOwn ? '#fff' : '#111827',
                fontFamily: 'Inter_400Regular',
                lineHeight: 22,
              }}
            >
              {message.content}
            </Text>
          )}
          {message.attachment_type === 'poll' && (
            <Text style={{ fontSize: 14, color: isOwn ? '#fff' : '#6B7280', fontFamily: 'Inter_500Medium' }}>
              📊 Poll
            </Text>
          )}
        </View>
        <Text
          style={{
            fontSize: 11,
            color: '#9CA3AF',
            fontFamily: 'Inter_400Regular',
            marginTop: 3,
            textAlign: isOwn ? 'right' : 'left',
          }}
        >
          {formatMessageTime(message.created_at)}
        </Text>
      </View>
    </View>
  );
}

export default function ChannelChatScreen() {
  const { clubId, channelId, channelName } = useLocalSearchParams<ChannelChatParams>();
  const { session } = useAuthStore();
  const userId = session?.user.id ?? '';
  const router = useRouter();
  const queryClient = useQueryClient();

  const [text, setText] = useState('');
  const listRef = useRef<FlatList>(null);

  const { data: messagesPage, isLoading } = useChannelMessages(channelId);
  const { mutate: send, isPending: sending } = useSendMessage(channelId!, clubId!, userId);

  const handleNewMessage = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['channelMessages', channelId] });
  }, [channelId]);

  useRealtimeMessages({
    channelId: channelId!,
    clubId: clubId!,
    onNewMessage: handleNewMessage,
  });

  function handleSend() {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setText('');
    send({ content: trimmed });
  }

  const messages = [...(messagesPage?.messages ?? [])].reverse();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#FEFCF0' }} edges={['top']}>
      {/* Header */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 16,
          paddingVertical: 12,
          borderBottomWidth: 1,
          borderBottomColor: '#F3F4F6',
          backgroundColor: '#FEFCF0',
        }}
      >
        <TouchableOpacity onPress={() => router.back()} activeOpacity={0.7} style={{ marginRight: 12 }}>
          <Ionicons name="chevron-back" size={26} color="#111827" />
        </TouchableOpacity>
        <Text style={{ fontSize: 17, fontWeight: '700', color: '#111827', fontFamily: 'Inter_700Bold' }}>
          # {channelName ?? 'channel'}
        </Text>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        {/* Messages list — Cursor will style individual bubbles */}
        {isLoading ? (
          <View style={{ flex: 1, padding: 16, gap: 12 }}>
            {[0, 1, 2].map((i) => (
              <View key={i} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-end' }}>
                <Skeleton width={32} height={32} borderRadius={16} />
                <Skeleton width={200} height={56} borderRadius={16} />
              </View>
            ))}
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <MessageBubble message={item} isOwn={item.sender_id === userId} />
            )}
            contentContainerStyle={{ paddingTop: 16, paddingBottom: 8 }}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 }}>
                <Text style={{ fontSize: 14, color: '#9CA3AF', fontFamily: 'Inter_400Regular' }}>
                  No messages yet. Say hi! 👋
                </Text>
              </View>
            }
          />
        )}

        {/* Input bar */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-end',
            paddingHorizontal: 12,
            paddingVertical: 10,
            borderTopWidth: 1,
            borderTopColor: '#F3F4F6',
            backgroundColor: '#FEFCF0',
            gap: 10,
          }}
        >
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Message..."
            placeholderTextColor="#9CA3AF"
            multiline
            maxLength={2000}
            style={{
              flex: 1,
              minHeight: 40,
              maxHeight: 120,
              backgroundColor: '#fff',
              borderRadius: 20,
              paddingHorizontal: 16,
              paddingVertical: 10,
              fontSize: 15,
              color: '#111827',
              fontFamily: 'Inter_400Regular',
              borderWidth: 1,
              borderColor: '#E5E7EB',
            }}
          />
          <TouchableOpacity
            onPress={handleSend}
            disabled={!text.trim() || sending}
            activeOpacity={0.8}
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              backgroundColor: text.trim() ? '#0FA6A6' : '#E5E7EB',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="send" size={18} color={text.trim() ? '#fff' : '#9CA3AF'} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
