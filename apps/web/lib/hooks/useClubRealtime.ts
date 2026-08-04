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
function refreshMembershipPermissions(queryClient: ReturnType<typeof useQueryClient>, userId: string): void {
  refreshPermissionSensitiveEventState(queryClient, userId);
  for (const key of [
    ["isOfficer", userId],
    ["officerClubs", userId],
    ["eventAudienceMemberSearch", userId],
    ["notifications", userId],
    ["unreadSummary", userId],
  ]) {
    queryClient.removeQueries({ queryKey: key });
    void queryClient.invalidateQueries({ queryKey: key });
  }
  // Conversation participants are removed by the existing membership triggers.
  // Drop every messages query so a removed member never briefly reuses local
  // history while its next RLS query resolves.
  queryClient.removeQueries({ queryKey: ["messages"] });
  queryClient.removeQueries({ queryKey: ["conversationHub"] });
  queryClient.removeQueries({ queryKey: ["clubChannels"] });
  queryClient.removeQueries({ queryKey: ["chatDetails"] });
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

    const invProfile = () => void queryClient.invalidateQueries({ queryKey: clubProfileKey(clubId, userId) });
    const invMembers = () => {
      invProfile();
      void queryClient.invalidateQueries({ queryKey: ["clubMemberList", clubId] });
      void queryClient.invalidateQueries({ queryKey: myClubsKey(userId) });
      void queryClient.invalidateQueries({ queryKey: discoveryClubsKey(userId) });
      // A membership/role row can immediately change Home visibility, direct
      // event access, RSVP/attendee rights, Saved Events, and Calendar. Do not
      // leave a member-only result usable until its normal stale timeout.
      refreshMembershipPermissions(queryClient, userId);
    };
    const invEvents = () => {
      invProfile();
      void queryClient.invalidateQueries({ queryKey: clubEventsFeedKey(clubId, userId) });
    };
    const invMedia = () => {
      invProfile();
      void queryClient.invalidateQueries({ queryKey: ["clubPhotoFeed", clubId] });
    };

    const channel = createSafeChannel(`club:${clubId}`, [
      { event: "*", schema: "public", table: "clubs", filter: `id=eq.${clubId}`, callback: invProfile },
      { event: "*", schema: "public", table: "club_goals", filter: `club_id=eq.${clubId}`, callback: invProfile },
      { event: "*", schema: "public", table: "club_members", filter: `club_id=eq.${clubId}`, callback: invMembers },
      { event: "*", schema: "public", table: "club_officers", filter: `club_id=eq.${clubId}`, callback: invMembers },
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
