import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createSafeChannel, removeSafeChannel } from '../lib/realtime';

/**
 * Subscribes to new messages in a conversation and auto-invalidates
 * the React Query cache so the thread re-fetches without manual polling.
 */
export function useRealtimeDirectMessages(conversationId: string | undefined): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!conversationId) return;

    const channel = createSafeChannel(`dm:${conversationId}`, [
      {
        event: '*',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${conversationId}`,
        callback: () => {
          queryClient.invalidateQueries({ queryKey: ['directMessages', conversationId] });
          queryClient.invalidateQueries({ queryKey: ['myChats'] });
        },
      },
    ]);

    return () => { removeSafeChannel(channel); };
  }, [conversationId, queryClient]);
}

/**
 * Subscribes to poll_votes changes for a given poll and invalidates
 * the poll query so vote counts update in real-time.
 */
export function useRealtimePoll(pollId: string | undefined): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!pollId) return;

    const channel = createSafeChannel(`poll:${pollId}`, [
      {
        event: '*',
        schema: 'public',
        table: 'poll_votes',
        filter: `poll_id=eq.${pollId}`,
        callback: () => {
          queryClient.invalidateQueries({ queryKey: ['poll', pollId] });
        },
      },
    ]);

    return () => { removeSafeChannel(channel); };
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
  useEffect(() => {
    if (!conversationId || !userId) return;

    const channel = createSafeChannel(`participants:${conversationId}`, [
      {
        event: 'INSERT',
        schema: 'public',
        table: 'conversation_participants',
        filter: `conversation_id=eq.${conversationId}`,
        callback: (payload) => {
          if ((payload.new as any).user_id === userId) {
            onJoined();
          }
        },
      },
    ]);

    return () => { removeSafeChannel(channel); };
  }, [conversationId, userId, onJoined]);
}
