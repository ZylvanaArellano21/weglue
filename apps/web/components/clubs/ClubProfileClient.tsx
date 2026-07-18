"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ToastProvider, useToast } from "../shared/Toast";
import { AppHeader } from "../home/AppHeader";
import { EventDetailModal } from "../home/EventDetailModal";
import { PostModal } from "../home/PostModal";
import { Modal } from "../shared/Modal";
import { ClubProfileHeader, type ClubTab } from "./ClubProfileHeader";
import { ClubRightColumn } from "./ClubRightColumn";
import { ClubHomeTab } from "./ClubHomeTab";
import { ClubCalendarTab } from "./ClubCalendarTab";
import { ClubOfficersTab } from "./ClubOfficersTab";
import { ClubMediaTab } from "./ClubMediaTab";
import { useUnreadSummary } from "../../lib/hooks/useUnreadSummary";
import { useRealtimeNotifications } from "../../lib/hooks/useNotifications";
import { useClubProfile, useToggleClubMembership, OnlyOfficerError } from "../../lib/hooks/useClubProfile";
import { useClubEventsFeed } from "../../lib/hooks/useClubEventsFeed";
import { useRsvpToEvent, useToggleSaveEvent } from "../../lib/hooks/useHomeEventsFeed";
import type { HomeFeedEvent } from "../../lib/hooks/useHomeEventsFeed";

const TABS: ClubTab[] = ["home", "calendar", "officers", "media"];

// Local overlay state — calendar same-date cycling and the media lightbox live
// OVER the current tab (no page navigation), so closing restores the exact tab,
// month, date and scroll (spec §16/§19).
type Overlay =
  | { kind: "event"; list: HomeFeedEvent[]; index: number }
  | { kind: "post"; postId: string }
  | { kind: "image"; url: string; caption: string | null }
  | null;

export function ClubProfileClient({ clubId, userId }: { clubId: string; userId: string }): JSX.Element {
  useUnreadSummary(userId);
  useRealtimeNotifications(userId);

  return (
    <ToastProvider>
      <div className="min-h-screen bg-cream">
        <AppHeader userId={userId} />
        <Body clubId={clubId} userId={userId} />
      </div>
    </ToastProvider>
  );
}

function Body({ clubId, userId }: { clubId: string; userId: string }): JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();
  const show = useToast();

  const { data: club, isLoading } = useClubProfile(clubId, userId);
  const { data: feed } = useClubEventsFeed(clubId, userId);
  const membership = useToggleClubMembership(clubId, userId);
  const { mutate: rsvp } = useRsvpToEvent();
  const { mutate: toggleSave } = useToggleSaveEvent();

  const tabParam = searchParams.get("tab");
  const activeTab: ClubTab = (TABS as string[]).includes(tabParam ?? "") ? (tabParam as ClubTab) : "home";

  const [overlay, setOverlay] = useState<Overlay>(null);

  const upcoming = feed?.upcoming ?? [];
  const past = feed?.past ?? [];
  const allEvents = useMemo(() => [...upcoming, ...past], [upcoming, past]);

  const setTab = (tab: ClubTab) => {
    const sp = new URLSearchParams(searchParams.toString());
    if (tab === "home") sp.delete("tab");
    else sp.set("tab", tab);
    const qs = sp.toString();
    router.push(qs ? `/club/${clubId}?${qs}` : `/club/${clubId}`, { scroll: false });
  };

  const openSingleEvent = (eventId: string) => {
    const ev = allEvents.find((e) => e.id === eventId);
    if (ev) setOverlay({ kind: "event", list: [ev], index: 0 });
  };

  const handleRsvp = (eventId: string) =>
    rsvp(
      { userId, eventId, status: "going" },
      {
        onSuccess: () => show("RSVP updated 🎉"),
        onError: () => show("Failed to RSVP. Try again.", "error"),
      }
    );

  const handleSave = (eventId: string) =>
    toggleSave(
      { userId, eventId },
      {
        onSuccess: (saved) => show(saved ? "Event saved!" : "Removed from saved"),
        onError: () => show("Failed to save event.", "error"),
      }
    );

  const handleToggleMembership = () => {
    if (!club) return;
    membership.mutate(
      { join: !club.is_member },
      {
        onSuccess: () => show(club.is_member ? "You left the club." : "Joined club! 🎉"),
        onError: (err) =>
          show(err instanceof OnlyOfficerError ? err.message : "Something went wrong. Try again.", "error"),
      }
    );
  };

  const openPhoto = (index: number) => {
    if (!club) return;
    const photo = club.photos[index];
    if (!photo) return;
    if (photo.source === "tagged_post" && photo.post_id) setOverlay({ kind: "post", postId: photo.post_id });
    else setOverlay({ kind: "image", url: photo.url, caption: photo.caption });
  };

  const chatUnavailable = () => show("Messaging is available in the We Glue mobile app.");

  if (isLoading) {
    return (
      <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
        <div className="h-64 animate-pulse rounded-2xl bg-black/5" />
      </main>
    );
  }
  if (!club) {
    return (
      <main className="mx-auto max-w-[1400px] px-4 py-16 text-center sm:px-6">
        <p className="text-gray-500">This club is no longer available.</p>
        <button type="button" onClick={() => router.push("/clubs")} className="mt-4 text-sm font-semibold text-teal hover:underline">
          Back to Clubs
        </button>
      </main>
    );
  }

  const eventOverlay = overlay?.kind === "event" ? overlay.list[overlay.index] : null;

  return (
    <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* Left: header + tab content */}
        <div className="min-w-0">
          <ClubProfileHeader
            club={club}
            activeTab={activeTab}
            onSelectTab={setTab}
            onToggleMembership={handleToggleMembership}
            membershipPending={membership.isPending}
            onEdit={() => show("Club editing is coming to web soon.")}
            onOfficerChat={chatUnavailable}
            onGroupChat={chatUnavailable}
          />

          {activeTab === "home" && (
            <ClubHomeTab
              club={club}
              upcoming={upcoming}
              past={past}
              onRsvp={handleRsvp}
              onToggleSave={handleSave}
              onJoinClub={() => handleToggleMembership()}
              onOpenEvent={openSingleEvent}
              onOpenClub={() => {}}
            />
          )}
          {activeTab === "calendar" && (
            <ClubCalendarTab
              events={allEvents}
              onOpenDate={(dateEvents) => setOverlay({ kind: "event", list: dateEvents, index: 0 })}
            />
          )}
          {activeTab === "officers" && (
            <ClubOfficersTab
              officers={club.officers}
              currentUserId={userId}
              onOpenProfile={(id) => router.push(`/u/${id}`)}
              onMessage={chatUnavailable}
            />
          )}
          {activeTab === "media" && <ClubMediaTab photos={club.photos} onOpenPhoto={openPhoto} />}
        </div>

        {/* Right column — persistent across tabs */}
        <div className="min-w-0">
          <ClubRightColumn
            club={club}
            upcomingEvents={upcoming}
            onRsvp={handleRsvp}
            onOpenEvent={openSingleEvent}
            onOpenPhoto={(i) => {
              setTab("media");
              openPhoto(i);
            }}
            onSeeAllPhotos={() => setTab("media")}
          />
        </div>
      </div>

      {/* Overlays */}
      {eventOverlay && overlay?.kind === "event" && (
        <EventDetailModal
          key={`event-${eventOverlay.id}`}
          eventId={eventOverlay.id}
          userId={userId}
          onClose={() => setOverlay(null)}
          onOpenClub={(cid) => router.push(`/club/${cid}`)}
          onPrev={overlay.list.length > 1 ? () => setOverlay({ ...overlay, index: (overlay.index - 1 + overlay.list.length) % overlay.list.length }) : undefined}
          onNext={overlay.list.length > 1 ? () => setOverlay({ ...overlay, index: (overlay.index + 1) % overlay.list.length }) : undefined}
          indicator={overlay.list.length > 1 ? `${overlay.index + 1} of ${overlay.list.length}` : undefined}
        />
      )}

      {overlay?.kind === "post" && (
        <PostModal
          key={`post-${overlay.postId}`}
          postId={overlay.postId}
          userId={userId}
          onClose={() => setOverlay(null)}
          onOpenAuthor={(id) => router.push(`/u/${id}`)}
        />
      )}

      {overlay?.kind === "image" && (
        <Modal onClose={() => setOverlay(null)} maxWidth={720}>
          <div className="p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={overlay.url} alt={overlay.caption ?? ""} className="max-h-[75vh] w-full rounded-xl object-contain" />
            {overlay.caption && <p className="px-1 py-3 text-[15px] text-gray-800">{overlay.caption}</p>}
          </div>
        </Modal>
      )}
    </main>
  );
}
