"use client";

import { useCallback, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createSafeChannel, removeSafeChannel, subscribeBroadcastEvents } from "../realtime";
import type { ThreadMessage, ThreadPage } from "./service";
import {
  canPostInChannel,
  unsendFailureMessage,
  unsendMessage,
  getChannelMuted,
  getConversationFlags,
  getConversationMuted,
  getChannels,
  getConversationDetails,
  getConversationHub,
  getMessageSuggestions,
  getMessagePerson,
  getMyConversations,
  getSharedEvents,
  getSharedMessages,
  getThread,
  searchMessageContent,
  searchMessagePeople,
} from "./service";

export const messageKeys = {
  conversations: (userId: string, limit = 30) => ["messages", "conversations", userId, limit] as const,
  details: (id: string, userId: string) => ["messages", "details", id, userId] as const,
  thread: (id: string, channelId: string | null) => ["messages", "thread", id, channelId ?? "direct"] as const,
  hub: (id: string, userId: string) => ["messages", "hub", id, userId] as const,
  channels: (id: string) => ["messages", "channels", id] as const,
  suggestions: () => ["messages", "suggestions"] as const,
  people: (query: string) => ["messages", "people", query] as const,
  contentSearch: (query: string, conversationId: string | null) => ["messages", "contentSearch", query, conversationId ?? "all"] as const,
  shared: (id: string, channelId: string | null, type: string) => ["messages", "shared", id, channelId ?? "direct", type] as const,
};

export function useMessageConversations(userId: string, limit = 30) {
  return useQuery({ queryKey: messageKeys.conversations(userId, limit), queryFn: () => getMyConversations(userId, limit), enabled: !!userId, staleTime: 15_000 });
}

export function useMessageDetails(conversationId: string | null, userId: string) {
  return useQuery({ queryKey: messageKeys.details(conversationId ?? "", userId), queryFn: () => getConversationDetails(conversationId!, userId), enabled: !!conversationId && !!userId, staleTime: 30_000 });
}

// userId is part of the key, not just the fetch: delete-for-me is per viewer,
// so two accounts must never share a cached thread page.
//
// `staleTime` is short rather than 0 (Bug 8). Thread freshness does NOT depend
// on it: `useMessagesRealtime` invalidates this exact key on every message
// lifecycle event for the open conversation, so a new, edited or unsent message
// still lands immediately. With 0, re-entering a conversation the viewer left
// seconds ago always refetched a full page of messages before rendering
// anything, which is what made "chat → back → chat" reload every time.
export function useMessageThread(conversationId: string | null, channelId: string | null, userId: string) {
  return useQuery({ queryKey: [...messageKeys.thread(conversationId ?? "", channelId), userId], queryFn: () => getThread(conversationId!, channelId, userId), enabled: !!conversationId && !!userId, staleTime: 30_000 });
}

export function useMessageHub(conversationId: string | null, userId: string) {
  return useQuery({ queryKey: messageKeys.hub(conversationId ?? "", userId), queryFn: () => getConversationHub(conversationId!, userId), enabled: !!conversationId && !!userId, staleTime: 10_000 });
}

export function useMessageChannels(conversationId: string | null) {
  return useQuery({ queryKey: messageKeys.channels(conversationId ?? ""), queryFn: () => getChannels(conversationId!), enabled: !!conversationId, staleTime: 30_000 });
}

export function useMessageSuggestions(enabled: boolean) {
  return useQuery({ queryKey: messageKeys.suggestions(), queryFn: getMessageSuggestions, enabled, staleTime: 5 * 60_000 });
}

export function useMessagePeopleSearch(query: string) {
  const trimmed = query.trim();
  return useQuery({ queryKey: messageKeys.people(trimmed), queryFn: () => searchMessagePeople(trimmed), enabled: trimmed.length >= 3, staleTime: 30_000 });
}

export function useMessageContentSearch(query: string, conversationId: string | null) {
  const trimmed = query.trim();
  return useQuery({ queryKey: messageKeys.contentSearch(trimmed, conversationId), queryFn: () => searchMessageContent(trimmed, conversationId), enabled: trimmed.length >= 3, staleTime: 15_000 });
}

export function useMessagePerson(userId: string | null) {
  return useQuery({ queryKey: ["messages", "person", userId], queryFn: () => getMessagePerson(userId!), enabled: !!userId, staleTime: 60_000 });
}

export function useMessagePermission(channelId: string | null) {
  return useQuery({ queryKey: ["messages", "canPost", channelId], queryFn: () => canPostInChannel(channelId!), enabled: !!channelId, staleTime: 10_000 });
}

/** Conversation-level mute + archive for this viewer (mobile's parent-info
 *  action row reads exactly these two flags). */
export function useConversationFlags(conversationId: string | null, userId: string) {
  return useQuery({
    queryKey: ["messages", "convFlags", conversationId, userId],
    queryFn: () => getConversationFlags(conversationId!, userId),
    enabled: !!conversationId && !!userId,
    staleTime: 30_000,
  });
}

export function useMessageMute(conversationId: string | null, channelId: string | null, userId: string) {
  return useQuery({
    queryKey: ["messages", "muted", conversationId, channelId ?? "conversation", userId],
    queryFn: () => channelId ? getChannelMuted(channelId, userId) : getConversationMuted(conversationId!, userId),
    enabled: !!conversationId && !!userId,
    staleTime: 30_000,
  });
}

export function useMessageShared(conversationId: string | null, channelId: string | null, type: "image" | "video" | "file" | "poll", userId: string) {
  return useQuery({ queryKey: [...messageKeys.shared(conversationId ?? "", channelId, type), userId], queryFn: () => getSharedMessages(conversationId!, channelId, type, userId), enabled: !!conversationId && !!userId, staleTime: 30_000 });
}

export function useMessageEvents(conversationId: string | null, channelId: string | null, userId: string) {
  return useQuery({ queryKey: [...messageKeys.shared(conversationId ?? "", channelId, "events"), userId], queryFn: () => getSharedEvents(conversationId!, channelId, userId), enabled: !!conversationId && !!userId, staleTime: 30_000 });
}

/**
 * Bug 1 — unsend has to feel immediate, in every web chat.
 *
 * Two separate things made it slow, and both are fixed rather than hidden:
 *
 *   1. The UI waited for the ENTIRE round trip before the message moved. For an
 *      attachment that round trip included storage work (see the edge function),
 *      so a photo could sit visibly in the thread for seconds after the person
 *      confirmed they wanted it gone.
 *   2. On success the whole thread was then refetched, so the message's
 *      disappearance was gated on a second round trip as well.
 *
 * The item is now dropped from every cache that renders it — the thread, and
 * the info panel's photos / videos / files / polls tabs — in the same tick the
 * person confirms. The real deletion still runs immediately afterwards and is
 * still the authority: if it genuinely fails, every snapshot is put back
 * exactly as it was, so the person is never told something was deleted when it
 * was not.
 *
 * Convergence only happens AFTER the server confirms. Invalidating earlier
 * would race the delete and pull the message straight back into view.
 */
export function useUnsendMessage(
  conversationId: string,
  channelId: string | null,
  userId: string,
  onError: (message: string) => void
): (messageId: string) => Promise<void> {
  const queryClient = useQueryClient();
  return useCallback(
    async (messageId: string) => {
      const threadKey = [...messageKeys.thread(conversationId, channelId), userId];
      const previousThread = queryClient.getQueryData<ThreadPage>(threadKey);
      // Photos/videos/files/polls panels for this conversation, whichever are
      // cached. Captured before the write so rollback is exact.
      const previousShared = queryClient.getQueriesData<ThreadMessage[]>({
        queryKey: ["messages", "shared", conversationId],
      });

      queryClient.setQueryData<ThreadPage>(threadKey, (page) =>
        page ? { ...page, messages: page.messages.filter((message) => message.id !== messageId) } : page
      );
      for (const [key, list] of previousShared) {
        if (Array.isArray(list)) {
          queryClient.setQueryData(
            key,
            list.filter((message) => message.id !== messageId)
          );
        }
      }

      try {
        await unsendMessage(messageId);
      } catch (error) {
        // The deletion did not happen, so the message must come back. Anything
        // else would leave the person believing content was removed from a
        // conversation it is still sitting in.
        if (previousThread) queryClient.setQueryData(threadKey, previousThread);
        for (const [key, list] of previousShared) queryClient.setQueryData(key, list);
        // Reporting the failure is done HERE, not by the caller.
        //
        // Found in QA: the explanation used to be attached as `.catch()` on this
        // promise inside the message's own component — but that component is
        // unmounted the moment the optimistic removal takes effect, so the
        // rejection had nowhere to surface. The message reappeared with no word
        // of why, which is precisely the "never leave them guessing" rule this
        // was written for. This hook is owned by the conversation, which stays
        // mounted for the whole operation.
        onError(unsendFailureMessage(error));
        return;
      }

      void queryClient.invalidateQueries({ queryKey: ["messages", "thread", conversationId] });
      void queryClient.invalidateQueries({ queryKey: ["messages", "shared", conversationId] });
      void queryClient.invalidateQueries({ queryKey: messageKeys.conversations(userId) });
      void queryClient.invalidateQueries({ queryKey: ["unreadSummary", userId] });
    },
    [channelId, conversationId, onError, queryClient, userId]
  );
}

/** Scoped, cleanup-safe invalidations for a Messages session. */
export function useMessagesRealtime(conversationId: string | null, userId: string): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!userId) return;
    const invalidateInbox = () => {
      void queryClient.invalidateQueries({ queryKey: messageKeys.conversations(userId) });
      void queryClient.invalidateQueries({ queryKey: ["unreadSummary", userId] });
    };
    const inbox = createSafeChannel("messages-inbox", [
      { event: "INSERT", schema: "public", table: "conversation_participants", filter: `user_id=eq.${userId}`, callback: invalidateInbox },
      { event: "UPDATE", schema: "public", table: "conversation_participants", filter: `user_id=eq.${userId}`, callback: invalidateInbox },
    ]);
    // The `sync:message-inbox:<uid>` broadcast (message deletion / read sync)
    // is owned session-long by useUnreadSummary — it shares this one Realtime
    // channel instance by topic, and a `removeChannel` here on unmount tore
    // down that shared subscription (and, since approach B, the foreground
    // message-banner feed). useUnreadSummary's `invalidate` handler now also
    // refreshes messageKeys.conversations(userId), so the list stays live.
    return () => {
      removeSafeChannel(inbox);
    };
  }, [queryClient, userId]);

  useEffect(() => {
    if (!conversationId) return;
    const invalidateOpen = () => {
      void queryClient.invalidateQueries({ queryKey: ["messages", "thread", conversationId] });
      void queryClient.invalidateQueries({ queryKey: ["messages", "shared", conversationId] });
      void queryClient.invalidateQueries({ queryKey: ["messages", "hub", conversationId] });
      void queryClient.invalidateQueries({ queryKey: messageKeys.channels(conversationId) });
      void queryClient.invalidateQueries({ queryKey: messageKeys.details(conversationId, userId) });
      void queryClient.invalidateQueries({ queryKey: messageKeys.conversations(userId) });
      void queryClient.invalidateQueries({ queryKey: ["unreadSummary", userId] });
    };
    const open = createSafeChannel(`messages-conversation-${conversationId}`, [
      { event: "*", schema: "public", table: "conversation_participants", filter: `conversation_id=eq.${conversationId}`, callback: invalidateOpen },
      { event: "*", schema: "public", table: "conversation_channels", filter: `conversation_id=eq.${conversationId}`, callback: invalidateOpen },
      // Fix 5 — the "certain people" allow-list itself was never watched:
      // conversation_channels only changes on a MODE switch, so editing WHO
      // is on the list without changing the mode silently went unsynced on
      // every other device/session. channel_posters has no conversation_id
      // column to filter by (only channel_id), so this is unfiltered here —
      // RLS still scopes actual delivery, and the subscription only lives
      // while this conversation is open.
      { event: "*", schema: "public", table: "channel_posters", callback: invalidateOpen },
    ]);
    // The database emits an opaque Day 10E-style invalidation for every
    // message lifecycle event. Canonical RLS-backed refetches own visibility.
    // Reactions and grouped-message metadata use this same existing private
    // thread topic; both handlers refetch canonical rows under RLS.
    const removeMessageSync = subscribeBroadcastEvents(
      `sync:message:${conversationId}`,
      { invalidate: invalidateOpen, reaction: invalidateOpen, message: invalidateOpen },
      invalidateOpen,
    );
    return () => {
      removeSafeChannel(open);
      removeMessageSync();
    };
  }, [conversationId, queryClient, userId]);
}
