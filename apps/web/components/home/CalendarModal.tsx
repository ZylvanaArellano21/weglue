"use client";

import { useState } from "react";
import { Modal } from "../shared/Modal";
import { CalendarGrid } from "./CalendarGrid";
import {
  useCalendarMonthMarkers,
  useCalendarDayEvents,
} from "../../lib/hooks/useCalendar";
import { formatEventTime, formatEventLocation, todayInAppTz } from "../../lib/datetime";
import { EventAudienceBadge } from "./EventAudienceBadge";

// The expanded calendar view (spec §20). Larger grid + the selected day's
// events; clicking an event opens the event-detail overlay. Closing returns to
// the same Home state. Uses the same going-RSVP data as Upcoming Events.
export function CalendarModal({
  userId,
  initialDate,
  onClose,
  onOpenEvent,
}: {
  userId: string;
  initialDate: string | null;
  onClose: () => void;
  onOpenEvent: (eventId: string) => void;
}): JSX.Element {
  const today = todayInAppTz();
  const start = initialDate ?? today;
  const [y, m] = start.split("-").map(Number);
  const [cursor, setCursor] = useState({ year: y!, month: m! });
  const [selected, setSelected] = useState<string | null>(initialDate);

  const { data: markers } = useCalendarMonthMarkers(userId, cursor.year, cursor.month);
  const { data: dayEvents, isLoading } = useCalendarDayEvents(userId, selected ?? undefined);

  const shift = (delta: number) => {
    setCursor((c) => {
      const d = new Date(c.year, c.month - 1 + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() + 1 };
    });
  };

  const prettyDate = selected
    ? new Date(selected + "T00:00:00").toLocaleDateString("en-US", {
        weekday: "long",
        day: "numeric",
        month: "long",
      })
    : null;

  return (
    <Modal onClose={onClose} labelledBy="calendar-modal-title" maxWidth={520}>
      <div className="p-5 sm:p-6">
        <h2 id="calendar-modal-title" className="sr-only">
          Calendar
        </h2>
        <CalendarGrid
          year={cursor.year}
          month={cursor.month}
          markers={markers ?? []}
          selectedDate={selected}
          onSelectDate={setSelected}
          onPrev={() => shift(-1)}
          onNext={() => shift(1)}
          size="lg"
        />

        <div className="mt-5 border-t border-black/5 pt-4">
          {!selected ? (
            <p className="text-sm text-gray-400">Pick a date to see its events.</p>
          ) : (
            <>
              <p className="mb-2 text-sm font-bold text-gray-900">{prettyDate}</p>
              {isLoading ? (
                <div className="h-14 animate-pulse rounded-lg bg-black/5" />
              ) : !dayEvents || dayEvents.length === 0 ? (
                <p className="text-sm text-gray-400">No events on this day.</p>
              ) : (
                <div className="space-y-2">
                  {dayEvents.map((event) => (
                    <button
                      key={event.id}
                      type="button"
                      onClick={() => onOpenEvent(event.id)}
                      className="flex w-full items-center gap-2 rounded-lg border border-black/5 p-2.5 text-left hover:bg-gray-50"
                      style={{ borderLeft: "3px solid #0FA6A6" }}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-gray-900">
                          {event.emoji ? `${event.emoji} ` : ""}
                          {event.title}
                        </p>
                        <EventAudienceBadge audience={event.visibility} />
                        <p className="truncate text-xs font-medium" style={{ color: "#0FA6A6" }}>
                          {event.club.name}
                        </p>
                        <p className="text-xs text-gray-500">
                          {formatEventTime(event.start_time)} - {formatEventTime(event.end_time)}
                          {formatEventLocation(event.building, event.room, event.location)
                            ? ` · ${formatEventLocation(event.building, event.room, event.location)}`
                            : ""}
                        </p>
                      </div>
                      <span aria-hidden className="text-gray-300">
                        ›
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
