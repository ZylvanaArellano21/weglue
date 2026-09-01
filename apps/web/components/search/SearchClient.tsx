"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AppHeader } from "../home/AppHeader";
import { PageOverlays } from "../shared/PageOverlays";
import { Avatar } from "../shared/Avatar";
import { SearchIcon, ImageIcon, PeopleIcon } from "../shared/icons";
import { formatEventTime, formatEventLocation } from "../../lib/datetime";
import { useDiscoverySearch, type DiscoverySearchResult } from "../../lib/hooks/useDiscoverySearch";
import {
  useDistinctCategories,
  useJoinFromSearch,
  useSearchDiscoveryClubs,
  useSearchDiscoveryPeople,
} from "../../lib/hooks/useSearchTab";
import type { SearchDiscoveryClub, SearchDiscoveryPerson } from "../../lib/search/searchService";

// Native's Search tab (apps/mobile/app/(tabs)/search.tsx), ported to web: a
// full-screen browse experience (category pills + a two-column club grid +
// horizontal people discovery), which becomes a sectioned People/Clubs result
// list the moment a query is typed. The bottom tab bar's Search icon links
// here now instead of expanding the header's inline field (that field, and
// its own copy of search_discovery, stay exactly as they are for desktop).
export function SearchClient({ userId }: { userId: string }): JSX.Element {
  return (
    <div className="flex min-h-screen flex-col bg-cream pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0">
      <AppHeader userId={userId} />
      <SearchBody userId={userId} />
      <PageOverlays userId={userId} />
    </div>
  );
}

function SearchBody({ userId }: { userId: string }): JSX.Element {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const searching = query.trim().length > 0;

  const { data: categories = [] } = useDistinctCategories();
  const {
    data: clubPages,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading: clubsLoading,
  } = useSearchDiscoveryClubs(userId, category);
  const { data: people = [], isLoading: peopleLoading } = useSearchDiscoveryPeople(userId);
  const { data: searchResults = [], isLoading: searchLoading } = useDiscoverySearch(userId, query);
  const join = useJoinFromSearch(userId);
  const joiningId = join.isPending ? (join.variables ?? null) : null;

  const clubs = clubPages?.pages.flat() ?? [];

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-10 pt-4 sm:px-6">
      <label className="relative block">
        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gray-500">
          <SearchIcon size={17} />
        </span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          type="search"
          placeholder="Search people & clubs"
          aria-label="Search people and clubs"
          className="h-11 w-full rounded-full border bg-white pl-11 pr-4 text-sm italic outline-none placeholder:text-gray-500 focus:ring-2 focus:ring-teal"
          style={{ borderColor: "rgba(0,0,0,0.2)" }}
        />
      </label>

      {searching ? (
        <SearchResults
          results={searchResults}
          loading={searchLoading}
          query={query.trim()}
          onOpen={(result) => router.push(result.result_type === "person" ? `/u/${result.id}` : `/club/${result.id}`)}
          onJoin={(id) => join.mutate(id)}
          joiningId={joiningId}
        />
      ) : (
        <>
          <div className="-mx-4 mt-4 flex gap-2.5 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6" role="tablist" aria-label="Club categories">
            <CategoryPill label="All categories" active={category === null} onClick={() => setCategory(null)} />
            {categories.map((cat) => (
              <CategoryPill key={cat} label={cat} active={category === cat} onClick={() => setCategory(cat)} />
            ))}
          </div>

          {clubsLoading && clubs.length === 0 ? (
            <p className="py-16 text-center text-sm text-gray-500">Loading clubs…</p>
          ) : clubs.length === 0 ? (
            <div className="flex flex-col items-center px-8 py-14 text-center">
              <span className="mb-3 text-gray-400 opacity-60"><PeopleIcon size={40} /></span>
              <p className="mb-1.5 text-sm font-semibold text-gray-900">{category ? "No clubs in this category" : "No clubs yet"}</p>
              <p className="text-xs text-gray-500">{category ? "Try another category or browse all clubs." : "Check back soon for new clubs to discover."}</p>
            </div>
          ) : (
            <>
              <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {clubs.map((club) => (
                  <SearchClubCard key={club.id} club={club} onJoin={(id) => join.mutate(id)} joining={joiningId === club.id} />
                ))}
              </div>
              {hasNextPage && (
                <div className="mt-6 flex justify-center">
                  <button
                    type="button"
                    onClick={() => fetchNextPage()}
                    disabled={isFetchingNextPage}
                    className="rounded-full border px-5 py-2 text-sm font-semibold text-teal transition hover:bg-teal/5 disabled:opacity-50"
                    style={{ borderColor: "#0FA6A6" }}
                  >
                    {isFetchingNextPage ? "Loading…" : "Load more"}
                  </button>
                </div>
              )}
            </>
          )}

          {!peopleLoading && people.length > 0 && (
            <div className="mt-8">
              <h2 className="text-lg font-bold text-gray-900">People discovery</h2>
              <div className="-mx-4 mt-3 flex gap-3.5 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6">
                {people.map((person) => (
                  <PersonCard key={person.user_id} person={person} onOpen={() => router.push(`/u/${person.user_id}`)} />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </main>
  );
}

function CategoryPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className="shrink-0 rounded-full px-4 py-1.5 text-[13px] font-semibold shadow-sm transition"
      style={active ? { background: "#0FA6A6", color: "#fff" } : { background: "#fff", color: "#0FA6A6", border: "1px solid rgba(0,0,0,0.08)" }}
    >
      {label}
    </button>
  );
}

function SearchClubCard({ club, onJoin, joining }: { club: SearchDiscoveryClub; onJoin: (id: string) => void; joining: boolean }): JSX.Element {
  const router = useRouter();
  const image = club.cover_image_url ?? club.avatar_url;
  const time = club.meeting_time_start && club.meeting_time_end
    ? `${formatEventTime(club.meeting_time_start)} - ${formatEventTime(club.meeting_time_end)}`
    : null;
  const location = formatEventLocation(club.meeting_building, club.meeting_room, null);
  const hasSchedule = !!club.meeting_day || !!time || !!location;

  const open = () => router.push(`/club/${club.id}`);

  return (
    // A plain div, not a <button>: the Join control below is itself a real
    // button, and a button cannot legally contain another button (React
    // flagged the hydration mismatch this produced). role="button" keeps the
    // whole card keyboard- and screen-reader-operable exactly like native's
    // TouchableOpacity wrapping everything including its own Join child.
    <div
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); } }}
      aria-label={`Open ${club.name}`}
      className="flex cursor-pointer flex-col overflow-hidden rounded-2xl bg-white text-left shadow-card transition hover:-translate-y-0.5"
    >
      <div className="relative aspect-[5/3] w-full bg-gray-200">
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-gray-400">
            <ImageIcon size={28} />
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col items-stretch px-2.5 pb-3 pt-2">
        <p className="mb-1 line-clamp-2 text-[15px] font-bold text-gray-900">{club.name}</p>
        <div className="mb-2.5 space-y-0.5">
          {hasSchedule ? (
            <>
              {club.meeting_day && <p className="truncate text-[11.5px] font-medium text-gray-600">{club.meeting_day}</p>}
              {time && <p className="truncate text-[11.5px] font-medium text-gray-600">{time}</p>}
              {location && <p className="line-clamp-2 text-[11.5px] font-medium text-gray-600">{location}</p>}
            </>
          ) : (
            <p className="truncate text-[11.5px] font-medium italic text-gray-600">Schedule coming soon</p>
          )}
        </div>
        {club.is_member ? (
          <span className="mx-auto min-w-[88px] rounded-full border-[1.5px] px-4 py-1 text-center text-[12px] font-semibold text-teal" style={{ borderColor: "#0FA6A6" }}>
            Joined
          </span>
        ) : (
          <button
            type="button"
            onClick={(event) => { event.stopPropagation(); onJoin(club.id); }}
            disabled={joining}
            aria-label={`Join ${club.name}`}
            className="mx-auto min-w-[88px] rounded-full bg-teal px-4 py-1 text-[12px] font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
          >
            {joining ? "…" : "Join"}
          </button>
        )}
      </div>
    </div>
  );
}

function PersonCard({ person, onOpen }: { person: SearchDiscoveryPerson; onOpen: () => void }): JSX.Element {
  const name = person.full_name?.trim() || person.username?.trim() || "Member";
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open ${name}'s profile`}
      className="flex w-[129px] shrink-0 flex-col items-center rounded-2xl bg-white px-2 py-3.5 shadow-card"
    >
      <Avatar uri={person.avatar_url} size={52} name={person.full_name ?? person.username} />
      <span className="mt-2 mb-1 w-full truncate text-center text-sm font-semibold text-gray-900">{name}</span>
      {person.club_name && (
        <span className="max-w-full truncate rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: "rgba(15,166,166,0.22)", color: "#0A8080" }}>
          {person.club_name}
        </span>
      )}
    </button>
  );
}

function SearchResults({ results, loading, query, onOpen, onJoin, joiningId }: {
  results: DiscoverySearchResult[];
  loading: boolean;
  query: string;
  onOpen: (result: DiscoverySearchResult) => void;
  onJoin: (id: string) => void;
  joiningId: string | null;
}): JSX.Element {
  if (loading) return <p className="py-16 text-center text-sm text-gray-500">Searching…</p>;
  const people = results.filter((r) => r.result_type === "person");
  const clubs = results.filter((r) => r.result_type === "club");
  if (!people.length && !clubs.length) {
    return (
      <div className="flex flex-col items-center px-8 py-14 text-center">
        <span className="mb-3 text-gray-400 opacity-60"><SearchIcon size={40} /></span>
        <p className="mb-1.5 text-sm font-semibold text-gray-900">No results found</p>
        <p className="text-xs text-gray-500">Nothing matched &quot;{query}&quot;</p>
      </div>
    );
  }
  return (
    <div className="mt-4">
      {people.length > 0 && (
        <>
          <p className="px-1 pb-1 pt-2 text-xs font-bold uppercase tracking-wide text-gray-500">People</p>
          {people.map((result) => <ResultRow key={`p-${result.id}`} result={result} onOpen={onOpen} onJoin={onJoin} joiningId={joiningId} />)}
        </>
      )}
      {clubs.length > 0 && (
        <>
          <p className="px-1 pb-1 pt-3 text-xs font-bold uppercase tracking-wide text-gray-500">Clubs</p>
          {clubs.map((result) => <ResultRow key={`c-${result.id}`} result={result} onOpen={onOpen} onJoin={onJoin} joiningId={joiningId} />)}
        </>
      )}
    </div>
  );
}

function ResultRow({ result, onOpen, onJoin, joiningId }: {
  result: DiscoverySearchResult;
  onOpen: (result: DiscoverySearchResult) => void;
  onJoin: (id: string) => void;
  joiningId: string | null;
}): JSX.Element {
  return (
    // A plain div, not a <button> — the Join control below is itself a real
    // button, and a button cannot legally contain another button.
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(result)}
      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(result); } }}
      className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-1 py-2.5 text-left transition hover:bg-black/[0.03]"
    >
      <Avatar uri={result.avatar_url} size={40} name={result.name} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-gray-900">{result.name}</span>
        {result.sub && <span className="block truncate text-xs text-gray-500">{result.result_type === "person" ? `@${result.sub}` : `${result.sub} members`}</span>}
      </span>
      {result.result_type === "club" && (
        result.is_member ? (
          <span className="shrink-0 rounded-full border-[1.5px] px-3.5 py-1 text-xs font-semibold text-teal" style={{ borderColor: "#0FA6A6" }}>Joined</span>
        ) : (
          <button
            type="button"
            onClick={(event) => { event.stopPropagation(); onJoin(result.id); }}
            disabled={joiningId === result.id}
            className="shrink-0 rounded-full bg-teal px-3.5 py-1 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
          >
            {joiningId === result.id ? "…" : "Join"}
          </button>
        )
      )}
    </div>
  );
}
