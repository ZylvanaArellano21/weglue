import { supabase } from './supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

// supabase-js returns the SAME channel instance for an existing topic, and
// calling .on('postgres_changes', …) on an already-subscribed channel throws
// ("cannot add `postgres_changes` callbacks … after `subscribe()`").
// Two things trigger that in a React app:
//   1. Two mounted components subscribing with the same topic string.
//   2. Unmount → remount races: removeChannel() awaits unsubscribe() before
//      dropping the channel from the client, so a fast remount gets the old
//      already-subscribed instance back.
// Every subscription therefore gets a unique topic (the topic string is
// arbitrary for postgres_changes — filtering happens via the bindings), and
// all setup is wrapped so a realtime failure degrades to a log line instead
// of an error-boundary crash. Screens keep working via normal query refetch.

// Sequence + random suffix: the counter alone is not enough if this module
// is ever instantiated twice (Metro/pnpm can resolve duplicate module copies,
// each starting its own counter at 0 — two "notifications:USER:1" topics
// would collide and re-trigger the postgres_changes-after-subscribe throw).
let topicSeq = 0;
const instanceSalt = Math.random().toString(36).slice(2, 8);

export interface PostgresChangesBinding {
  event: '*' | 'INSERT' | 'UPDATE' | 'DELETE';
  schema: string;
  table: string;
  filter?: string;
  callback: (payload: any) => void;
}

export function createSafeChannel(
  topicBase: string,
  bindings: PostgresChangesBinding[],
): RealtimeChannel | null {
  try {
    let channel = supabase.channel(`${topicBase}:${instanceSalt}:${++topicSeq}`);
    for (const { callback, ...filter } of bindings) {
      // Wrap every callback so a subscriber's own error can never bubble up
      // into the realtime socket handler and crash the error boundary.
      const safeCallback = (payload: any) => {
        try {
          callback(payload);
        } catch (e) {
          console.warn(`[realtime] ${topicBase} callback error`, e);
        }
      };
      channel = channel.on('postgres_changes', filter as any, safeCallback);
    }
    channel.subscribe((status, err) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.warn(`[realtime] ${topicBase} ${status}`, err?.message ?? '');
      }
    });
    return channel;
  } catch (e) {
    console.warn(`[realtime] failed to subscribe ${topicBase}`, e);
    return null;
  }
}

export function removeSafeChannel(channel: RealtimeChannel | null): void {
  if (!channel) return;
  try {
    void supabase.removeChannel(channel).catch(() => {});
  } catch {
    // Never let realtime teardown crash an unmount.
  }
}
