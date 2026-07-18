"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  useHomeEventsFeed,
  useRsvpToEvent,
  useToggleSaveEvent,
  mergeEventFeedPages,
} from "../../lib/hooks/useHomeEventsFeed";
import { useClubRecommendations } from "../../lib/hooks/useClubRecommendations";
import { useJoinClubMutation } from "../../lib/hooks/useClubMembership";
import { useToast } from "../shared/Toast";
import { RecommendationStrip } from "./RecommendationStrip";
import { EventCard } from "./EventCard";
import { EmptyState } from "./EmptyState";

// Desktop container mirroring apps/mobile/components/home/EventsFeed.tsx:
// recommendation strip first (below the Posts/Events selector), then the
// "Your Clubs" and "Recommended for You" event sections in the same order.
export function EventsFeed({ userId }: { userId: string }): JSX.Element {
  const router = useRouter();
  const show = useToast();

  const { data, isLoading, isError, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useHomeEventsFeed(userId);
  const { data: batch } = useClubRecommendations(userId);

  const { mutate: rsvp } = useRsvpToEvent();
  const { mutate: toggleSave } = useToggleSaveEvent();
  const { mutate: joinClub } = useJoinClubMutation(userId);

  const sections = useMemo(
    () => (data ? mergeEventFeedPages(data.pages) : []),
    [data]
  );

  const openClub = (clubId: string) => router.push(`/club/${clubId}`);
  // Event detail is a URL-driven overlay (built in Phase 2); pushing the query
  // param keeps browser Back working and restores Home state on close.
  const openEvent = (eventId: string) => router.push(`/home?event=${eventId}`);

  const handleRsvp = (eventId: string) =>
    rsvp(
      { userId, eventId, status: "going" },
      {
        onSuccess: () => show("RSVP confirmed! 🎉"),
        onError: () => show("Failed to RSVP. Try again.", "error"),
      }
    );

  const handleSave = (eventId: string) =>
    toggleSave(
      { userId, eventId },
      {
        onSuccess: (saved) => show(saved ? "Event saved!" : "Event removed from saved"),
        onError: () => show("Failed to save event.", "error"),
      }
    );

  const handleJoin = (clubId: string) =>
    joinClub(clubId, {
      onSuccess: () => show("Joined club! 🎉"),
      onError: () => show("Failed to join club.", "error"),
    });

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
                    onJoinClub={handleJoin}
                    onOpenEvent={openEvent}
                    onOpenClub={openClub}
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
    </div>
  );
}
