"use client";

import { Suspense, useCallback, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppHeader } from "../home/AppHeader";
import { ProfileLayout, type ProfileTab } from "./ProfileLayout";
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
import { ReportModal } from "../shared/ReportModal";
import {
  UNAVAILABLE_TITLE,
  UNAVAILABLE_BODY,
  YOU_BLOCKED_TITLE,
  YOU_BLOCKED_BODY,
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
      <div className="min-h-screen bg-cream pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0">
        <AppHeader userId={viewerUserId} />
        {/* One boundary for the whole body: it reads useSearchParams for the
            selected tab, and PageOverlays reads it for the post/event params. */}
        <Suspense fallback={null}>
          <Body targetUserId={targetUserId} viewerUserId={viewerUserId} />
          <PageOverlays userId={viewerUserId} />
        </Suspense>
      </div>
    </ToastProvider>
  );
}

function Body({ targetUserId, viewerUserId }: { targetUserId: string; viewerUserId: string }): JSX.Element {
  const router = useRouter();
  const params = useSearchParams();
  const show = useToast();
  const { data: profile, isLoading } = useUserProfile(targetUserId, viewerUserId);
  const { data: iBlockedThem, isLoading: blockStateLoading } = useDidIBlock(viewerUserId, targetUserId);
  const { mutate: block, isPending: blocking } = useBlockUser(viewerUserId);
  const { mutate: unblock, isPending: unblocking } = useUnblockUser(viewerUserId);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
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
      event_end_at: e.event_end_at,
      visibility: e.visibility,
      location: e.location,
      building: e.building,
      room: e.room,
      club: e.club,
    })),
    [weekly]
  );

  // ONE unblock path for every entry point. Declared before the early returns so
  // the blocked-user state can use it too; it calls the same `useUnblockUser`
  // mutation as the profile menu, so no second implementation exists and the
  // existing access-sync invalidation applies unchanged.
  const runUnblock = (username?: string | null) => {
    setMenuOpen(false);
    if (!window.confirm(unblockConfirmMessage(username))) return;
    unblock(targetUserId, {
      onSuccess: () => show("Unblocked."),
      onError: () => show("Couldn’t unblock. Please try again.", "error"),
    });
  };

  const tab: ProfileTab = params.get("tab") === "weekly_events" ? "weekly_events" : "posts";

  // Keep every existing param when navigating, so opening a post from the
  // Weekly Events tab and pressing Back returns to Weekly Events.
  const withParam = useCallback(
    (key: string, value: string) => {
      const sp = new URLSearchParams(params.toString());
      sp.set(key, value);
      return `/u/${targetUserId}?${sp.toString()}`;
    },
    [params, targetUserId]
  );

  // Wait for the directional block state too when there is no readable profile,
  // otherwise the blocker briefly sees the generic unavailable state before the
  // Unblock affordance appears.
  if (isLoading || (!profile && blockStateLoading)) {
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
  // OUTCOME B — the viewer CREATED the block. `current_user_blocks` is
  // directional and true only for the person who blocked, so this branch can
  // never be reached by the blocked party. It exists so the blocker keeps a way
  // to undo their own action from a shared context (club member list, group
  // participant list, an old message) instead of hitting a dead end.
  //
  // The blocked person's normal profile content stays inaccessible: no posts, no
  // weekly events, no follow or message controls are rendered here, and RLS
  // would refuse them anyway.
  if (!profile && iBlockedThem === true) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <p className="text-base font-semibold text-gray-900">{YOU_BLOCKED_TITLE}</p>
        <p className="mt-2 text-sm text-gray-500">{YOU_BLOCKED_BODY}</p>
        <button
          type="button"
          onClick={() => runUnblock(null)}
          disabled={unblocking}
          className="mt-6 rounded-full border border-[#0FA6A6] px-5 py-2 text-sm font-semibold text-[#0FA6A6] disabled:opacity-60"
        >
          {unblocking ? "Unblocking…" : "Unblock"}
        </button>
        <button
          type="button"
          onClick={() => router.push("/home")}
          className="mt-3 block w-full text-sm font-semibold text-gray-500"
        >
          Back to Home
        </button>
      </div>
    );
  }

  // OUTCOME A — the viewer WAS blocked, or the account is deleted, or the id
  // never existed. A blocked account returns ZERO ROWS from RLS and lands here.
  // The copy is deliberately identical for all three, so the state itself cannot
  // disclose which occurred, and it must never reveal that this specific person
  // blocked the viewer. No Unblock is offered, because the viewer has nothing to
  // unblock.
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

  const onUnblock = () => runUnblock(profile.username);

  return (
    <>
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
      tab={tab}
      onTabChange={(next) =>
        router.replace(withParam("tab", next), { scroll: false })
      }
      // Gluemates and Clubs lists are the OWNER's own lists on mobile — there is
      // no equivalent sheet on someone else's profile, so the counts stay
      // non-interactive here rather than inventing a destination.
      onOpenClub={(clubId) => router.push(`/club/${clubId}`)}
      onOpenPost={(id) => router.push(withParam("post", id), { scroll: false })}
      onOpenEvent={(id) => router.push(withParam("event", id), { scroll: false })}
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
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => { setMenuOpen(false); setReportOpen(true); }}
                    className="block w-full px-4 py-2.5 text-left text-sm text-red-600 hover:bg-red-50"
                  >
                    Report
                  </button>
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
    {reportOpen && (
      <ReportModal
        entityType="user"
        entityId={targetUserId}
        entityName={profile.username ? `@${profile.username}` : profile.full_name}
        onClose={() => setReportOpen(false)}
        onSubmitted={show}
        onBlock={
          iBlockedThem
            ? undefined
            : () =>
                block(targetUserId, {
                  onSuccess: () => router.push("/home"),
                  onError: () => show("Couldn’t block. Please try again.", "error"),
                })
        }
      />
    )}
    </>
  );
}
