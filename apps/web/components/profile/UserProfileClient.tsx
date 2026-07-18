"use client";

import { Suspense, useMemo } from "react";
import { useRouter } from "next/navigation";
import { AppHeader } from "../home/AppHeader";
import { ProfileLayout } from "./ProfileLayout";
import { PageOverlays } from "../shared/PageOverlays";
import { ToastProvider, useToast } from "../shared/Toast";
import {
  useUserProfile,
  useUserPosts,
  useUserWeeklyEvents,
  useFollow,
  useUnfollow,
} from "../../lib/hooks/useUserProfile";

// Public (other-user) profile — the destination for Gluemates and notification
// actors. Read-only apart from the Follow button, which respects private
// accounts (Follow → Requested when the target is private). Privacy hides
// interests/events/posts server-side (RLS) and in the UI.
export function UserProfileClient({
  targetUserId,
  viewerUserId,
}: {
  targetUserId: string;
  viewerUserId: string;
}): JSX.Element {
  return (
    <ToastProvider>
      <div className="min-h-screen bg-cream">
        <AppHeader userId={viewerUserId} />
        <Body targetUserId={targetUserId} viewerUserId={viewerUserId} />
        <Suspense fallback={null}>
          <PageOverlays userId={viewerUserId} />
        </Suspense>
      </div>
    </ToastProvider>
  );
}

function Body({ targetUserId, viewerUserId }: { targetUserId: string; viewerUserId: string }): JSX.Element {
  const router = useRouter();
  const show = useToast();
  const { data: profile, isLoading } = useUserProfile(targetUserId, viewerUserId);
  const following = profile?.follow_status === "following";
  const { data: posts } = useUserPosts(following || profile?.is_private === false ? targetUserId : undefined);
  const { data: weekly } = useUserWeeklyEvents(targetUserId, !!profile && !profile.hide_events && (following || !profile.is_private));

  const { mutate: follow, isPending: following1 } = useFollow(viewerUserId);
  const { mutate: unfollow, isPending: unfollowing } = useUnfollow(viewerUserId);
  const busy = following1 || unfollowing;

  const weeklyEvents = useMemo(
    () => (weekly ?? []).map((e) => ({
      id: e.id,
      title: e.title,
      emoji: e.emoji,
      cover_image_url: e.cover_image_url,
      event_date: e.event_date,
      start_time: e.start_time,
      end_time: e.end_time,
      club: e.club,
    })),
    [weekly]
  );

  if (isLoading || !profile) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-10">
        <div className="h-24 animate-pulse rounded-xl bg-black/5" />
      </div>
    );
  }

  const locked = profile.is_private && profile.follow_status !== "following";

  const label = profile.is_gluemate
    ? "Gluemates 🎉"
    : profile.follow_status === "following"
    ? "Following"
    : profile.follow_status === "pending"
    ? "Requested"
    : "Follow";

  const onAction = () => {
    if (busy) return;
    if (profile.follow_status === "not_following") {
      follow(targetUserId, {
        onSuccess: () => show(profile.is_private ? "Requested to follow" : "Following! 🎉"),
        onError: () => show("Failed to follow.", "error"),
      });
    } else {
      unfollow(targetUserId, {
        onSuccess: () => show(profile.follow_status === "pending" ? "Request cancelled" : "Unfollowed"),
        onError: () => show("Failed to update.", "error"),
      });
    }
  };

  const isFollowingLike = profile.follow_status !== "not_following";

  const setParam = (key: string, val: string) =>
    router.push(`/u/${targetUserId}?${key}=${val}`, { scroll: false });

  return (
    <ProfileLayout
      avatarUrl={profile.avatar_url}
      fullName={profile.full_name}
      username={profile.username}
      major={profile.major}
      clubsCount={profile.clubs_count}
      gluematesCount={profile.gluemates_count}
      interests={profile.interests}
      roles={profile.club_roles}
      posts={posts ?? []}
      weeklyEvents={weeklyEvents}
      hideInterests={profile.hide_interests}
      hideEvents={profile.hide_events}
      locked={locked}
      onOpenPost={(id) => setParam("post", id)}
      onOpenEvent={(id) => setParam("event", id)}
      action={
        <button
          type="button"
          onClick={onAction}
          disabled={busy}
          className="w-full rounded-full py-2.5 text-center text-[15px] font-semibold disabled:opacity-60"
          style={
            isFollowingLike
              ? { border: "1.5px solid #0FA6A6", color: "#0FA6A6", background: "rgba(15,166,166,0.08)" }
              : { background: "#0FA6A6", color: "#fff" }
          }
        >
          {label}
        </button>
      }
    />
  );
}
