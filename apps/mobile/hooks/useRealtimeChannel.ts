import { useEffect } from 'react';
import { createSafeChannel, removeSafeChannel, subscribeBroadcast } from '../lib/realtime';

// ─── Channel messages (System 1: messages table) ──────────────────────────────

export interface RealtimeChannelOptions {
  channelId: string;
  conversationId: string;
  /** Called after an opaque, server-authorized message invalidation. */
  onNewMessage?: () => void;
}

export function useRealtimeMessages(options: RealtimeChannelOptions): void {
  useEffect(() => {
    if (!options.channelId || !options.conversationId) return;

    return subscribeBroadcast(
      `sync:message:${options.conversationId}`,
      'invalidate',
      () => options.onNewMessage?.(),
      () => options.onNewMessage?.(),
    );
  }, [options.channelId, options.conversationId, options.onNewMessage]);
}

// ─── Poll votes (System 1: poll_votes table) ──────────────────────────────────

export interface RealtimePollOptions {
  pollId: string;
  onVoteChange?: (payload: any) => void;
}

export function useRealtimePollVotes(options: RealtimePollOptions): void {
  useEffect(() => {
    if (!options.pollId) return;

    const channel = createSafeChannel(`poll_votes:${options.pollId}`, [
      {
        event: '*',
        schema: 'public',
        table: 'poll_votes',
        filter: `poll_id=eq.${options.pollId}`,
        callback: (payload) => {
          options.onVoteChange?.(payload);
        },
      },
    ]);

    return () => {
      removeSafeChannel(channel);
    };
  }, [options.pollId]);
}

// ─── Event RSVPs ──────────────────────────────────────────────────────────────

export interface RealtimeRsvpOptions {
  eventId: string;
  onRsvpChange?: (payload: any) => void;
}

export function useRealtimeEventRsvps(options: RealtimeRsvpOptions): void {
  useEffect(() => {
    if (!options.eventId) return;

    const channel = createSafeChannel(`event_rsvps:${options.eventId}`, [
      {
        event: '*',
        schema: 'public',
        table: 'event_rsvps',
        filter: `event_id=eq.${options.eventId}`,
        callback: (payload) => {
          options.onRsvpChange?.(payload);
        },
      },
    ]);

    return () => {
      removeSafeChannel(channel);
    };
  }, [options.eventId]);
}

// ─── Club members ─────────────────────────────────────────────────────────────

export interface RealtimeMemberOptions {
  clubId: string;
  onMemberChange?: (payload: any) => void;
}

export function useRealtimeClubMembers(options: RealtimeMemberOptions): void {
  useEffect(() => {
    if (!options.clubId) return;

    const channel = createSafeChannel(`club_members:${options.clubId}`, [
      {
        event: '*',
        schema: 'public',
        table: 'club_members',
        filter: `club_id=eq.${options.clubId}`,
        callback: (payload) => {
          options.onMemberChange?.(payload);
        },
      },
    ]);

    return () => {
      removeSafeChannel(channel);
    };
  }, [options.clubId]);
}

// ─── Direct / group conversation messages ─────────────────────────────────────

export interface RealtimeConvOptions {
  conversationId: string;
  onNewMessage?: () => void;
  onDeleteMessage?: () => void;
}

export function useRealtimeConversation(options: RealtimeConvOptions): void {
  useEffect(() => {
    if (!options.conversationId) return;

    return subscribeBroadcast(
      `sync:message:${options.conversationId}`,
      'invalidate',
      () => {
        options.onNewMessage?.();
        options.onDeleteMessage?.();
      },
    );
  }, [options.conversationId, options.onNewMessage, options.onDeleteMessage]);
}
