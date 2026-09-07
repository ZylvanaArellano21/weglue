import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageBubble } from './MessageBubble';
import { ChatInput } from './ChatInput';
import { MediaViewer, type ViewerMediaItem } from './MediaViewer';
import { MessageActionsSheet } from './MessageActionsSheet';
import { MessageReactorsSheet } from './MessageReactorsSheet';
import { PollComposer, type PollComposerPayload } from './PollComposer';
import { PollMessage } from './PollMessage';
import { EventShareCard } from './EventShareCard';
import { PostShareCard } from './PostShareCard';
import { DateDivider, formatChatDateDivider, isSameChatDay } from './DateDivider';
import {
  useThread,
  useConversationRealtime,
  useSendPipeline,
  type PendingMessage,
} from '../../hooks/useConversation';
import {
  unsendMessage,
  hideMessageForMe,
  reportMessage,
  createPollAtomic,
  newClientTag,
  setMessageReaction,
  removeMessageReaction,
  type ThreadMessage,
  type MessageReplyTarget,
} from '../../services/messagingService';
import { messageReplyPreviewLabel } from '@weglue/shared';
import { resolveAttachmentUrl, openAttachmentExternally } from '../../lib/chatAttachments';
import { getConversationRestrictedSenders } from '../../services/messagingService';
import { displayNameOrFallback } from '../../lib/displayName';
import { openProfile } from '../../lib/profileNavigation';
import { markConversationRead } from '../../services/chatService';
import { setActiveThread, clearActiveThread } from '../../lib/notifications/activeThread';
import { useAndroidKeyboardHeight } from '../../lib/useAndroidKeyboardHeight';
import { useKeyboardVisible } from '../../lib/useComposerBottomInset';
import { chatColors, chatFonts } from './chatTheme';

// ─── Shared conversation thread ──────────────────────────────────────────────
// One implementation for direct messages, custom groups, official Members
// chats and official Officers chats. Type-specific behavior is configuration
// (props), never a separate screen.

interface Props {
  conversationId: string | undefined;
  channelId?: string | null;
  currentUserId: string;
  /** Officers moderate official chats; group admins moderate custom groups. */
  canModerate?: boolean;
  /** Officers-only posting in restricted channels. */
  isRestricted?: boolean;
  isOfficer?: boolean;
  /** Authoritative per-channel posting permission (Bug 19). */
  canPost?: boolean;
  blockedReason?: string;
  /** Polls are available in group-style chats. */
  allowPolls?: boolean;
  /** Draft conversations materialize on first send. */
  ensureConversation?: () => Promise<string>;
  /** Draft groups: atomic conversation+first-text-message creation. */
  createWithFirstMessage?: (text: string, clientTag: string) => Promise<string>;
  onFirstSend?: (conversationId: string) => void;
  /** Tap on a sender avatar opens their profile. */
  onOpenProfile?: (userId: string) => void;
  /** Scroll target when arriving from search. */
  jumpToMessageId?: string;
  emptyLabel?: string;
}

export function ConversationThread({
  conversationId,
  channelId = null,
  currentUserId,
  canModerate = false,
  isRestricted = false,
  isOfficer = false,
  canPost,
  blockedReason,
  allowPolls = false,
  ensureConversation,
  createWithFirstMessage,
  onFirstSend,
  onOpenProfile,
  jumpToMessageId,
  emptyLabel = 'No messages yet',
}: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const listRef = useRef<FlatList>(null);
  // Android: edge-to-edge defeats adjustResize, so lift the list + composer
  // above the keyboard ourselves (iOS keeps KeyboardAvoidingView below).
  const { height: androidKeyboardHeight } = useAndroidKeyboardHeight();
  const keyboardVisible = useKeyboardVisible();

  const { data: page } = useThread(conversationId, channelId, currentUserId);
  // Senders whose attachment payload this viewer may not read (a block in
  // either direction). Keyed under 'messages' so the existing access-sync cache
  // clearing already drops it and it re-resolves after an unblock. Symmetric,
  // so it never tells the viewer who blocked whom. The storage policy is the
  // enforcement point; this only chooses which card renders.
  const { data: restrictedSenderIds } = useQuery({
    queryKey: ['messages', 'restrictedSenders', conversationId],
    queryFn: () => getConversationRestrictedSenders(conversationId!),
    enabled: !!conversationId,
    staleTime: 0,
  });
  const restrictedSenders = useMemo(
    () => new Set(restrictedSenderIds ?? []),
    [restrictedSenderIds],
  );
  useConversationRealtime(conversationId, channelId);

  const pipeline = useSendPipeline({
    conversationId,
    channelId,
    ensureConversation,
    createWithFirstMessage,
    onFirstSend,
  });

  const serverMessages = useMemo(
    () =>
      [...(page?.messages ?? [])].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      ),
    [page?.messages],
  );

  useEffect(() => {
    pipeline.reconcile(serverMessages);
  }, [serverMessages, pipeline.reconcile]);

  useEffect(() => {
    if (conversationId && serverMessages.length > 0) {
      void markConversationRead(conversationId);
    }
  }, [conversationId, serverMessages.length]);

  // While THIS thread is on screen, its pushes never banner (the foreground
  // handler checks this); leaving the screen re-enables them.
  useEffect(() => {
    if (!conversationId) return;
    setActiveThread(conversationId, channelId ?? null);
    return () => clearActiveThread(conversationId);
  }, [conversationId, channelId]);

  // Merged render list: server messages then local pending (chronological).
  type Row =
    | { kind: 'server'; msg: ThreadMessage }
    | { kind: 'pending'; msg: PendingMessage };
  const rows: Row[] = useMemo(
    () => [
      ...serverMessages.map((m) => ({ kind: 'server' as const, msg: m })),
      ...pipeline.pending
        .filter((p) => !p.conversationId || p.conversationId === (conversationId ?? p.conversationId))
        .map((m) => ({ kind: 'pending' as const, msg: m })),
    ],
    [serverMessages, pipeline.pending, conversationId],
  );

  useEffect(() => {
    if (rows.length > 0) {
      const t = setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
      return () => clearTimeout(t);
    }
  }, [rows.length]);

  // Keep the latest message visible when the keyboard opens and the list
  // resizes underneath the composer. Both platforms need this: the viewport
  // shrinks from the bottom while the scroll offset stays put, so without it
  // the newest messages end up below the fold.
  useEffect(() => {
    if (keyboardVisible && rows.length > 0) {
      const t = setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
      return () => clearTimeout(t);
    }
  }, [keyboardVisible, rows.length]);

  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  useEffect(() => {
    if (!jumpToMessageId || serverMessages.length === 0) return;
    const idx = serverMessages.findIndex((m) => m.id === jumpToMessageId);
    if (idx !== -1) {
      setHighlightedId(jumpToMessageId);
      setTimeout(() => {
        listRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.5 });
      }, 250);
      setTimeout(() => setHighlightedId(null), 2500);
    }
  }, [jumpToMessageId, serverMessages.length]);

  // Tap a quoted reply reference → scroll to and pulse the original message.
  const scrollToMessage = useCallback(
    (messageId: string) => {
      const idx = rows.findIndex((r) => r.kind === 'server' && r.msg.id === messageId);
      if (idx === -1) return;
      setHighlightedId(messageId);
      listRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.5 });
      setTimeout(() => setHighlightedId((id) => (id === messageId ? null : id)), 2200);
    },
    [rows],
  );

  // ── Reply target (migration 129) ──
  const [replyTarget, setReplyTarget] = useState<ThreadMessage | null>(null);
  useEffect(() => setReplyTarget(null), [conversationId, channelId]);
  const beginReply = useCallback((m: ThreadMessage) => {
    setReplyTarget(m);
  }, []);
  const replySnapshot = useMemo<MessageReplyTarget | null>(() => {
    if (!replyTarget) return null;
    return {
      id: replyTarget.id,
      content: replyTarget.content,
      message_type: replyTarget.message_type,
      attachment_count: (replyTarget.attachments ?? []).filter((a) => a.kind === 'image').length,
      sender_name: displayNameOrFallback(replyTarget.sender),
    };
  }, [replyTarget]);
  const replyingToBanner = replySnapshot
    ? {
        senderName: replySnapshot.sender_name,
        label: messageReplyPreviewLabel(replySnapshot),
      }
    : null;

  // ── Media viewer ──
  // Grouped-media messages contribute one viewer entry per photo so a tap opens
  // on the chosen image and swipes through that message's set.
  const mediaEntries = useMemo(
    () =>
      serverMessages
        .filter(
          (m) =>
            (m.message_type === 'image' || m.message_type === 'video') &&
            !(m.sender_id && restrictedSenders.has(m.sender_id)),
        )
        .flatMap((m) => {
          const grouped = (m.attachments ?? []).filter((a) => a.kind !== 'file');
          const sources =
            grouped.length > 0
              ? grouped.map((a) => ({ source: a.storage_path, kind: a.kind, position: a.position }))
              : m.attachment_url
                ? [{
                    source: m.attachment_url,
                    kind: m.message_type === 'video' ? ('video' as const) : ('image' as const),
                    position: 0,
                  }]
                : [];
          return sources.map((s) => ({
            messageId: m.id,
            attachmentIndex: s.position,
            item: {
              messageId: m.id,
              source: s.source,
              kind: s.kind as 'image' | 'video',
              senderName: displayNameOrFallback(m.sender),
              sentAt: m.created_at,
            } satisfies ViewerMediaItem,
          }));
        }),
    [serverMessages, restrictedSenders],
  );
  const mediaItems: ViewerMediaItem[] = useMemo(
    () => mediaEntries.map((e) => e.item),
    [mediaEntries],
  );
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  const openMedia = useCallback(
    (messageId: string, index = 0) => {
      let idx = mediaEntries.findIndex(
        (e) => e.messageId === messageId && e.attachmentIndex === index,
      );
      if (idx === -1) idx = mediaEntries.findIndex((e) => e.messageId === messageId);
      if (idx !== -1) setViewerIndex(idx);
    },
    [mediaEntries],
  );

  const openFile = useCallback(
    async (messageId: string) => {
      const msg = serverMessages.find((m) => m.id === messageId);
      if (!msg?.attachment_url) return;
      // Fetched through the authenticated endpoint, so Storage re-checks the
      // viewer's CURRENT authorization; a blocked viewer gets nothing to open.
      const opened = await openAttachmentExternally(msg.attachment_url);
      if (!opened) {
        Alert.alert('Unavailable', 'This file could not be opened.');
      }
    },
    [serverMessages],
  );

  // ── Long-press actions ──
  const [actionTarget, setActionTarget] = useState<ThreadMessage | null>(null);
  const [reactorsTarget, setReactorsTarget] = useState<string | null>(null);

  const invalidateFor = useCallback(
    (id: string | undefined) => {
      queryClient.invalidateQueries({ queryKey: ['thread', id] });
      queryClient.invalidateQueries({ queryKey: ['convMedia', id] });
      queryClient.invalidateQueries({ queryKey: ['convFiles', id] });
      queryClient.invalidateQueries({ queryKey: ['convEvents', id] });
      queryClient.invalidateQueries({ queryKey: ['convPolls', id] });
      queryClient.invalidateQueries({ queryKey: ['myChats'] });
    },
    [queryClient],
  );

  const invalidate = useCallback(() => {
    invalidateFor(conversationId);
  }, [invalidateFor, conversationId]);

  const handleUnsend = useCallback(
    (messageId: string) => {
      unsendMessage(messageId)
        .then(invalidate)
        .catch(() => Alert.alert('Could not remove the message. Please try again.'));
    },
    [invalidate],
  );

  const handleDeleteForMe = useCallback(
    (messageId: string) => {
      hideMessageForMe(messageId, currentUserId)
        .then(invalidate)
        .catch(() => Alert.alert('Could not delete the message. Please try again.'));
    },
    [invalidate, currentUserId],
  );

  // Reactions: optimistic isn't attempted — the canonical rows come back on the
  // `reaction` broadcast + this invalidate. Errors are quiet (a failed react is
  // low-stakes and self-corrects on the next thread read).
  const handleReact = useCallback(
    (messageId: string, emoji: string | null) => {
      const p = emoji ? setMessageReaction(messageId, emoji) : removeMessageReaction(messageId);
      p.then(invalidate).catch(() => invalidate());
    },
    [invalidate],
  );

  // Returns true only when the report is durably saved. The action sheet keeps
  // the user's reason + details and offers retry on false; on true it shows
  // "Report submitted." and closes — the thread and its scroll position are
  // untouched (the sheet is a modal over it), the content stays visible, and
  // the sender is neither blocked nor notified.
  const handleReport = useCallback(
    async (messageId: string, reason: string, details?: string): Promise<boolean> => {
      try {
        await reportMessage(messageId, reason, details);
        return true;
      } catch {
        return false;
      }
    },
    [],
  );

  // ── Polls ──
  const [pollOpen, setPollOpen] = useState(false);
  const submitPoll = useCallback(
    async (payload: PollComposerPayload) => {
      const convId = ensureConversation ? await ensureConversation() : conversationId;
      if (!convId) throw new Error('Conversation not ready');
      await createPollAtomic({
        conversationId: convId,
        channelId,
        question: payload.question,
        options: payload.options,
        allowMultiple: payload.allowMultiple,
        startAt: payload.startAt ?? null,
        endAt: payload.endAt ?? null,
        clientTag: newClientTag(),
      });
      // A poll can be the FIRST thing sent into a draft group, exactly like a
      // text message. ensureConversation() materialized it, so the screen has to
      // be handed the real id — the text path does this via the send pipeline.
      // Without it the screen stays on the draft, useThread stays disabled, and
      // the poll is invisible until the app is relaunched even though it is
      // already in the database.
      if (convId !== conversationId) onFirstSend?.(convId);
      invalidateFor(convId);
    },
    [conversationId, channelId, ensureConversation, onFirstSend, invalidateFor],
  );

  const renderRow = ({ item, index }: { item: Row; index: number }) => {
    const prevRow = rows[index - 1];
    if (item.kind === 'pending') {
      const p = item.msg;
      return (
        <MessageBubble
          id={p.clientTag}
          senderId={currentUserId}
          senderUsername=""
          senderAvatarUrl={null}
          content={p.content}
          attachmentUrl={p.localUri ?? null}
          attachmentName={p.attachmentName}
          attachmentSize={p.attachmentSize}
          attachments={
            p.localUris && p.localUris.length > 1
              ? p.localUris.map((uri, i) => ({
                  id: `pending-${i}`,
                  storage_path: uri,
                  kind: 'image' as const,
                  position: i,
                  mime: null,
                  width: null,
                  height: null,
                  byte_size: null,
                  file_name: null,
                }))
              : undefined
          }
          messageType={p.messageType}
          createdAt={p.createdAt}
          isOwn
          showSenderInfo={false}
          pendingState={p.status}
          uploadProgress={p.progress}
          onRetry={() => pipeline.retry(p.clientTag)}
          onDiscardFailed={() => pipeline.discardFailed(p.clientTag)}
          replyPreview={
            p.replyTo
              ? { senderName: p.replyTo.sender_name, label: messageReplyPreviewLabel(p.replyTo) }
              : null
          }
        />
      );
    }

    const m = item.msg;
    const prev = prevRow?.kind === 'server' ? prevRow.msg : undefined;
    const nextRow = rows[index + 1];
    const next = nextRow?.kind === 'server' ? nextRow.msg : undefined;
    const showDateDivider = !prev || !isSameChatDay(prev.created_at, m.created_at);
    const showSenderInfo =
      showDateDivider || !prev || prev.sender_id !== m.sender_id;
    const isLastInGroup =
      !next ||
      next.sender_id !== m.sender_id ||
      !isSameChatDay(m.created_at, next.created_at);
    const isOwn = m.sender_id === currentUserId;

    return (
      <View>
        {showDateDivider && <DateDivider label={formatChatDateDivider(m.created_at)} />}
        <View style={m.id === highlightedId ? styles.highlightedRow : undefined}>
          <MessageBubble
            id={m.id}
            senderId={m.sender_id ?? ''}
            senderUsername={displayNameOrFallback(m.sender)}
            senderAvatarUrl={m.sender.avatar_url}
            content={m.content}
            attachmentUrl={m.attachment_url}
            attachmentName={m.attachment_name}
            attachmentSize={m.attachment_size}
            attachmentUnavailable={!!m.sender_id && restrictedSenders.has(m.sender_id)}
            attachments={m.attachments}
            reactions={m.reactions}
            onToggleReaction={(emoji) => {
              const mine = m.reactions?.find((r) => r.reactedByMe)?.emoji;
              handleReact(m.id, mine === emoji ? null : emoji);
            }}
            onPressReactions={() => setReactorsTarget(m.id)}
            messageType={m.message_type}
            createdAt={m.created_at}
            isOwn={isOwn}
            isGroup={allowPolls}
            showSenderInfo={showSenderInfo}
            isLastInGroup={isLastInGroup}
            onLongPress={() => setActionTarget(m)}
            onSwipeReply={m.message_type === 'poll' ? undefined : () => beginReply(m)}
            replyPreview={
              m.reply_to
                ? { senderName: m.reply_to.sender_name, label: messageReplyPreviewLabel(m.reply_to) }
                : null
            }
            onPressReplyPreview={m.reply_to ? () => scrollToMessage(m.reply_to!.id) : undefined}
            onPressMedia={openMedia}
            onPressFile={openFile}
            onPressAvatar={
              m.sender_id
                ? () => {
                    if (onOpenProfile) onOpenProfile(m.sender_id!);
                    else openProfile(router, m.sender_id, currentUserId);
                  }
                : undefined
            }
            pollSlot={
              m.message_type === 'poll' && m.poll_id ? (
                <PollMessage pollId={m.poll_id} messageId={m.id} userId={currentUserId} isOwn={isOwn} />
              ) : undefined
            }
            cardSlot={
              m.message_type === 'shared_event' ? (
                <EventShareCard eventId={m.shared_event_id} viewerUserId={currentUserId} />
              ) : m.message_type === 'shared_post' ? (
                <PostShareCard postId={m.shared_post_id} viewerUserId={currentUserId} />
              ) : undefined
            }
          />
        </View>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={[
        styles.flex,
        // Android edge-to-edge: adjustResize doesn't shrink the view, so pad by
        // the real keyboard height to lift the list + composer above it.
        Platform.OS === 'android' ? { paddingBottom: androidKeyboardHeight } : null,
      ]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <FlatList
        ref={listRef}
        data={rows}
        keyExtractor={(item) => (item.kind === 'server' ? item.msg.id : item.msg.clientTag)}
        contentContainerStyle={styles.list}
        onScrollToIndexFailed={() => {}}
        renderItem={renderRow}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>{emptyLabel}</Text>
          </View>
        }
      />

      <ChatInput
        mode={allowPolls ? 'group' : 'direct'}
        isRestricted={isRestricted}
        isOfficer={isOfficer}
        canPost={canPost}
        blockedReason={blockedReason}
        replyingTo={replyingToBanner}
        onCancelReply={() => setReplyTarget(null)}
        onSendText={(content) => {
          pipeline.sendText(content, replySnapshot);
          setReplyTarget(null);
        }}
        onSendAttachment={(draft) => {
          const res = pipeline.sendAttachment(draft, undefined, replySnapshot);
          setReplyTarget(null);
          return res;
        }}
        onSendPhotos={(photos, caption) => {
          const res = pipeline.sendPhotos(photos, caption, replySnapshot);
          setReplyTarget(null);
          return res;
        }}
        onAttachmentError={(message) => Alert.alert('Attachment', message)}
        onOpenPoll={allowPolls ? () => setPollOpen(true) : undefined}
      />

      <MediaViewer
        visible={viewerIndex !== null}
        items={mediaItems}
        initialIndex={viewerIndex ?? 0}
        onClose={() => setViewerIndex(null)}
        currentUserId={currentUserId}
      />

      <MessageActionsSheet
        message={actionTarget}
        isOwn={actionTarget?.sender_id === currentUserId}
        canModerate={canModerate}
        onClose={() => setActionTarget(null)}
        onReply={(m) => { setActionTarget(null); beginReply(m); }}
        onUnsend={handleUnsend}
        onDeleteForMe={handleDeleteForMe}
        onReport={handleReport}
        onSaveMedia={(messageId) => openMedia(messageId)}
        myReaction={actionTarget?.reactions?.find((r) => r.reactedByMe)?.emoji ?? null}
        onReact={handleReact}
      />

      <MessageReactorsSheet
        messageId={reactorsTarget}
        currentUserId={currentUserId}
        onClose={() => setReactorsTarget(null)}
        onRemoveOwn={(id) => handleReact(id, null)}
      />

      {allowPolls && (
        <PollComposer visible={pollOpen} onClose={() => setPollOpen(false)} onSubmit={submitPoll} />
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { paddingVertical: 8, flexGrow: 1 },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontFamily: chatFonts.regular,
    fontSize: 14,
    color: chatColors.textMuted,
  },
  highlightedRow: {
    backgroundColor: 'rgba(15,166,166,0.08)',
    borderRadius: 8,
  },
});
