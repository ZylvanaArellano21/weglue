"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabaseBrowser } from "../supabase-browser";
import { getClubProfile, type ClubProfileData } from "../clubs/clubProfileService";
import { myClubsKey, discoveryClubsKey } from "./useClubTab";
import { invalidateEventState } from "./eventSync";

export const clubProfileKey = (clubId?: string, userId?: string) =>
  ["clubProfile", clubId, userId] as const;

export function useClubProfile(clubId: string | undefined, userId: string | undefined) {
  return useQuery<ClubProfileData | null>({
    queryKey: clubProfileKey(clubId, userId),
    queryFn: () => getClubProfile(clubId!, userId!),
    enabled: !!clubId && !!userId,
    staleTime: 2 * 60 * 1000,
  });
}

export class OnlyOfficerError extends Error {
  constructor() {
    super("You're the only officer of this club. Assign another officer before leaving.");
    this.name = "OnlyOfficerError";
  }
}

// Join / leave the club from the profile. Join = plain upsert (RLS-guarded).
// Leave = the race-safe leave_club RPC (migration 029/032) which blocks the
// sole officer and lets AFTER DELETE triggers strip officer role, group-chat
// access, and members-only RSVPs atomically — identical to mobile. Optimistic
// on the profile, then invalidates profile + sidebar + catalog so every Club
// surface and Home resync.
export function useToggleClubMembership(clubId: string | undefined, userId: string | undefined) {
  const queryClient = useQueryClient();
  const key = clubProfileKey(clubId, userId);

  return useMutation<
    void,
    Error,
    { join: boolean },
    { previous?: ClubProfileData | null }
  >({
    mutationFn: async ({ join }) => {
      const supabase = getSupabaseBrowser();
      if (join) {
        const { error } = await supabase
          .from("club_members")
          .upsert({ user_id: userId!, club_id: clubId!, role: "member" }, { onConflict: "club_id,user_id" });
        if (error) throw error;
      } else {
        const { data, error } = await supabase.rpc("leave_club", { p_club_id: clubId! });
        if (error) throw error;
        if (data === "blocked_only_officer") throw new OnlyOfficerError();
      }
    },
    onMutate: async ({ join }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<ClubProfileData | null>(key);
      if (previous) {
        queryClient.setQueryData<ClubProfileData | null>(key, (current) =>
          current
            ? {
                ...current,
                is_member: join,
                // Leaving always drops officer powers; joining never grants them.
                is_officer: join ? current.is_officer : false,
                officer_role: join ? current.officer_role : null,
                member_count: Math.max(0, current.member_count + (join ? 1 : -1)),
              }
            : current
        );
      }
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous !== undefined) queryClient.setQueryData(key, context.previous);
    },
    onSettled: (_data, _error, variables) => {
      void queryClient.invalidateQueries({ queryKey: key });
      void queryClient.invalidateQueries({ queryKey: myClubsKey(userId) });
      void queryClient.invalidateQueries({ queryKey: discoveryClubsKey(userId) });
      invalidateEventState(queryClient, userId);
      void queryClient.invalidateQueries({ queryKey: ["isOfficer", userId] });
      void queryClient.invalidateQueries({ queryKey: ["officerClubs", userId] });
      void queryClient.invalidateQueries({ queryKey: ["notifications", userId] });
      void queryClient.invalidateQueries({ queryKey: ["unreadSummary", userId] });
      if (!variables.join && !_error) {
        // Direct event and chat routes should show their unavailable state
        // immediately after a successful leave, not stale restricted data.
        //
        // `resetQueries`, NOT `removeQueries` — see the same correction and
        // rationale in studentSynchronization.ts:66-81. `removeQueries`
        // destroys the query object; a screen still observing it (an open
        // event detail, the messages list) keeps a subscription to nothing
        // and an in-flight fetch resolves onto the discarded object, leaving
        // it permanently `status: "pending"`. `resetQueries` returns the
        // query to its initial state AND refetches every active observer, so
        // the screen actually converges to the unavailable state instead of
        // hanging on a skeleton forever.
        queryClient.resetQueries({ queryKey: ["eventDetail"] });
        queryClient.resetQueries({ queryKey: ["eventAttendees"] });
        queryClient.resetQueries({ queryKey: ["savedEvents"] });
        queryClient.resetQueries({ queryKey: ["messages"] });
      }
      void queryClient.invalidateQueries({ queryKey: ["ownProfile", userId] });
    },
  });
}
