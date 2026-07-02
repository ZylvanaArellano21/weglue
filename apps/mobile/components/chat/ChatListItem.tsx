import { View, Text, TouchableOpacity, Image, StyleSheet } from 'react-native';
import { Avatar, parsePresetColor } from '../shared/Avatar';
import type { ChatPreview } from '../../services/chatService';
import { chatColors, chatFonts, chatShadow, chatSizes, chatTypography } from './chatTheme';

interface Props {
  chat: ChatPreview;
  currentUserId: string;
  onPress: () => void;
  channelTags?: string[];
}

function formatTime(isoString: string | null): string {
  if (!isoString) return '';
  const date = new Date(isoString);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
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
  const text =
    chat.last_message.length > 60 ? chat.last_message.slice(0, 60) + '…' : chat.last_message;
  return prefix + text;
}

export function ChatListItem({ chat, onPress, channelTags = [] }: Props) {
  const isGroup = chat.type !== 'direct';
  const displayName = chat.name ?? 'Unknown Chat';
  const preset = parsePresetColor(chat.avatar_url);

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.75}>
      <View style={styles.imageWrap}>
        {preset ? (
          <View style={[styles.groupImage, { backgroundColor: preset }]} />
        ) : chat.avatar_url ? (
          <Image source={{ uri: chat.avatar_url }} style={styles.groupImage} />
        ) : (
          <View style={styles.groupImageFallback}>
            <Avatar uri={null} size={44} username={displayName} />
          </View>
        )}
      </View>

      <View style={styles.content}>
        <View style={styles.topRow}>
          <Text style={styles.name} numberOfLines={1}>
            {displayName}
          </Text>
          <Text style={styles.time}>{formatTime(chat.last_message_at)}</Text>
        </View>

        {isGroup && channelTags.length > 0 && (
          <View style={styles.tagsRow}>
            {channelTags.map((tag) => (
              <View key={tag} style={styles.tag}>
                <Text style={styles.tagText}># {tag}</Text>
              </View>
            ))}
          </View>
        )}

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

/** Simple row for suggested people (Single filter empty state) */
export function SuggestedPersonRow({
  username,
  avatarUrl,
  onPress,
}: {
  username: string;
  avatarUrl: string | null;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.suggestedRow} onPress={onPress} activeOpacity={0.7}>
      <Avatar uri={avatarUrl} size={chatSizes.avatarSuggested} username={username} />
      <Text style={chatTypography.rowName}>{username}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginHorizontal: 12,
    marginVertical: 6,
    padding: 12,
    backgroundColor: chatColors.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: chatColors.border,
    ...chatShadow,
  },
  imageWrap: {
    marginRight: 12,
  },
  groupImage: {
    width: 48,
    height: 48,
    borderRadius: 10,
  },
  groupImageFallback: {
    width: 48,
    height: 48,
    borderRadius: 10,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flex: 1,
    minWidth: 0,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  name: {
    fontFamily: chatFonts.semiBold,
    fontSize: 14,
    color: chatColors.text,
    flex: 1,
    marginRight: 8,
  },
  time: {
    ...chatTypography.timestamp,
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 4,
  },
  tag: {
    backgroundColor: chatColors.tagBg,
    borderRadius: 40,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  tagText: {
    fontFamily: chatFonts.regular,
    fontSize: 10,
    color: chatColors.tagText,
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  preview: {
    fontFamily: chatFonts.regular,
    fontSize: 12,
    color: chatColors.textMuted,
    flex: 1,
    marginRight: 8,
  },
  badge: {
    backgroundColor: chatColors.teal,
    borderRadius: chatSizes.unreadBadge / 2,
    minWidth: chatSizes.unreadBadge,
    height: chatSizes.unreadBadge,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  badgeText: {
    fontFamily: chatFonts.semiBold,
    fontSize: 11,
    color: chatColors.cream,
  },
  suggestedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 23,
    paddingVertical: 10,
  },
});
