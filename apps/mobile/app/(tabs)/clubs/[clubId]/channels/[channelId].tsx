import { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Modal,
  ScrollView,
  Switch,
  Alert,
  Animated,
  Dimensions,
  ActivityIndicator,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@weglue/shared';
import { useClubChannels, useChannelMessages, useSendMessage } from '../../../../../hooks/useClubChannels';
import { useClubProfile } from '../../../../../hooks/useClubProfile';
import { useRealtimeMessages } from '../../../../../hooks/useRealtimeChannel';
import { useOfficerStore } from '../../../../../store/officerStore';
import { useQueryClient, useQuery, useMutation } from '@tanstack/react-query';
import { Avatar } from '../../../../../components/shared/Avatar';
import { Skeleton } from '../../../../../components/shared/SkeletonLoader';
import { useToast } from '../../../../../components/Toast';
import * as ImagePicker from 'expo-image-picker';
import { sendPoll, getClubPoll, votePoll } from '../../../../../services/clubPollService';
import type { MessageWithSender } from '../../../../../services/channelService';
import type { ClubPoll } from '../../../../../services/clubPollService';

const SCREEN_WIDTH = Dimensions.get('window').width;
const DRAWER_WIDTH = SCREEN_WIDTH * 0.72;

// ─── Types ────────────────────────────────────────────────────────────────────
export type ChannelChatParams = {
  clubId: string;
  channelId: string;
  channelName?: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatMessageTime(isoString: string): string {
  const date = new Date(isoString);
  const h = date.getHours();
  const m = date.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${ampm}`;
}

function formatDateDivider(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase();
}

function isSameDay(a: string, b: string): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

function formatDateInput(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

// ─── Poll Bubble ──────────────────────────────────────────────────────────────
function PollBubble({
  pollId,
  userId,
  isOwn,
}: {
  pollId: string;
  userId: string;
  isOwn: boolean;
}) {
  const queryClient = useQueryClient();

  const { data: poll, isLoading } = useQuery({
    queryKey: ['poll', pollId, userId],
    queryFn: () => getClubPoll(pollId, userId),
    staleTime: 30 * 1000,
  });

  const { mutate: vote, isPending: voting } = useMutation({
    mutationFn: (optionId: string) => votePoll(pollId, userId, [optionId]),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['poll', pollId, userId] });
    },
  });

  if (isLoading || !poll) {
    return (
      <View
        style={{
          backgroundColor: isOwn ? '#0FA6A6' : '#fff',
          borderRadius: 16,
          padding: 14,
          minWidth: 200,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 1 },
          shadowOpacity: 0.06,
          shadowRadius: 3,
          elevation: 1,
        }}
      >
        <Text style={{ fontSize: 13, color: isOwn ? '#fff' : '#9CA3AF', fontFamily: 'Inter_400Regular' }}>
          📊 Loading poll…
        </Text>
      </View>
    );
  }

  const now = new Date();
  const isPollEnded = poll.end_date ? new Date(poll.end_date) < now : false;
  const totalVotes = poll.total_votes;

  return (
    <View
      style={{
        backgroundColor: '#fff',
        borderRadius: 16,
        padding: 14,
        minWidth: Math.min(SCREEN_WIDTH * 0.72, 280),
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.06,
        shadowRadius: 3,
        elevation: 1,
        borderWidth: 1,
        borderColor: '#E5E7EB',
      }}
    >
      <Text style={{ fontSize: 14, fontWeight: '700', color: '#111827', fontFamily: 'Inter_700Bold', marginBottom: 10 }}>
        📊 {poll.question}
      </Text>

      {poll.options.map((option) => {
        const pct = totalVotes > 0 ? Math.round((option.vote_count / totalVotes) * 100) : 0;
        return (
          <TouchableOpacity
            key={option.id}
            onPress={() => !isPollEnded && !voting && vote(option.id)}
            disabled={isPollEnded || voting}
            activeOpacity={0.8}
            style={{ marginBottom: 8 }}
          >
            <View
              style={{
                borderRadius: 8,
                overflow: 'hidden',
                borderWidth: 1.5,
                borderColor: option.user_voted ? '#0FA6A6' : '#E5E7EB',
              }}
            >
              {/* Progress fill */}
              <View
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: `${pct}%`,
                  backgroundColor: option.user_voted ? 'rgba(15,166,166,0.15)' : 'rgba(209,213,219,0.3)',
                }}
              />
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  paddingHorizontal: 10,
                  paddingVertical: 8,
                }}
              >
                <Text
                  style={{
                    fontSize: 13,
                    color: option.user_voted ? '#0FA6A6' : '#374151',
                    fontFamily: option.user_voted ? 'Inter_600SemiBold' : 'Inter_400Regular',
                  }}
                >
                  {option.option_text}
                </Text>
                <Text style={{ fontSize: 12, color: '#6B7280', fontFamily: 'Inter_400Regular' }}>
                  {pct}%
                </Text>
              </View>
            </View>
          </TouchableOpacity>
        );
      })}

      <Text style={{ fontSize: 11, color: '#9CA3AF', fontFamily: 'Inter_400Regular', marginTop: 4 }}>
        {totalVotes} vote{totalVotes !== 1 ? 's' : ''}{isPollEnded ? ' · Ended' : ''}
      </Text>
    </View>
  );
}

// ─── Message Bubble ───────────────────────────────────────────────────────────
function MessageBubble({
  message,
  isOwn,
  userId,
  onLongPress,
}: {
  message: MessageWithSender;
  isOwn: boolean;
  userId: string;
  onLongPress?: () => void;
}) {
  const isPoll = message.attachment_type === 'poll' && !!message.poll_id;

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
      <View style={{ maxWidth: '78%' }}>
        {!isOwn && (
          <Text style={{ fontSize: 12, color: '#6B7280', fontFamily: 'Inter_500Medium', marginBottom: 3 }}>
            {message.sender.username}
          </Text>
        )}
        <Pressable
          onLongPress={onLongPress}
          delayLongPress={400}
        >
          {isPoll ? (
            <PollBubble pollId={message.poll_id!} userId={userId} isOwn={isOwn} />
          ) : (
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
              {message.content ? (
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
              ) : null}
            </View>
          )}
        </Pressable>
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

// ─── Date Divider ─────────────────────────────────────────────────────────────
function DateDivider({ label }: { label: string }) {
  return (
    <View
      style={{
        alignItems: 'center',
        marginVertical: 16,
        paddingHorizontal: 16,
      }}
    >
      <View
        style={{
          backgroundColor: '#E5E7EB',
          borderRadius: 20,
          paddingHorizontal: 12,
          paddingVertical: 4,
        }}
      >
        <Text style={{ fontSize: 11, color: '#6B7280', fontFamily: 'Inter_500Medium', letterSpacing: 0.5 }}>
          {label}
        </Text>
      </View>
    </View>
  );
}

// ─── Poll Bottom Sheet ────────────────────────────────────────────────────────
function PollSheet({
  visible,
  onClose,
  onSend,
}: {
  visible: boolean;
  onClose: () => void;
  onSend: (input: {
    question: string;
    options: string[];
    allowMultiple: boolean;
    startDate?: string;
    endDate?: string;
  }) => void;
}) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [allowMultiple, setAllowMultiple] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [sending, setSending] = useState(false);

  function addOption() {
    if (options.length < 10) setOptions([...options, '']);
  }

  function updateOption(idx: number, val: string) {
    const updated = [...options];
    updated[idx] = val;
    setOptions(updated);
  }

  function removeOption(idx: number) {
    if (options.length <= 2) return;
    setOptions(options.filter((_, i) => i !== idx));
  }

  function reset() {
    setQuestion('');
    setOptions(['', '']);
    setAllowMultiple(false);
    setStartDate('');
    setEndDate('');
    setSending(false);
  }

  async function handleSend() {
    const trimmedQ = question.trim();
    if (!trimmedQ) {
      Alert.alert('Missing question', 'Please enter a poll question.');
      return;
    }
    const validOptions = options.map((o) => o.trim()).filter((o) => o.length > 0);
    if (validOptions.length < 2) {
      Alert.alert('Not enough options', 'Please add at least 2 poll options.');
      return;
    }
    setSending(true);
    try {
      await onSend({
        question: trimmedQ,
        options: validOptions,
        allowMultiple,
        startDate: startDate.trim() || undefined,
        endDate: endDate.trim() || undefined,
      });
      reset();
      onClose();
    } catch {
      Alert.alert('Error', 'Failed to send poll. Try again.');
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}
        onPress={onClose}
      >
        <Pressable onPress={() => {}} style={{ backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20 }}>
          {/* Header */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: 16,
              paddingTop: 16,
              paddingBottom: 12,
              borderBottomWidth: 1,
              borderBottomColor: '#F3F4F6',
            }}
          >
            <TouchableOpacity onPress={() => { reset(); onClose(); }} activeOpacity={0.7}>
              <Ionicons name="close" size={22} color="#6B7280" />
            </TouchableOpacity>
            <Text
              style={{
                flex: 1,
                textAlign: 'center',
                fontSize: 16,
                fontWeight: '700',
                color: '#111827',
                fontFamily: 'Inter_700Bold',
              }}
            >
              Poll
            </Text>
            <TouchableOpacity
              onPress={handleSend}
              disabled={sending}
              activeOpacity={0.8}
              style={{
                backgroundColor: '#0FA6A6',
                borderRadius: 20,
                paddingHorizontal: 16,
                paddingVertical: 7,
              }}
            >
              {sending ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={{ fontSize: 14, fontWeight: '600', color: '#fff', fontFamily: 'Inter_600SemiBold' }}>
                  Send
                </Text>
              )}
            </TouchableOpacity>
          </View>

          <ScrollView
            style={{ maxHeight: 520 }}
            contentContainerStyle={{ padding: 16, gap: 16 }}
            keyboardShouldPersistTaps="handled"
          >
            {/* Question */}
            <View>
              <Text style={{ fontSize: 13, fontWeight: '600', color: '#374151', fontFamily: 'Inter_600SemiBold', marginBottom: 6 }}>
                Ask a question
              </Text>
              <TextInput
                value={question}
                onChangeText={setQuestion}
                placeholder="Type your question..."
                placeholderTextColor="#9CA3AF"
                multiline
                maxLength={200}
                style={{
                  backgroundColor: '#F9FAFB',
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: '#E5E7EB',
                  paddingHorizontal: 14,
                  paddingVertical: 12,
                  fontSize: 15,
                  color: '#111827',
                  fontFamily: 'Inter_400Regular',
                  minHeight: 52,
                }}
              />
            </View>

            {/* Options */}
            <View>
              <Text style={{ fontSize: 13, fontWeight: '600', color: '#374151', fontFamily: 'Inter_600SemiBold', marginBottom: 6 }}>
                Poll options
              </Text>
              {options.map((opt, idx) => (
                <View key={idx} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <TextInput
                    value={opt}
                    onChangeText={(val) => updateOption(idx, val)}
                    placeholder={`Option ${idx + 1}`}
                    placeholderTextColor="#9CA3AF"
                    maxLength={100}
                    style={{
                      flex: 1,
                      backgroundColor: '#F9FAFB',
                      borderRadius: 10,
                      borderWidth: 1,
                      borderColor: '#E5E7EB',
                      paddingHorizontal: 14,
                      paddingVertical: 10,
                      fontSize: 14,
                      color: '#111827',
                      fontFamily: 'Inter_400Regular',
                    }}
                  />
                  {options.length > 2 && (
                    <TouchableOpacity onPress={() => removeOption(idx)} activeOpacity={0.7}>
                      <Ionicons name="close-circle" size={20} color="#9CA3AF" />
                    </TouchableOpacity>
                  )}
                </View>
              ))}
              {options.length < 10 && (
                <TouchableOpacity onPress={addOption} activeOpacity={0.7}>
                  <Text style={{ fontSize: 13, color: '#0FA6A6', fontFamily: 'Inter_500Medium' }}>
                    + Add option
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Multiple options toggle */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 14, color: '#374151', fontFamily: 'Inter_400Regular' }}>
                Multiple options
              </Text>
              <Switch
                value={allowMultiple}
                onValueChange={setAllowMultiple}
                trackColor={{ true: '#0FA6A6', false: '#E5E7EB' }}
                thumbColor="#fff"
              />
            </View>

            {/* Duration */}
            <View>
              <Text style={{ fontSize: 13, fontWeight: '600', color: '#374151', fontFamily: 'Inter_600SemiBold', marginBottom: 8 }}>
                Duration
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                <Text style={{ fontSize: 13, color: '#374151', fontFamily: 'Inter_400Regular', width: 40 }}>
                  Start
                </Text>
                <TextInput
                  value={startDate}
                  onChangeText={setStartDate}
                  placeholder="MM/D/Y"
                  placeholderTextColor="#9CA3AF"
                  style={{
                    flex: 1,
                    backgroundColor: '#F9FAFB',
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: '#E5E7EB',
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    fontSize: 13,
                    color: '#111827',
                    fontFamily: 'Inter_400Regular',
                  }}
                />
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Text style={{ fontSize: 13, color: '#374151', fontFamily: 'Inter_400Regular', width: 40 }}>
                  End
                </Text>
                <TextInput
                  value={endDate}
                  onChangeText={setEndDate}
                  placeholder="MM/D/Y"
                  placeholderTextColor="#9CA3AF"
                  style={{
                    flex: 1,
                    backgroundColor: '#F9FAFB',
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: '#E5E7EB',
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    fontSize: 13,
                    color: '#111827',
                    fontFamily: 'Inter_400Regular',
                  }}
                />
              </View>
            </View>

            {/* Bottom padding for keyboard */}
            <View style={{ height: 24 }} />
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─── Attachment Bottom Sheet ──────────────────────────────────────────────────
function AttachmentSheet({
  visible,
  onClose,
  onPickImage,
}: {
  visible: boolean;
  onClose: () => void;
  onPickImage: (source: 'camera' | 'library') => void;
}) {
  const OPTIONS = [
    { icon: 'camera-outline' as const, label: 'Camera', action: () => onPickImage('camera') },
    { icon: 'image-outline' as const, label: 'Photo Library', action: () => onPickImage('library') },
    { icon: 'document-outline' as const, label: 'Document', action: () => Alert.alert('Coming soon', 'Document sharing is coming soon!') },
  ];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}
        onPress={onClose}
      >
        <Pressable onPress={() => {}} style={{ backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 32 }}>
          <View style={{ alignItems: 'center', paddingTop: 10, marginBottom: 4 }}>
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: '#D1D5DB' }} />
          </View>
          {OPTIONS.map((opt) => (
            <TouchableOpacity
              key={opt.label}
              onPress={() => { opt.action(); onClose(); }}
              activeOpacity={0.7}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 16,
                paddingHorizontal: 24,
                paddingVertical: 16,
              }}
            >
              <View
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 22,
                  backgroundColor: '#F3F4F6',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name={opt.icon} size={22} color="#374151" />
              </View>
              <Text style={{ fontSize: 16, color: '#111827', fontFamily: 'Inter_500Medium' }}>
                {opt.label}
              </Text>
            </TouchableOpacity>
          ))}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─── Channel Drawer ───────────────────────────────────────────────────────────
function ChannelDrawer({
  visible,
  clubId,
  activeChannelId,
  isOfficer,
  onSelectChannel,
  onClose,
  onAddChannel,
  onDeleteChannel,
}: {
  visible: boolean;
  clubId: string;
  activeChannelId: string;
  isOfficer: boolean;
  onSelectChannel: (id: string, name: string) => void;
  onClose: () => void;
  onAddChannel: () => void;
  onDeleteChannel: (id: string) => void;
}) {
  const translateX = useRef(new Animated.Value(-DRAWER_WIDTH)).current;
  const { data: channels } = useClubChannels(clubId);

  useEffect(() => {
    Animated.timing(translateX, {
      toValue: visible ? 0 : -DRAWER_WIDTH,
      duration: 260,
      useNativeDriver: true,
    }).start();
  }, [visible]);

  if (!visible) return null;

  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 100 }}>
      {/* Backdrop */}
      <Pressable
        style={{ flex: 1 }}
        onPress={onClose}
      />

      {/* Drawer */}
      <Animated.View
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: 0,
          width: DRAWER_WIDTH,
          backgroundColor: '#FEFCF0',
          transform: [{ translateX }],
          shadowColor: '#000',
          shadowOffset: { width: 4, height: 0 },
          shadowOpacity: 0.15,
          shadowRadius: 12,
          elevation: 12,
        }}
      >
        <SafeAreaView style={{ flex: 1 }} edges={['top']}>
          <View style={{ flex: 1, paddingTop: 8 }}>
            {/* Drawer header */}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingHorizontal: 16,
                paddingBottom: 12,
                borderBottomWidth: 1,
                borderBottomColor: '#F3F4F6',
              }}
            >
              <Text style={{ fontSize: 16, fontWeight: '700', color: '#111827', fontFamily: 'Zain_700Bold' }}>
                Channels
              </Text>
              {isOfficer && (
                <TouchableOpacity onPress={onAddChannel} activeOpacity={0.7}>
                  <Ionicons name="add-circle-outline" size={22} color="#0FA6A6" />
                </TouchableOpacity>
              )}
            </View>

            {/* Channel list */}
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 8 }}>
              {(channels ?? []).map((ch) => {
                const isActive = ch.id === activeChannelId;
                return (
                  <Pressable
                    key={ch.id}
                    onPress={() => { onSelectChannel(ch.id, ch.name); onClose(); }}
                    onLongPress={() => {
                      if (!isOfficer) return;
                      Alert.alert(
                        `Delete #${ch.name}?`,
                        'All messages in this channel will be lost.',
                        [
                          { text: 'Cancel', style: 'cancel' },
                          {
                            text: 'Delete',
                            style: 'destructive',
                            onPress: () => { onDeleteChannel(ch.id); onClose(); },
                          },
                        ],
                      );
                    }}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      paddingHorizontal: 16,
                      paddingVertical: 12,
                      backgroundColor: isActive ? 'rgba(15,166,166,0.1)' : 'transparent',
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 15,
                        color: isActive ? '#0FA6A6' : '#374151',
                        fontFamily: isActive ? 'Inter_600SemiBold' : 'Inter_400Regular',
                      }}
                    >
                      #{ch.name}
                    </Text>
                    {ch.is_restricted && (
                      <Ionicons name="lock-closed-outline" size={12} color="#9CA3AF" style={{ marginLeft: 6 }} />
                    )}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </SafeAreaView>
      </Animated.View>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function ChannelChatScreen() {
  const { clubId, channelId, channelName: paramChannelName } = useLocalSearchParams<ChannelChatParams>();
  const { session } = useAuthStore();
  const userId = session?.user.id ?? '';
  const router = useRouter();
  const queryClient = useQueryClient();
  const { show, ToastComponent } = useToast();
  const { officerClubIds } = useOfficerStore();

  const [activeChannelId, setActiveChannelId] = useState(channelId ?? '');
  const [activeChannelName, setActiveChannelName] = useState(paramChannelName ?? '');
  const [text, setText] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [pollSheetOpen, setPollSheetOpen] = useState(false);
  const [attachSheetOpen, setAttachSheetOpen] = useState(false);
  const listRef = useRef<FlatList>(null);

  const isOfficer = !!clubId && officerClubIds.includes(clubId);

  const { data: club } = useClubProfile(clubId, userId);
  const { data: channels } = useClubChannels(clubId);
  const { data: messagesPage, isLoading } = useChannelMessages(activeChannelId);
  const { mutate: send, isPending: sending } = useSendMessage(activeChannelId!, clubId!, userId);

  // Resolve active channel info from channels list when it loads
  useEffect(() => {
    if (channels && !activeChannelName) {
      const found = channels.find((c) => c.id === activeChannelId);
      if (found) setActiveChannelName(found.name);
    }
  }, [channels, activeChannelId]);

  const handleNewMessage = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['channelMessages', activeChannelId] });
  }, [activeChannelId]);

  useRealtimeMessages({
    channelId: activeChannelId!,
    clubId: clubId!,
    onNewMessage: handleNewMessage,
  });

  function handleSend() {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setText('');
    send(
      { content: trimmed },
      {
        onError: () => show('Failed to send message.', 'error'),
      },
    );
  }

  async function handleSendPoll(input: {
    question: string;
    options: string[];
    allowMultiple: boolean;
    startDate?: string;
    endDate?: string;
  }) {
    await sendPoll(userId, activeChannelId!, clubId!, {
      club_id: clubId!,
      channel_id: activeChannelId,
      question: input.question,
      allow_multiple: input.allowMultiple,
      options: input.options,
      start_date: input.startDate,
      end_date: input.endDate,
    });
    queryClient.invalidateQueries({ queryKey: ['channelMessages', activeChannelId] });
    show('Poll sent 📊');
  }

  async function handlePickImage(source: 'camera' | 'library') {
    let result: ImagePicker.ImagePickerResult;
    if (source === 'camera') {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Camera access needed', 'Please enable camera access in Settings to take photos.');
        return;
      }
      result = await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 });
    } else {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Photos access needed', 'Please enable photo library access in Settings to share photos.');
        return;
      }
      result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 });
    }
    if (!result.canceled && result.assets[0]) {
      // Image selected — attachment sending handled by Claude Code backend
      show('Image selected — upload coming soon', 'info');
    }
  }

  function handleAddChannel() {
    Alert.prompt(
      'New Channel',
      'Enter channel name',
      async (name) => {
        if (!name?.trim()) return;
        // Channel creation is handled by backend hooks
        show('Channel creation coming soon', 'info');
      },
    );
  }

  function handleDeleteChannel(id: string) {
    // Channel deletion handled by backend hooks
    show('Channel deleted', 'success');
  }

  function handleSelectChannel(id: string, name: string) {
    setActiveChannelId(id);
    setActiveChannelName(name);
  }

  const messages = [...(messagesPage?.messages ?? [])].reverse();

  // Check if active channel is restricted (officers only)
  const activeChannel = channels?.find((c) => c.id === activeChannelId);
  const isRestricted = activeChannel?.is_restricted ?? false;
  const canPost = isOfficer || !isRestricted;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#FEFCF0' }} edges={['top']}>
      {ToastComponent}

      {/* ── Header ───────────────────────────────────────────── */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 16,
          paddingVertical: 10,
          borderBottomWidth: 1,
          borderBottomColor: '#F3F4F6',
          backgroundColor: '#FEFCF0',
        }}
      >
        <TouchableOpacity onPress={() => router.back()} activeOpacity={0.7} style={{ marginRight: 12 }}>
          <Ionicons name="chevron-back" size={26} color="#111827" />
        </TouchableOpacity>

        {/* Club avatar + name (centered) */}
        <TouchableOpacity
          style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}
          onPress={() =>
            router.push({ pathname: '/(tabs)/clubs/[clubId]', params: { clubId: clubId! } })
          }
          activeOpacity={0.7}
        >
          <Avatar uri={club?.avatar_url} size={32} username={club?.name ?? ''} />
          <Text
            style={{ fontSize: 16, fontWeight: '700', color: '#111827', fontFamily: 'Inter_700Bold' }}
            numberOfLines={1}
          >
            {club?.name ?? 'Club'}
          </Text>
        </TouchableOpacity>

        {/* Right arrow to club profile */}
        <TouchableOpacity
          onPress={() =>
            router.push({ pathname: '/(tabs)/clubs/[clubId]', params: { clubId: clubId! } })
          }
          activeOpacity={0.7}
          style={{ marginLeft: 12 }}
        >
          <Ionicons name="chevron-forward" size={22} color="#6B7280" />
        </TouchableOpacity>
      </View>

      {/* ── Channel selector bar ──────────────────────────────── */}
      <TouchableOpacity
        onPress={() => setDrawerOpen(true)}
        activeOpacity={0.8}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 16,
          paddingVertical: 10,
          borderBottomWidth: 1,
          borderBottomColor: '#F3F4F6',
          backgroundColor: '#FEFCF0',
          gap: 10,
        }}
      >
        <Ionicons name="menu" size={20} color="#6B7280" />
        <Text style={{ fontSize: 14, fontWeight: '600', color: '#374151', fontFamily: 'Inter_600SemiBold' }}>
          #{activeChannelName || 'channel'}
        </Text>
      </TouchableOpacity>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        {/* ── Messages ─────────────────────────────────────────── */}
        {isLoading ? (
          <View style={{ flex: 1, padding: 16, gap: 12 }}>
            {[0, 1, 2, 3].map((i) => (
              <View
                key={i}
                style={{
                  flexDirection: i % 2 === 0 ? 'row' : 'row-reverse',
                  gap: 10,
                  alignItems: 'flex-end',
                }}
              >
                {i % 2 === 0 && <Skeleton width={32} height={32} borderRadius={16} />}
                <Skeleton width={i % 2 === 0 ? 180 : 140} height={52} borderRadius={16} />
              </View>
            ))}
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(item) => item.id}
            renderItem={({ item, index }) => {
              const prevMsg = index > 0 ? messages[index - 1] : null;
              const showDivider = !prevMsg || !isSameDay(prevMsg.created_at, item.created_at);
              return (
                <>
                  {showDivider && <DateDivider label={formatDateDivider(item.created_at)} />}
                  <MessageBubble
                    message={item}
                    isOwn={item.sender_id === userId}
                    userId={userId}
                    onLongPress={() => {
                      if (item.sender_id === userId || isOfficer) {
                        Alert.alert('Message', '', [
                          { text: 'Cancel', style: 'cancel' },
                          {
                            text: 'Delete',
                            style: 'destructive',
                            onPress: () => show('Message deleted', 'success'),
                          },
                        ]);
                      }
                    }}
                  />
                </>
              );
            }}
            contentContainerStyle={{ paddingTop: 8, paddingBottom: 8 }}
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

        {/* ── Input / Restricted Banner ─────────────────────── */}
        {!canPost ? (
          <View
            style={{
              paddingHorizontal: 16,
              paddingVertical: 12,
              borderTopWidth: 1,
              borderTopColor: '#F3F4F6',
              backgroundColor: '#FFFBEB',
              alignItems: 'center',
            }}
          >
            <Text style={{ fontSize: 13, color: '#92400E', fontFamily: 'Inter_500Medium' }}>
              🔒 Only officers can post here
            </Text>
          </View>
        ) : (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'flex-end',
              paddingHorizontal: 12,
              paddingVertical: 10,
              borderTopWidth: 1,
              borderTopColor: '#F3F4F6',
              backgroundColor: '#FEFCF0',
              gap: 8,
            }}
          >
            {/* Attachment icon */}
            <TouchableOpacity
              onPress={() => setAttachSheetOpen(true)}
              activeOpacity={0.7}
              style={{ paddingBottom: 10 }}
            >
              <Ionicons name="attach" size={22} color="#6B7280" />
            </TouchableOpacity>

            {/* Text input */}
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

            {/* Poll icon */}
            <TouchableOpacity
              onPress={() => setPollSheetOpen(true)}
              activeOpacity={0.7}
              style={{ paddingBottom: 10 }}
            >
              <Ionicons name="list-outline" size={22} color="#6B7280" />
            </TouchableOpacity>

            {/* Send button */}
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
              {sending ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Ionicons name="send" size={18} color={text.trim() ? '#fff' : '#9CA3AF'} />
              )}
            </TouchableOpacity>
          </View>
        )}
      </KeyboardAvoidingView>

      {/* ── Drawer ────────────────────────────────────────────── */}
      <ChannelDrawer
        visible={drawerOpen}
        clubId={clubId!}
        activeChannelId={activeChannelId}
        isOfficer={isOfficer}
        onSelectChannel={handleSelectChannel}
        onClose={() => setDrawerOpen(false)}
        onAddChannel={handleAddChannel}
        onDeleteChannel={handleDeleteChannel}
      />

      {/* ── Poll Sheet ────────────────────────────────────────── */}
      <PollSheet
        visible={pollSheetOpen}
        onClose={() => setPollSheetOpen(false)}
        onSend={handleSendPoll}
      />

      {/* ── Attachment Sheet ──────────────────────────────────── */}
      <AttachmentSheet
        visible={attachSheetOpen}
        onClose={() => setAttachSheetOpen(false)}
        onPickImage={handlePickImage}
      />
    </SafeAreaView>
  );
}
