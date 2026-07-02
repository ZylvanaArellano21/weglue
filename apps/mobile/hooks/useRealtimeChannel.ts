import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

// ─── Channel messages (System 1: messages table) ──────────────────────────────

export interface RealtimeChannelOptions {
  channelId: string;
  conversationId: string;
  onNewMessage?: (payload: any) => void;
}

export function useRealtimeMessages(options: RealtimeChannelOptions): void {
  const channelRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    if (!options.channelId || !options.conversationId) return;

    const channel = supabase
      .channel(`messages:channel:${options.channelId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `channel_id=eq.${options.channelId}`,
        },
        (payload) => {
          options.onNewMessage?.(payload.new);
        },
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
    };
  }, [options.channelId, options.conversationId]);
}

// ─── Poll votes (System 1: poll_votes table) ──────────────────────────────────

export interface RealtimePollOptions {
  pollId: string;
  onVoteChange?: (payload: any) => void;
}

export function useRealtimePollVotes(options: RealtimePollOptions): void {
  const channelRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    if (!options.pollId) return;

    const channel = supabase
      .channel(`poll_votes:${options.pollId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'poll_votes',
          filter: `poll_id=eq.${options.pollId}`,
        },
        (payload) => {
          options.onVoteChange?.(payload);
        },
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
    };
  }, [options.pollId]);
}

// ─── Event RSVPs ──────────────────────────────────────────────────────────────

export interface RealtimeRsvpOptions {
  eventId: string;
  onRsvpChange?: (payload: any) => void;
}

export function useRealtimeEventRsvps(options: RealtimeRsvpOptions): void {
  const channelRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    if (!options.eventId) return;

    const channel = supabase
      .channel(`event_rsvps:${options.eventId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'event_rsvps',
          filter: `event_id=eq.${options.eventId}`,
        },
        (payload) => {
          options.onRsvpChange?.(payload);
        },
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
    };
  }, [options.eventId]);
}

// ─── Club members ─────────────────────────────────────────────────────────────

export interface RealtimeMemberOptions {
  clubId: string;
  onMemberChange?: (payload: any) => void;
}

export function useRealtimeClubMembers(options: RealtimeMemberOptions): void {
  const channelRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    if (!options.clubId) return;

    const channel = supabase
      .channel(`club_members:${options.clubId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'club_members',
          filter: `club_id=eq.${options.clubId}`,
        },
        (payload) => {
          options.onMemberChange?.(payload);
        },
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
    };
  }, [options.clubId]);
}

// ─── Direct / group conversation messages ─────────────────────────────────────

export interface RealtimeConvOptions {
  conversationId: string;
  onNewMessage?: (payload: any) => void;
  onDeleteMessage?: (payload: any) => void;
}

export function useRealtimeConversation(options: RealtimeConvOptions): void {
  const channelRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    if (!options.conversationId) return;

    const channel = supabase
      .channel(`messages:conv:${options.conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${options.conversationId}`,
        },
        (payload) => options.onNewMessage?.(payload.new),
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${options.conversationId}`,
        },
        (payload) => options.onDeleteMessage?.(payload.old),
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
    };
  }, [options.conversationId]);
}
