import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from '../shared/Avatar';
import { chatColors, chatFonts, chatShadow, chatSizes, chatTypography } from './chatTheme';

interface Props {
  id: string;
  senderId: string;
  senderUsername: string;
  senderAvatarUrl: string | null;
  content: string | null;
  attachmentUrl: string | null;
  messageType: string;
  createdAt: string;
  isOwn: boolean;
  showSenderInfo: boolean;
  onLongPress?: (messageId: string) => void;
  pollSlot?: React.ReactNode;
  // Renders a shared_event/shared_post preview card in place of the normal
  // bubble chrome — same extension point as pollSlot.
  cardSlot?: React.ReactNode;
}

function formatTime(isoString: string): string {
  const date = new Date(isoString);
  const h = date.getHours();
  const m = date.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`;
}

export function MessageBubble({
  id,
  senderUsername,
  senderAvatarUrl,
  content,
  attachmentUrl,
  messageType,
  createdAt,
  isOwn,
  showSenderInfo,
  onLongPress,
  pollSlot,
  cardSlot,
}: Props) {
  const isPoll = messageType === 'poll' && pollSlot;
  const isCard = (messageType === 'shared_event' || messageType === 'shared_post') && cardSlot;

  return (
    <View style={[styles.row, isOwn && styles.rowOwn]}>
      {!isOwn && (
        <View style={styles.avatarCol}>
          {showSenderInfo ? (
            <Avatar uri={senderAvatarUrl} size={chatSizes.avatarMessage} username={senderUsername} />
          ) : (
            <View style={{ width: chatSizes.avatarMessage }} />
          )}
        </View>
      )}

      <View style={[styles.col, isOwn && styles.colOwn]}>
        {isPoll ? (
          <TouchableOpacity onLongPress={() => onLongPress?.(id)} activeOpacity={0.9}>
            {pollSlot}
          </TouchableOpacity>
        ) : isCard ? (
          <TouchableOpacity onLongPress={() => onLongPress?.(id)} activeOpacity={0.9}>
            {cardSlot}
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            onLongPress={() => onLongPress?.(id)}
            activeOpacity={0.88}
            style={[styles.bubble, isOwn ? styles.bubbleOwn : styles.bubbleOther]}
          >
            {messageType === 'image' && attachmentUrl && (
              <Image source={{ uri: attachmentUrl }} style={styles.image} resizeMode="cover" />
            )}

            {messageType === 'file' && attachmentUrl && (
              <View style={styles.fileRow}>
                <Ionicons
                  name="document-outline"
                  size={18}
                  color={isOwn ? chatColors.cream : chatColors.teal}
                />
                <Text
                  style={[isOwn ? chatTypography.bubbleSent : chatTypography.bubbleReceived, styles.fileLabel]}
                  numberOfLines={1}
                >
                  {content ?? 'File'}
                </Text>
              </View>
            )}

            {messageType === 'text' && content ? (
              <Text style={isOwn ? chatTypography.bubbleSent : chatTypography.bubbleReceived}>
                {content}
              </Text>
            ) : null}

            {messageType === 'image' && content ? (
              <Text
                style={[
                  isOwn ? chatTypography.bubbleSent : chatTypography.bubbleReceived,
                  { marginTop: 4 },
                ]}
              >
                {content}
              </Text>
            ) : null}
          </TouchableOpacity>
        )}

        <Text style={[chatTypography.timestamp, isOwn ? styles.timeOwn : styles.timeOther]}>
          {formatTime(createdAt)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginVertical: 4,
    paddingHorizontal: 15,
  },
  rowOwn: {
    flexDirection: 'row-reverse',
  },
  avatarCol: {
    marginRight: 8,
    marginBottom: 14,
  },
  col: {
    maxWidth: '78%',
    alignItems: 'flex-start',
  },
  colOwn: {
    alignItems: 'flex-end',
  },
  bubble: {
    borderRadius: chatSizes.bubbleRadius,
    paddingHorizontal: 14,
    paddingVertical: 8,
    minHeight: 34,
    justifyContent: 'center',
    ...chatShadow,
  },
  bubbleOwn: {
    backgroundColor: chatColors.teal,
  },
  bubbleOther: {
    backgroundColor: chatColors.bg,
  },
  timeOwn: {
    marginTop: 3,
    alignSelf: 'flex-end',
  },
  timeOther: {
    marginTop: 3,
    alignSelf: 'flex-start',
  },
  image: {
    width: 200,
    height: 150,
    borderRadius: 16,
  },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  fileLabel: {
    flex: 1,
  },
});
