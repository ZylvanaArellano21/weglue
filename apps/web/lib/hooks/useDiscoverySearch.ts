"use client";

import { useQuery } from "@tanstack/react-query";
import { getSupabaseBrowser } from "../supabase-browser";

export interface DiscoverySearchResult {
  result_type: "person" | "club";
  id: string;
  name: string;
  avatar_url: string | null;
  sub: string | null;
  is_member: boolean;
}

/** Same person/club search RPC and blocked-user filtering used by mobile. */
export function useDiscoverySearch(userId: string | undefined, query: string) {
  const normalized = query.trim();
  return useQuery({
    queryKey: ["discoverySearch", userId, normalized],
    queryFn: async (): Promise<DiscoverySearchResult[]> => {
      const supabase = getSupabaseBrowser();
      const { data, error } = await supabase.rpc("search_discovery", {
        p_user_id: userId!,
        p_query: normalized,
      });
      if (error) throw error;
      return ((data ?? []) as any[]).map((row) => ({
        result_type: row.result_type as DiscoverySearchResult["result_type"],
        id: row.id,
        name: row.name,
        avatar_url: row.avatar_url ?? null,
        sub: row.sub ?? null,
        is_member: !!row.is_member,
      }));
    },
    enabled: !!userId && normalized.length > 0,
    staleTime: 30 * 1000,
  });
}
