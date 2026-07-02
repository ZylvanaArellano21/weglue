import { View, Text, TouchableOpacity, StyleSheet, FlatList } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from '../shared/Avatar';
import type { DirectMessageThread } from '../../services/chatService';

interface Props {
  messages: DirectMessageThread[];
  chatName: string;
  onJoin: () => void;
  joining?: boolean;
}

function formatTime(isoString: string): string {
  const date = new Date(isoString);
  const h = date.getHours();
  const m = date.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`;
}

/**
 * Read-only 15-message preview for non-members of a club group chat.
 * Replaces the input bar with a "Join the club" CTA.
 * No pagination — this is intentionally limited to 15 messages.
 */
export function NonMemberPreview({ messages, chatName, onJoin, joining = false }: Props) {
  const sorted = [...messages].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );

  return (
    <View style={styles.container}>
      {/* Preview header */}
      <View style={styles.previewBanner}>
        <Ionicons name="lock-closed-outline" size={14} color="#6B7280" />
        <Text style={styles.previewBannerText}>
          Showing {messages.length} recent message{messages.length !== 1 ? 's' : ''} — join to see more
        </Text>
      </View>

      {/* Messages list (read-only, no scroll-up past 15) */}
      <FlatList
        data={sorted}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        scrollEnabled
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Avatar uri={item.sender.avatar_url} size={32} username={item.sender.username} />
            <View style={styles.bubble}>
              <Text style={styles.sender}>{item.sender.username}</Text>
              {item.message_type === 'text' && (
                <Text style={styles.content}>{item.content}</Text>
              )}
              {item.message_type === 'image' && (
                <Text style={styles.contentMuted}>[Photo]</Text>
              )}
              {item.message_type === 'poll' && (
                <Text style={styles.contentMuted}>[Poll] Join to vote</Text>
              )}
              {item.message_type === 'file' && (
                <Text style={styles.contentMuted}>[File]</Text>
              )}
              <Text style={styles.time}>{formatTime(item.created_at)}</Text>
            </View>
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No messages yet</Text>
          </View>
        }
      />

      {/* Join CTA */}
      <View style={styles.ctaContainer}>
        <View style={styles.ctaCard}>
          <Ionicons name="people-outline" size={28} color="#0FA6A6" />
          <Text style={styles.ctaTitle}>Join {chatName}</Text>
          <Text style={styles.ctaBody}>
            Join the club to participate in discussions, vote on polls, and see the full message history.
          </Text>
          <TouchableOpacity
            style={[styles.joinBtn, joining && styles.joinBtnDisabled]}
            onPress={onJoin}
            disabled={joining}
            activeOpacity={0.8}
          >
            <Text style={styles.joinBtnLabel}>
              {joining ? 'Joining…' : 'Join the club'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FEFCF0',
  },
  previewBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#F9FAFB',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  previewBannerText: {
    fontFamily: 'Zain_400Regular',
    fontSize: 12,
    color: '#6B7280',
  },
  list: {
    padding: 12,
    flexGrow: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 12,
  },
  bubble: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  sender: {
    fontFamily: 'Zain_700Bold',
    fontSize: 12,
    color: '#0FA6A6',
    marginBottom: 3,
  },
  content: {
    fontFamily: 'Zain_400Regular',
    fontSize: 14,
    color: '#374151',
    lineHeight: 20,
  },
  contentMuted: {
    fontFamily: 'Zain_400Regular',
    fontSize: 14,
    color: '#9CA3AF',
    fontStyle: 'italic',
  },
  time: {
    fontFamily: 'Zain_400Regular',
    fontSize: 11,
    color: '#9CA3AF',
    marginTop: 4,
    alignSelf: 'flex-end',
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    fontFamily: 'Zain_400Regular',
    fontSize: 14,
    color: '#9CA3AF',
  },
  ctaContainer: {
    padding: 16,
    backgroundColor: '#FEFCF0',
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  ctaCard: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    gap: 8,
  },
  ctaTitle: {
    fontFamily: 'Zain_700Bold',
    fontSize: 17,
    color: '#1A1A1A',
    textAlign: 'center',
  },
  ctaBody: {
    fontFamily: 'Zain_400Regular',
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 20,
  },
  joinBtn: {
    backgroundColor: '#0FA6A6',
    borderRadius: 14,
    paddingHorizontal: 32,
    paddingVertical: 13,
    marginTop: 4,
    width: '100%',
    alignItems: 'center',
  },
  joinBtnDisabled: {
    opacity: 0.6,
  },
  joinBtnLabel: {
    fontFamily: 'Zain_700Bold',
    fontSize: 15,
    color: '#fff',
  },
});
