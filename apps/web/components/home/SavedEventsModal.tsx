"use client";

import { Modal } from "../shared/Modal";
import { ImageIcon } from "../shared/icons";
import { EmptyState } from "./EmptyState";
import { useSavedEvents } from "../../lib/hooks/useSavedEvents";
import { formatEventDate, formatEventTime, formatEventLocation } from "../../lib/datetime";
import type { CalendarEvent } from "../../lib/hooks/useCalendar";
import { ClickableClubIdentity } from "../shared/ClickableIdentity";

// The "Saved" overlay (matches the web screenshot): real saved-event records,
// upcoming events bucketed by Today / This Week / …, then past. Each row opens
// the event detail; unsaving happens there and updates this list immediately.
export function SavedEventsModal({
  userId,
  onClose,
  onOpenEvent,
}: {
  userId: string;
  onClose: () => void;
  onOpenEvent: (eventId: string) => void;
}): JSX.Element {
  const { data, isLoading } = useSavedEvents(userId);
  const hasUpcoming = (data?.upcoming.length ?? 0) > 0;
  const hasPast = (data?.past.length ?? 0) > 0;
  const isEmpty = !isLoading && !hasUpcoming && !hasPast;

  return (
    <Modal onClose={onClose} labelledBy="saved-title" maxWidth={620}>
      <div className="p-5 sm:p-6">
        <h2 id="saved-title" className="mb-4 text-center text-lg font-bold text-gray-900">
          Saved
        </h2>

        {isLoading ? (
          <div className="space-y-2">
            {[0, 1].map((k) => (
              <div key={k} className="h-20 animate-pulse rounded-xl bg-black/5" />
            ))}
          </div>
        ) : isEmpty ? (
          <EmptyState
            emoji="🔖"
            title="No saved events yet."
            subtitle="Tap the bookmark on any event to save it here."
          />
        ) : (
          <div className="space-y-5">
            {data!.upcoming.map((section) => (
              <div key={section.key}>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                  {section.label}
                </p>
                <div className="space-y-2">
                  {section.data.map((e) => (
                    <SavedRow key={e.id} event={e} onOpen={() => onOpenEvent(e.id)} />
                  ))}
                </div>
              </div>
            ))}
            {hasPast && (
              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                  Past
                </p>
                <div className="space-y-2">
                  {data!.past.map((e) => (
                    <SavedRow key={e.id} event={e} onOpen={() => onOpenEvent(e.id)} past />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

function SavedRow({
  event,
  onOpen,
  past,
}: {
  event: CalendarEvent;
  onOpen: () => void;
  past?: boolean;
}): JSX.Element {
  const location = formatEventLocation(event.building, event.room, event.location);
  return (
    <div className={`flex w-full items-center gap-3 rounded-xl border border-black/5 bg-white p-2.5 ${past ? "opacity-70" : ""}`}>
      <button type="button" onClick={onOpen} aria-label={`Open ${event.title}`} className="shrink-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0FA6A6] focus-visible:ring-offset-2">
      {event.cover_image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={event.cover_image_url} alt="" className="h-14 w-16 shrink-0 rounded-lg object-cover" />
      ) : (
        <span className="flex h-14 w-16 shrink-0 items-center justify-center rounded-lg" style={{ background: "#E5E7EB", color: "#9CA3AF" }}>
          <ImageIcon size={22} />
        </span>
      )}
      </button>
      <div className="min-w-0 flex-1">
        <button type="button" onClick={onOpen} className="block w-full truncate text-left text-sm font-semibold text-gray-900 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0FA6A6] focus-visible:ring-offset-2">
          {event.emoji ? `${event.emoji} ` : ""}{event.title}
        </button>
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
