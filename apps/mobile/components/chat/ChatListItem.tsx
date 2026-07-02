import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Avatar } from '../shared/Avatar';
import type { ChatPreview } from '../../services/chatService';

interface Props {
  chat: ChatPreview;
  currentUserId: string;
  onPress: () => void;
}

function formatTime(isoString: string | null): string {
  if (!isoString) return '';
  const date = new Date(isoString);
  const now = new Date();
  const diffDays = Math.floor(
    (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (diffDays === 0) {
    const h = date.getHours();
    const m = date.getMinutes();
    const ampm = h >= 12 ? 'PM' : 'AM';
    return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`;
  }
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return date.toLocaleDateString('en-US', { weekday: 'short' });
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function lastMessagePreview(chat: ChatPreview): string {
  if (!chat.last_message) return 'No messages yet';
  const prefix = chat.last_sender_username ? `${chat.last_sender_username}: ` : '';
  const text = chat.last_message.length > 60
    ? chat.last_message.slice(0, 60) + '…'
    : chat.last_message;
  return prefix + text;
}

export function ChatListItem({ chat, currentUserId: _currentUserId, onPress }: Props) {
  const isGroup = chat.type !== 'direct';
  const displayName = chat.name ?? 'Unknown Chat';

  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.avatarWrap}>
        <Avatar
          uri={chat.avatar_url}
          size={48}
          username={displayName}
        />
        {isGroup && (
          <View style={styles.groupBadge} />
        )}
      </View>

      <View style={styles.content}>
        <View style={styles.topRow}>
          <Text style={styles.name} numberOfLines={1}>{displayName}</Text>
          <Text style={styles.time}>{formatTime(chat.last_message_at)}</Text>
        </View>
        <View style={styles.bottomRow}>
          <Text style={styles.preview} numberOfLines={1}>
            {lastMessagePreview(chat)}
          </Text>
          {chat.unread_count > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>
                {chat.unread_count > 99 ? '99+' : chat.unread_count}
              </Text>
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FEFCF0',
  },
  avatarWrap: {
    position: 'relative',
    marginRight: 12,
  },
  groupBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#0FA6A6',
    borderWidth: 2,
    borderColor: '#FEFCF0',
  },
  content: {
    flex: 1,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 3,
  },
  name: {
    fontFamily: 'Zain_700Bold',
    fontSize: 15,
    color: '#1A1A1A',
    flex: 1,
    marginRight: 8,
  },
  time: {
    fontFamily: 'Zain_400Regular',
    fontSize: 12,
    color: '#9CA3AF',
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  preview: {
    fontFamily: 'Zain_400Regular',
    fontSize: 13,
    color: '#6B7280',
    flex: 1,
    marginRight: 8,
  },
  badge: {
    backgroundColor: '#0FA6A6',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  badgeText: {
    fontFamily: 'Zain_700Bold',
    fontSize: 11,
    color: '#fff',
  },
});
