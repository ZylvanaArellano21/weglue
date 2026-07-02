import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

/**
 * Subscribes to new messages in a conversation and auto-invalidates
 * the React Query cache so the thread re-fetches without manual polling.
 */
export function useRealtimeDirectMessages(conversationId: string | undefined): void {
  const queryClient = useQueryClient();
  const channelRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    if (!conversationId) return;

    const channel = supabase
      .channel(`dm:${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['directMessages', conversationId] });
          queryClient.invalidateQueries({ queryKey: ['myChats'] });
        },
      )
      .subscribe();

    channelRef.current = channel;
    return () => { supabase.removeChannel(channel); };
  }, [conversationId, queryClient]);
}

/**
 * Subscribes to poll_votes changes for a given poll and invalidates
 * the poll query so vote counts update in real-time.
 */
export function useRealtimePoll(pollId: string | undefined): void {
  const queryClient = useQueryClient();
  const channelRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    if (!pollId) return;

    const channel = supabase
      .channel(`poll:${pollId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'poll_votes',
          filter: `poll_id=eq.${pollId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['poll', pollId] });
        },
      )
      .subscribe();

    channelRef.current = channel;
    return () => { supabase.removeChannel(channel); };
  }, [pollId, queryClient]);
}

/**
 * Subscribes to conversation_participants changes.
 * Used to detect when the current user gets added to a chat (e.g. joins a club)
 * so the view switches from preview to full access without requiring an app restart.
 */
export function useRealtimeParticipants(
  conversationId: string | undefined,
  userId: string | undefined,
  onJoined: () => void,
): void {
  const channelRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    if (!conversationId || !userId) return;

    const channel = supabase
      .channel(`participants:${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'conversation_participants',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          if ((payload.new as any).user_id === userId) {
            onJoined();
          }
        },
      )
      .subscribe();

    channelRef.current = channel;
    return () => { supabase.removeChannel(channel); };
  }, [conversationId, userId, onJoined]);
}
