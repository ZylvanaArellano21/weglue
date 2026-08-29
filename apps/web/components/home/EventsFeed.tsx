"use client";

import { useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  useHomeEventsFeed,
  useRsvpToEvent,
  useToggleSaveEvent,
  mergeEventFeedPages,
} from "../../lib/hooks/useHomeEventsFeed";
import { useClubRecommendations } from "../../lib/hooks/useClubRecommendations";
import { useJoinClubMutation } from "../../lib/hooks/useClubMembership";
import { LeaveClubDialog } from "../clubs/LeaveClubDialog";
import { useState } from "react";
import { useToast } from "../shared/Toast";
import { RecommendationStrip } from "./RecommendationStrip";
import { EventCard } from "./EventCard";
import { EmptyState } from "./EmptyState";

// Desktop container mirroring apps/mobile/components/home/EventsFeed.tsx:
// recommendation strip first (below the Posts/Events selector), then the
// "Your Clubs" and "Recommended for You" event sections in the same order.
export function EventsFeed({
  userId,
  onOpenEvent,
}: {
  userId: string;
  onOpenEvent: (eventId: string) => void;
}): JSX.Element {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const show = useToast();

  const { data, isLoading, isError, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useHomeEventsFeed(userId);
  const { data: batch } = useClubRecommendations(userId);

  const { mutate: rsvp } = useRsvpToEvent();
  const { mutate: toggleSave } = useToggleSaveEvent();
  const { mutate: joinClub } = useJoinClubMutation(userId);
  const [leaving, setLeaving] = useState<{ id: string; name: string } | null>(null);

  const sections = useMemo(
    () => (data ? mergeEventFeedPages(data.pages) : []),
    [data]
  );

  const openClub = (clubId: string) => router.push(`/club/${clubId}`);
  // Event detail is the shared URL-driven overlay (see HomeClient); opening it
  // preserves the current tab so browser Back restores the exact Home state.
  const openEvent = onOpenEvent;
  const openAttendees = (eventId: string) => {
    const sp = new URLSearchParams(searchParams.toString());
    sp.set("attendees", eventId);
    router.push(`${pathname}?${sp.toString()}`, { scroll: false });
  };

  const handleRsvp = (eventId: string, previousStatus: "going" | "cant" | null) =>
    rsvp(
      { userId, eventId, status: "going", previousStatus },
      {
        onSuccess: () => show("RSVP confirmed! 🎉"),
        onError: () => show("Failed to RSVP. Try again.", "error"),
      }
    );

  const handleSave = (eventId: string, isSaved: boolean) =>
    toggleSave(
      { userId, eventId, isSaved },
      {
        onSuccess: () => show(!isSaved ? "Event saved!" : "Event removed from saved"),
        onError: () => show("Failed to save event.", "error"),
      }
    );

  const handleToggleClub = (clubId: string, clubName: string, isMember: boolean) => {
    if (isMember) { setLeaving({ id: clubId, name: clubName }); return; }
    joinClub(clubId, {
      onSuccess: () => show("Joined club! 🎉"),
      onError: () => show("Failed to join club.", "error"),
    });
  };

  const strip = batch ? (
    <RecommendationStrip
      batch={batch}
      userId={userId}
      onJoined={() => show("Joined club! 🎉")}
      onJoinError={() => show("Failed to join club.", "error")}
      onOpenClub={openClub}
      onSeeAllClubs={() => router.push("/clubs")}
    />
  ) : null;

  if (isLoading) {
    return (
      <div>
        {strip}
        <div className="mt-4 space-y-4">
          {[0, 1, 2].map((k) => (
            <div key={k} className="h-72 animate-pulse rounded-xl bg-black/5" />
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div>
        {strip}
        <p className="py-12 text-center text-[15px] text-gray-500">
          Something went wrong loading events.
        </p>
      </div>
    );
  }

  const isEmpty = sections.length === 0;

  return (
    <div>
      {strip}
      {isEmpty ? (
        <EmptyState
          emoji="🌟"
          title="No events yet."
          subtitle="Explore clubs to get started!"
        />
      ) : (
        <div className="mt-4 space-y-6">
          {sections.map((section) => (
            <section key={section.label} aria-label={section.label}>
              <h2 className="mb-3 text-[17px] font-bold text-gray-900 font-zain">
                {section.label}
                {section.label === "Recommended for You" && (
                  <span className="mt-0.5 block text-xs font-normal text-gray-400">
                    Events from clubs you might like
                  </span>
                )}
              </h2>
              <div className="space-y-4">
                {section.data.map((event) => (
                  <EventCard
                    key={event.id}
                    event={event}
                    onRsvp={handleRsvp}
                    onToggleSave={handleSave}
                    onToggleClub={handleToggleClub}
                    onOpenEvent={openEvent}
                    onOpenClub={openClub}
                    onOpenAttendees={openAttendees}
                  />
                ))}
              </div>
            </section>
          ))}

          {hasNextPage && (
            <button
              type="button"
              onClick={() => fetchNextPage()}
              disabled={isFetchingNextPage}
              className="mx-auto block rounded-full border px-6 py-2 text-sm font-semibold disabled:opacity-50"
              style={{ borderColor: "#0FA6A6", color: "#0FA6A6" }}
            >
              {isFetchingNextPage ? "Loading…" : "Show more events"}
            </button>
          )}
        </div>
      )}
      {leaving && <LeaveClubDialog clubId={leaving.id} clubName={leaving.name} userId={userId} onClose={() => setLeaving(null)} onLeft={() => show("You left the club.")} onError={(message) => show(message, "error")} />}
    </div>
  );
}
