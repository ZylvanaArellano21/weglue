"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createSafeChannel, removeSafeChannel, subscribeBroadcast } from "../realtime";
import {
  canPostInChannel,
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
export function useMessageThread(conversationId: string | null, channelId: string | null, userId: string) {
  return useQuery({ queryKey: [...messageKeys.thread(conversationId ?? "", channelId), userId], queryFn: () => getThread(conversationId!, channelId, userId), enabled: !!conversationId && !!userId, staleTime: 0 });
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
      { event: "INSERT", schema: "public", table: "conversation_participants", callback: invalidateInbox },
      { event: "UPDATE", schema: "public", table: "conversation_participants", callback: invalidateInbox },
    ]);
    // Never subscribe to raw messages here: an UPDATE event can include a
    // pre-scrub OLD row. The database sends an authorized opaque ping instead.
    const removeMessageSync = subscribeBroadcast(`sync:message-inbox:${userId}`, "invalidate", invalidateInbox, invalidateInbox);
    return () => {
      removeSafeChannel(inbox);
      removeMessageSync();
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
    ]);
    // The database emits an opaque Day 10E-style invalidation for every
    // message lifecycle event. Canonical RLS-backed refetches own visibility.
    const removeMessageSync = subscribeBroadcast(`sync:message:${conversationId}`, "invalidate", invalidateOpen, invalidateOpen);
    return () => {
      removeSafeChannel(open);
      removeMessageSync();
    };
  }, [conversationId, queryClient, userId]);
}
