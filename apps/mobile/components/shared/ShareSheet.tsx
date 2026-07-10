import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  TextInput,
  FlatList,
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
  { key: 'instagram', label: 'Instagram', icon: 'logo-instagram' as const, color: '#E1306C' },
  { key: 'messages', label: 'Messages', icon: 'chatbubble-ellipses-outline' as const, color: '#34C759' },
  { key: 'whatsapp', label: 'WhatsApp', icon: 'logo-whatsapp' as const, color: '#25D366' },
  { key: 'copy', label: 'Copy Link', icon: 'link-outline' as const, color: '#0FA6A6' },
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
        onShowToast(`Sent to ${username}`);
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

          <View style={styles.searchWrap}>
            <Ionicons name="search-outline" size={18} color="#9CA3AF" style={styles.searchIcon} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search Gluemates"
              placeholderTextColor="#9CA3AF"
              style={styles.searchInput}
            />
          </View>

          <Text style={styles.sectionHeader}>Suggested</Text>

          {peopleLoading ? (
            <Text style={styles.loadingText}>Loading…</Text>
          ) : (
            <FlatList
              data={people}
              keyExtractor={(item) => item.user_id}
              style={{ maxHeight: 220 }}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.personRow}
                  activeOpacity={0.7}
                  disabled={sending}
                  onPress={() => handleSendToUser(item.user_id, item.full_name?.trim() || item.username)}
                >
                  <Avatar uri={item.avatar_url} size={44} username={item.full_name?.trim() || item.username} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.personName} numberOfLines={1}>
                      {item.full_name?.trim() || item.username}
                    </Text>
                    <Text style={styles.personHint}>@{item.username} · Tap to send</Text>
                  </View>
                  <View style={styles.sendCircle}>
                    <Ionicons name="paper-plane" size={16} color="#0FA6A6" />
                  </View>
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <Text style={styles.emptyText}>
                  {isTyping ? 'No Gluemates found.' : 'No suggestions yet.'}
                </Text>
              }
            />
          )}

          <View style={styles.divider} />

          <Text style={styles.sectionHeader}>Share externally</Text>
          <View style={styles.externalRow}>
            {EXTERNAL_TARGETS.map((target) => (
              <TouchableOpacity
                key={target.key}
                style={styles.externalItem}
                activeOpacity={0.7}
                onPress={() => handleExternal(target.key)}
              >
                <View style={[styles.externalIconCircle, { backgroundColor: `${target.color}18` }]}>
                  <Ionicons name={target.icon} size={22} color={target.color} />
                </View>
                <Text style={styles.externalLabel}>{target.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
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
    paddingBottom: 36,
    maxHeight: '82%',
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
    marginBottom: 14,
    textAlign: 'center',
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginBottom: 16,
    paddingHorizontal: 12,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 11,
    fontSize: 14,
    color: '#111827',
    fontFamily: 'Inter_400Regular',
  },
  sectionHeader: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
    fontFamily: 'Inter_600SemiBold',
    marginBottom: 8,
  },
  loadingText: {
    fontSize: 13,
    color: '#9CA3AF',
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    paddingVertical: 20,
  },
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  personName: {
    fontSize: 14,
    color: '#111827',
    fontFamily: 'Inter_600SemiBold',
  },
  personHint: {
    fontSize: 11,
    color: '#9CA3AF',
    fontFamily: 'Inter_400Regular',
    marginTop: 1,
  },
  sendCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(15,166,166,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: 13,
    color: '#9CA3AF',
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    paddingVertical: 16,
  },
  divider: {
    height: 1,
    backgroundColor: '#E5E7EB',
    marginVertical: 16,
  },
  externalRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingTop: 4,
  },
  externalItem: {
    alignItems: 'center',
    gap: 8,
    minWidth: 64,
  },
  externalIconCircle: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
  },
  externalLabel: {
    fontSize: 11,
    color: '#374151',
    fontFamily: 'Inter_500Medium',
    textAlign: 'center',
  },
});
