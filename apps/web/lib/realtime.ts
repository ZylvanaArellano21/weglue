"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabaseBrowser } from "./supabase-browser";

// Web port of apps/mobile/lib/realtime.createSafeChannel. supabase-js returns the
// SAME channel instance for a repeated topic string and throws if you add
// postgres_changes bindings after subscribe(), which mount/remount races and
// duplicate subscribers hit. So every subscription gets a UNIQUE topic (the
// topic is arbitrary for postgres_changes — filtering is per-binding) and every
// callback is wrapped so a realtime hiccup degrades to a console warning; the UI
// keeps working via normal query refetch.

export interface PostgresChangesBinding {
  event: "*" | "INSERT" | "UPDATE" | "DELETE";
  schema: string;
  table: string;
  filter?: string;
  callback: (payload: any) => void;
}

let topicSeq = 0;
const instanceSalt = Math.random().toString(36).slice(2, 8);

export function createSafeChannel(
  topicBase: string,
  bindings: PostgresChangesBinding[]
): RealtimeChannel | null {
  try {
    const supabase = getSupabaseBrowser();
    let channel = supabase.channel(`${topicBase}:${instanceSalt}:${++topicSeq}`);
    for (const { callback, ...filter } of bindings) {
      const safeCallback = (payload: any) => {
        try {
          callback(payload);
        } catch (e) {
          console.warn(`[realtime] ${topicBase} callback error`, e);
        }
      };
      channel = channel.on("postgres_changes", filter as any, safeCallback);
    }
    channel.subscribe((status: string, err?: Error) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        console.warn(`[realtime] ${topicBase} ${status}`, err?.message ?? "");
      }
    });
    return channel;
  } catch (e) {
    console.warn(`[realtime] failed to subscribe ${topicBase}`, e);
    return null;
  }
}

// RealtimeClient.removeChannel() calls unsubscribe(); the channel's close
// handler removes it from the client on a successful leave or leave timeout.
// Track in-flight removals so repeated cleanup does not send another leave.
const removingChannels = new WeakSet<RealtimeChannel>();

export function removeSafeChannel(channel: RealtimeChannel | null): void {
  if (!channel || removingChannels.has(channel)) return;
  try {
    const supabase = getSupabaseBrowser();
    if (!supabase.getChannels().includes(channel)) return;
    removingChannels.add(channel);
    void supabase.removeChannel(channel).then(
      (status: string) => {
        if (status === "error") removingChannels.delete(channel);
      },
      (e: unknown) => {
        removingChannels.delete(channel);
        console.warn("[realtime] removeChannel failed", e);
      },
    );
  } catch (e) {
    removingChannels.delete(channel);
    console.warn("[realtime] removeChannel failed", e);
  }
}

// A private channel's own Phoenix rejoin timer retries CHANNEL_ERROR/TIMED_OUT
// forever with no way for us to intervene from the outside — that's correct
// for a transient network blip, but an "Unauthorized" denial from the
// realtime.messages RLS policy is a HARD, PERMANENT verdict: the topic is
// wrong or the policy doesn't cover it, and no amount of rejoining ever
// changes that. Left alone this retries every few seconds for the entire app
// session, one wasted socket round-trip at a time. Detecting the specific
// "Unauthorized" signature and tearing the channel down (rather than letting
// it keep rejoining) turns an infinite failing loop into a single warning.
// Mirrors apps/mobile/lib/realtime.ts's isPermanentChannelAuthFailure.
function isPermanentChannelAuthFailure(err?: Error): boolean {
  return !!err?.message && /unauthorized/i.test(err.message);
}

// Subscribe to a PRIVATE Broadcast channel whose name IS the authorization topic
// (e.g. `event:<id>` / `post:<id>`). The topic gates receipt via the
// realtime.messages RLS policies in migration 050, so a user only gets pings for
// items they can see. The payload is an invalidation-only signal — the caller
// refetches through the app's normal RLS-governed queries.
//
// Private channels require the realtime socket to carry the user's JWT, which is
// set EXPLICITLY here (relying on the browser client's auto-wiring proved
// unreliable). Because that read is async, this returns a cleanup function
// rather than the channel; a subscription still in flight when the caller
// unmounts is cancelled, and any channel already opened is removed. The callback
// and subscribe are wrapped so a realtime hiccup — or an authorization denial —
// degrades to a console warning while the UI keeps working via refetch. One
// channel per topic; the caller invokes the returned cleanup on unmount / id
// change.
// One private-broadcast subscription carrying SEVERAL events on one channel —
// e.g. `sync:message-inbox:<uid>` delivers both `invalidate` (deletion/read
// sync) and `new_message` (foreground banner). One socket subscription instead
// of one per event; each handler receives the broadcast payload. Same
// authorization contract as subscribeBroadcast: a payload is never treated as
// authorization; refetch canonical state where it matters.
export function subscribeBroadcastEvents(
  topic: string,
  handlers: Record<string, (payload: any) => void>,
  onSubscribed?: () => void
): () => void {
  let channel: RealtimeChannel | null = null;
  let cancelled = false;

  void (async () => {
    try {
      const supabase = getSupabaseBrowser();
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (token) await supabase.realtime.setAuth(token);
      if (cancelled) return;
      let ch = supabase.channel(topic, { config: { private: true } });
      for (const [event, handler] of Object.entries(handlers)) {
        ch = ch.on("broadcast", { event }, (message: any) => {
          try {
            handler(message?.payload ?? message);
          } catch (e) {
            console.warn(`[realtime] ${topic}/${event} broadcast callback error`, e);
          }
        });
      }
      channel = ch.subscribe((status: string, err?: Error) => {
        if (status === "SUBSCRIBED") {
          try {
            onSubscribed?.();
          } catch (e) {
            console.warn(`[realtime] ${topic} subscribe callback error`, e);
          }
          return;
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.warn(`[realtime] ${topic} ${status}`, err?.message ?? "");
          if (isPermanentChannelAuthFailure(err)) {
            console.warn(`[realtime] ${topic} unauthorized — giving up, will not retry`);
            const dead = channel;
            channel = null;
            removeSafeChannel(dead);
          }
        }
      });
    } catch (e) {
      console.warn(`[realtime] failed to subscribe broadcast ${topic}`, e);
    }
  })();

  return () => {
    cancelled = true;
    removeSafeChannel(channel);
  };
}

export function subscribeBroadcast(
  topic: string,
  event: string,
  onMessage: () => void,
  onSubscribed?: () => void
): () => void {
  let channel: RealtimeChannel | null = null;
  let cancelled = false;

  void (async () => {
    try {
      const supabase = getSupabaseBrowser();
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (token) await supabase.realtime.setAuth(token);
      if (cancelled) return;
      channel = supabase
        .channel(topic, { config: { private: true } })
        .on("broadcast", { event }, () => {
          try {
            onMessage();
          } catch (e) {
            console.warn(`[realtime] ${topic} broadcast callback error`, e);
          }
        })
        .subscribe((status: string, err?: Error) => {
          if (status === "SUBSCRIBED") {
            try {
              onSubscribed?.();
            } catch (e) {
              console.warn(`[realtime] ${topic} subscribe callback error`, e);
            }
            return;
          }
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            console.warn(`[realtime] ${topic} ${status}`, err?.message ?? "");
            if (isPermanentChannelAuthFailure(err)) {
              console.warn(`[realtime] ${topic} unauthorized — giving up, will not retry`);
              const dead = channel;
              channel = null;
              removeSafeChannel(dead);
            }
          }
        });
    } catch (e) {
      console.warn(`[realtime] failed to subscribe broadcast ${topic}`, e);
    }
  })();

  return () => {
    cancelled = true;
    removeSafeChannel(channel);
  };
}
