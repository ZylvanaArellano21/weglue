"use client";

import { useMemo } from "react";
import { todayInAppTz } from "../../lib/datetime";

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function pad(n: number) {
  return String(n).padStart(2, "0");
}

// Month grid used by both the small Home calendar and the expanded modal.
// Monday-first, today ringed in teal, dates with a going RSVP marked with a
// dot, selected date filled. Real data only (markers come from the caller).
export function CalendarGrid({
  year,
  month, // 1-indexed
  markers,
  selectedDate,
  onSelectDate,
  onPrev,
  onNext,
  size = "sm",
}: {
  year: number;
  month: number;
  markers: string[];
  selectedDate: string | null;
  onSelectDate: (date: string) => void;
  onPrev: () => void;
  onNext: () => void;
  size?: "sm" | "lg";
}): JSX.Element {
  const today = todayInAppTz();
  const markerSet = useMemo(() => new Set(markers), [markers]);

  const cells = useMemo(() => {
    const firstOfMonth = new Date(year, month - 1, 1);
    const daysInMonth = new Date(year, month, 0).getDate();
    // Monday-first offset (getDay: 0=Sun..6=Sat).
    const leading = (firstOfMonth.getDay() + 6) % 7;
    const arr: (number | null)[] = [];
    for (let i = 0; i < leading; i++) arr.push(null);
    for (let d = 1; d <= daysInMonth; d++) arr.push(d);
    while (arr.length % 7 !== 0) arr.push(null);
    return arr;
  }, [year, month]);

  const cellSize = size === "lg" ? "h-11" : "h-9";
  const textSize = size === "lg" ? "text-sm" : "text-[13px]";

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h3 className={`font-bold text-gray-900 font-zain ${size === "lg" ? "text-xl" : "text-lg"}`}>
          {MONTHS[month - 1]} {year}
        </h3>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onPrev}
            aria-label="Previous month"
            className="rounded p-1 text-gray-500 hover:bg-gray-100"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={onNext}
            aria-label="Next month"
            className="rounded p-1 text-gray-500 hover:bg-gray-100"
          >
            ›
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-y-1 text-center">
        {WEEKDAYS.map((w) => (
          <div key={w} className="pb-1 text-[11px] font-semibold text-gray-400">
            {w}
          </div>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <div key={`e-${i}`} className={cellSize} />;
          const dateStr = `${year}-${pad(month)}-${pad(day)}`;
          const isToday = dateStr === today;
          const isSelected = dateStr === selectedDate;
          const hasEvent = markerSet.has(dateStr);
          return (
            <div key={dateStr} className="flex items-center justify-center">
              <button
                type="button"
                onClick={() => onSelectDate(dateStr)}
                aria-label={`${MONTHS[month - 1]} ${day}${hasEvent ? ", has events" : ""}`}
                aria-pressed={isSelected}
                className={`relative flex ${cellSize} w-9 items-center justify-center rounded-full ${textSize} ${
                  isSelected
                    ? "font-bold text-white"
                    : isToday
                    ? "font-bold"
                    : "text-gray-800 hover:bg-gray-100"
                }`}
                style={
                  isSelected
                    ? { background: "#0FA6A6" }
                    : isToday
                    ? { background: "rgba(15,166,166,0.15)", color: "#0FA6A6" }
                    : undefined
                }
              >
                {day}
                {hasEvent && !isSelected && (
                  <span
                    aria-hidden
                    className="absolute bottom-1 h-1 w-1 rounded-full"
                    style={{ background: "#EF4444" }}
                  />
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
