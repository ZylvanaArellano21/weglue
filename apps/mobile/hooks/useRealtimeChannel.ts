import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

export interface RealtimeChannelOptions {
  channelId: string;
  clubId: string;
  onNewMessage?: (payload: any) => void;
}

export function useRealtimeMessages(options: RealtimeChannelOptions): void {
  const channelRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    if (!options.channelId || !options.clubId) return;

    const channel = supabase
      .channel(`channel_messages:${options.channelId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'channel_messages',
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
  }, [options.channelId, options.clubId]);
}

export interface RealtimePollOptions {
  pollId: string;
  onVoteChange?: (payload: any) => void;
}

export function useRealtimePollVotes(options: RealtimePollOptions): void {
  const channelRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    if (!options.pollId) return;

    const channel = supabase
      .channel(`club_poll_votes:${options.pollId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'club_poll_votes',
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
