"use client";

import { Modal } from "../shared/Modal";
import { Avatar } from "../shared/Avatar";
import { AvatarStack } from "../shared/AvatarStack";
import { CalendarIcon, LocationIcon, BookmarkIcon, ImageIcon } from "../shared/icons";
import { useToast } from "../shared/Toast";
import {
  useEventDetail,
  useRsvpMutation,
  useSaveEventMutation,
} from "../../lib/hooks/useEventDetail";
import { useJoinClubMutation } from "../../lib/hooks/useClubMembership";
import { formatEventTime, formatEventLocation, isEventPast } from "../../lib/datetime";

function formatLongDate(dateStr: string): string {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

// Desktop adaptation of apps/mobile/app/home/event-detail.tsx as a URL-driven
// overlay: dims the background, closes on X/Escape/outside-click, and restores
// Home state (the caller just removes the ?event= param). Ended events are
// view-only — same rule as mobile and enforced server-side by rsvpToEvent.
export function EventDetailModal({
  eventId,
  userId,
  onClose,
  onOpenClub,
}: {
  eventId: string;
  userId: string;
  onClose: () => void;
  onOpenClub: (clubId: string) => void;
}): JSX.Element {
  const show = useToast();
  const { data: event, isLoading } = useEventDetail(eventId, userId);
  const { mutate: rsvp, isPending: rsvping } = useRsvpMutation(userId);
  const { mutate: toggleSave, isPending: saving } = useSaveEventMutation(userId);
  const { mutate: joinClub, isPending: joining } = useJoinClubMutation(userId);

  const doRsvp = (status: "going" | "cant") =>
    rsvp(
      { eventId, status },
      {
        onSuccess: () => show(status === "going" ? "You're going! 🎉" : "Got it, maybe next time!"),
        onError: () => show("Failed to RSVP. Try again.", "error"),
      }
    );

  const doSave = () =>
    toggleSave(eventId, {
      onSuccess: (savedNow) => show(savedNow ? "Event saved!" : "Removed from saved"),
      onError: () => show("Failed to save event.", "error"),
    });

  const doShare = async () => {
    const url = `${window.location.origin}/home?event=${eventId}`;
    try {
      if (navigator.share) await navigator.share({ title: event?.title ?? "Event", url });
      else {
        await navigator.clipboard.writeText(url);
        show("Link copied to clipboard");
      }
    } catch {
      /* user cancelled share */
    }
  };

  return (
    <Modal onClose={onClose} labelledBy="event-detail-title" maxWidth={560}>
      {isLoading ? (
        <div className="space-y-3 p-6">
          <div className="h-9 w-2/3 animate-pulse rounded bg-black/5" />
          <div className="h-52 animate-pulse rounded-xl bg-black/5" />
          <div className="h-6 w-1/2 animate-pulse rounded bg-black/5" />
        </div>
      ) : !event ? (
        <p className="p-10 text-center text-[15px] text-gray-500">
          This event is no longer available.
        </p>
      ) : (
        <div className="p-5 sm:p-6">
          {/* Club row */}
          <div className="mb-3 flex items-center gap-2.5 pr-8">
            <button
              type="button"
              onClick={() => onOpenClub(event.club_id)}
              className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
            >
              <Avatar uri={event.club.avatar_url} size={36} name={event.club.name} />
              <span className="truncate text-[15px] font-semibold text-gray-900">
                {event.club.name}
              </span>
            </button>
            <button
              type="button"
              onClick={() => !event.user_has_joined_club && joinClub(event.club_id, {
                onSuccess: () => show("Joined club! 🎉"),
                onError: () => show("Failed to join club.", "error"),
              })}
              disabled={event.user_has_joined_club || joining}
              className="rounded-full px-4 py-1.5 text-[13px] font-semibold"
              style={
                event.user_has_joined_club
                  ? { border: "1.5px solid #0FA6A6", color: "#0FA6A6", background: "rgba(15,166,166,0.1)" }
                  : { background: "#0FA6A6", color: "#fff" }
              }
            >
              {event.user_has_joined_club ? "Joined ✓" : "Join"}
            </button>
          </div>

          {/* Hero */}
          {event.cover_image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={event.cover_image_url}
              alt={event.title}
              className="h-56 w-full rounded-xl object-cover"
            />
          ) : (
            <div className="flex h-56 w-full items-center justify-center rounded-xl" style={{ background: "#E5E7EB", color: "#9CA3AF" }}>
              <ImageIcon size={48} />
            </div>
          )}

          <h2 id="event-detail-title" className="mt-4 text-2xl font-extrabold leading-tight text-gray-900 font-zain">
            {event.emoji ? `${event.emoji} ` : ""}
            {event.title}
          </h2>

          {/* Date & location card */}
          <div className="mt-4 rounded-xl bg-white p-3.5" style={{ boxShadow: "0 1px 6px rgba(0,0,0,0.05)" }}>
            <p className="mb-1 text-[11px] text-gray-400">Date &amp; Time</p>
            <div className="flex items-center gap-2 text-gray-900">
              <CalendarIcon size={18} />
              <span className="text-[15px] font-bold">{formatLongDate(event.event_date)}</span>
            </div>
            <p className="ml-6 mt-0.5 text-sm text-gray-700">
              {formatEventTime(event.start_time)} - {formatEventTime(event.end_time)}
            </p>
            {formatEventLocation(event.building, event.room, event.location) && (
              <>
                <p className="mb-1 mt-3 text-[11px] text-gray-400">Location</p>
                <div className="flex items-center gap-2 text-gray-900">
                  <LocationIcon size={18} />
                  <span className="text-sm">
                    {formatEventLocation(event.building, event.room, event.location)}
                  </span>
                </div>
              </>
            )}
          </div>

          {/* Attendees */}
          <div className="mt-3 flex items-center gap-3 rounded-xl bg-white p-3.5" style={{ boxShadow: "0 1px 6px rgba(0,0,0,0.05)" }}>
            {event.attendee_preview.length > 0 && (
              <AvatarStack avatars={event.attendee_preview} size={30} overlap={8} />
            )}
            <div>
              <p className="text-sm font-bold text-gray-900">{event.attendee_count} going</p>
              <p className="text-xs text-gray-400">Be part of the community</p>
            </div>
          </div>

          {event.description && (
            <div className="mt-4">
              <h3 className="mb-1.5 text-base font-bold text-gray-900 font-zain">About this event</h3>
              <p className="text-sm leading-relaxed text-gray-700 whitespace-pre-wrap">{event.description}</p>
            </div>
          )}

          {/* Share + Save */}
          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              onClick={doShare}
              aria-label="Share event"
              className="flex h-11 w-11 items-center justify-center rounded-full"
              style={{ background: "rgba(15,166,166,0.1)", color: "#0FA6A6" }}
            >
              <ShareGlyph />
            </button>
            <button
              type="button"
              onClick={doSave}
              disabled={saving}
              aria-label={event.is_saved ? "Remove from saved" : "Save event"}
              aria-pressed={event.is_saved}
              className="flex h-11 w-11 items-center justify-center rounded-full"
              style={{ background: "rgba(15,166,166,0.1)", color: "#0FA6A6" }}
            >
              <BookmarkIcon size={22} filled={event.is_saved} />
            </button>
          </div>

          {/* RSVP */}
          {isEventPast(event.event_date, event.end_time) ? (
            <p className="mt-5 text-center text-[13px] text-gray-400">This event has ended</p>
          ) : (
            <div className="mt-5">
              <h3 className="mb-3 text-base font-bold text-gray-900 font-zain">Are you coming?</h3>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => doRsvp("going")}
                  disabled={rsvping}
                  className="flex-1 rounded-xl border-[1.5px] py-3 text-[15px] font-semibold"
                  style={
                    event.user_rsvp_status === "going"
                      ? { background: "#0FA6A6", borderColor: "#0FA6A6", color: "#fff" }
                      : { background: "#fff", borderColor: "#D1D5DB", color: "#0FA6A6" }
                  }
                >
                  {event.user_rsvp_status === "going" ? "Going ✓" : "Going"}
                </button>
                <button
                  type="button"
                  onClick={() => doRsvp("cant")}
                  disabled={rsvping}
                  className="flex-1 rounded-xl border-[1.5px] py-3 text-[15px] font-semibold"
                  style={
                    event.user_rsvp_status === "cant"
                      ? { background: "#F02719", borderColor: "#F02719", color: "#fff" }
                      : { background: "#fff", borderColor: "#D1D5DB", color: "#374151" }
                  }
                >
                  {event.user_rsvp_status === "cant" ? "Can't ✓" : "Can't"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function ShareGlyph(): JSX.Element {
  return (
    <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M22 2 11 13" />
      <path d="M22 2 15 22l-4-9-9-4 20-7Z" />
    </svg>
  );
}
