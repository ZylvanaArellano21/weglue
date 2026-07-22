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

export function removeSafeChannel(channel: RealtimeChannel | null): void {
  if (!channel) return;
  try {
    void getSupabaseBrowser().removeChannel(channel);
  } catch (e) {
    console.warn("[realtime] removeChannel failed", e);
  }
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
export function subscribeBroadcast(
  topic: string,
  event: string,
  onMessage: () => void
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
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            console.warn(`[realtime] ${topic} ${status}`, err?.message ?? "");
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
