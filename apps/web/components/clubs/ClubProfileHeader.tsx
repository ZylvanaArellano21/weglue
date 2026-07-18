"use client";

import { Avatar } from "../shared/Avatar";
import { ChatIcon } from "../shared/icons";
import type { ClubProfileData } from "../../lib/clubs/clubProfileService";

export type ClubTab = "home" | "calendar" | "officers" | "media";

const TABS: { key: ClubTab; label: string }[] = [
  { key: "home", label: "Home" },
  { key: "calendar", label: "Calendar" },
  { key: "officers", label: "Officers" },
  { key: "media", label: "Media" },
];

// Club Profile header card (spec §12): banner, circular avatar, member/gluemate
// counts, Officer/Group chat actions, Join·Joined, an Edit control for officers,
// name + description, and the Home/Calendar/Officers/Media tab nav. Officer-only
// affordances (Edit, Officer Chat) are gated here as defence-in-depth — the
// real authorization is server-side RLS/RPC.
export function ClubProfileHeader({
  club,
  activeTab,
  onSelectTab,
  onToggleMembership,
  membershipPending,
  onEdit,
  onOfficerChat,
  onGroupChat,
}: {
  club: ClubProfileData;
  activeTab: ClubTab;
  onSelectTab: (tab: ClubTab) => void;
  onToggleMembership: () => void;
  membershipPending: boolean;
  onEdit: () => void;
  onOfficerChat: () => void;
  onGroupChat: () => void;
}): JSX.Element {
  return (
    <section className="overflow-hidden rounded-2xl bg-white shadow-[0_2px_10px_rgba(0,0,0,0.08)]">
      {/* Banner + overlapping avatar + Edit */}
      <div className="relative h-40 w-full bg-gray-200 sm:h-48">
        {club.banner_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={club.banner_url} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="h-full w-full" style={{ background: "linear-gradient(135deg,#0FA6A6,#0b7d7d)" }} />
        )}
        {club.is_officer && (
          <button
            type="button"
            onClick={onEdit}
            className="absolute bottom-3 right-3 flex items-center gap-1.5 rounded-full bg-teal px-4 py-1.5 text-[13px] font-semibold text-white shadow-md transition hover:opacity-90"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
            Edit
          </button>
        )}
      </div>

      <div className="relative px-5 pb-2 pt-3 sm:px-7">
        {/* Avatar overlaps the banner */}
        <div className="absolute -top-14 left-5 sm:left-7">
          <div className="rounded-full border-4 border-white bg-white">
            <Avatar uri={club.avatar_url} size={104} name={club.name} />
          </div>
        </div>

        {/* Counts + chat actions row (right-aligned above the name) */}
        <div className="flex min-h-[56px] items-start justify-end gap-8 pt-1">
          <div className="flex items-center gap-8">
            <Stat value={club.member_count} label="Members" />
            <Stat value={club.gluemates_count} label="Gluemates" />
          </div>
          <div className="flex flex-col items-start gap-2">
            {club.is_officer && (
              <button
                type="button"
                onClick={onOfficerChat}
                className="flex items-center gap-1.5 text-[15px] font-semibold text-teal hover:underline"
              >
                <span className="relative">
                  <ChatIcon size={20} />
                  <span className="absolute -right-1 -top-1 text-[10px]" aria-hidden>⭐</span>
                </span>
                Officer Chat
              </button>
            )}
            {club.is_member && (
              <button
                type="button"
                onClick={onGroupChat}
                className="flex items-center gap-1.5 text-[15px] font-semibold text-teal hover:underline"
              >
                <ChatIcon size={20} />
                Group Chat
              </button>
            )}
          </div>
        </div>

        {/* Name + description + Join/Joined */}
        <h1 className="mt-1 text-[26px] font-bold text-gray-900">{club.name}</h1>
        {club.description && (
          <p className="mt-1 max-w-2xl text-[15px] text-gray-800">{club.description}</p>
        )}

        <div className="mt-3">
          {club.is_member ? (
            <button
              type="button"
              onClick={onToggleMembership}
              disabled={membershipPending}
              className="rounded-full border px-6 py-1.5 text-[15px] font-semibold text-teal transition hover:bg-teal/5 disabled:opacity-60"
              style={{ borderColor: "#0FA6A6" }}
            >
              Joined
            </button>
          ) : (
            <button
              type="button"
              onClick={onToggleMembership}
              disabled={membershipPending}
              className="rounded-full bg-teal px-8 py-1.5 text-[15px] font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
            >
              Join
            </button>
          )}
        </div>

        {/* Tab nav */}
        <nav className="mt-4 flex gap-8 border-t pt-3" style={{ borderColor: "rgba(0,0,0,0.08)" }} aria-label="Club sections">
          {TABS.map((t) => {
            const active = t.key === activeTab;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => onSelectTab(t.key)}
                aria-current={active ? "page" : undefined}
                className="relative pb-2 text-[16px] transition-colors"
                style={{ color: active ? "#111827" : "#6B7280", fontWeight: active ? 700 : 500 }}
              >
                {t.label}
                {active && (
                  <span className="absolute -bottom-[13px] left-0 h-[2px] w-full rounded-full bg-gray-900" aria-hidden />
                )}
              </button>
            );
          })}
        </nav>
      </div>
    </section>
  );
}

function Stat({ value, label }: { value: number; label: string }): JSX.Element {
  return (
    <div className="text-center">
      <p className="text-xl font-bold text-gray-900">{value}</p>
      <p className="text-[13px] text-gray-600">{label}</p>
    </div>
  );
}
