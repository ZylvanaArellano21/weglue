"use client";

import { useRouter } from "next/navigation";
import type { CatalogClub } from "../../lib/clubs/clubService";
import { formatEventTime, formatEventLocation } from "../../lib/datetime";

// A single catalog club card (Suggested for you / Popular at your school),
// matching the web screenshots: cover image, club name, meeting day / time /
// room, and a Join · Joined pill. Clicking the card body opens the canonical
// Club Profile; the pill joins or unjoins in place without navigating.
//
// The pill is the SAME control as the Club Profile header's: teal fill to join,
// teal outline "Joined" to leave. Leaving hands off to the shared
// LeaveClubDialog (owned by ClubsClient), which runs the existing preflight,
// the only-officer guard, the red destructive confirmation and the leave_club
// RPC. There is no second membership implementation here.
export function CatalogCard({
  club,
  onJoin,
  onLeave,
  joining,
}: {
  club: CatalogClub;
  onJoin: (club: CatalogClub) => void;
  onLeave: (club: CatalogClub) => void;
  joining: boolean;
}): JSX.Element {
  const router = useRouter();
  const location = formatEventLocation(club.meeting_building, club.meeting_room, null);

  return (
    <div
      className="group flex flex-col overflow-hidden rounded-xl bg-white shadow-[0_6px_16px_rgba(0,0,0,0.10)] transition hover:shadow-[0_8px_22px_rgba(0,0,0,0.14)]"
      style={{ border: "1px solid rgba(0,0,0,0.05)" }}
    >
      <button
        type="button"
        onClick={() => router.push(`/club/${club.id}`)}
        aria-label={`Open ${club.name}`}
        className="block text-left"
      >
        <div className="relative h-40 w-full bg-gray-200">
          {club.cover_image_url || club.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={(club.cover_image_url ?? club.avatar_url) as string}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-4xl">🎓</div>
          )}
        </div>
      </button>

      <div className="flex flex-1 flex-col p-3.5">
        <button
          type="button"
          onClick={() => router.push(`/club/${club.id}`)}
          className="text-left"
        >
          <h3 className="truncate text-[15px] font-bold text-gray-900">{club.name}</h3>
        </button>

        <div className="mt-1 space-y-0.5 text-[13px] text-gray-500">
          {club.meeting_day && <p>{club.meeting_day}</p>}
          {club.meeting_time_start && (
            <p>
              {formatEventTime(club.meeting_time_start)}
              {club.meeting_time_end ? ` - ${formatEventTime(club.meeting_time_end)}` : ""}
            </p>
          )}
          {location && <p>{location}</p>}
          {!club.meeting_day && !club.meeting_time_start && !location && (
            <p className="italic text-gray-400">Schedule coming soon</p>
          )}
        </div>

        <div className="mt-3 flex justify-end">
          {club.is_member ? (
            <button
              type="button"
              onClick={() => onLeave(club)}
              aria-label={`Leave ${club.name}`}
              title={`Leave ${club.name}`}
              className="rounded-full border px-4 py-1 text-[13px] font-semibold text-teal transition hover:bg-teal/5"
              style={{ borderColor: "#0FA6A6", background: "#fff" }}
            >
              Joined
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onJoin(club)}
              disabled={joining}
              aria-label={`Join ${club.name}`}
              className="rounded-full bg-teal px-5 py-1 text-[13px] font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
            >
              {joining ? "…" : "Join"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
