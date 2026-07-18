"use client";

import { useState } from "react";
import { Avatar } from "../shared/Avatar";
import { AvatarStack } from "../shared/AvatarStack";
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

interface EventCardProps {
  event: HomeFeedEvent;
  onRsvp: (eventId: string) => void;
  onToggleSave: (eventId: string) => void;
  onJoinClub: (clubId: string) => void;
  onOpenEvent: (eventId: string) => void;
  onOpenClub: (clubId: string) => void;
  /** Past events show no active RSVP action (Club Profile Past Events, §15). */
  isPast?: boolean;
}

// Desktop adaptation of apps/mobile/components/home/EventCard.tsx — same data,
// same teal/cream language, laid out for a wider column.
export function EventCard({
  event,
  onRsvp,
  onToggleSave,
  onJoinClub,
  onOpenEvent,
  onOpenClub,
  isPast = false,
}: EventCardProps): JSX.Element {
  const [imageError, setImageError] = useState(false);
  const location = formatEventLocation(event.building, event.room, event.location);
  const rsvp = event.user_rsvp_status;

  return (
    <article
      className="overflow-hidden rounded-xl"
      style={{
        background: "#FEFFF8",
        boxShadow: "0 2px 8px rgba(0,0,0,0.07)",
        border: "1px solid rgba(0,0,0,0.04)",
      }}
    >
      {/* Club row */}
      <div className="flex items-center gap-2.5 px-3.5 pt-3 pb-2">
        <button
          type="button"
          onClick={() => onOpenClub(event.club_id)}
          className="flex items-center gap-2.5 flex-1 min-w-0 text-left"
        >
          <Avatar uri={event.club.logo_url} size={34} name={event.club.name} />
          <span
            className="truncate text-[15px] font-semibold"
            style={{ color: "#5F5D5D" }}
          >
            {event.club.name}
          </span>
        </button>
        <button
          type="button"
          onClick={() => !event.user_has_joined_club && onJoinClub(event.club_id)}
          disabled={event.user_has_joined_club}
          className="rounded-full px-4 py-1 text-[13px] font-semibold transition-colors"
          style={
            event.user_has_joined_club
              ? { border: "1px solid #D1D5DB", color: "#6B7280", background: "#fff" }
              : { background: "#0FA6A6", color: "#fff" }
          }
        >
          {event.user_has_joined_club ? "Joined" : "Join"}
        </button>
      </div>

      {/* Event image */}
      <button
        type="button"
        onClick={() => onOpenEvent(event.id)}
        className="relative block w-full"
        style={{ aspectRatio: "3 / 2" }}
        aria-label={`Open ${event.title}`}
      >
        {event.cover_image_url && !imageError ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={event.cover_image_url}
            alt={event.title}
            onError={() => setImageError(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          <span
            className="flex h-full w-full items-center justify-center"
            style={{ background: "#E5E7EB", color: "#9CA3AF" }}
          >
            <ImageIcon size={40} />
          </span>
        )}
      </button>

      {/* Body */}
      <div className="px-3.5 pt-2.5 pb-3">
        <div className="flex items-start justify-between gap-2">
          <button
            type="button"
            onClick={() => onOpenEvent(event.id)}
            className="text-left"
          >
            <h3 className="text-lg font-semibold leading-snug text-black line-clamp-2">
              {event.title}
            </h3>
          </button>
          <button
            type="button"
            onClick={() => onToggleSave(event.id)}
            aria-label={event.is_saved ? "Remove from saved" : "Save event"}
            aria-pressed={event.is_saved}
            className="shrink-0 rounded-full p-1.5"
            style={{ color: event.is_saved ? "#0FA6A6" : "#374151" }}
          >
            <BookmarkIcon size={20} filled={event.is_saved} />
          </button>
        </div>

        {event.description ? (
          <p className="mt-1 truncate text-xs" style={{ color: "#5F5D5D" }}>
            {event.description}
          </p>
        ) : null}

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
          <button
            type="button"
            onClick={() => onOpenEvent(event.id)}
            className="flex items-center gap-2"
          >
            {event.attendee_preview.length > 0 && (
              <AvatarStack avatars={event.attendee_preview} size={26} overlap={8} />
            )}
            <span className="text-xs text-black">{event.attendee_count} going</span>
          </button>
          <div className="flex-1" />
          {isPast ? (
            <span className="rounded-full px-4 py-1.5 text-xs font-semibold" style={{ background: "#F3F4F6", color: "#6B7280" }}>
              Ended
            </span>
          ) : (
            <button
              type="button"
              onClick={() => onRsvp(event.id)}
              className="rounded-full px-5 py-1.5 text-xs font-semibold transition-colors"
              style={
                rsvp === "cant"
                  ? { background: "rgba(240,39,25,0.1)", color: "#F02719", border: "1.5px solid #F02719" }
                  : { background: "#0FA6A6", color: "#fff" }
              }
            >
              {rsvp === "going" ? "Going ✓" : rsvp === "cant" ? "Can't" : "RSVP"}
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
