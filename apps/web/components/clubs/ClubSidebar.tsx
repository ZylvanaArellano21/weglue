"use client";

import { useRouter } from "next/navigation";
import { Avatar } from "../shared/Avatar";
import { SearchIcon, CloseIcon } from "../shared/icons";
import { formatMeetingSchedule } from "../../lib/datetime";
import type { SidebarClub } from "../../lib/clubs/clubService";

// Left column of the Club tab (spec §4/§5): "Clubs" heading, the CLUB-SPECIFIC
// search input (distinct from the global header search), then the Officer and
// Member sections. The search input is controlled by the parent so the SAME
// query filters the sidebar AND the catalog simultaneously. Empty sections hide
// their heading rather than render blank.
export function ClubSidebar({
  officerClubs,
  memberClubs,
  query,
  onQueryChange,
}: {
  officerClubs: SidebarClub[];
  memberClubs: SidebarClub[];
  query: string;
  onQueryChange: (q: string) => void;
}): JSX.Element {
  return (
    <aside
      className="border-r pr-4"
      style={{ borderColor: "rgba(0,0,0,0.06)" }}
      aria-label="Your clubs"
    >
      <h1 className="mb-3 text-2xl font-bold text-gray-900">Clubs</h1>

      <div className="relative mb-4">
        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400">
          <SearchIcon size={16} />
        </span>
        <input
          type="search"
          aria-label="Search your clubs and the catalog"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          className="no-native-clear h-9 w-full rounded-full border bg-white pl-9 pr-9 text-sm outline-none focus:ring-2"
          style={{ borderColor: "rgba(0,0,0,0.12)" }}
        />
        {query && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => onQueryChange("")}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            <CloseIcon size={16} />
          </button>
        )}
      </div>

      {officerClubs.length > 0 && (
        <section className="mb-5">
          <h2 className="mb-2 text-lg font-bold text-gray-900">Officer</h2>
          <ul className="space-y-3">
            {officerClubs.map((club) => (
              <SidebarRow key={club.id} club={club} showRole />
            ))}
          </ul>
        </section>
      )}

      {memberClubs.length > 0 && (
        <section className="mb-5">
          <h2 className="mb-2 text-lg font-bold text-gray-900">Member</h2>
          <ul className="space-y-3">
            {memberClubs.map((club) => (
              <SidebarRow key={club.id} club={club} />
            ))}
          </ul>
        </section>
      )}
    </aside>
  );
}

// Each row's third line answers "what is happening with this club?":
//   • an event still to come THIS Monday–Sunday week → that event's title, red;
//   • otherwise the recurring meeting schedule, e.g. "Monday, 3:00 pm - 4:00 pm"
//     or "Monday, Wednesday, 3:00 pm - 4:00 pm".
// The week window and the schedule grouping both come from lib/datetime, so
// this row, the Club Profile and mobile all read the same rules.
function SidebarRow({ club, showRole }: { club: SidebarClub; showRole?: boolean }): JSX.Element {
  const router = useRouter();
  const scheduleLines = formatMeetingSchedule(club.meeting_schedule);
  return (
    <li>
      <button
        type="button"
        onClick={() => router.push(`/club/${club.id}`)}
        className="flex w-full items-start gap-2.5 rounded-lg p-1 text-left transition hover:bg-black/[0.03]"
      >
        <Avatar uri={club.avatar_url} size={44} name={club.name} />
        <div className="min-w-0 flex-1">
          {showRole && club.officer_role && (
            <span className="flex items-center gap-1 text-[12px] font-semibold italic text-teal">
              <span aria-hidden>★</span>
              {club.officer_role}
            </span>
          )}
          <p className="truncate text-[15px] font-bold text-gray-900">{club.name}</p>
          {club.next_event ? (
            <p className="truncate text-[12px] font-semibold text-[#F02719]">
              {club.next_event.emoji ? `${club.next_event.emoji} ` : ""}
              {club.next_event.title}
            </p>
          ) : scheduleLines.length > 0 ? (
            scheduleLines.map((line) => (
              <p key={line} className="truncate text-[12px] italic text-gray-500">
                {line}
              </p>
            ))
          ) : null}
        </div>
      </button>
    </li>
  );
}
