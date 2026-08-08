"use client";

import { useState } from "react";
import { CalendarGrid } from "./CalendarGrid";
import { useCalendarMonthMarkers, useCalendarSections } from "../../lib/hooks/useCalendar";
import { todayInAppTz } from "../../lib/datetime";

// Small Home calendar. Defaults to the current month, supports prev/next, marks
// dates that have a going RSVP, and opens the larger calendar view (spec §20)
// when a date is picked or "Expand" is clicked.
export function HomeCalendar({
  userId,
  onExpand,
}: {
  userId: string;
  onExpand: (date: string | null) => void;
}): JSX.Element {
  const today = todayInAppTz();
  const [y, m] = today.split("-").map(Number);
  const [cursor, setCursor] = useState({ year: y!, month: m! });
  const { data: markers } = useCalendarMonthMarkers(userId, cursor.year, cursor.month);
  // Shares the Upcoming Events query, so this costs no extra request. Only a
  // genuinely empty calendar (no upcoming going-RSVPs at all) gets the hint —
  // it disappears for good once the user has anything on the calendar.
  const { data: sections, isSuccess } = useCalendarSections(userId);
  const calendarIsEmpty = isSuccess && (sections?.length ?? 0) === 0;

  const shift = (delta: number) => {
    setCursor((c) => {
      const d = new Date(c.year, c.month - 1 + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() + 1 };
    });
  };

  return (
    <section
      className="rounded-xl bg-white p-4"
      style={{ boxShadow: "0 1px 4px rgba(0,0,0,0.06)", border: "1px solid rgba(0,0,0,0.05)" }}
      aria-label="Calendar"
    >
      <CalendarGrid
        year={cursor.year}
        month={cursor.month}
        markers={markers ?? []}
        selectedDate={null}
        onSelectDate={(date) => onExpand(date)}
        onPrev={() => shift(-1)}
        onNext={() => shift(1)}
        size="sm"
      />
      {calendarIsEmpty && (
        <p className="mt-3 text-center text-xs text-gray-400">
          RSVP or tap Going to add events here.
        </p>
      )}
      <button
        type="button"
        onClick={() => onExpand(null)}
        className="mt-3 w-full rounded-full border py-2 text-sm font-semibold"
        style={{ borderColor: "#0FA6A6", color: "#0FA6A6" }}
      >
        Expand calendar
      </button>
    </section>
  );
}
