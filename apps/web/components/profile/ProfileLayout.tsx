"use client";

import { useState, type ReactNode } from "react";
import { Avatar } from "../shared/Avatar";
import { CalendarIcon, ChevronRightIcon, LocationIcon, PlusIcon } from "../shared/icons";
import { formatEventDate, formatEventLocation, formatEventTime } from "../../lib/datetime";
import type { GridPost } from "../../lib/hooks/useOwnProfile";

export interface ProfileWeeklyEvent {
  id: string;
  title: string;
  emoji: string | null;
  cover_image_url: string | null;
  event_date: string;
  start_time: string;
  end_time: string;
  location?: string | null;
  building?: string | null;
  room?: string | null;
  club: { id: string; name: string };
}

export type ProfileTab = "posts" | "weekly_events";

interface ProfileLayoutProps {
  avatarUrl: string | null;
  fullName: string;
  username: string;
  major?: string | null;
  clubsCount: number;
  gluematesCount: number;
  interests: string[];
  roles: Array<{ club_id: string; club_name: string; role_title: string }>;
  posts: GridPost[];
  weeklyEvents: ProfileWeeklyEvent[];
  /** Edit Profile button (own) or Follow / Message / ••• (other). */
  action: ReactNode;
  /** Controlled tab — lives in the URL so browser Back restores it. */
  tab: ProfileTab;
  onTabChange: (tab: ProfileTab) => void;
  /** Own profile only: the ⊕ on the avatar opens the picture editor. */
  onEditPicture?: () => void;
  onOpenClubs?: () => void;
  onOpenGluemates?: () => void;
  onOpenClub?: (clubId: string) => void;
  onOpenPost: (postId: string) => void;
  onOpenEvent: (eventId: string) => void;
  /** Own profile only: remove the going RSVP (mobile's swipe-to-delete). */
  onRemoveEvent?: (eventId: string) => void;
  postsLoading?: boolean;
  eventsLoading?: boolean;
  postsError?: boolean;
  eventsError?: boolean;
  /** Private account the viewer can't see into — hide posts/events entirely. */
  locked?: boolean;
  hideInterests?: boolean;
  hideEvents?: boolean;
}

const ROLES_CAP = 2;
const INTERESTS_CAP = 5;

// Desktop profile — the layout of the web reference, driven entirely by the
// mobile rules in apps/mobile/app/profile/own.tsx:
//   • Clubs and Gluemates are BOTH tappable on mobile (they open the "Your
//     Clubs" / "Gluemates" sheets), so both are buttons here.
//   • Interests render as the `~Interest` line from InterestsLine.tsx — first
//     five, then Show more / Show less in place — not as chips.
//   • Officer roles are `@ClubName Role Title`, open the club, and are capped
//     at two with Show more.
export function ProfileLayout({
  avatarUrl,
  fullName,
  username,
  major,
  clubsCount,
  gluematesCount,
  interests,
  roles,
  posts,
  weeklyEvents,
  action,
  tab,
  onTabChange,
  onEditPicture,
  onOpenClubs,
  onOpenGluemates,
  onOpenClub,
  onOpenPost,
  onOpenEvent,
  onRemoveEvent,
  postsLoading,
  eventsLoading,
  postsError,
  eventsError,
  locked,
  hideInterests,
  hideEvents,
}: ProfileLayoutProps): JSX.Element {
  const [showAllRoles, setShowAllRoles] = useState(false);
  const [showAllInterests, setShowAllInterests] = useState(false);

  const visibleRoles = showAllRoles ? roles : roles.slice(0, ROLES_CAP);
  const visibleInterests = showAllInterests ? interests : interests.slice(0, INTERESTS_CAP);
  const displayName = fullName || username;

  // When the owner hides events the tab is not merely emptied, it is not
  // offered — a viewer is never invited into a section they may not see.
  const tabs: Array<[ProfileTab, string]> = hideEvents
    ? [["posts", "Posts"]]
    : [
        ["posts", "Posts"],
        ["weekly_events", "Weekly Events"],
      ];
  const activeTab: ProfileTab = hideEvents && tab === "weekly_events" ? "posts" : tab;

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
      {/* Identity */}
      <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-start sm:gap-8">
        <div className="relative shrink-0">
          <Avatar uri={avatarUrl} size={172} name={displayName} />
          {onEditPicture && (
            <button
              type="button"
              onClick={onEditPicture}
              aria-label="Edit your profile picture"
              className="absolute inset-0 z-0 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-2"
            />
          )}
          {onEditPicture && (
            <button
              type="button"
              onClick={onEditPicture}
              aria-label="Change your profile picture"
              className="absolute bottom-2 right-2 z-10 flex h-8 w-8 items-center justify-center rounded-full border-2 border-cream bg-cream text-teal shadow-sm transition-colors hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-2"
            >
              <PlusIcon size={18} strokeWidth={2.4} />
            </button>
          )}
        </div>

        <div className="min-w-0 flex-1 text-center sm:pt-2 sm:text-left">
          <h1 className="truncate text-[26px] font-bold leading-tight text-gray-900">
            {displayName}
          </h1>
          {/* The real handle — never a second copy of the display name. */}
          <p className="mt-0.5 truncate text-[15px] text-gray-700">@{username}</p>

          <div className="mt-4 flex justify-center gap-10 sm:justify-start">
            <StatButton
              value={clubsCount}
              label="Clubs"
              onClick={onOpenClubs}
              describe={`View clubs (${clubsCount})`}
            />
            <StatButton
              value={gluematesCount}
              label="Gluemates"
              onClick={onOpenGluemates}
              describe={`View Gluemates (${gluematesCount})`}
            />
          </div>

          {major && <p className="mt-3 text-sm italic text-gray-500">{major}</p>}

          {!hideInterests && interests.length > 0 && (
            <div className="mt-5">
              <p className="text-[15px] italic leading-relaxed text-gray-700">
                {visibleInterests.map((i) => `~${i}`).join("  ")}
              </p>
              {interests.length > INTERESTS_CAP && (
                <button
                  type="button"
                  onClick={() => setShowAllInterests((v) => !v)}
                  className="mt-1 text-[13px] font-medium text-teal hover:underline focus:outline-none focus-visible:underline"
                >
                  {showAllInterests ? "Show less" : "Show more"}
                </button>
              )}
            </div>
          )}

          {roles.length > 0 && (
            <div className="mt-1.5 space-y-0.5">
              {visibleRoles.map((r) => (
                <p key={r.club_id} className="text-[15px] italic">
                  <button
                    type="button"
                    onClick={() => onOpenClub?.(r.club_id)}
                    disabled={!onOpenClub}
                    className="font-bold text-teal hover:underline disabled:no-underline focus:outline-none focus-visible:underline"
                  >
                    @{r.club_name}
                  </button>{" "}
                  <span className="text-gray-700">{r.role_title}</span>
                </p>
              ))}
              {roles.length > ROLES_CAP && (
                <button
                  type="button"
                  onClick={() => setShowAllRoles((v) => !v)}
                  className="text-[13px] font-medium text-teal hover:underline focus:outline-none focus-visible:underline"
                >
                  {showAllRoles ? "Show less" : "Show more"}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="mt-7">{action}</div>

      {locked ? (
        <div className="mt-8 rounded-xl border border-black/5 bg-white p-10 text-center">
          <p className="text-2xl" aria-hidden>
            🔒
          </p>
          <p className="mt-2 text-sm font-semibold text-gray-700">This account is private</p>
          <p className="text-xs text-gray-400">Follow to see their posts and events.</p>
        </div>
      ) : (
        <section className="mt-7 overflow-hidden rounded-xl bg-white shadow-[0_1px_4px_rgba(0,0,0,0.07)]">
          <div role="tablist" aria-label="Profile content" className="flex gap-6 px-5 pt-4">
            {tabs.map(([key, label]) => {
              const active = activeTab === key;
              return (
                <button
                  key={key}
                  id={`profile-tab-${key}`}
                  role="tab"
                  type="button"
                  aria-selected={active}
                  aria-controls={`profile-panel-${key}`}
                  onClick={() => onTabChange(key)}
                  className="pb-3 text-[16px] focus:outline-none focus-visible:ring-2 focus-visible:ring-teal"
                  style={{
                    color: active ? "#111827" : "#6B7280",
                    fontWeight: active ? 700 : 400,
                    borderBottom: active ? "2px solid #111827" : "2px solid transparent",
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>

          <div
            id={`profile-panel-${activeTab}`}
            role="tabpanel"
            aria-labelledby={`profile-tab-${activeTab}`}
            tabIndex={0}
            className="px-4 pb-5 pt-4 focus:outline-none"
          >
            {activeTab === "posts" ? (
              <PostsPanel
                posts={posts}
                loading={postsLoading}
                error={postsError}
                onOpenPost={onOpenPost}
              />
            ) : (
              <EventsPanel
                events={weeklyEvents}
                loading={eventsLoading}
                error={eventsError}
                onOpenEvent={onOpenEvent}
                onRemoveEvent={onRemoveEvent}
              />
            )}
          </div>
        </section>
      )}
    </main>
  );
}

function StatButton({
  value,
  label,
  onClick,
  describe,
}: {
  value: number;
  label: string;
  onClick?: () => void;
  describe: string;
}): JSX.Element {
  const body = (
    <>
      <span className="block text-[19px] font-bold text-gray-900">{value}</span>
      <span className="block text-[14px] text-gray-600">{label}</span>
    </>
  );
  if (!onClick) {
    return <span className="text-center">{body}</span>;
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={describe}
      className="rounded-lg px-1 text-center transition-colors hover:bg-black/[0.035] focus:outline-none focus-visible:ring-2 focus-visible:ring-teal"
    >
      {body}
    </button>
  );
}

function PostsPanel({
  posts,
  loading,
  error,
  onOpenPost,
}: {
  posts: GridPost[];
  loading?: boolean;
  error?: boolean;
  onOpenPost: (id: string) => void;
}): JSX.Element {
  if (loading) {
    return (
      <div className="grid grid-cols-3 gap-1.5" aria-live="polite" aria-busy>
        <span className="sr-only">Loading posts…</span>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="aspect-square animate-pulse rounded-md bg-black/[0.06]" />
        ))}
      </div>
    );
  }
  if (error) {
    return (
      <p role="alert" className="py-12 text-center text-sm text-[#F02719]">
        We couldn&apos;t load these posts. Please refresh and try again.
      </p>
    );
  }
  if (posts.length === 0) {
    return <p className="py-12 text-center text-sm text-gray-400">No posts yet.</p>;
  }
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {posts.map((p) =>
        // Mobile's grid is image-only; a post whose image is gone (deleted or
        // moderated) is simply absent rather than a broken tile.
        p.image_url ? (
          <button
            key={p.id}
            type="button"
            onClick={() => onOpenPost(p.id)}
            aria-label="Open post"
            className="aspect-square overflow-hidden rounded-md bg-black/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-2"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={p.image_url}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover transition-transform hover:scale-[1.02]"
            />
          </button>
        ) : null
      )}
    </div>
  );
}

function EventsPanel({
  events,
  loading,
  error,
  onOpenEvent,
  onRemoveEvent,
}: {
  events: ProfileWeeklyEvent[];
  loading?: boolean;
  error?: boolean;
  onOpenEvent: (id: string) => void;
  onRemoveEvent?: (id: string) => void;
}): JSX.Element {
  if (loading) {
    return (
      <div className="space-y-2" aria-live="polite" aria-busy>
        <span className="sr-only">Loading this week&apos;s events…</span>
        {[0, 1].map((i) => (
          <div key={i} className="h-[92px] animate-pulse rounded-xl bg-black/[0.06]" />
        ))}
      </div>
    );
  }
  if (error) {
    return (
      <p role="alert" className="py-12 text-center text-sm text-[#F02719]">
        We couldn&apos;t load these events. Please refresh and try again.
      </p>
    );
  }
  if (events.length === 0) {
    return <p className="py-12 text-center text-sm text-gray-400">No upcoming events this week.</p>;
  }
  return (
    <ul className="space-y-2">
      {events.map((e) => {
        const place = formatEventLocation(e.building, e.room, e.location);
        return (
          <li
            key={e.id}
            className="group relative flex items-stretch overflow-hidden rounded-xl border border-black/5 bg-white transition-colors hover:bg-black/[0.015]"
          >
            <button
              type="button"
              onClick={() => onOpenEvent(e.id)}
              className="flex min-w-0 flex-1 items-stretch text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal"
            >
              {e.cover_image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={e.cover_image_url}
                  alt=""
                  loading="lazy"
                  className="h-[104px] w-[104px] shrink-0 object-cover"
                />
              ) : (
                <span
                  aria-hidden
                  className="flex h-[104px] w-[104px] shrink-0 items-center justify-center"
                  style={{ background: "#E5E7EB", color: "#9CA3AF" }}
                >
                  <CalendarIcon size={24} />
                </span>
              )}

              <span className="min-w-0 flex-1 px-3.5 py-2.5">
                <span className="block truncate text-[14px] font-bold text-gray-900">
                  {e.emoji ? `${e.emoji} ` : ""}
                  {e.title}
                </span>
                <span className="mt-0.5 block truncate text-[12px] font-medium text-teal">
                  {e.club.name}
                </span>
                <span className="mt-1.5 flex items-start gap-1.5 text-[12px] text-gray-500">
                  <span aria-hidden className="mt-[1px] shrink-0">
                    <CalendarIcon size={14} />
                  </span>
                  <span className="min-w-0">
                    <span className="block">{formatEventDate(e.event_date)}</span>
                    <span className="block">
                      {formatEventTime(e.start_time)} - {formatEventTime(e.end_time)}
                    </span>
                  </span>
                </span>
                {place && (
                  <span className="mt-1 flex items-center gap-1.5 text-[12px] text-gray-500">
                    <span aria-hidden className="shrink-0">
                      <LocationIcon size={14} />
                    </span>
                    <span className="truncate">{place}</span>
                  </span>
                )}
              </span>

              <span aria-hidden className="flex shrink-0 items-center pr-3 text-gray-800">
                <ChevronRightIcon size={22} strokeWidth={2.2} />
              </span>
            </button>

            {/* Mobile removes an event by swiping the row; a desktop pointer has
                no swipe, so the same action is an explicit button. It always
                confirms first, because it deletes the RSVP itself. */}
            {onRemoveEvent && (
              <button
                type="button"
                onClick={() => onRemoveEvent(e.id)}
                aria-label={`Remove your attendance for ${e.title}`}
                className="absolute right-2 top-2 rounded-full bg-white/95 px-2 py-1 text-[11px] font-semibold text-[#F02719] opacity-0 shadow-sm transition-opacity focus:opacity-100 group-hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-black"
              >
                Remove
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
