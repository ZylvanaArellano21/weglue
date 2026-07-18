"use client";

import { useState, type ReactNode } from "react";
import { Avatar } from "../shared/Avatar";
import { CalendarIcon } from "../shared/icons";
import { formatEventDate, formatEventTime } from "../../lib/datetime";
import type { GridPost } from "../../lib/hooks/useOwnProfile";

export interface ProfileWeeklyEvent {
  id: string;
  title: string;
  emoji: string | null;
  cover_image_url: string | null;
  event_date: string;
  start_time: string;
  end_time: string;
  club: { id: string; name: string };
}

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
  /** Edit Profile button (own) or Follow button (other). */
  action: ReactNode;
  onAvatarClick?: () => void;
  onOpenGluemates?: () => void;
  onOpenPost: (postId: string) => void;
  onOpenEvent: (eventId: string) => void;
  /** Private account the viewer can't see into — hide posts/events. */
  locked?: boolean;
  hideInterests?: boolean;
  hideEvents?: boolean;
}

const ROLES_CAP = 2;

// Desktop adaptation of apps/mobile/app/profile/own.tsx — avatar + stats,
// interests, officer roles, an action button, and Posts / Weekly Events tabs.
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
  onAvatarClick,
  onOpenGluemates,
  onOpenPost,
  onOpenEvent,
  locked,
  hideInterests,
  hideEvents,
}: ProfileLayoutProps): JSX.Element {
  const [tab, setTab] = useState<"posts" | "weekly_events">("posts");
  const [showAllRoles, setShowAllRoles] = useState(false);
  const visibleRoles = showAllRoles ? roles : roles.slice(0, ROLES_CAP);

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6">
      {/* Header row: avatar + stats */}
      <div className="flex items-center gap-6">
        <button
          type="button"
          onClick={onAvatarClick}
          disabled={!onAvatarClick}
          className={onAvatarClick ? "rounded-full ring-offset-2 focus:outline-none focus:ring-2" : ""}
          aria-label={onAvatarClick ? "Change profile picture" : undefined}
        >
          <Avatar uri={avatarUrl} size={84} name={fullName || username} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-bold text-gray-900">{fullName || username}</h1>
          <p className="truncate text-sm text-gray-500">@{username}</p>
          <div className="mt-2 flex gap-8">
            <div className="text-center">
              <p className="text-lg font-bold text-gray-900">{clubsCount}</p>
              <p className="text-xs text-gray-500">Clubs</p>
            </div>
            {onOpenGluemates ? (
              <button type="button" onClick={onOpenGluemates} className="text-center">
                <p className="text-lg font-bold text-gray-900">{gluematesCount}</p>
                <p className="text-xs text-gray-500">Gluemates</p>
              </button>
            ) : (
              <div className="text-center">
                <p className="text-lg font-bold text-gray-900">{gluematesCount}</p>
                <p className="text-xs text-gray-500">Gluemates</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {major && <p className="mt-3 text-sm italic text-gray-500">{major}</p>}

      {!hideInterests && interests.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {interests.map((i) => (
            <span key={i} className="rounded-full bg-black/[0.04] px-3 py-1 text-xs text-gray-700">
              {i}
            </span>
          ))}
        </div>
      )}

      {roles.length > 0 && (
        <div className="mt-3 space-y-1">
          {visibleRoles.map((r) => (
            <p key={r.club_id} className="text-[13px]">
              <span className="font-semibold" style={{ color: "#0FA6A6" }}>
                @{r.club_name}
              </span>{" "}
              <span className="text-gray-500">{r.role_title}</span>
            </p>
          ))}
          {roles.length > ROLES_CAP && (
            <button
              type="button"
              onClick={() => setShowAllRoles((v) => !v)}
              className="text-[13px] font-medium"
              style={{ color: "#0FA6A6" }}
            >
              {showAllRoles ? "Show less" : "Show more"}
            </button>
          )}
        </div>
      )}

      <div className="mt-5">{action}</div>

      {locked ? (
        <div className="mt-8 rounded-xl border border-black/5 bg-white p-10 text-center">
          <p className="text-2xl">🔒</p>
          <p className="mt-2 text-sm font-semibold text-gray-700">This account is private</p>
          <p className="text-xs text-gray-400">Follow to see their posts and events.</p>
        </div>
      ) : (
        <>
          <div role="tablist" className="mt-6 flex border-b" style={{ borderColor: "#E5E7EB" }}>
            {([["posts", "Posts"], ["weekly_events", "Weekly Events"]] as const).map(([key, label]) => {
              if (key === "weekly_events" && hideEvents) return null;
              const active = tab === key;
              return (
                <button
                  key={key}
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(key)}
                  className="mr-6 pb-2.5 text-[15px]"
                  style={{
                    color: active ? "#111827" : "#9CA3AF",
                    fontWeight: active ? 700 : 400,
                    borderBottom: active ? "2px solid #111827" : "2px solid transparent",
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>

          <div className="mt-4">
            {tab === "posts" ? (
              posts.length === 0 ? (
                <p className="py-12 text-center text-sm text-gray-400">No posts yet.</p>
              ) : (
                <div className="grid grid-cols-3 gap-1.5">
                  {posts.map((p) =>
                    p.image_url ? (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => onOpenPost(p.id)}
                        className="aspect-square overflow-hidden rounded-md bg-black/5"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={p.image_url} alt="" className="h-full w-full object-cover" />
                      </button>
                    ) : null
                  )}
                </div>
              )
            ) : weeklyEvents.length === 0 ? (
              <p className="py-12 text-center text-sm text-gray-400">No upcoming events this week.</p>
            ) : (
              <div className="space-y-2">
                {weeklyEvents.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => onOpenEvent(e.id)}
                    className="flex w-full items-center gap-3 overflow-hidden rounded-xl border border-black/5 bg-white text-left hover:bg-gray-50"
                  >
                    {e.cover_image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={e.cover_image_url} alt="" className="h-16 w-16 shrink-0 object-cover" />
                    ) : (
                      <span className="flex h-16 w-16 shrink-0 items-center justify-center" style={{ background: "#E5E7EB", color: "#9CA3AF" }}>
                        <CalendarIcon size={22} />
                      </span>
                    )}
                    <div className="min-w-0 flex-1 py-2 pr-3">
                      <p className="truncate text-sm font-bold text-gray-900">
                        {e.emoji ? `${e.emoji} ` : ""}
                        {e.title}
                      </p>
                      <p className="truncate text-xs font-medium" style={{ color: "#0FA6A6" }}>
                        {e.club.name}
                      </p>
                      <p className="text-xs text-gray-400">
                        {formatEventDate(e.event_date)} · {formatEventTime(e.start_time)} - {formatEventTime(e.end_time)}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
