import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createSafeChannel, removeSafeChannel } from '../lib/realtime';
import {
  getThreadMessages,
  sendMessage,
  newClientTag,
  type ThreadMessage,
} from '../services/messagingService';
import {
  uploadChatAttachment,
  MAX_FILE_BYTES,
  formatFileSize,
} from '../lib/chatAttachments';
import { timedQuery } from '../lib/timedQuery';

// ─── Optimistic send pipeline (shared by all four conversation types) ───────
// Server messages come from React Query; in-flight/failed messages live in
// local state and are merged for rendering. A stable client_tag per logical
// message makes retries duplicate-proof (DB unique index + RPC checks), and
// reconciliation drops the local copy the moment the server copy is visible.

export interface PendingMessage {
  clientTag: string;
  conversationId: string;
  channelId: string | null;
  content: string | null;
  messageType: 'text' | 'image' | 'video' | 'file';
  localUri?: string;
  attachmentName?: string | null;
  attachmentSize?: number | null;
  attachmentMime?: string | null;
  status: 'uploading' | 'sending' | 'failed';
  progress: number;
  errorText?: string;
  createdAt: string;
}

export interface AttachmentDraft {
  localUri: string;
  kind: 'image' | 'video' | 'file';
  name?: string | null;
  size?: number | null;
  mime: string;
}

export function useThread(conversationId: string | undefined, channelId: string | null, userId: string) {
  return useQuery({
    queryKey: ['thread', conversationId, channelId ?? 'dm'],
    queryFn: () => timedQuery('thread', getThreadMessages(conversationId!, channelId, userId)),
    enabled: !!conversationId && !!userId,
    staleTime: 0,
  });
}

export function useConversationRealtime(conversationId: string | undefined, channelId: string | null) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!conversationId) return;
    const channel = createSafeChannel(`conv:${conversationId}`, [
      {
        event: '*',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${conversationId}`,
        callback: () => {
          queryClient.invalidateQueries({ queryKey: ['thread', conversationId] });
          queryClient.invalidateQueries({ queryKey: ['convMedia', conversationId] });
          queryClient.invalidateQueries({ queryKey: ['convFiles', conversationId] });
          queryClient.invalidateQueries({ queryKey: ['convEvents', conversationId] });
          queryClient.invalidateQueries({ queryKey: ['convPolls', conversationId] });
          queryClient.invalidateQueries({ queryKey: ['myChats'] });
        },
      },
    ]);
    return () => {
      removeSafeChannel(channel);
    };
  }, [conversationId, channelId, queryClient]);
}

export function useSendPipeline(opts: {
  conversationId: string | undefined;
  channelId: string | null;
  /** Draft conversations (new DM / new group) materialize the conversation on
   * first send and return its id; existing chats just return their id. */
  ensureConversation?: () => Promise<string>;
  /** Draft groups: creates conversation + first TEXT message in one atomic
   * RPC (no partial groups). Non-text first sends fall back to
   * ensureConversation + regular send. */
  createWithFirstMessage?: (text: string, clientTag: string) => Promise<string>;
  onFirstSend?: (conversationId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const materializedId = useRef<string | null>(opts.conversationId ?? null);
  useEffect(() => {
    if (opts.conversationId) materializedId.current = opts.conversationId;
  }, [opts.conversationId]);
  // Tags currently inside sendOne — a second retry tap while a send is
  // in flight must be a no-op (duplicate prevention at the UI layer too).
  const inFlight = useRef<Set<string>>(new Set());

  const patch = useCallback((tag: string, updates: Partial<PendingMessage>) => {
    setPending((prev) => prev.map((p) => (p.clientTag === tag ? { ...p, ...updates } : p)));
  }, []);

  const removePending = useCallback((tag: string) => {
    setPending((prev) => prev.filter((p) => p.clientTag !== tag));
  }, []);

  const finish = useCallback(
    (conversationId: string) => {
      queryClient.invalidateQueries({ queryKey: ['thread', conversationId] });
      queryClient.invalidateQueries({ queryKey: ['myChats'] });
    },
    [queryClient],
  );

  const sendOne = useCallback(
    async (msg: PendingMessage) => {
      if (inFlight.current.has(msg.clientTag)) return;
      inFlight.current.add(msg.clientTag);
      try {
        // Atomic draft-group path: conversation + first text message in one
        // server transaction. Retries reuse the clientTag (RPC dedupes).
        if (
          !materializedId.current &&
          opts.createWithFirstMessage &&
          msg.messageType === 'text' &&
          msg.content
        ) {
          const createdId = await opts.createWithFirstMessage(msg.content, msg.clientTag);
          materializedId.current = createdId;
          removePending(msg.clientTag);
          finish(createdId);
          opts.onFirstSend?.(createdId);
          return;
        }

        const convId =
          materializedId.current ??
          (opts.ensureConversation ? await opts.ensureConversation() : msg.conversationId);
        if (!convId) throw new Error('Conversation not ready');
        materializedId.current = convId;

        let attachmentPath: string | null = null;
        let size = msg.attachmentSize ?? null;
        let mime = msg.attachmentMime ?? null;

        if (msg.localUri && msg.messageType !== 'text') {
          patch(msg.clientTag, { status: 'uploading', conversationId: convId });
          const uploaded = await uploadChatAttachment({
            conversationId: convId,
            localUri: msg.localUri,
            mime: mime ?? 'application/octet-stream',
            fileName: msg.attachmentName,
            // messageType is already narrowed to a non-text attachment kind here.
            kind: msg.messageType as 'image' | 'video' | 'file',
            onProgress: (f) => patch(msg.clientTag, { progress: f }),
          });
          attachmentPath = uploaded.path;
          mime = uploaded.mime;
          if (!size || size <= 0) size = uploaded.size;
        }

        patch(msg.clientTag, { status: 'sending', progress: 1 });

        await sendMessage({
          conversationId: convId,
          channelId: msg.channelId,
          content: msg.content,
          messageType: msg.messageType,
          attachmentPath,
          attachmentName: msg.attachmentName ?? null,
          attachmentSize: size,
          attachmentMime: mime,
          clientTag: msg.clientTag,
        });

        removePending(msg.clientTag);
        finish(convId);
        opts.onFirstSend?.(convId);
      } catch (e: any) {
        patch(msg.clientTag, {
          status: 'failed',
          errorText: e?.message ?? 'Failed to send',
        });
      } finally {
        inFlight.current.delete(msg.clientTag);
      }
    },
    [opts, patch, removePending, finish],
  );

  /** Immediate-return text send: the message appears locally before any I/O. */
  const sendText = useCallback(
    (content: string) => {
      const trimmed = content.trim();
      if (!trimmed) return;
      const msg: PendingMessage = {
        clientTag: newClientTag(),
        conversationId: opts.conversationId ?? '',
        channelId: opts.channelId,
        content: trimmed,
        messageType: 'text',
        status: 'sending',
        progress: 0,
        createdAt: new Date().toISOString(),
      };
      setPending((prev) => [...prev, msg]);
      void sendOne(msg);
    },
    [opts.conversationId, opts.channelId, sendOne],
  );

  /** Attachment send: pending bubble with progress appears immediately. */
  const sendAttachment = useCallback(
    (draft: AttachmentDraft, caption?: string) => {
      if (draft.kind === 'file' && draft.size && draft.size > MAX_FILE_BYTES) {
        return {
          ok: false as const,
          error: `This file is ${formatFileSize(draft.size)} — larger than the 25 MB limit. You can compress it, or paste a cloud-storage link into the message field instead.`,
        };
      }
      const msg: PendingMessage = {
        clientTag: newClientTag(),
        conversationId: opts.conversationId ?? '',
        channelId: opts.channelId,
        content: caption?.trim() || null,
        messageType: draft.kind,
        localUri: draft.localUri,
        attachmentName: draft.name ?? null,
        attachmentSize: draft.size ?? null,
        attachmentMime: draft.mime,
        status: 'uploading',
        progress: 0,
        createdAt: new Date().toISOString(),
      };
      setPending((prev) => [...prev, msg]);
      void sendOne(msg);
      return { ok: true as const };
    },
    [opts.conversationId, opts.channelId, sendOne],
  );

  const retry = useCallback(
    (clientTag: string) => {
      setPending((prev) => {
        const msg = prev.find((p) => p.clientTag === clientTag);
        if (msg && msg.status === 'failed') {
          const reset: PendingMessage = { ...msg, status: msg.localUri ? 'uploading' : 'sending', progress: 0, errorText: undefined };
          void sendOne(reset);
          return prev.map((p) => (p.clientTag === clientTag ? reset : p));
        }
        return prev;
      });
    },
    [sendOne],
  );

  const discardFailed = useCallback((clientTag: string) => removePending(clientTag), [removePending]);

  /** Drop pending copies whose server row is already visible. */
  const reconcile = useCallback((serverMessages: ThreadMessage[]) => {
    setPending((prev) => {
      if (prev.length === 0) return prev;
      const serverTags = new Set(serverMessages.map((m) => m.client_tag).filter(Boolean));
      const next = prev.filter((p) => !serverTags.has(p.clientTag));
      return next.length === prev.length ? prev : next;
    });
  }, []);

  return { pending, sendText, sendAttachment, retry, discardFailed, reconcile };
}
