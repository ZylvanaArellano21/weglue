"use client";

import { useCalendarSections, type CalendarEvent } from "../../lib/hooks/useCalendar";
import { formatEventDate, formatEventTime, formatEventLocation } from "../../lib/datetime";
import { ClickableClubIdentity } from "../shared/ClickableIdentity";
import { EventAudienceBadge } from "./EventAudienceBadge";

// Right-column "Upcoming Events!" — the user's going-RSVP events grouped
// Today / This Week / … (same source as the calendar, so the two always agree).
export function UpcomingEvents({
  userId,
  onOpenEvent,
}: {
  userId: string;
  onOpenEvent: (eventId: string) => void;
}): JSX.Element {
  const { data: sections, isLoading } = useCalendarSections(userId);

  return (
    <section
      className="rounded-xl bg-white p-4"
      style={{ boxShadow: "0 1px 4px rgba(0,0,0,0.06)", border: "1px solid rgba(0,0,0,0.05)" }}
      aria-label="Upcoming events"
    >
      <h2 className="mb-3 text-lg font-bold text-gray-900 font-zain">Upcoming Events!</h2>

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1].map((k) => (
            <div key={k} className="h-16 animate-pulse rounded-lg bg-black/5" />
          ))}
        </div>
      ) : !sections || sections.length === 0 ? (
        <p className="py-4 text-sm text-gray-400">
          No upcoming events yet. RSVP to an event and it&apos;ll show up here.
        </p>
      ) : (
        <div className="space-y-4">
          {sections.map((section) => (
            <div key={section.key}>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                {section.label}
              </p>
              <div className="space-y-2">
                {section.data.map((event) => (
                  <UpcomingRow key={event.id} event={event} onOpen={() => onOpenEvent(event.id)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function UpcomingRow({ event, onOpen }: { event: CalendarEvent; onOpen: () => void }): JSX.Element {
  const location = formatEventLocation(event.building, event.room, event.location);
  return (
    <div className="flex w-full items-center gap-2 rounded-lg border border-black/5 p-2.5" style={{ borderLeft: "3px solid #0FA6A6" }}>
      <div className="min-w-0 flex-1">
        <button type="button" onClick={onOpen} className="block w-full truncate text-left text-sm font-semibold text-gray-900 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0FA6A6] focus-visible:ring-offset-2">
          {event.emoji ? `${event.emoji} ` : ""}{event.title}
        </button>
        <EventAudienceBadge audience={event.visibility} />
        <ClickableClubIdentity clubId={event.club.id} className="block truncate text-xs font-medium text-[#0FA6A6]">
          @{event.club.name}
        </ClickableClubIdentity>
        <p className="text-xs text-gray-500">
          {formatEventDate(event.event_date)} · {formatEventTime(event.start_time)} -{" "}
          {formatEventTime(event.end_time)}
        </p>
        {location && <p className="truncate text-xs text-gray-400">{location}</p>}
      </div>
      <span aria-hidden className="text-gray-300">
        ›
      </span>
    </div>
  );
}
