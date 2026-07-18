"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabaseBrowser } from "../supabase-browser";

// Web port of apps/mobile/hooks/usePicturePrompt.ts. The "Personalize your
// picture!" prompt state lives server-side (profiles.picture_prompt_status) so
// it holds across logout/login and other devices — exactly like mobile. It is
// shown ONLY for genuinely new accounts (status 'pending') that still have no
// custom avatar; existing accounts were backfilled to 'hidden' and never see
// it. Acting on it dismisses it permanently via the dismiss_picture_prompt RPC.

export interface PicturePromptState {
  status: "pending" | "hidden";
  avatar_url: string | null;
}

export function usePicturePromptState(userId: string | undefined) {
  return useQuery({
    queryKey: ["picturePrompt", userId],
    queryFn: async (): Promise<PicturePromptState> => {
      const supabase = getSupabaseBrowser();
      const { data } = await supabase
        .from("profiles")
        .select("picture_prompt_status, avatar_url")
        .eq("id", userId!)
        .maybeSingle();
      return {
        status: ((data as any)?.picture_prompt_status ?? "hidden") as "pending" | "hidden",
        avatar_url: (data as any)?.avatar_url ?? null,
      };
    },
    enabled: !!userId,
    staleTime: 60 * 1000,
  });
}

export function useDismissPicturePrompt(userId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const supabase = getSupabaseBrowser();
      const { error } = await supabase.rpc("dismiss_picture_prompt");
      if (error) throw error;
    },
    onMutate: async () => {
      const key = ["picturePrompt", userId];
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<PicturePromptState>(key);
      if (previous) queryClient.setQueryData(key, { ...previous, status: "hidden" });
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["picturePrompt", userId], context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["picturePrompt", userId] });
    },
  });
}
