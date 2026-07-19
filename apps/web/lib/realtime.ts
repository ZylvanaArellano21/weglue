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
