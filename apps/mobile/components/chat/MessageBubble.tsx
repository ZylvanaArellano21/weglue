import { useEffect, useState } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from '../shared/Avatar';
import { resolveAttachmentUrl, formatFileSize, fileTypeLabel } from '../../lib/chatAttachments';
import {
  chatColors,
  chatFonts,
  chatShadow,
  chatSizes,
  chatTypography,
  senderNameColor,
} from './chatTheme';
import { ATTACHMENT_UNAVAILABLE_TEXT } from '../../lib/blockPrompts';
import { LinkifiedText } from '../shared/LinkifiedText';
import type { MessageAttachment, MessageReactionSummary } from '../../services/messagingService';

interface Props {
  id: string;
  senderId: string;
  senderUsername: string;
  senderAvatarUrl: string | null;
  content: string | null;
  attachmentUrl: string | null;
  attachmentName?: string | null;
  attachmentSize?: number | null;
  /** Grouped media (1..5). When length > 1 renders a grid; falls back to
   * attachmentUrl for legacy single messages. */
  attachments?: MessageAttachment[];
  /** Reaction summary, grouped by emoji, count desc. */
  reactions?: MessageReactionSummary[];
  /** Toggle the viewer's reaction (null clears). */
  onToggleReaction?: (emoji: string) => void;
  /** Tapping the reaction chips opens the "who reacted with what" sheet. */
  onPressReactions?: () => void;
  /**
   * True when this sender's attachment payload is unavailable to the viewer
   * (a block in either direction). The message row is still rendered, as
   * historical context, with the canonical unavailable text instead of the
   * media. Presentation only: the storage policy refuses the bytes regardless.
   */
  attachmentUnavailable?: boolean;
  messageType: string;
  createdAt: string;
  isOwn: boolean;
  /** This is a group conversation — show the sender's name in incoming bubbles. */
  isGroup?: boolean;
  /** First message of a consecutive run from this sender (show avatar + name). */
  showSenderInfo: boolean;
  /** Last message of a consecutive run from this sender (drives corner + spacing). */
  isLastInGroup?: boolean;
  /** Pending pipeline state (optimistic messages only). */
  pendingState?: 'uploading' | 'sending' | 'failed';
  uploadProgress?: number;
  onRetry?: () => void;
  onDiscardFailed?: () => void;
  onLongPress?: (messageId: string) => void;
  onPressMedia?: (messageId: string, index?: number) => void;
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

/** One signed-URL image in a multi-image message, at its OWN natural aspect
 *  (clamped so neither a panorama nor a very tall screenshot takes over the
 *  thread) — never cropped into a shared grid cell. */
function GroupedMediaImage({
  path,
  onPress,
  onLongPress,
}: {
  path: string;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const uri = useAttachmentUri(path);
  const [aspect, setAspect] = useState(4 / 3);

  useEffect(() => {
    if (!uri) return;
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
  }, [uri]);

  return (
    <TouchableOpacity activeOpacity={0.9} onPress={onPress} onLongPress={onLongPress}>
      <View
        style={[
          styles.groupedTile,
          { aspectRatio: Math.max(0.5, Math.min(2, aspect)) },
        ]}
      >
        {uri ? (
          <Image source={{ uri }} style={styles.mediaImage} resizeMode="cover" />
        ) : (
          <View style={styles.mediaLoading}>
            <ActivityIndicator size="small" color={chatColors.teal} />
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

/** 2..5 images stacked, each keeping its OWN natural aspect ratio. */
function GroupedMedia({
  images,
  onPress,
  onLongPress,
}: {
  images: MessageAttachment[];
  onPress: (index: number) => void;
  onLongPress: () => void;
}) {
  return (
    <View style={styles.groupedMedia}>
      {images.map((img, i) => (
        <GroupedMediaImage
          key={img.id}
          path={img.storage_path}
          onPress={() => onPress(i)}
          onLongPress={onLongPress}
        />
      ))}
    </View>
  );
}

function ReactionChips({
  reactions,
  isOwn,
  onToggle,
  onPressReactions,
}: {
  reactions: MessageReactionSummary[];
  isOwn: boolean;
  onToggle?: (emoji: string) => void;
  onPressReactions?: () => void;
}) {
  if (!reactions.length) return null;
  return (
    <View style={[styles.reactionRow, isOwn ? styles.timeOwn : styles.timeOther]}>
      {reactions.map((r) => (
        <TouchableOpacity
          key={r.emoji}
          style={[styles.reactionChip, r.reactedByMe && styles.reactionChipMine]}
          // Tap → "who reacted with what". Long-press → quick toggle of that
          // emoji (fast path; also reachable from the long-press quick bar).
          onPress={() => (onPressReactions ? onPressReactions() : onToggle?.(r.emoji))}
          onLongPress={() => onToggle?.(r.emoji)}
          disabled={!onPressReactions && !onToggle}
        >
          <Text style={styles.reactionEmoji}>{r.emoji}</Text>
          {r.count > 1 ? <Text style={styles.reactionCount}>{r.count}</Text> : null}
        </TouchableOpacity>
      ))}
    </View>
  );
}

export function MessageBubble({
  id,
  senderId,
  senderUsername,
  senderAvatarUrl,
  content,
  attachmentUrl,
  attachmentName,
  attachmentSize,
  attachments,
  reactions,
  onToggleReaction,
  onPressReactions,
  attachmentUnavailable,
  messageType,
  createdAt,
  isOwn,
  isGroup,
  showSenderInfo,
  isLastInGroup = true,
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
  const groupImages = (attachments ?? []).filter((a) => a.kind === 'image');
  const isGroupedMedia = groupImages.length > 1;
  const isPoll = messageType === 'poll' && pollSlot;
  const isCard = (messageType === 'shared_event' || messageType === 'shared_post') && cardSlot;
  const isMedia = messageType === 'image' || messageType === 'video';
  const isFile = messageType === 'file';
  const failed = pendingState === 'failed';
  const isTextBubble = !isPoll && !isCard && !isMedia && !isFile && !(attachmentUnavailable && isFile);

  const longPress = () => onLongPress?.(id);
  const showName = !!isGroup && !isOwn && showSenderInfo;

  // Consecutive bubbles from the same sender tuck their inner corner in.
  const R = chatSizes.bubbleRadius;
  const r = chatSizes.bubbleRadiusGrouped;
  const groupedCorners = isOwn
    ? { borderTopRightRadius: showSenderInfo ? R : r, borderBottomRightRadius: isLastInGroup ? R : r }
    : { borderTopLeftRadius: showSenderInfo ? R : r, borderBottomLeftRadius: isLastInGroup ? R : r };

  return (
    <View
      style={[
        styles.row,
        isOwn && styles.rowOwn,
        { marginTop: showSenderInfo ? 6 : 2, marginBottom: isLastInGroup ? 6 : 2 },
      ]}
    >
      {!isOwn && (
        <View style={styles.avatarCol}>
          {isLastInGroup ? (
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
        ) : attachmentUnavailable && (isMedia || isFile) ? (
          <TouchableOpacity onLongPress={longPress} activeOpacity={0.9} style={styles.fileCard}>
            <View style={styles.fileIconWrap}>
              <Ionicons name="eye-off-outline" size={22} color={chatColors.textMuted} />
            </View>
            <View style={styles.fileMeta}>
              <Text style={styles.fileName} numberOfLines={2}>
                {ATTACHMENT_UNAVAILABLE_TEXT}
              </Text>
            </View>
          </TouchableOpacity>
        ) : isMedia && isGroupedMedia ? (
          <View>
            <GroupedMedia
              images={groupImages}
              onPress={(i) => onPressMedia?.(id, i)}
              onLongPress={longPress}
            />
            {content ? (
              <LinkifiedText text={content} style={[styles.mediaCaption, isOwn ? styles.timeOwn : styles.timeOther]} />
            ) : null}
          </View>
        ) : isMedia ? (
          <View>
            <MediaPreview
              raw={attachmentUrl}
              isVideo={messageType === 'video'}
              onPress={() => onPressMedia?.(id, 0)}
              onLongPress={longPress}
            />
            {content ? (
              <LinkifiedText text={content} style={[styles.mediaCaption, isOwn ? styles.timeOwn : styles.timeOther]} />
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
            activeOpacity={0.9}
            style={[
              styles.bubble,
              isOwn ? styles.bubbleOwn : styles.bubbleOther,
              groupedCorners,
              failed && styles.bubbleFailed,
            ]}
          >
            {showName ? (
              <Text style={[chatTypography.senderName, { color: senderNameColor(senderId || senderUsername) }]}>
                {senderUsername}
              </Text>
            ) : null}
            {content ? (
              <LinkifiedText text={content} style={isOwn ? chatTypography.bubbleSent : chatTypography.bubbleReceived} />
            ) : null}
            <Text style={styles.bubbleTime}>
              {pendingState ? 'Sending…' : formatTime(createdAt)}
            </Text>
          </TouchableOpacity>
        )}

        <ReactionChips reactions={reactions ?? []} isOwn={isOwn} onToggle={onToggleReaction} onPressReactions={onPressReactions} />

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
        ) : !isTextBubble ? (
          <Text style={[chatTypography.bubbleTimestamp, isOwn ? styles.timeOwn : styles.timeOther]}>
            {pendingState ? 'Sending…' : formatTime(createdAt)}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 15,
  },
  rowOwn: {
    flexDirection: 'row-reverse',
  },
  avatarCol: {
    marginRight: 8,
    marginBottom: 2,
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
    paddingHorizontal: 12,
    paddingTop: 7,
    paddingBottom: 5,
    minHeight: 32,
  },
  bubbleOwn: {
    backgroundColor: chatColors.bubbleOwn,
  },
  bubbleOther: {
    backgroundColor: chatColors.bubbleIncoming,
  },
  bubbleFailed: {
    opacity: 0.65,
  },
  bubbleTime: {
    ...chatTypography.bubbleTimestamp,
    alignSelf: 'flex-end',
    marginTop: 1,
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
  groupedMedia: {
    width: MEDIA_MAX_WIDTH,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#00000010',
    gap: 2,
  },
  groupedTile: {
    width: '100%',
    backgroundColor: '#00000010',
  },
  reactionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 4,
  },
  reactionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    ...chatShadow,
  },
  reactionChipMine: {
    backgroundColor: 'rgba(15,166,166,0.16)',
  },
  reactionEmoji: {
    fontSize: 13,
  },
  reactionCount: {
    fontFamily: chatFonts.semiBold,
    fontSize: 11,
    color: chatColors.textMuted,
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
