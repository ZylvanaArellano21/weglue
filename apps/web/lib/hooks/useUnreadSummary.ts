"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabaseBrowser } from "../supabase-browser";

// Web port of apps/mobile/hooks/useUnreadSummary.ts. Same `get_unread_summary`
// RPC, same two counts — so web badges and mobile badges are driven by the
// exact same shared backend records.
//
// Product meaning (from mobile, do NOT invent new rules from the screenshots):
//   unread_notifications → notification activity  (Home icon + sidebar entry)
//   unread_threads       → unread conversations   (Messages icon)
// Mobile has NO club-activity badge count, so the web Clubs icon shows none.

export type UnreadSummary = {
  unread_notifications: number;
  unread_threads: number;
};

async function fetchUnreadSummary(): Promise<UnreadSummary> {
  const supabase = getSupabaseBrowser();
  const { data, error } = await supabase.rpc("get_unread_summary");
  if (error) throw error;
  const summary = (data ?? {}) as Partial<UnreadSummary>;
  return {
    unread_notifications: Math.max(0, summary.unread_notifications ?? 0),
    unread_threads: Math.max(0, summary.unread_threads ?? 0),
  };
}

/** Read-only value (no subscription). Use at extra render sites. */
export function useUnreadSummaryValue(userId: string | undefined) {
  return useQuery({
    queryKey: ["unreadSummary", userId],
    queryFn: fetchUnreadSummary,
    enabled: !!userId,
    staleTime: 15 * 1000,
  });
}

/**
 * The live version — mount ONCE per session (HomeClient). Owns the single
 * realtime subscription that keeps both badge counts fresh across devices.
 */
export function useUnreadSummary(userId: string | undefined) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["unreadSummary", userId],
    queryFn: fetchUnreadSummary,
    enabled: !!userId,
    staleTime: 15 * 1000,
    refetchInterval: 60 * 1000,
  });

  useEffect(() => {
    if (!userId) return;
    const supabase = getSupabaseBrowser();
    const invalidate = () => {
      void queryClient.invalidateQueries({ queryKey: ["unreadSummary", userId] });
    };
    // One uniquely-named channel (mirrors mobile's `unread-summary:<id>`),
    // torn down on unmount so we never double-subscribe.
    const channel = supabase
      .channel(`unread-summary:${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        invalidate
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        () => {
          invalidate();
          void queryClient.invalidateQueries({ queryKey: ["notifications", userId] });
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        invalidate
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, queryClient]);

  return query;
}
