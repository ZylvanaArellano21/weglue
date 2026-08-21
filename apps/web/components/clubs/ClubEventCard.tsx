"use client";

import { CalendarIcon, LocationIcon, ChevronRightIcon } from "../shared/icons";
import { formatEventDate, formatEventTime, formatEventLocation } from "../../lib/datetime";
import type { HomeFeedEvent } from "../../lib/hooks/useHomeEventsFeed";

// Native's Club Profile event row (apps/mobile/app/club/[clubId]/index.tsx's
// ClubEventCard) — a compact horizontal card with a fixed-width image on the
// left filling the card's height, a red "Members only"/"Selected members
// only" ribbon on the image when restricted, and title/date/location on the
// right with a trailing chevron. This is NOT the same design as the
// full-width top-image card the Home feed and desktop's ClubHomeTab use
// (components/home/EventCard.tsx) — native genuinely uses two different card
// designs for these two contexts, so this is its own component rather than a
// variant of that one.
export function ClubEventCard({
  event,
  onOpen,
  onRestricted,
}: {
  event: HomeFeedEvent;
  onOpen: (eventId: string) => void;
  onRestricted: () => void;
}): JSX.Element {
  const isRestricted = event.visibility === "members" || event.visibility === "specific";
  const location = formatEventLocation(event.building, event.room, event.location);

  return (
    <button
      type="button"
      onClick={() => (event.can_open ? onOpen(event.id) : onRestricted())}
      className="mb-3.5 flex w-full items-center overflow-hidden rounded-xl bg-[#FEFCF0] text-left shadow-[0_4px_5px_rgba(0,0,0,0.25)]"
      style={{ minHeight: 96 }}
    >
      <div className="relative w-32 shrink-0 self-stretch bg-gray-200">
        {event.cover_image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={event.cover_image_url} alt="" className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-gray-500">
            <CalendarIcon size={30} />
          </div>
        )}
        {isRestricted && (
          <span className="absolute left-5 top-0 rounded-b px-2.5 py-1 text-[11px] font-bold text-white" style={{ background: "#F02719" }}>
            {event.visibility === "specific" ? "Selected members only" : "Members only"}
          </span>
        )}
      </div>
      <div className="flex-1 px-3.5 py-3">
        <p className="mb-1.5 truncate text-[15px] font-bold text-gray-900">{event.title}</p>
        <div className="mb-1 flex items-start gap-1.5 text-gray-500">
          <span className="mt-0.5"><CalendarIcon size={15} strokeWidth={1.6} /></span>
          <span className="text-xs font-medium leading-[17px]">
            {formatEventDate(event.event_date)}
            <br />
            {formatEventTime(event.start_time)} - {formatEventTime(event.end_time)}
          </span>
        </div>
        {location && (
          <div className="flex items-center gap-1.5 text-gray-500">
            <LocationIcon size={15} strokeWidth={1.6} />
            <span className="truncate text-xs font-medium">{location}</span>
          </div>
        )}
      </div>
      <span className="mr-3 shrink-0 text-gray-900" aria-hidden>
        <ChevronRightIcon size={22} />
      </span>
    </button>
  );
}
