"use client";

import { Suspense, useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AppHeader } from "../home/AppHeader";
import { ProfileLayout, type ProfileTab } from "./ProfileLayout";
import { GluematesModal } from "../home/GluematesModal";
import { ClubsModal } from "./ClubsModal";
import { AvatarPickerModal } from "./AvatarPickerModal";
import { PageOverlays } from "../shared/PageOverlays";
import { ConfirmDialog } from "../shared/ConfirmDialog";
import { ToastProvider, useToast } from "../shared/Toast";
import {
  useOwnProfile,
  useOwnThisWeekEvents,
  useOwnPosts,
  useRemoveEventRsvp,
} from "../../lib/hooks/useOwnProfile";

// The authenticated user's own profile page. Real data throughout; Edit profile
// navigates to /profile/edit; the ⊕ on the avatar opens the picture editor;
// Clubs and Gluemates open their lists (both are tappable on mobile); posts and
// weekly events open the shared overlays. The selected tab lives in the URL, so
// browser Back restores the exact tab the student came from.
export function OwnProfileClient({ userId }: { userId: string }): JSX.Element {
  return (
    <ToastProvider>
      <div className="min-h-screen bg-cream">
        <AppHeader userId={userId} />
        {/* useSearchParams needs a Suspense boundary in the App Router. */}
        <Suspense fallback={<ProfileSkeleton />}>
          <Body userId={userId} />
        </Suspense>
      </div>
    </ToastProvider>
  );
}

function ProfileSkeleton(): JSX.Element {
  return (
    <div className="mx-auto max-w-2xl px-6 py-10" aria-live="polite" aria-busy>
      <span className="sr-only">Loading your profile…</span>
      <div className="flex items-start gap-8">
        <div className="h-[172px] w-[172px] shrink-0 animate-pulse rounded-full bg-black/[0.06]" />
        <div className="flex-1 space-y-3 pt-3">
          <div className="h-6 w-1/2 animate-pulse rounded bg-black/[0.06]" />
          <div className="h-4 w-1/3 animate-pulse rounded bg-black/[0.06]" />
          <div className="h-10 w-2/3 animate-pulse rounded bg-black/[0.06]" />
        </div>
      </div>
      <div className="mt-8 h-11 animate-pulse rounded-full bg-black/[0.06]" />
    </div>
  );
}

function Body({ userId }: { userId: string }): JSX.Element {
  const router = useRouter();
  const params = useSearchParams();
  const show = useToast();

  const [gluematesOpen, setGluematesOpen] = useState(false);
  const [clubsOpen, setClubsOpen] = useState(false);
  const [pictureOpen, setPictureOpen] = useState(false);
  const [removeEventId, setRemoveEventId] = useState<string | null>(null);

  const { data: profile, isLoading, isError } = useOwnProfile(userId);
  const {
    data: weekSections,
    isLoading: eventsLoading,
    isError: eventsError,
  } = useOwnThisWeekEvents(userId);
  const { data: posts, isLoading: postsLoading, isError: postsError } = useOwnPosts(userId);
  const removeRsvp = useRemoveEventRsvp(userId);

  const tab: ProfileTab = params.get("tab") === "weekly_events" ? "weekly_events" : "posts";

  // Every navigation keeps the existing params, so opening a post from the
  // Weekly Events tab and pressing Back returns to Weekly Events, not Posts.
  const withParam = useCallback(
    (key: string, value: string | null) => {
      const sp = new URLSearchParams(params.toString());
      if (value === null) sp.delete(key);
      else sp.set(key, value);
      const qs = sp.toString();
      return qs ? `/profile?${qs}` : "/profile";
    },
    [params]
  );

  const weeklyEvents = useMemo(
    () =>
      (weekSections ?? [])
        .flatMap((s) => s.data)
        .map((e) => ({
          id: e.id,
          title: e.title,
          emoji: e.emoji,
          cover_image_url: e.cover_image_url,
          event_date: e.event_date,
          start_time: e.start_time,
          end_time: e.end_time,
          location: e.location,
          building: e.building,
          room: e.room,
          club: { id: e.club.id, name: e.club.name },
        })),
    [weekSections]
  );

  const onConfirmRemove = async () => {
    if (!removeEventId) return;
    try {
      await removeRsvp.mutateAsync(removeEventId);
      setRemoveEventId(null);
      show("Removed from your week.");
    } catch {
      setRemoveEventId(null);
      show("Couldn't remove that event. Please try again.", "error");
    }
  };

  if (isLoading) return <ProfileSkeleton />;

  if (isError || !profile) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <p role="alert" className="text-base font-semibold text-gray-900">
          We couldn&apos;t load your profile.
        </p>
        <p className="mt-2 text-sm text-gray-500">Check your connection and try again.</p>
        <button
          type="button"
          onClick={() => router.refresh()}
          className="mt-6 rounded-full bg-teal px-5 py-2 text-sm font-semibold text-white"
        >
          Try again
        </button>
      </div>
    );
  }

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
        postsLoading={postsLoading}
        eventsLoading={eventsLoading}
        postsError={postsError}
        eventsError={eventsError}
        tab={tab}
        onTabChange={(next) => router.replace(withParam("tab", next), { scroll: false })}
        // The ⊕ opens the picture editor in place. The big avatar is NOT the
        // dropdown trigger — that is only the small one in the header.
        onEditPicture={() => setPictureOpen(true)}
        onOpenClubs={() => setClubsOpen(true)}
        onOpenGluemates={() => setGluematesOpen(true)}
        onOpenClub={(clubId) => router.push(`/club/${clubId}`)}
        onOpenPost={(id) => router.push(withParam("post", id), { scroll: false })}
        onOpenEvent={(id) => router.push(withParam("event", id), { scroll: false })}
        onRemoveEvent={(id) => setRemoveEventId(id)}
        action={
          <>
            <Link
              href="/profile/edit"
              className="block w-full rounded-full border-[1.5px] border-teal bg-white py-3 text-center text-[16px] font-semibold text-teal shadow-[0_1px_4px_rgba(0,0,0,0.06)] transition-colors hover:bg-teal/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
            >
              Edit profile
            </Link>
            {/* Blocked Accounts — the only surface where a block is ever
                visible, and only to the student who created it. */}
            <Link
              href="/settings/blocked"
              className="mt-2.5 block w-full rounded-full border border-gray-200 py-2.5 text-center text-[14px] font-semibold text-gray-600 hover:bg-gray-50"
            >
              Blocked Accounts
            </Link>
          </>
        }
      />

      {clubsOpen && (
        <ClubsModal
          userId={userId}
          onClose={() => setClubsOpen(false)}
          onOpenClub={(clubId) => router.push(`/club/${clubId}`)}
        />
      )}

      {gluematesOpen && (
        <GluematesModal
          userId={userId}
          onClose={() => setGluematesOpen(false)}
          onOpenUser={(id) => router.push(`/u/${id}`)}
        />
      )}

      {pictureOpen && (
        <AvatarPickerModal
          userId={userId}
          username={profile.username}
          currentAvatarUrl={profile.avatar_url}
          onClose={() => setPictureOpen(false)}
        />
      )}

      {removeEventId && (
        <ConfirmDialog
          title="Remove event?"
          message="If you delete this, your attendance will be removed as well."
          confirmLabel="Continue"
          cancelLabel="Cancel"
          destructive
          loading={removeRsvp.isPending}
          onConfirm={() => void onConfirmRemove()}
          onCancel={() => {
            if (!removeRsvp.isPending) setRemoveEventId(null);
          }}
        />
      )}

      <PageOverlays userId={userId} />
    </>
  );
}
