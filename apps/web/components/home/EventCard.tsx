"use client";

import { useState } from "react";
import { Avatar } from "../shared/Avatar";
import { ClickableClubIdentity } from "../shared/ClickableIdentity";
import { AttendanceTrigger } from "./AttendanceTrigger";
import { LinkifiedText } from "../shared/LinkifiedText";
import { PhotoCarousel } from "../shared/PhotoCarousel";
import { MediaLightbox } from "../messages/messageInteractions";
import {
  BookmarkIcon,
  CalendarIcon,
  ImageIcon,
  LocationIcon,
} from "../shared/icons";
import {
  formatEventDate,
  formatEventTime,
  formatEventLocation,
} from "../../lib/datetime";
import type { HomeFeedEvent } from "../../lib/hooks/useHomeEventsFeed";
import { EventAudienceBadge } from "./EventAudienceBadge";

interface EventCardProps {
  event: HomeFeedEvent;
  onRsvp: (eventId: string, previousStatus: "going" | "cant" | null) => void;
  onToggleSave: (eventId: string, isSaved: boolean) => void;
  onToggleClub: (clubId: string, clubName: string, isMember: boolean) => void;
  onOpenEvent: (eventId: string) => void;
  onOpenClub: (clubId: string) => void;
  onOpenAttendees: (eventId: string) => void;
  onRestricted?: () => void;
  /** Past events show no active RSVP action (Club Profile Past Events, §15). */
  isPast?: boolean;
}

// Desktop adaptation of apps/mobile/components/home/EventCard.tsx — same data,
// same teal/cream language, laid out for a wider column.
export function EventCard({
  event,
  onRsvp,
  onToggleSave,
  onToggleClub,
  onOpenEvent,
  onOpenClub,
  onOpenAttendees,
  onRestricted,
  isPast = false,
}: EventCardProps): JSX.Element {
  const [viewerOpen, setViewerOpen] = useState(false);
  const location = formatEventLocation(event.building, event.room, event.location);
  const rsvp = event.user_rsvp_status;
  const openEvent = () => {
    if (!event.can_open) {
      onRestricted?.();
      return;
    }
    onOpenEvent(event.id);
  };

  return (
    <>
    <article
      className="overflow-hidden rounded-2xl shadow-card"
      style={{ background: "#FEFFF8" }}
    >
      {/* Club row */}
      <div className="flex items-center gap-2.5 px-3.5 pt-3 pb-2">
        <ClickableClubIdentity clubId={event.club_id} ariaLabel={`Open ${event.club.name}`} className="flex flex-1 min-w-0 items-center gap-2.5 text-left">
          <Avatar uri={event.club.logo_url} size={34} name={event.club.name} />
          <span
            className="truncate text-[15px] font-semibold"
            style={{ color: "#5F5D5D" }}
          >
            {event.club.name}
          </span>
        </ClickableClubIdentity>
        <button
          type="button"
          onClick={() => onToggleClub(event.club_id, event.club.name, event.user_has_joined_club)}
          className="rounded-full px-4 py-1 text-[13px] font-semibold transition-colors"
          style={
            event.user_has_joined_club
              ? { border: "1px solid #D1D5DB", color: "#6B7280", background: "#fff", cursor: "pointer" }
              : { background: "#0FA6A6", color: "#fff" }
          }
        >
          {event.user_has_joined_club ? "Joined" : "Join"}
        </button>
      </div>

      {/* Event image — its own tap target (opens the full-screen photo
          viewer), independent of the event-details tap targets (title, club
          row, body) elsewhere on this card. Natural ratio: horizontal stays
          horizontal, vertical stays vertical, square stays square — never a
          forced 3:2 crop. */}
      <div className="relative">
        {event.cover_image_url ? (
          <PhotoCarousel
            images={[{ uri: event.cover_image_url }]}
            naturalRatio
            rounded={false}
            onImageClick={event.can_open ? () => setViewerOpen(true) : onRestricted}
          />
        ) : (
          <span
            className="flex w-full items-center justify-center"
            style={{ aspectRatio: "3 / 2", background: "#E5E7EB", color: "#9CA3AF" }}
          >
            <ImageIcon size={40} />
          </span>
        )}

        {/* Phone: bookmark + audience badge float ON the image, top-right
            and top-left — checked directly against
            apps/mobile/components/home/EventCard.tsx, which positions both
            `absolute` over the image (a semi-transparent cream circle
            behind the bookmark) rather than in the body row below it.
            Desktop keeps its original body-row placement unchanged. */}
        {event.can_open && (
          <button
            type="button"
            onClick={() => onToggleSave(event.id, event.is_saved)}
            aria-label={event.is_saved ? "Remove from saved" : "Save event"}
            aria-pressed={event.is_saved}
            className="absolute right-2.5 top-2.5 flex h-7 w-7 items-center justify-center rounded-full shadow-[0_1px_4px_rgba(0,0,0,0.15)] md:hidden"
            style={{ background: "rgba(254,255,248,0.92)", color: event.is_saved ? "#0FA6A6" : "#374151" }}
          >
            <BookmarkIcon size={18} filled={event.is_saved} />
          </button>
        )}
        {/* max-w caps this absolutely-positioned wrapper's shrink-to-fit
            width explicitly — an unconstrained `absolute left-2.5` block
            (no `right`) was overflowing the card horizontally on-device
            even though EventAudienceBadge returns null for most events,
            widening the whole page's scrollable area. */}
        <div className="absolute left-2.5 top-2.5 max-w-[75%] md:hidden"><EventAudienceBadge audience={event.visibility} /></div>
      </div>

      {/* Body */}
      <div className="px-3.5 pt-2.5 pb-3">
        <div className="flex items-start justify-between gap-2">
          <button
            type="button"
            onClick={openEvent}
            className="text-left"
          >
            <h3 className="text-lg font-semibold leading-snug text-black line-clamp-2">
              {event.title}
            </h3>
          </button>
          {event.can_open ? (
            <button
              type="button"
              onClick={() => onToggleSave(event.id, event.is_saved)}
              aria-label={event.is_saved ? "Remove from saved" : "Save event"}
              aria-pressed={event.is_saved}
              className="hidden shrink-0 rounded-full p-1.5 md:block"
              style={{ color: event.is_saved ? "#0FA6A6" : "#374151" }}
            >
              <BookmarkIcon size={20} filled={event.is_saved} />
            </button>
          ) : null}
        </div>

        {event.description ? (
          <p className="mt-1 truncate text-xs" style={{ color: "#5F5D5D" }}>
            <LinkifiedText text={event.description} />
          </p>
        ) : null}

        <div className="mt-2 hidden md:block"><EventAudienceBadge audience={event.visibility} /></div>

        <div className="mt-2 flex items-start gap-1.5" style={{ color: "#5F5D5D" }}>
          <CalendarIcon size={17} strokeWidth={1.6} />
          <span className="text-xs font-medium leading-[18px]">
            {formatEventDate(event.event_date)}
            <br />
            {formatEventTime(event.start_time)} - {formatEventTime(event.end_time)}
          </span>
        </div>

        {location ? (
          <div className="mt-1.5 flex items-center gap-1.5" style={{ color: "#5F5D5D" }}>
            <LocationIcon size={16} strokeWidth={1.6} />
            <span className="truncate text-xs font-medium">{location}</span>
          </div>
        ) : null}

        <div className="mt-3 flex items-center">
          {event.can_view_attendees ? (
            <AttendanceTrigger eventId={event.id} attendees={event.attendee_preview} count={event.attendee_count} onOpen={onOpenAttendees} />
          ) : (
            <span className="text-xs text-gray-500">Join the club to view attendees.</span>
          )}
          <div className="flex-1" />
          {isPast ? (
            <span className="rounded-full px-4 py-1.5 text-xs font-semibold" style={{ background: "#F3F4F6", color: "#6B7280" }}>
              Ended
            </span>
          ) : (
            <button
              type="button"
              onClick={() => event.can_open ? onRsvp(event.id, rsvp) : onRestricted?.()}
              className="rounded-full px-5 py-1.5 text-xs font-semibold transition-colors"
              style={
                rsvp === "cant"
                  ? { background: "rgba(240,39,25,0.1)", color: "#F02719", border: "1.5px solid #F02719" }
                  : { background: "#0FA6A6", color: "#fff" }
              }
            >
              {event.can_open ? (rsvp === "going" ? "Going ✓" : rsvp === "cant" ? "Can't" : "RSVP") : "Join to RSVP"}
            </button>
          )}
        </div>
      </div>
    </article>
    {viewerOpen && event.cover_image_url && (
      <MediaLightbox
        items={[{ url: event.cover_image_url, kind: "image", senderName: event.club.name }]}
        index={0}
        onIndex={() => {}}
        onClose={() => setViewerOpen(false)}
      />
    )}
    </>
  );
}
