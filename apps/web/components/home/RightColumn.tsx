"use client";

import { useState } from "react";
import { UpcomingEvents } from "./UpcomingEvents";
import { HomeCalendar } from "./HomeCalendar";
import { CalendarModal } from "./CalendarModal";

// Right column: Upcoming Events + the small calendar, plus the expanded
// calendar overlay. Opening an event (from either) routes through onOpenEvent
// so the shared event-detail overlay handles it. External-calendar linking is
// not a We Glue feature on any platform — the calendar is filled by RSVP/Going.
export function RightColumn({
  userId,
  onOpenEvent,
}: {
  userId: string;
  onOpenEvent: (eventId: string) => void;
}): JSX.Element {
  // null = closed; { date } = expanded, optionally focused on a date.
  const [expanded, setExpanded] = useState<{ date: string | null } | null>(null);

  return (
    <aside className="flex flex-col gap-5" aria-label="Upcoming events and calendar">
      <UpcomingEvents userId={userId} onOpenEvent={onOpenEvent} />
      <HomeCalendar userId={userId} onExpand={(date) => setExpanded({ date })} />

      {expanded && (
        <CalendarModal
          userId={userId}
          initialDate={expanded.date}
          onClose={() => setExpanded(null)}
          onOpenEvent={(eventId) => {
            setExpanded(null);
            onOpenEvent(eventId);
          }}
        />
      )}
    </aside>
  );
}
