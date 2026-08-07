"use client";

import { CalendarIcon } from "../shared/icons";
import { formatEventDate, formatEventTime, formatEventLocation } from "../../lib/datetime";
import type { ClubProfileData } from "../../lib/clubs/clubProfileService";
import type { HomeFeedEvent } from "../../lib/hooks/useHomeEventsFeed";
import { EventAudienceBadge } from "../home/EventAudienceBadge";

// Persistent right column of the Club Profile (visible on every tab): learning
// outcomes, meeting schedule, an Upcoming Events! rail, and the Photos that Glue
// preview grid. All real data — empty sections simply don't render.
export function ClubRightColumn({
  club,
  upcomingEvents,
  onRsvp,
  onOpenEvent,
  onOpenPhoto,
  onSeeAllPhotos,
  onRestricted,
}: {
  club: ClubProfileData;
  upcomingEvents: HomeFeedEvent[];
  onRsvp: (eventId: string, previousStatus: "going" | "cant" | null) => void;
  onOpenEvent: (eventId: string) => void;
  onOpenPhoto: (index: number) => void;
  onSeeAllPhotos: () => void;
  onRestricted?: () => void;
}): JSX.Element {
  const scheduleLines = buildScheduleLines(club);
  const location = formatEventLocation(club.meeting_building, club.meeting_room, club.meeting_location);
  const railEvents = upcomingEvents.slice(0, 3);
  const photos = club.photos.slice(0, 6);

  return (
    <div className="space-y-6">
      {club.goals.length > 0 && (
        <div
          className="rounded-2xl bg-white p-5 shadow-[0_0_0_1px_rgba(15,166,166,0.25),0_2px_14px_rgba(15,166,166,0.12)]"
        >
          <ul className="space-y-3.5">
            {club.goals.map((goal) => (
              <li key={goal.id} className="flex items-start gap-3">
                <span className="mt-0.5 text-teal" aria-hidden>💡</span>
                <span className="text-[15px] font-medium text-gray-900">{goal.goal_text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(scheduleLines.length > 0 || location) && (
        <div className="flex items-start gap-3 rounded-2xl bg-white p-5 shadow-[0_0_0_1px_rgba(15,166,166,0.25),0_2px_14px_rgba(15,166,166,0.12)]">
          <span className="mt-0.5 text-teal">
            <ClockIcon />
          </span>
          <div className="text-[15px] font-semibold text-gray-900">
            {scheduleLines.map((line) => (
              <p key={line}>{line}</p>
            ))}
            {location && <p>{location}</p>}
          </div>
        </div>
      )}

      {railEvents.length > 0 && (
        <div>
          <h2 className="mb-3 text-2xl font-bold text-gray-900">Upcoming Events!</h2>
          <div className="space-y-3">
            {railEvents.map((e) => {
              const loc = formatEventLocation(e.building, e.room, e.location);
              return (
                <div
                  key={e.id}
                  className="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-[0_2px_10px_rgba(0,0,0,0.07)]"
                >
                  <button type="button" onClick={() => e.can_open ? onOpenEvent(e.id) : onRestricted?.()} className="min-w-0 flex-1 text-left">
                    <p className="truncate text-[14px] font-bold text-gray-900">{e.title}</p>
                    <EventAudienceBadge audience={e.visibility} />
                    <p className="mt-0.5 text-[12px] font-medium text-[#F02719]">
                      {formatEventDate(e.event_date)}
                    </p>
                    <p className="text-[12px] font-medium text-[#F02719]">
                      {formatEventTime(e.start_time)} - {formatEventTime(e.end_time)}
                    </p>
                    {loc && <p className="text-[12px] font-medium text-[#F02719]">{loc}</p>}
                  </button>
                  <button
                    type="button"
                    onClick={() => e.can_open ? onRsvp(e.id, e.user_rsvp_status) : onRestricted?.()}
                    className="shrink-0 rounded-full px-4 py-1.5 text-[13px] font-semibold transition-colors"
                    style={
                      e.user_rsvp_status === "cant"
                        ? { background: "rgba(240,39,25,0.1)", color: "#F02719", border: "1.5px solid #F02719" }
                        : { background: "#0FA6A6", color: "#fff" }
                    }
                  >
                    {e.can_open ? (e.user_rsvp_status === "going" ? "Going ✓" : e.user_rsvp_status === "cant" ? "Can't" : "RSVP") : "Join"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {photos.length > 0 && (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-2xl font-bold text-gray-900">Photos that Glue</h2>
            <button type="button" onClick={onSeeAllPhotos} className="text-sm font-semibold text-teal hover:underline">
              See all
            </button>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {photos.map((photo, i) => (
              <button
                key={photo.id}
                type="button"
                onClick={() => onOpenPhoto(i)}
                className="relative aspect-square overflow-hidden rounded-md bg-gray-200"
                aria-label="Open photo"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo.url} alt={photo.caption ?? ""} className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function buildScheduleLines(club: ClubProfileData): string[] {
  const sched = club.meeting_schedule;
  if (sched && sched.length > 0) {
    return sched.map((s) => {
      const start = s.start ? formatEventTime(s.start) : "";
      const end = s.end ? ` - ${formatEventTime(s.end)}` : "";
      return `${s.day}${start ? ` ${start}${end}` : ""}`;
    });
  }
  if (club.meeting_day) {
    const start = club.meeting_time_start ? formatEventTime(club.meeting_time_start) : "";
    const end = club.meeting_time_end ? ` - ${formatEventTime(club.meeting_time_end)}` : "";
    return [`${club.meeting_day}${start ? ` ${start}${end}` : ""}`];
  }
  return [];
}

function ClockIcon(): JSX.Element {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
