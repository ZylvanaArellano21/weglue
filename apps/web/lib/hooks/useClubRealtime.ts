"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createSafeChannel, removeSafeChannel, subscribeBroadcast } from "../realtime";
import { clubProfileKey } from "./useClubProfile";
import { clubEventsFeedKey } from "./useClubEventsFeed";
import { myClubsKey, discoveryClubsKey } from "./useClubTab";
import { refreshPermissionSensitiveEventState } from "./eventSync";

/**
 * Membership and officer role changes alter several independently cached
 * capability checks. This intentionally clears (rather than merely marks
 * stale) private payload caches: React Query otherwise renders a prior result
 * while a background RLS refetch is in flight after a user leaves a club.
 */
// Self-echo suppression — see markLocalClubEdit(). A short, per-club window
// so the Postgres realtime event for a change THIS user just made (Edit Club
// save, add/remove officer, photo removal) doesn't trigger a second,
// redundant invalidate/refetch of the exact query the mutation's own
// onSuccess already refreshed — that duplicate round trip is what showed up
// as the profile "refreshing again" right after Save. The window is short
// and scoped to this one club, so a genuinely concurrent edit from another
// officer is still picked up shortly after (by the query's normal staleTime,
// or the very next realtime event once the window elapses).
const recentLocalClubEdits = new Map<string, number>();
const LOCAL_CLUB_EDIT_SUPPRESS_MS = 4000;

export function markLocalClubEdit(clubId: string): void {
  recentLocalClubEdits.set(clubId, Date.now());
}

function isSuppressedLocalEdit(clubId: string): boolean {
  const at = recentLocalClubEdits.get(clubId);
  return at !== undefined && Date.now() - at < LOCAL_CLUB_EDIT_SUPPRESS_MS;
}

// `resetQueries`, NOT `removeQueries` — see studentSynchronization.ts:66-81 for
// the documented defect this mirrors. `removeQueries` destroys the query
// object; a screen still observing it (Messages open in another tab, a
// mounted officer-only control) keeps a subscription to nothing and an
// in-flight fetch resolves onto the discarded object, leaving it permanently
// `status: "pending"`. `resetQueries` clears the cached payload (the same
// privacy/correctness requirement `removeQueries` was reaching for) AND
// refetches every active observer in one call, so the surface actually
// converges instead of hanging on a skeleton. This previously called
// `removeQueries` followed immediately by `invalidateQueries` on the same
// key as a workaround for the same gap `resetQueries` already closes
// correctly.
function refreshMembershipPermissions(queryClient: ReturnType<typeof useQueryClient>, userId: string): void {
  refreshPermissionSensitiveEventState(queryClient, userId);
  for (const key of [
    ["isOfficer", userId],
    ["officerClubs", userId],
    ["eventAudienceMemberSearch", userId],
    ["notifications", userId],
    ["unreadSummary", userId],
  ]) {
    queryClient.resetQueries({ queryKey: key });
  }
  // Conversation participants are removed by the existing membership triggers.
  // Reset every messages query so a removed member never briefly reuses local
  // history while its next RLS query resolves.
  queryClient.resetQueries({ queryKey: ["messages"] });
  queryClient.resetQueries({ queryKey: ["conversationHub"] });
  queryClient.resetQueries({ queryKey: ["clubChannels"] });
  queryClient.resetQueries({ queryKey: ["chatDetails"] });
}

// Cross-user realtime for the open Club Profile. Subscribes ONLY to this club's
// rows (every binding is filtered by club_id / id = this club) and invalidates
// the precise queries a change affects — so a join/leave, officer change, member
// removal, profile/banner/avatar/outcomes/schedule edit, event create·edit·
// delete, or media create·hide·remove·delete made by ANOTHER user shows here
// without a page reload. The current user's own actions already updated
// optimistically; these authoritative events simply reconcile.
//
// Precise invalidation (never a full reload), one channel per mount, cleaned up
// on unmount / clubId change. Scale-sensitive cross-user signals with no
// club_id column (RSVP counts, per-post likes/comments) are intentionally NOT
// firehose-subscribed; they reconcile on refetch — see the final report.
export function useClubRealtime(clubId: string | undefined, userId: string | undefined): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!clubId || !userId) return;

    const invalidateProfile = () => void queryClient.invalidateQueries({ queryKey: clubProfileKey(clubId, userId) });
    // clubs (name/about/banner/schedule) and club_goals are only ever written
    // by this club's own Edit Club save — always covered by markLocalClubEdit.
    const invProfile = () => {
      if (isSuppressedLocalEdit(clubId)) return;
      invalidateProfile();
    };
    const invMembershipCore = () => {
      invalidateProfile();
      void queryClient.invalidateQueries({ queryKey: ["clubMemberList", clubId] });
      void queryClient.invalidateQueries({ queryKey: myClubsKey(userId) });
      void queryClient.invalidateQueries({ queryKey: discoveryClubsKey(userId) });
      // A membership/role row can immediately change Home visibility, direct
      // event access, RSVP/attendee rights, Saved Events, and Calendar. Do not
      // leave a member-only result usable until its normal stale timeout.
      refreshMembershipPermissions(queryClient, userId);
    };
    // club_members (join/leave) is driven by useToggleClubMembership on the
    // main profile view, not by Edit Club — never suppressed, so another
    // student joining/leaving while an officer has the modal open still
    // updates the member count/list live.
    const invMembers = invMembershipCore;
    // club_officers IS written by Edit Club's add/remove officer actions —
    // same self-echo suppression as the profile fields.
    const invOfficers = () => {
      if (isSuppressedLocalEdit(clubId)) return;
      invMembershipCore();
    };
    const invEvents = () => {
      invalidateProfile();
      void queryClient.invalidateQueries({ queryKey: clubEventsFeedKey(clubId, userId) });
    };
    // club_photos IS written by Edit Club's photo-removal actions.
    const invMedia = () => {
      if (isSuppressedLocalEdit(clubId)) return;
      invalidateProfile();
      void queryClient.invalidateQueries({ queryKey: ["clubPhotoFeed", clubId] });
    };

    const channel = createSafeChannel(`club:${clubId}`, [
      { event: "*", schema: "public", table: "clubs", filter: `id=eq.${clubId}`, callback: invProfile },
      { event: "*", schema: "public", table: "club_goals", filter: `club_id=eq.${clubId}`, callback: invProfile },
      { event: "*", schema: "public", table: "club_members", filter: `club_id=eq.${clubId}`, callback: invMembers },
      { event: "*", schema: "public", table: "club_officers", filter: `club_id=eq.${clubId}`, callback: invOfficers },
      { event: "*", schema: "public", table: "events", filter: `club_id=eq.${clubId}`, callback: invEvents },
      { event: "*", schema: "public", table: "club_photos", filter: `club_id=eq.${clubId}`, callback: invMedia },
    ]);

    return () => removeSafeChannel(channel);
  }, [clubId, userId, queryClient]);
}

// Event-overlay realtime: another user's RSVP change (INSERT / UPDATE / DELETE)
// to the OPEN event updates its attendee count + avatars live. Delivered via a
// PRIVATE Broadcast topic `event:<id>` (migration 050) — deletion-safe (the
// trigger reads OLD.event_id, unlike filtered postgres_changes which can't see
// event_id on a DELETE) and visibility-gated (a user only receives if they can
// see the event). The ping carries no row data; we refetch through RLS-governed
// queries. One channel per open event; cleaned up on unmount / event change.
export function useEventRsvpRealtime(eventId: string | undefined, userId: string | undefined): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!eventId || !userId) return;
    return subscribeBroadcast(`event:${eventId}`, "interaction", () => {
      void queryClient.invalidateQueries({ queryKey: ["eventDetail", eventId] });
      void queryClient.invalidateQueries({ queryKey: ["clubEventsFeed"] });
      void queryClient.invalidateQueries({ queryKey: ["homeEventsFeed", userId] });
      void queryClient.invalidateQueries({ queryKey: ["clubCalendarEvents"] });
    });
  }, [eventId, userId, queryClient]);
}

// Media-overlay realtime: another user's like/unlike or new/deleted comment on
// the OPEN post updates its counts + comment list live. Delivered via a PRIVATE
// Broadcast topic `post:<id>` (migration 050) — deletion-safe (the trigger reads
// OLD.post_id, which a filtered postgres_changes DELETE cannot) and
// visibility-gated. One bounded channel per open post; cleaned up on unmount /
// post change.
export function usePostInteractionsRealtime(postId: string | undefined, userId: string | undefined): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!postId || !userId) return;
    return subscribeBroadcast(`post:${postId}`, "interaction", () => {
      void queryClient.invalidateQueries({ queryKey: ["postDetail"] });
      void queryClient.invalidateQueries({ queryKey: ["postComments", postId] });
      void queryClient.invalidateQueries({ queryKey: ["homePostsFeed"] });
    });
  }, [postId, userId, queryClient]);
}

// Club-tab realtime: the signed-in user's own membership rows (this-device or
// another device / another session join·leave·promotion) reconcile the sidebar
// and catalog. Scoped to user_id = me, so no other user's data is observed.
export function useMyClubsRealtime(userId: string | undefined): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!userId) return;
    const inv = () => {
      void queryClient.invalidateQueries({ queryKey: myClubsKey(userId) });
      void queryClient.invalidateQueries({ queryKey: discoveryClubsKey(userId) });
      refreshMembershipPermissions(queryClient, userId);
    };
    const channel = createSafeChannel(`my-clubs:${userId}`, [
      { event: "*", schema: "public", table: "club_members", filter: `user_id=eq.${userId}`, callback: inv },
    ]);
    return () => removeSafeChannel(channel);
  }, [userId, queryClient]);
}
