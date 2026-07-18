"use client";

import { useMemo, useState } from "react";
import { CalendarGrid } from "../home/CalendarGrid";
import { todayInAppTz } from "../../lib/datetime";
import type { HomeFeedEvent } from "../../lib/hooks/useHomeEventsFeed";

// Calendar tab (spec §16): month grid marking every date that has one or more
// club events (past OR future), using real event data. Clicking a marked date
// opens the Event Detail overlay directly over the calendar — the parent handles
// the overlay + same-date prev/next cycling. Closing keeps this month + date.
export function ClubCalendarTab({
  events,
  onOpenDate,
}: {
  events: HomeFeedEvent[];
  onOpenDate: (dateEvents: HomeFeedEvent[], selectedDate: string) => void;
}): JSX.Element {
  const today = todayInAppTz();
  const [ym, setYm] = useState(() => {
    // Start on the month of the nearest upcoming event, else today.
    const upcoming = events
      .filter((e) => e.event_date >= today)
      .sort((a, b) => a.event_date.localeCompare(b.event_date))[0];
    const anchor = upcoming?.event_date ?? events[0]?.event_date ?? today;
    const [y, m] = anchor.split("-").map(Number);
    return { year: y!, month: m! };
  });
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const eventsByDate = useMemo(() => {
    const map = new Map<string, HomeFeedEvent[]>();
    for (const e of events) {
      const list = map.get(e.event_date) ?? [];
      list.push(e);
      map.set(e.event_date, list);
    }
    // Order each day's events by start time so "first event" is deterministic.
    for (const list of map.values()) list.sort((a, b) => a.start_time.localeCompare(b.start_time));
    return map;
  }, [events]);

  const markers = useMemo(() => Array.from(eventsByDate.keys()), [eventsByDate]);

  return (
    <div className="mt-6 rounded-2xl bg-white p-4 shadow-[0_2px_10px_rgba(0,0,0,0.08)] sm:p-6">
      <CalendarGrid
        year={ym.year}
        month={ym.month}
        markers={markers}
        selectedDate={selectedDate}
        onSelectDate={(date) => {
          setSelectedDate(date);
          const dayEvents = eventsByDate.get(date);
          if (dayEvents && dayEvents.length > 0) onOpenDate(dayEvents, date);
        }}
        onPrev={() =>
          setYm((v) => (v.month === 1 ? { year: v.year - 1, month: 12 } : { year: v.year, month: v.month - 1 }))
        }
        onNext={() =>
          setYm((v) => (v.month === 12 ? { year: v.year + 1, month: 1 } : { year: v.year, month: v.month + 1 }))
        }
        size="lg"
      />
    </div>
  );
}
