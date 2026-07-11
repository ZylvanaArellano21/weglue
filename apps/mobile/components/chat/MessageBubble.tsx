import { useEffect, useState } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from '../shared/Avatar';
import { resolveAttachmentUrl, formatFileSize, fileTypeLabel } from '../../lib/chatAttachments';
import { chatColors, chatFonts, chatShadow, chatSizes, chatTypography } from './chatTheme';

interface Props {
  id: string;
  senderId: string;
  senderUsername: string;
  senderAvatarUrl: string | null;
  content: string | null;
  attachmentUrl: string | null;
  attachmentName?: string | null;
  attachmentSize?: number | null;
  messageType: string;
  createdAt: string;
  isOwn: boolean;
  showSenderInfo: boolean;
  /** Pending pipeline state (optimistic messages only). */
  pendingState?: 'uploading' | 'sending' | 'failed';
  uploadProgress?: number;
  onRetry?: () => void;
  onDiscardFailed?: () => void;
  onLongPress?: (messageId: string) => void;
  onPressMedia?: (messageId: string) => void;
  onPressFile?: (messageId: string) => void;
  onPressAvatar?: () => void;
  pollSlot?: React.ReactNode;
  cardSlot?: React.ReactNode;
}

function formatTime(isoString: string): string {
  const date = new Date(isoString);
  const h = date.getHours();
  const m = date.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`;
}

const MEDIA_MAX_WIDTH = 230;

/** Resolves private-storage paths to signed URLs for inline previews. */
function useAttachmentUri(raw: string | null): string | null {
  const [uri, setUri] = useState<string | null>(raw && raw.startsWith('http') ? raw : null);
  useEffect(() => {
    let alive = true;
    if (!raw) {
      setUri(null);
      return;
    }
    void resolveAttachmentUrl(raw).then((u) => {
      if (alive) setUri(u);
    });
    return () => {
      alive = false;
    };
  }, [raw]);
  return uri;
}

function MediaPreview({
  raw,
  isVideo,
  onPress,
  onLongPress,
}: {
  raw: string | null;
  isVideo: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
}) {
  const uri = useAttachmentUri(raw);
  const [aspect, setAspect] = useState(4 / 3);

  useEffect(() => {
    if (!uri || isVideo) return;
    let alive = true;
    Image.getSize(
      uri,
      (w, h) => {
        if (alive && w > 0 && h > 0) setAspect(w / h);
      },
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [uri, isVideo]);

  // Media renders bare — rounded corners only. No bubble chrome, no thick
  // colored outline (correction screenshots: Bug 4).
  return (
    <TouchableOpacity activeOpacity={0.9} onPress={onPress} onLongPress={onLongPress}>
      <View style={[styles.mediaWrap, { aspectRatio: isVideo ? 16 / 9 : Math.max(0.5, Math.min(2, aspect)) }]}>
        {uri ? (
          <Image source={{ uri }} style={styles.mediaImage} resizeMode="cover" />
        ) : (
          <View style={styles.mediaLoading}>
            <ActivityIndicator size="small" color={chatColors.teal} />
          </View>
        )}
        {isVideo && (
          <View style={styles.playOverlay}>
            <Ionicons name="play" size={26} color="#fff" />
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

export function MessageBubble({
  id,
  senderUsername,
  senderAvatarUrl,
  content,
  attachmentUrl,
  attachmentName,
  attachmentSize,
  messageType,
  createdAt,
  isOwn,
  showSenderInfo,
  pendingState,
  uploadProgress,
  onRetry,
  onDiscardFailed,
  onLongPress,
  onPressMedia,
  onPressFile,
  onPressAvatar,
  pollSlot,
  cardSlot,
}: Props) {
  const isPoll = messageType === 'poll' && pollSlot;
  const isCard = (messageType === 'shared_event' || messageType === 'shared_post') && cardSlot;
  const isMedia = messageType === 'image' || messageType === 'video';
  const isFile = messageType === 'file';
  const failed = pendingState === 'failed';

  const longPress = () => onLongPress?.(id);

  return (
    <View style={[styles.row, isOwn && styles.rowOwn]}>
      {!isOwn && (
        <View style={styles.avatarCol}>
          {showSenderInfo ? (
            <TouchableOpacity onPress={onPressAvatar} disabled={!onPressAvatar}>
              <Avatar uri={senderAvatarUrl} size={chatSizes.avatarMessage} username={senderUsername} />
            </TouchableOpacity>
          ) : (
            <View style={{ width: chatSizes.avatarMessage }} />
          )}
        </View>
      )}

      <View style={[styles.col, isOwn && styles.colOwn]}>
        {isPoll ? (
          <TouchableOpacity onLongPress={longPress} activeOpacity={0.9}>
            {pollSlot}
          </TouchableOpacity>
        ) : isCard ? (
          <TouchableOpacity onLongPress={longPress} activeOpacity={0.9}>
            {cardSlot}
          </TouchableOpacity>
        ) : isMedia ? (
          <View>
            <MediaPreview
              raw={attachmentUrl}
              isVideo={messageType === 'video'}
              onPress={() => onPressMedia?.(id)}
              onLongPress={longPress}
            />
            {content ? (
              <Text style={[styles.mediaCaption, isOwn ? styles.timeOwn : styles.timeOther]}>{content}</Text>
            ) : null}
            {pendingState === 'uploading' && (
              <View style={styles.uploadOverlay} pointerEvents="none">
                <ActivityIndicator size="small" color="#fff" />
                <Text style={styles.uploadPct}>{Math.round((uploadProgress ?? 0) * 100)}%</Text>
              </View>
            )}
          </View>
        ) : isFile ? (
          <TouchableOpacity
            onPress={() => onPressFile?.(id)}
            onLongPress={longPress}
            activeOpacity={0.85}
            style={styles.fileCard}
          >
            <View style={styles.fileIconWrap}>
              {pendingState === 'uploading' ? (
                <ActivityIndicator size="small" color={chatColors.teal} />
              ) : (
                <Ionicons name="document-text-outline" size={22} color={chatColors.teal} />
              )}
            </View>
            <View style={styles.fileMeta}>
              <Text style={styles.fileName} numberOfLines={2}>
                {attachmentName ?? content ?? 'File'}
              </Text>
              <Text style={styles.fileSub} numberOfLines={1}>
                {fileTypeLabel(attachmentName, null)}
                {attachmentSize ? ` · ${formatFileSize(attachmentSize)}` : ''}
                {pendingState === 'uploading'
                  ? ` · Uploading ${Math.round((uploadProgress ?? 0) * 100)}%`
                  : ''}
              </Text>
            </View>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            onLongPress={longPress}
            activeOpacity={0.88}
            style={[styles.bubble, isOwn ? styles.bubbleOwn : styles.bubbleOther, failed && styles.bubbleFailed]}
          >
            {content ? (
              <Text style={isOwn ? chatTypography.bubbleSent : chatTypography.bubbleReceived}>{content}</Text>
            ) : null}
          </TouchableOpacity>
        )}

        {failed ? (
          <View style={styles.failedRow}>
            <Ionicons name="alert-circle" size={13} color="#C62828" />
            <Text style={styles.failedText}>Not sent</Text>
            <TouchableOpacity onPress={onRetry} hitSlop={8}>
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onDiscardFailed} hitSlop={8}>
              <Text style={styles.discardText}>Discard</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <Text style={[chatTypography.timestamp, isOwn ? styles.timeOwn : styles.timeOther]}>
            {pendingState ? 'Sending…' : formatTime(createdAt)}
          </Text>
        )}
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
  bubbleFailed: {
    opacity: 0.65,
  },
  timeOwn: {
    marginTop: 3,
    alignSelf: 'flex-end',
  },
  timeOther: {
    marginTop: 3,
    alignSelf: 'flex-start',
  },
  // Bare media: rounded corners, natural aspect ratio, no border.
  mediaWrap: {
    width: MEDIA_MAX_WIDTH,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#00000010',
  },
  mediaImage: {
    width: '100%',
    height: '100%',
  },
  mediaLoading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  mediaCaption: {
    fontFamily: chatFonts.regular,
    fontSize: 13,
    color: chatColors.text,
    marginTop: 4,
    maxWidth: MEDIA_MAX_WIDTH,
  },
  uploadOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  uploadPct: {
    fontFamily: chatFonts.semiBold,
    fontSize: 12,
    color: '#fff',
  },
  fileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    width: 240,
    backgroundColor: chatColors.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: chatColors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    ...chatShadow,
  },
  fileIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(15,166,166,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileMeta: {
    flex: 1,
  },
  fileName: {
    fontFamily: chatFonts.semiBold,
    fontSize: 13,
    color: chatColors.text,
  },
  fileSub: {
    fontFamily: chatFonts.regular,
    fontSize: 11,
    color: chatColors.textMuted,
    marginTop: 2,
  },
  failedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  failedText: {
    fontFamily: chatFonts.regular,
    fontSize: 11,
    color: '#C62828',
  },
  retryText: {
    fontFamily: chatFonts.semiBold,
    fontSize: 11,
    color: chatColors.teal,
  },
  discardText: {
    fontFamily: chatFonts.regular,
    fontSize: 11,
    color: chatColors.textMuted,
  },
});
