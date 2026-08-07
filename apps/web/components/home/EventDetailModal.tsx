"use client";

import { Modal } from "../shared/Modal";
import { Avatar } from "../shared/Avatar";
import { AvatarStack } from "../shared/AvatarStack";
import { AttendanceTrigger } from "./AttendanceTrigger";
import { UnifiedShareSheet } from "../shared/UnifiedShareSheet";
import { LeaveClubDialog } from "../clubs/LeaveClubDialog";
import { ClickableClubIdentity } from "../shared/ClickableIdentity";
import { CalendarIcon, LocationIcon, BookmarkIcon, ImageIcon } from "../shared/icons";
import { useToast } from "../shared/Toast";
import { useState } from "react";
import {
  useEventDetail,
  useRsvpMutation,
  useSaveEventMutation,
  useDeleteEvent,
} from "../../lib/hooks/useEventDetail";
import { useJoinClubMutation } from "../../lib/hooks/useClubMembership";
import { useEventRsvpRealtime } from "../../lib/hooks/useClubRealtime";
import { formatEventTime, formatEventLocation } from "../../lib/datetime";
import { EventAudienceBadge } from "./EventAudienceBadge";

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
  onOpenAttendees,
  onPrev,
  onNext,
  indicator,
  onEdit,
  onDeleted,
}: {
  eventId: string;
  userId: string;
  onClose: () => void;
  onOpenClub: (clubId: string) => void;
  onOpenAttendees?: (eventId: string) => void;
  onPrev?: () => void;
  onNext?: () => void;
  indicator?: string;
  /** Officer/creator affordances (Club Profile). Absent on Home. */
  onEdit?: (eventId: string) => void;
  onDeleted?: () => void;
}): JSX.Element {
  const show = useToast();
  useEventRsvpRealtime(eventId, userId); // live attendee count/avatars from other users
  const { data: event, isLoading } = useEventDetail(eventId, userId);
  const { mutate: rsvp, isPending: rsvping } = useRsvpMutation(userId);
  const { mutate: toggleSave, isPending: saving } = useSaveEventMutation(userId);
  const { mutate: joinClub, isPending: joining } = useJoinClubMutation(userId);
  const { mutate: deleteEvent, isPending: deleting } = useDeleteEvent(userId);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);

  const doRsvp = (status: "going" | "cant") =>
    rsvp(
      { eventId, status, previousStatus: event?.user_rsvp_status ?? null },
      {
        onSuccess: () => show(status === "going" ? "You're going! 🎉" : "Got it, maybe next time!"),
        onError: () => show("Failed to RSVP. Try again.", "error"),
      }
    );

  const doSave = () =>
    toggleSave({ eventId, isSaved: event?.is_saved ?? false }, {
      onSuccess: (savedNow) => show(savedNow ? "Event saved!" : "Removed from saved"),
      onError: () => show("Failed to save event.", "error"),
    });

  return (
    <>
    <Modal
      onClose={onClose}
      labelledBy="event-detail-title"
      maxWidth={1120}
      onPrev={onPrev}
      onNext={onNext}
      indicator={indicator}
    >
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
        <div className="grid max-h-[86vh] overflow-y-auto md:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
          <div className="flex min-h-[260px] items-center justify-center bg-black md:min-h-[620px]">
            {event.cover_image_url ? <img src={event.cover_image_url} alt={event.title} className="max-h-[86vh] w-full object-contain" /> : <div className="flex h-full min-h-[260px] w-full items-center justify-center text-gray-400"><ImageIcon size={54} /></div>}
          </div>
          <div className="p-5 sm:p-7">
          {/* Club row */}
          <div className="mb-3 flex items-center gap-2.5 pr-8">
            <ClickableClubIdentity clubId={event.club_id} ariaLabel={`Open ${event.club.name}`} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
              <Avatar uri={event.club.avatar_url} size={36} name={event.club.name} />
              <span className="truncate text-[15px] font-semibold text-gray-900">
                {event.club.name}
              </span>
            </ClickableClubIdentity>
            <button
              type="button"
              onClick={() => event.user_has_joined_club ? setLeaveOpen(true) : joinClub(event.club_id, {
                onSuccess: () => show("Joined club! 🎉"),
                onError: () => show("Failed to join club.", "error"),
              })}
              disabled={joining}
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

          <h2 id="event-detail-title" className="mt-4 text-2xl font-extrabold leading-tight text-gray-900 font-zain">
            {event.emoji ? `${event.emoji} ` : ""}
            {event.title}
          </h2>
          <div className="mt-2"><EventAudienceBadge audience={event.visibility} /></div>

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
          <div className="mt-3 rounded-xl bg-white p-3.5" style={{ boxShadow: "0 1px 6px rgba(0,0,0,0.05)" }}>
            {event.can_view_attendees ? (onOpenAttendees ? <AttendanceTrigger eventId={event.id} attendees={event.attendee_preview} count={event.attendee_count} onOpen={onOpenAttendees} className="gap-3" /> : <div className="flex items-center gap-3">{event.attendee_preview.length > 0 && <AvatarStack avatars={event.attendee_preview} size={30} overlap={8} />}<p className="text-sm font-bold text-gray-900">{event.attendee_count} going</p></div>) : <p className="text-sm text-gray-500">Join the club to view attendees.</p>}
            <p className="mt-0.5 text-xs text-gray-400">Be part of the community</p>
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
              onClick={() => setShareOpen(true)}
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
          {event.is_past ? (
            <p className="mt-5 text-center text-[13px] text-gray-400">This event has ended</p>
          ) : !event.can_rsvp ? (
            <p className="mt-5 text-center text-[13px] text-gray-500">This event is for club members only. Join the club to RSVP and view attendees.</p>
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

          {/* Officer/creator management (spec §17/§20) */}
          {(event.can_manage && (onEdit || onDeleted)) && (
            <div className="mt-5 flex items-center gap-3 border-t pt-4" style={{ borderColor: "rgba(0,0,0,0.08)" }}>
              {onEdit && (
                <button
                  type="button"
                  onClick={() => onEdit(event.id)}
                  className="rounded-full border-[1.5px] px-5 py-2 text-sm font-semibold text-teal transition hover:bg-teal/5"
                  style={{ borderColor: "#0FA6A6" }}
                >
                  Edit event
                </button>
              )}
              {onDeleted &&
                (confirmingDelete ? (
                  <span className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        deleteEvent(event.id, {
                          onSuccess: () => {
                            show("Event deleted");
                            onDeleted();
                          },
                          onError: () => show("Could not delete event. Try again.", "error"),
                        })
                      }
                      disabled={deleting}
                      className="rounded-full bg-[#F02719] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                    >
                      {deleting ? "Deleting…" : "Confirm delete"}
                    </button>
                    <button type="button" onClick={() => setConfirmingDelete(false)} className="text-sm font-semibold text-gray-500 hover:underline">
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmingDelete(true)}
                    className="rounded-full border-[1.5px] border-[#F02719]/40 px-5 py-2 text-sm font-semibold text-[#F02719] transition hover:bg-[#F02719]/5"
                  >
                    Delete event
                  </button>
                ))}
            </div>
          )}
          </div>
        </div>
      )}
    </Modal>
    {shareOpen && <UnifiedShareSheet userId={userId} content={{ type: "event", id: eventId }} title={event?.title ?? "Event"} onClose={() => setShareOpen(false)} onToast={(message, kind) => show(message, kind === "error" ? "error" : undefined)} />}
    {leaveOpen && event && <LeaveClubDialog clubId={event.club_id} clubName={event.club.name} userId={userId} onClose={() => setLeaveOpen(false)} onLeft={() => show("You left the club.")} onError={(message) => show(message, "error")} />}
    </>
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
