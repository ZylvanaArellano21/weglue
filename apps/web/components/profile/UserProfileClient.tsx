"use client";

import { Suspense, useMemo, useState } from "react";
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
import { useDidIBlock, useBlockUser, useUnblockUser } from "../../lib/hooks/useBlocking";
import { personMessageHref } from "../../lib/messages/routes";
import {
  UNAVAILABLE_TITLE,
  UNAVAILABLE_BODY,
  blockConfirmMessage,
  unblockConfirmMessage,
} from "../../lib/blocking";

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
  const { data: iBlockedThem } = useDidIBlock(viewerUserId, targetUserId);
  const { mutate: block, isPending: blocking } = useBlockUser(viewerUserId);
  const { mutate: unblock, isPending: unblocking } = useUnblockUser(viewerUserId);
  const [menuOpen, setMenuOpen] = useState(false);
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

  if (isLoading) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-10">
        <div className="h-24 animate-pulse rounded-xl bg-black/5" />
      </div>
    );
  }

  // Loaded, but there is no readable profile. A blocked account returns ZERO
  // ROWS from RLS and lands here, as does a deleted or never-existed id — the
  // copy is deliberately identical for all three, so the state itself cannot
  // disclose which occurred. (Before this split, a blocked profile rendered the
  // loading skeleton forever.)
  if (!profile) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <p className="text-base font-semibold text-gray-900">{UNAVAILABLE_TITLE}</p>
        <p className="mt-2 text-sm text-gray-500">{UNAVAILABLE_BODY}</p>
        <button
          type="button"
          onClick={() => router.push("/home")}
          className="mt-6 rounded-full bg-[#0FA6A6] px-5 py-2 text-sm font-semibold text-white"
        >
          Back to Home
        </button>
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

  const onBlock = () => {
    setMenuOpen(false);
    if (!window.confirm(blockConfirmMessage(profile.username))) return;
    block(targetUserId, {
      onSuccess: (result) => {
        if (result.status !== "ok") {
          show("Couldn’t block. Please try again.", "error");
          return;
        }
        show("Blocked.");
        // The profile is now unreadable to this viewer, so staying here would
        // render the unavailable state. Leave instead.
        router.push("/home");
      },
      onError: () => show("Couldn’t block. Please try again.", "error"),
    });
  };

  const onUnblock = () => {
    setMenuOpen(false);
    if (!window.confirm(unblockConfirmMessage(profile.username))) return;
    unblock(targetUserId, {
      onSuccess: () => show("Unblocked."),
      onError: () => show("Couldn’t unblock. Please try again.", "error"),
    });
  };

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
        <div className="flex w-full items-center gap-2">
          <button
            type="button"
            onClick={onAction}
            disabled={busy}
            className="flex-1 rounded-full py-2.5 text-center text-[15px] font-semibold disabled:opacity-60"
            style={
              isFollowingLike
                ? { border: "1.5px solid #0FA6A6", color: "#0FA6A6", background: "rgba(15,166,166,0.08)" }
                : { background: "#0FA6A6", color: "#fff" }
            }
          >
            {label}
          </button>
          <button
            type="button"
            onClick={() => router.push(personMessageHref(targetUserId))}
            disabled={!!iBlockedThem}
            className="rounded-full border-[1.5px] border-teal px-4 py-2.5 text-center text-[15px] font-semibold text-teal hover:bg-teal/5 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Message
          </button>

          {/* Safety menu. Mirrors the mobile profile overflow menu so a student
              finds the same control in the same place on either platform. */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="Profile options"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className="rounded-full border border-gray-200 px-3 py-2.5 text-[15px] font-semibold text-gray-500 hover:bg-gray-50"
            >
              •••
            </button>
            {menuOpen && (
              <>
                {/* Click-away layer, so the menu closes without a global listener. */}
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div
                  role="menu"
                  className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-xl border border-gray-100 bg-white shadow-lg"
                >
                  {iBlockedThem ? (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={onUnblock}
                      disabled={unblocking}
                      className="block w-full px-4 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                    >
                      {unblocking ? "Unblocking…" : "Unblock"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={onBlock}
                      disabled={blocking}
                      className="block w-full px-4 py-2.5 text-left text-sm text-red-600 hover:bg-red-50 disabled:opacity-60"
                    >
                      {blocking ? "Blocking…" : "Block"}
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      }
    />
  );
}
