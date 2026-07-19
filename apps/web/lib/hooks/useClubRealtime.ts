"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createSafeChannel, removeSafeChannel } from "../realtime";
import { clubProfileKey } from "./useClubProfile";
import { clubEventsFeedKey } from "./useClubEventsFeed";
import { myClubsKey, discoveryClubsKey } from "./useClubTab";

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

// Event-overlay realtime: another user's RSVP change to the OPEN event updates
// its attendee count + avatars live. Scoped to a single event_id (not a
// firehose); RLS on event_rsvps still governs which rows are delivered. Fires
// once event_rsvps is in the supabase_realtime publication (migration 050).
export function useEventRsvpRealtime(eventId: string | undefined, userId: string | undefined): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!eventId || !userId) return;
    const inv = () => {
      void queryClient.invalidateQueries({ queryKey: ["eventDetail", eventId] });
      void queryClient.invalidateQueries({ queryKey: ["clubEventsFeed"] });
      void queryClient.invalidateQueries({ queryKey: ["homeEventsFeed", userId] });
      void queryClient.invalidateQueries({ queryKey: ["clubCalendarEvents"] });
    };
    const channel = createSafeChannel(`event-rsvps:${eventId}`, [
      { event: "*", schema: "public", table: "event_rsvps", filter: `event_id=eq.${eventId}`, callback: inv },
    ]);
    return () => removeSafeChannel(channel);
  }, [eventId, userId, queryClient]);
}

// Media-overlay realtime: another user's like/unlike or new/deleted comment on
// the OPEN post updates its counts + comment list live. Scoped to a single
// post_id (one bounded channel per open item); RLS on post_likes/post_comments
// (both "authenticated can read") governs delivery. Fires once those tables are
// in the supabase_realtime publication (migration 050).
export function usePostInteractionsRealtime(postId: string | undefined, userId: string | undefined): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!postId || !userId) return;
    const inv = () => {
      void queryClient.invalidateQueries({ queryKey: ["postDetail"] });
      void queryClient.invalidateQueries({ queryKey: ["postComments", postId] });
      void queryClient.invalidateQueries({ queryKey: ["homePostsFeed"] });
    };
    const channel = createSafeChannel(`post-interactions:${postId}`, [
      { event: "*", schema: "public", table: "post_likes", filter: `post_id=eq.${postId}`, callback: inv },
      { event: "*", schema: "public", table: "post_comments", filter: `post_id=eq.${postId}`, callback: inv },
    ]);
    return () => removeSafeChannel(channel);
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
    };
    const channel = createSafeChannel(`my-clubs:${userId}`, [
      { event: "*", schema: "public", table: "club_members", filter: `user_id=eq.${userId}`, callback: inv },
    ]);
    return () => removeSafeChannel(channel);
  }, [userId, queryClient]);
}
