"use client";

import { useCallback, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AppHeader } from "../home/AppHeader";
import { PageOverlays } from "../shared/PageOverlays";
import { EventAudienceBadge } from "../home/EventAudienceBadge";
import { ClickableClubIdentity } from "../shared/ClickableIdentity";
import { formatEventDate, formatEventTime, formatEventLocation, todayInAppTz } from "../../lib/datetime";
import { useCalendarMonthMarkers, useCalendarSections, type CalendarEvent } from "../../lib/hooks/useCalendar";

// Native's standalone Calendar tab (apps/mobile/app/(tabs)/calendar/index.tsx +
// components/calendar/{CalendarGrid,CalendarEventCard,CalendarEmptyState}.tsx),
// ported 1:1 for phone: a full month grid (today = solid teal circle, an
// event day = a colored underline, adjacent-month days shown muted) followed
// by the SAME going-RSVP events grouped Today/This Week/… that already power
// the desktop "Upcoming Events" sidebar and the /home?calendar=1 expand modal
// (useCalendarSections/useCalendarMonthMarkers — unmodified, shared reads).
// Only DAYS WITH EVENTS are tappable, exactly matching native's grid (a day
// with nothing on it is inert there too — CalendarGrid.tsx disables it).
export function CalendarTabClient({ userId }: { userId: string }): JSX.Element {
  return (
    <div className="flex min-h-screen flex-col bg-cream pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0">
      <AppHeader userId={userId} />
      <CalendarTabBody userId={userId} />
      <PageOverlays userId={userId} />
    </div>
  );
}

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

interface GridCell { date: string; day: number; inMonth: boolean }

function buildCells(year: number, month: number): GridCell[] {
  const first = new Date(year, month - 1, 1);
  const leading = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month, 0).getDate();
  const cells: GridCell[] = [];
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const prevDays = new Date(prevYear, prevMonth, 0).getDate();
  for (let i = 0; i < leading; i++) {
    const day = prevDays - leading + 1 + i;
    cells.push({ date: `${prevYear}-${pad(prevMonth)}-${pad(day)}`, day, inMonth: false });
  }
  for (let d = 1; d <= daysInMonth; d++) cells.push({ date: `${year}-${pad(month)}-${pad(d)}`, day: d, inMonth: true });
  const trailing = (7 - (cells.length % 7)) % 7;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  for (let d = 1; d <= trailing; d++) cells.push({ date: `${nextYear}-${pad(nextMonth)}-${pad(d)}`, day: d, inMonth: false });
  return cells;
}

function CalendarTabBody({ userId }: { userId: string }): JSX.Element {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const set = useCallback(
    (key: string, val: string) => {
      const sp = new URLSearchParams(params.toString());
      sp.set(key, val);
      router.push(`${pathname}?${sp.toString()}`, { scroll: false });
    },
    [params, pathname, router]
  );
  const openEvent = useCallback((id: string) => set("event", id), [set]);

  const today = todayInAppTz();
  const [y, m] = today.split("-").map(Number);
  const [cursor, setCursor] = useState({ year: y!, month: m! });
  const shift = (delta: number) =>
    setCursor((c) => {
      const d = new Date(c.year, c.month - 1 + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() + 1 };
    });

  const { data: markers = [] } = useCalendarMonthMarkers(userId, cursor.year, cursor.month);
  const markerSet = useMemo(() => new Set(markers), [markers]);
  const { data: sections, isLoading } = useCalendarSections(userId);
  const cells = useMemo(() => buildCells(cursor.year, cursor.month), [cursor.year, cursor.month]);

  const openFirstEventOn = (date: string) => {
    const dayEvents = (sections ?? [])
      .flatMap((s) => s.data)
      .filter((e) => e.event_date === date)
      .sort((a, b) => a.start_time.localeCompare(b.start_time));
    if (dayEvents[0]) openEvent(dayEvents[0].id);
  };

  const isEmpty = !isLoading && (sections?.length ?? 0) === 0;

  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-10 pt-4 sm:px-6">
      <div className="rounded-xl bg-white px-3 pb-2.5 pt-3.5 shadow-[0_4px_6px_rgba(0,0,0,0.15)]">
        <div className="mb-3 flex items-center justify-between px-1">
          <h1 className="text-xl font-bold text-gray-950 font-zain">{MONTHS[cursor.month - 1]} {cursor.year}</h1>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => shift(-1)} aria-label="Previous month" className="rounded p-1.5 text-gray-500 hover:bg-gray-100">‹</button>
            <button type="button" onClick={() => shift(1)} aria-label="Next month" className="rounded p-1.5 text-gray-500 hover:bg-gray-100">›</button>
          </div>
        </div>
        <div className="grid grid-cols-7 border-b border-r-0" style={{ borderColor: "#E5E7EB" }}>
          {WEEKDAYS.map((w) => (
            <div key={w} className="pb-1 text-center text-[11px] font-semibold text-gray-950">{w}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((cell) => {
            const isToday = cell.date === today;
            const hasEvent = markerSet.has(cell.date);
            return (
              <button
                key={cell.date}
                type="button"
                disabled={!hasEvent}
                onClick={() => openFirstEventOn(cell.date)}
                aria-label={`${cell.day}${hasEvent ? ", has events" : ""}`}
                className={`relative flex h-11 items-center justify-center border-b border-r ${!cell.inMonth ? "bg-[#F0F4FF]" : ""} ${hasEvent ? "cursor-pointer" : "cursor-default"}`}
                style={{ borderColor: "#E5E7EB" }}
              >
                {isToday ? (
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-teal text-sm font-bold text-white">{cell.day}</span>
                ) : (
                  <span className={`text-sm ${cell.inMonth ? "font-medium text-gray-950" : "text-gray-400"}`}>{cell.day}</span>
                )}
                {hasEvent && (
                  <span
                    aria-hidden
                    className="absolute bottom-1 h-0.5 w-4 rounded-full"
                    style={{ background: isToday ? "#F02719" : "#0FA6A6" }}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-4">
        {isLoading ? (
          <div className="space-y-2">
            {[0, 1].map((k) => <div key={k} className="h-20 animate-pulse rounded-xl bg-black/5" />)}
          </div>
        ) : isEmpty ? (
          <div className="flex flex-col items-center px-8 pt-8 text-center">
            <p className="text-lg font-semibold text-gray-900">Build your calendar</p>
            <p className="mb-5 mt-2 text-sm leading-5 text-gray-500">RSVP or tap Going on events you want to attend. They&apos;ll appear here automatically.</p>
            <button
              type="button"
              onClick={() => router.push("/home")}
              className="rounded-full bg-white px-7 py-3.5 text-[15px] font-semibold text-teal shadow-[0_2px_4px_rgba(0,0,0,0.08)]"
            >
              Find upcoming events
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {sections!.map((section) => (
              <div key={section.key}>
                <p className="mb-1.5 px-1 text-[13px] font-bold uppercase tracking-wide text-gray-500">{section.label}</p>
                <div className="space-y-2.5">
                  {section.data.map((event) => (
                    <CalendarEventRow key={event.id} event={event} isToday={section.key === "today"} onOpen={() => openEvent(event.id)} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

// A plain div, not a <button>: ClickableClubIdentity renders a real <a>, and
// interactive content (a link or button) cannot legally nest inside a
// <button> — the same fix applied to the Search tab's cards. Mirrors the
// existing desktop UpcomingRow's structure for the identical data shape:
// the title is its own button, the club name its own link, sitting side by
// side rather than one wrapping the other.
function CalendarEventRow({ event, isToday, onOpen }: { event: CalendarEvent; isToday: boolean; onOpen: () => void }): JSX.Element {
  const location = formatEventLocation(event.building, event.room, event.location);
  const metaClass = isToday ? "text-[12px] font-bold" : "text-[12px] text-gray-500";
  const metaStyle = isToday ? { color: "#F02719" } : undefined;
  return (
    <div className="flex w-full items-center gap-3 overflow-hidden rounded-xl bg-white py-3 pr-3 shadow-[0_2px_4px_rgba(0,0,0,0.08)]">
      <span aria-hidden className="self-stretch shrink-0" style={{ width: 4, background: "#F02719" }} />
      <div className="min-w-0 flex-1">
        <button type="button" onClick={onOpen} className="block w-full truncate text-left text-[14px] font-semibold text-gray-900 hover:underline">
          {event.emoji ? `${event.emoji} ` : ""}{event.title}
        </button>
        <ClickableClubIdentity clubId={event.club.id} className="block truncate text-[12px] font-medium text-teal">
          {event.club.name}
        </ClickableClubIdentity>
        <EventAudienceBadge audience={event.visibility} />
        <p className={`truncate ${metaClass}`} style={metaStyle}>{formatEventDate(event.event_date)}</p>
        <p className={`truncate ${metaClass}`} style={metaStyle}>{formatEventTime(event.start_time)} - {formatEventTime(event.end_time)}</p>
        {location && <p className={`truncate ${metaClass}`} style={metaStyle}>{location}</p>}
      </div>
      <button type="button" onClick={onOpen} aria-label={`Open ${event.title}`} className="shrink-0 text-gray-300">›</button>
    </div>
  );
}
