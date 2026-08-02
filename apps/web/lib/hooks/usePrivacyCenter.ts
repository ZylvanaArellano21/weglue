"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabaseBrowser } from "../supabase-browser";

// ─── Privacy Center (web) ────────────────────────────────────────────────────
//
// Web port of apps/mobile/services/privacyService.ts + hooks/usePrivacyCenter.ts.
// The SAME `user_privacy` row backs both platforms — there is no web-only
// privacy state — so a toggle flipped on the phone is already flipped here.
//
// Going private does NOT retroactively revoke existing accepted follows. It only
// gates NEW follow requests going forward: followUser() sets status = 'pending'
// when the target is private. Existing Gluemates are untouched. That is the
// mobile rule and it is not reinterpreted here.
//
// These flags drive the UI. They are NOT the security boundary — RLS on the
// server decides what another student can actually read, so hiding a section in
// the browser is presentation, never protection.

export interface PrivacySettings {
  is_private: boolean;
  hide_interests: boolean;
  hide_events: boolean;
}

export const PRIVACY_QUERY_KEY = "privacySettings";

export async function getPrivacySettings(userId: string): Promise<PrivacySettings> {
  const supabase = getSupabaseBrowser();
  const { data } = await supabase
    .from("user_privacy")
    .select("is_private, hide_interests, hide_events")
    .eq("user_id", userId)
    .maybeSingle();

  const row = data as Partial<PrivacySettings> | null;
  return {
    is_private: row?.is_private ?? false,
    hide_interests: row?.hide_interests ?? false,
    hide_events: row?.hide_events ?? false,
  };
}

async function upsertPrivacyField(
  userId: string,
  fields: Partial<PrivacySettings>
): Promise<void> {
  const { error } = await getSupabaseBrowser()
    .from("user_privacy")
    .upsert({ user_id: userId, ...fields }, { onConflict: "user_id" });
  if (error) throw error;
}

export function usePrivacySettings(userId: string | undefined) {
  return useQuery({
    queryKey: [PRIVACY_QUERY_KEY, userId],
    queryFn: () => getPrivacySettings(userId!),
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Shared optimistic-toggle factory. Each switch flips instantly, rolls back on
 * failure, and refetches on settle — identical to the mobile mutations.
 *
 * `hide_interests` / `hide_events` also change what OTHER people's views of this
 * profile may show, so a successful write additionally invalidates the public
 * profile caches (`userProfile`, `userWeeklyEvents`) — otherwise a viewer with
 * the page already open would keep seeing a section the owner just hid.
 */
function usePrivacyToggle(
  userId: string | undefined,
  field: keyof PrivacySettings
) {
  const queryClient = useQueryClient();
  const key = [PRIVACY_QUERY_KEY, userId];

  return useMutation<void, Error, boolean, { prev: PrivacySettings | undefined }>({
    mutationFn: (value: boolean) => upsertPrivacyField(userId!, { [field]: value }),
    onMutate: async (value) => {
      await queryClient.cancelQueries({ queryKey: key });
      const prev = queryClient.getQueryData<PrivacySettings>(key);
      if (prev) queryClient.setQueryData<PrivacySettings>(key, { ...prev, [field]: value });
      return { prev };
    },
    onError: (_err, _value, context) => {
      if (context?.prev) queryClient.setQueryData(key, context.prev);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["userProfile"] });
      void queryClient.invalidateQueries({ queryKey: ["userWeeklyEvents"] });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });
}

export function useSetPrivateAccount(userId: string | undefined) {
  return usePrivacyToggle(userId, "is_private");
}

export function useSetHideInterests(userId: string | undefined) {
  return usePrivacyToggle(userId, "hide_interests");
}

export function useSetHideEvents(userId: string | undefined) {
  return usePrivacyToggle(userId, "hide_events");
}
