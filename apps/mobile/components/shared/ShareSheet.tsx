import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  TextInput,
  FlatList,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Avatar } from './Avatar';
import {
  getSuggestedPeople,
  searchChats,
  getOrCreateDirectChat,
  sendEventShareMessage,
  sendPostShareMessage,
} from '../../services/chatService';
import {
  getEventShareUrl,
  getPostShareUrl,
  copyLinkToClipboard,
  shareToWhatsApp,
  shareToMessages,
  shareToInstagram,
} from '../../lib/share';
import type { ToastType } from '../Toast';

export interface ShareSheetProps {
  visible: boolean;
  onClose: () => void;
  userId: string | undefined;
  contentType: 'event' | 'post';
  contentId: string;
  onShowToast: (message: string, type?: ToastType) => void;
}

const EXTERNAL_TARGETS = [
  { key: 'instagram', label: 'Instagram', icon: 'logo-instagram' as const },
  { key: 'messages', label: 'Messages', icon: 'chatbox-ellipses-outline' as const },
  { key: 'whatsapp', label: 'WhatsApp', icon: 'logo-whatsapp' as const },
  { key: 'copy', label: 'Copy Link', icon: 'link-outline' as const },
];

export function ShareSheet({ visible, onClose, userId, contentType, contentId, onShowToast }: ShareSheetProps) {
  const [query, setQuery] = useState('');
  const isTyping = query.trim().length > 0;

  const { data: suggested, isLoading: suggestLoading } = useQuery({
    queryKey: ['suggestedPeople', userId],
    queryFn: () => getSuggestedPeople(userId!),
    enabled: visible && !!userId && !isTyping,
    staleTime: 5 * 60 * 1000,
  });

  const { data: searchResults, isLoading: searchLoading } = useQuery({
    queryKey: ['chatSearch', userId, query],
    queryFn: () => searchChats(userId!, query),
    enabled: visible && !!userId && isTyping,
    staleTime: 30 * 1000,
  });

  const people = isTyping ? searchResults?.people ?? [] : suggested ?? [];
  const peopleLoading = isTyping ? searchLoading : suggestLoading;

  const shareUrl = contentType === 'event' ? getEventShareUrl(contentId) : getPostShareUrl(contentId);
  const shareText =
    contentType === 'event'
      ? `Check out this event on We Glue: ${shareUrl}`
      : `Check out this post on We Glue: ${shareUrl}`;

  const { mutate: sendToUser, isPending: sending } = useMutation({
    mutationFn: async (otherUserId: string) => {
      const conversationId = await getOrCreateDirectChat(otherUserId);
      if (contentType === 'event') {
        await sendEventShareMessage(conversationId, userId!, contentId);
      } else {
        await sendPostShareMessage(conversationId, userId!, contentId);
      }
    },
  });

  function handleSendToUser(otherUserId: string, username: string) {
    if (!userId || sending) return;
    sendToUser(otherUserId, {
      onSuccess: () => {
        onShowToast(`Sent to @${username}`);
        handleClose();
      },
      onError: () => onShowToast('Failed to send. Try again.', 'error'),
    });
  }

  async function handleExternal(target: (typeof EXTERNAL_TARGETS)[number]['key']) {
    if (target === 'copy') {
      const ok = await copyLinkToClipboard(shareUrl);
      onShowToast(ok ? 'Link copied!' : 'Failed to copy link.', ok ? 'success' : 'error');
    } else if (target === 'whatsapp') {
      const ok = await shareToWhatsApp(shareText);
      if (!ok) onShowToast('WhatsApp isn’t installed.', 'error');
    } else if (target === 'messages') {
      const ok = await shareToMessages(shareText);
      if (!ok) onShowToast('Couldn’t open Messages.', 'error');
    } else if (target === 'instagram') {
      const { copied } = await shareToInstagram(shareUrl);
      onShowToast(
        copied ? 'Link copied — paste it into Instagram' : 'Failed to copy link.',
        copied ? 'success' : 'error',
      );
    }
    handleClose();
  }

  function handleClose() {
    setQuery('');
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={handleClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.title}>Share</Text>

          {/* External targets */}
          <View style={styles.externalRow}>
            {EXTERNAL_TARGETS.map((target) => (
              <TouchableOpacity
                key={target.key}
                style={styles.externalItem}
                activeOpacity={0.7}
                onPress={() => handleExternal(target.key)}
              >
                <View style={styles.externalIconCircle}>
                  <Ionicons name={target.icon} size={22} color="#0FA6A6" />
                </View>
                <Text style={styles.externalLabel}>{target.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.sectionHeader}>Send to</Text>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search We Glue users"
            placeholderTextColor="#9CA3AF"
            style={styles.searchInput}
          />

          {peopleLoading ? (
            <ActivityIndicator color="#0FA6A6" style={{ marginTop: 16 }} />
          ) : (
            <FlatList
              data={people}
              keyExtractor={(item) => item.user_id}
              style={{ maxHeight: 260 }}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.personRow}
                  activeOpacity={0.7}
                  disabled={sending}
                  onPress={() => handleSendToUser(item.user_id, item.username)}
                >
                  <Avatar uri={item.avatar_url} size={40} username={item.username} />
                  <Text style={styles.personName} numberOfLines={1}>
                    @{item.username}
                  </Text>
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <Text style={styles.emptyText}>
                  {isTyping ? 'No people found.' : 'No suggestions yet.'}
                </Text>
              }
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    backgroundColor: '#FEFCF0',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 32,
    maxHeight: '80%',
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D1D5DB',
    marginBottom: 12,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111827',
    fontFamily: 'Inter_700Bold',
    marginBottom: 16,
    textAlign: 'center',
  },
  externalRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 20,
  },
  externalItem: {
    alignItems: 'center',
    gap: 6,
  },
  externalIconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(15,166,166,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  externalLabel: {
    fontSize: 11,
    color: '#374151',
    fontFamily: 'Inter_500Medium',
  },
  sectionHeader: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
    fontFamily: 'Inter_600SemiBold',
    marginBottom: 8,
  },
  searchInput: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: '#111827',
    fontFamily: 'Inter_400Regular',
    marginBottom: 8,
  },
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
  },
  personName: {
    fontSize: 14,
    color: '#111827',
    fontFamily: 'Inter_500Medium',
    flex: 1,
  },
  emptyText: {
    fontSize: 13,
    color: '#9CA3AF',
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    paddingVertical: 16,
  },
});
