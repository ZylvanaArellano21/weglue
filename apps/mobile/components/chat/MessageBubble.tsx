import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from '../shared/Avatar';

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
}: Props) {
  return (
    <TouchableOpacity
      onLongPress={() => onLongPress?.(id)}
      activeOpacity={0.85}
      style={[styles.wrapper, isOwn && styles.wrapperOwn]}
    >
      {/* Avatar — shown for others when first message in group */}
      {!isOwn && (
        <View style={styles.avatarCol}>
          {showSenderInfo ? (
            <Avatar uri={senderAvatarUrl} size={32} username={senderUsername} />
          ) : (
            <View style={{ width: 32 }} />
          )}
        </View>
      )}

      <View style={[styles.bubble, isOwn ? styles.bubbleOwn : styles.bubbleOther]}>
        {showSenderInfo && !isOwn && (
          <Text style={styles.senderName}>{senderUsername}</Text>
        )}

        {/* Poll slot rendered inline */}
        {messageType === 'poll' && pollSlot}

        {/* Image attachment */}
        {messageType === 'image' && attachmentUrl && (
          <Image
            source={{ uri: attachmentUrl }}
            style={styles.image}
            resizeMode="cover"
          />
        )}

        {/* File attachment */}
        {messageType === 'file' && attachmentUrl && (
          <View style={styles.fileRow}>
            <Ionicons name="document-outline" size={20} color={isOwn ? '#fff' : '#374151'} />
            <Text style={[styles.fileLabel, isOwn && styles.textOwn]} numberOfLines={1}>
              {content ?? 'File'}
            </Text>
          </View>
        )}

        {/* Text content */}
        {messageType === 'text' && content ? (
          <Text style={[styles.text, isOwn && styles.textOwn]}>{content}</Text>
        ) : null}

        {/* Caption under image */}
        {messageType === 'image' && content ? (
          <Text style={[styles.text, isOwn && styles.textOwn, { marginTop: 4 }]}>
            {content}
          </Text>
        ) : null}

        <Text style={[styles.time, isOwn && styles.timeOwn]}>
          {formatTime(createdAt)}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginVertical: 2,
    paddingHorizontal: 12,
  },
  wrapperOwn: {
    flexDirection: 'row-reverse',
  },
  avatarCol: {
    marginRight: 8,
    marginBottom: 4,
  },
  bubble: {
    maxWidth: '75%',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bubbleOwn: {
    backgroundColor: '#0FA6A6',
    borderBottomRightRadius: 4,
  },
  bubbleOther: {
    backgroundColor: '#fff',
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  senderName: {
    fontFamily: 'Zain_700Bold',
    fontSize: 12,
    color: '#0FA6A6',
    marginBottom: 3,
  },
  text: {
    fontFamily: 'Zain_400Regular',
    fontSize: 15,
    color: '#1A1A1A',
    lineHeight: 21,
  },
  textOwn: {
    color: '#fff',
  },
  time: {
    fontFamily: 'Zain_400Regular',
    fontSize: 11,
    color: '#9CA3AF',
    marginTop: 4,
    alignSelf: 'flex-end',
  },
  timeOwn: {
    color: 'rgba(255,255,255,0.7)',
  },
  image: {
    width: 200,
    height: 150,
    borderRadius: 12,
  },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  fileLabel: {
    fontFamily: 'Zain_400Regular',
    fontSize: 14,
    color: '#374151',
    flex: 1,
  },
});
