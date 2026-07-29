"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppHeader } from "../home/AppHeader";
import { ProfileLayout } from "./ProfileLayout";
import { GluematesModal } from "../home/GluematesModal";
import { PageOverlays } from "../shared/PageOverlays";
import { ToastProvider } from "../shared/Toast";
import {
  useOwnProfile,
  useOwnThisWeekEvents,
  useOwnPosts,
} from "../../lib/hooks/useOwnProfile";

// The authenticated user's own profile page. Real data; Edit Profile navigates
// to /profile/edit; weekly events / posts open the shared overlays; Gluemates
// opens the mutual-follow list. Browser Back restores the prior Home state.
export function OwnProfileClient({ userId }: { userId: string }): JSX.Element {
  const router = useRouter();
  const [gluematesOpen, setGluematesOpen] = useState(false);

  const { data: profile, isLoading } = useOwnProfile(userId);
  const { data: weekSections } = useOwnThisWeekEvents(userId);
  const { data: posts } = useOwnPosts(userId);

  const weeklyEvents = useMemo(
    () => (weekSections ?? []).flatMap((s) => s.data).map((e) => ({
      id: e.id,
      title: e.title,
      emoji: e.emoji,
      cover_image_url: e.cover_image_url,
      event_date: e.event_date,
      start_time: e.start_time,
      end_time: e.end_time,
      club: { id: e.club.id, name: e.club.name },
    })),
    [weekSections]
  );

  const setParam = (key: string, val: string) =>
    router.push(`/profile?${key}=${val}`, { scroll: false });

  return (
    <ToastProvider>
      <div className="min-h-screen bg-cream">
        <AppHeader userId={userId} />

        {isLoading || !profile ? (
          <div className="mx-auto max-w-2xl px-6 py-10">
            <div className="h-24 animate-pulse rounded-xl bg-black/5" />
          </div>
        ) : (
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
            onAvatarClick={() => router.push("/profile/edit")}
            onOpenGluemates={() => setGluematesOpen(true)}
            onOpenPost={(id) => setParam("post", id)}
            onOpenEvent={(id) => setParam("event", id)}
            action={
              <>
                <Link
                  href="/profile/edit"
                  className="block w-full rounded-full border-[1.5px] py-2.5 text-center text-[15px] font-semibold"
                  style={{ borderColor: "#0FA6A6", color: "#0FA6A6" }}
                >
                  Edit Profile
                </Link>
                {/* Permanent, self-service account deletion. Sits with the
                    account actions so it is findable without leaving the app
                    or contacting support (App Store Guideline 5.1.1(v)). */}
                <Link
                  href="/account/delete"
                  className="mt-2.5 block w-full text-center text-[13px] font-semibold text-[#F02719] hover:underline"
                >
                  Delete Account
                </Link>
              </>
            }
          />
        )}

        {gluematesOpen && (
          <GluematesModal
            userId={userId}
            onClose={() => setGluematesOpen(false)}
            onOpenUser={(id) => router.push(`/u/${id}`)}
          />
        )}

        <Suspense fallback={null}>
          <PageOverlays userId={userId} />
        </Suspense>
      </div>
    </ToastProvider>
  );
}
