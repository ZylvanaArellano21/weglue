"use client";

import { Avatar } from "../shared/Avatar";
import { EventCard } from "../home/EventCard";
import type { ClubProfileData } from "../../lib/clubs/clubProfileService";
import type { HomeFeedEvent } from "../../lib/hooks/useHomeEventsFeed";

// Club Profile Home tab (spec §15): a small summary card (handle, member count,
// events-this-month) beside the Upcoming Events and Past Events lists. Reuses the
// shared EventCard so club events look and behave exactly like Home. Past events
// render with no active RSVP.
export function ClubHomeTab({
  club,
  upcoming,
  past,
  onRsvp,
  onToggleSave,
  onJoinClub,
  onOpenEvent,
  onOpenClub,
}: {
  club: ClubProfileData;
  upcoming: HomeFeedEvent[];
  past: HomeFeedEvent[];
  onRsvp: (eventId: string) => void;
  onToggleSave: (eventId: string) => void;
  onJoinClub: (clubId: string) => void;
  onOpenEvent: (eventId: string) => void;
  onOpenClub: (clubId: string) => void;
}): JSX.Element {
  return (
    <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-[190px_minmax(0,1fr)]">
      {/* Summary card */}
      <div className="self-start rounded-2xl bg-white p-5 text-center shadow-[0_2px_10px_rgba(0,0,0,0.08)]">
        <div className="flex justify-center">
          <Avatar uri={club.avatar_url} size={56} name={club.name} />
        </div>
        <p className="mt-2 text-[15px] font-bold text-gray-900">@{club.handle}</p>
        <p className="mt-2 text-[13px] text-gray-600">{club.member_count} Members</p>
        <p className="text-[13px] text-gray-600">
          {club.events_this_month} Event{club.events_this_month === 1 ? "" : "s"} this month
        </p>
      </div>

      {/* Events */}
      <div>
        <h2 className="mb-3 text-xl font-bold text-gray-900">Upcoming Events</h2>
        {upcoming.length > 0 ? (
          <div className="space-y-5">
            {upcoming.map((e) => (
              <EventCard
                key={e.id}
                event={e}
                onRsvp={onRsvp}
                onToggleSave={onToggleSave}
                onJoinClub={onJoinClub}
                onOpenEvent={onOpenEvent}
                onOpenClub={onOpenClub}
              />
            ))}
          </div>
        ) : (
          <p className="rounded-xl bg-white/60 py-8 text-center text-sm text-gray-500">No upcoming events yet</p>
        )}

        <h2 className="mb-3 mt-8 text-xl font-bold text-gray-900">Past Events</h2>
        {past.length > 0 ? (
          <div className="space-y-5">
            {past.map((e) => (
              <EventCard
                key={e.id}
                event={e}
                isPast
                onRsvp={onRsvp}
                onToggleSave={onToggleSave}
                onJoinClub={onJoinClub}
                onOpenEvent={onOpenEvent}
                onOpenClub={onOpenClub}
              />
            ))}
          </div>
        ) : (
          <p className="rounded-xl bg-white/60 py-8 text-center text-sm text-gray-500">No past events yet</p>
        )}
      </div>
    </div>
  );
}
