"use client";

import { useState } from "react";
import { Avatar } from "../shared/Avatar";
import { AvatarStack } from "../shared/AvatarStack";
import { ChatBubbleOutlineIcon, StarOutlineIcon, ChevronLeftIcon, CalendarIcon, LocationIcon, EllipsisIcon, ShareIcon } from "../shared/icons";
import type { ClubProfileData } from "../../lib/clubs/clubProfileService";
import { parseMeetingSchedule, formatEventTime, formatEventLocation } from "../../lib/datetime";

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
  onOpenAttendance,
  onOfficerChat,
  onGroupChat,
  onOpenPeople,
  onBack,
  onReport,
  onShare,
}: {
  club: ClubProfileData;
  activeTab: ClubTab;
  onSelectTab: (tab: ClubTab) => void;
  onToggleMembership: () => void;
  membershipPending: boolean;
  /** Opens the existing club-edit flow — now reached only via the ⋯ menu. */
  onEdit: () => void;
  /** Opens the club's permanent QR attendance screen — officers/advisors only. */
  onOpenAttendance: () => void;
  onOfficerChat: () => void;
  onGroupChat: () => void;
  /** Opens the Members / Gluemates list. Available to officers AND members. */
  onOpenPeople: (filter: "members" | "gluemates") => void;
  /** Phone-only back chevron floating on the banner — checked directly
   * against the native Club Profile screenshot, which has no other way
   * back. Desktop/tablet keep browser/AppHeader navigation, unchanged. */
  onBack: () => void;
  /** "…" trigger, bottom-right of the banner on phone / top-right on
   * desktop-tablet. Officers/advisors get a real menu (Edit club / QR
   * attendance / Report); everyone else gets this single report action
   * directly, same as before. */
  onReport: () => void;
  /** Phone-only Share button, beside the "…" — opens the club QR share
   * screen. Every valid club is shareable regardless of membership. The
   * larger-device club profile is intentionally left unchanged. */
  onShare: () => void;
}): JSX.Element {
  const [optionsOpen, setOptionsOpen] = useState(false);

  function handleOptionsPress() {
    if (club.is_officer) {
      setOptionsOpen(true);
    } else {
      onReport();
    }
  }

  return (
    <>
    {/* Negative margins cancel the parent <main>'s own px-4 sm:px-6 exactly,
        so the banner reaches the real screen edges on phone like native's —
        md:mx-0 removes the offset entirely at md+, leaving desktop identical
        to before. */}
    <section className="-mx-4 overflow-hidden rounded-none bg-white shadow-none sm:-mx-6 md:mx-0 md:rounded-2xl md:shadow-[0_2px_10px_rgba(0,0,0,0.08)]">
      {/* Banner + overlapping avatar + Edit */}
      <div className="relative h-40 w-full bg-gray-200 sm:h-48">
        {club.banner_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={club.banner_url} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="h-full w-full" style={{ background: "linear-gradient(135deg,#0FA6A6,#0b7d7d)" }} />
        )}
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="absolute left-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-white/80 text-gray-800 shadow-[0_1px_4px_rgba(0,0,0,0.15)] md:hidden"
        >
          <ChevronLeftIcon size={22} />
        </button>
        {/* "…" — bottom-right of the banner on phone, top-right on
            desktop/tablet (desktop had no equivalent affordance before this;
            it's additive there, in the Edit button's old top-right spot).
            Officers/advisors get Edit club / QR attendance / Report;
            everyone else gets the plain report action, same as before. */}
        <button
          type="button"
          onClick={handleOptionsPress}
          aria-label={club.is_officer ? "Club options" : `Report ${club.name}`}
          aria-haspopup={club.is_officer ? "menu" : undefined}
          className="absolute bottom-3 right-3 flex h-9 w-9 items-center justify-center rounded-full bg-white/80 text-gray-800 shadow-[0_1px_4px_rgba(0,0,0,0.15)] md:bottom-auto md:right-3 md:top-3"
        >
          <EllipsisIcon size={20} />
        </button>
        {/* Share — beside the "…", never inside it. Phone-only. */}
        <button
          type="button"
          onClick={onShare}
          aria-label={`Share ${club.name}`}
          className="absolute bottom-3 right-14 flex h-9 w-9 items-center justify-center rounded-full bg-white/80 text-gray-800 shadow-[0_1px_4px_rgba(0,0,0,0.15)] md:hidden"
        >
          <ShareIcon size={18} />
        </button>
      </div>

      <div className="relative px-5 pb-2 pt-3 sm:px-7">
        {/* Avatar overlaps the banner */}
        <div className="absolute -top-14 left-5 sm:left-7">
          <div className="rounded-full border-4 border-white bg-white">
            <Avatar uri={club.avatar_url} size={104} name={club.name} />
          </div>
        </div>

        {/* Counts + chat actions cluster — desktop/tablet only. The chat
            pills use the SAME outlined-teal style + icons as the mobile
            Club Profile actions; they're grouped and equal-width so the
            pair reads as one intentional control, clear of the banner Edit
            button, the avatar, the description and the tabs. Officer Chat is
            officer-only; Group Chat follows the same membership rule as mobile
            (any member, which includes officers). Phone gets its own layout
            below (native has no separate Members/Gluemates stat row here at
            all — just "N Members" as plain text, then Join/Chat/Admin Chat
            as buttons). */}
        <div className="hidden min-h-[56px] flex-wrap items-start justify-end gap-x-8 gap-y-3 pt-1 md:flex">
          <div className="flex items-center gap-8">
            <Stat value={club.member_count} label="Members" onClick={() => onOpenPeople("members")} />
            <Stat value={club.gluemates_count} label="Gluemates" onClick={() => onOpenPeople("gluemates")} />
          </div>
          {(club.is_officer || club.is_member) && (
            <div className="flex w-[150px] flex-col items-stretch gap-2">
              {club.is_officer && (
                <ChatPill label="Officer Chat" onClick={onOfficerChat} officer />
              )}
              {club.is_member && <ChatPill label="Group Chat" onClick={onGroupChat} />}
            </div>
          )}
        </div>

        {/* Name + description (desktop/tablet) — phone shows the
            description once, inside the About section below, so it isn't
            duplicated here too.
            The avatar is `absolute -top-14` (56px) and 104px tall, so its
            bottom edge sits ~48px below this container's top regardless of
            what's rendered before it. On desktop that space was always
            cleared by the Stats+Chat-pills row's own height — but that row
            is `hidden` (zero height, not just invisible) below md, so on a
            real phone the club name rendered directly under the small
            `pt-3` padding and the avatar covered its first few letters.
            mt-12 (48px) clears it; md:mt-1 restores the exact original
            desktop spacing, unaffected. */}
        <h1 className="mt-12 text-[26px] font-bold text-gray-900 md:mt-1">{club.name}</h1>
        {club.description && (
          <p className="mt-1 hidden max-w-2xl text-[15px] text-gray-800 md:block">{club.description}</p>
        )}

        {/* Phone: member count — checked directly against native, this is
            tappable and opens the Members list, not plain text. */}
        <button
          type="button"
          onClick={() => onOpenPeople("members")}
          className="mt-1 block text-left text-[13px] text-gray-500 md:hidden"
        >
          {club.member_count} Member{club.member_count === 1 ? "" : "s"}
        </button>

        {/* Desktop/tablet Join/Joined — unchanged position and sizing. */}
        <div className="mt-3 hidden md:block">
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

        {/* Phone: Join/Joined + Chat as one row, Admin Chat full-width
            below (officer-only) — checked directly against native, which
            combines membership + chat entry points here instead of
            splitting them the way desktop does. "Chat" and "Admin Chat" are
            native's exact labels for what desktop calls "Group Chat" /
            "Officer Chat" — same destinations, this screen just doesn't
            show a member who isn't in either chat a button for it. */}
        <div className="mt-3 flex flex-col gap-2 md:hidden">
          <div className="flex gap-2">
            {club.is_member ? (
              <button
                type="button"
                onClick={onToggleMembership}
                disabled={membershipPending}
                className="flex-1 rounded-full px-4 py-2.5 text-[15px] font-semibold text-teal transition disabled:opacity-60"
                style={{ background: "rgba(15,166,166,0.12)" }}
              >
                Joined ✓
              </button>
            ) : (
              <button
                type="button"
                onClick={onToggleMembership}
                disabled={membershipPending}
                className="flex-1 rounded-full bg-teal px-4 py-2.5 text-[15px] font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
              >
                Join
              </button>
            )}
            {club.is_member && (
              <button
                type="button"
                onClick={onGroupChat}
                className="flex flex-1 items-center justify-center gap-2 rounded-full border-[1.5px] px-4 py-2.5 text-[15px] font-semibold text-teal transition hover:bg-teal/5"
                style={{ borderColor: "#0FA6A6" }}
              >
                <ChatBubbleOutlineIcon size={17} strokeWidth={1.9} />
                Chat
              </button>
            )}
          </div>
          {club.is_officer && (
            <button
              type="button"
              onClick={onOfficerChat}
              className="flex w-full items-center justify-center gap-2 rounded-full border-[1.5px] px-4 py-2.5 text-[15px] font-semibold text-teal transition hover:bg-teal/5"
              style={{ borderColor: "#0FA6A6" }}
            >
              <StarOutlineIcon size={16} strokeWidth={2} />
              Admin Chat
            </button>
          )}
        </div>

        {/* Non-member hint — phone-only, matches native exactly. Desktop's
            chat-pill cluster above already communicates the same thing more
            visibly (the pills simply aren't there for a non-member), so this
            text nudge is native's phone-specific affordance, not a desktop
            gap. */}
        {!club.is_member && (
          <p
            className="mt-3 rounded-[10px] border px-3 py-3 text-center text-[13px] font-medium md:hidden"
            style={{ background: "rgba(15,166,166,0.08)", borderColor: "rgba(15,166,166,0.2)", color: "#0FA6A6" }}
          >
            Join this club to chat and see upcoming events
          </p>
        )}

        {/* Gluemates row — phone-only, matches native exactly: only shown
            when the club has at least one gluemate, an overlapping avatar
            stack plus a bold count, opening the same Members list filtered
            to gluemates. Desktop already surfaces this as one of the two
            Stats above, so this is additive to phone only. */}
        {club.gluemates_count > 0 && (
          <button
            type="button"
            onClick={() => onOpenPeople("gluemates")}
            className="mt-3 flex items-center gap-2 md:hidden"
          >
            <AvatarStack avatars={club.gluemates} size={28} overlap={12} />
            <span className="text-xs font-bold text-gray-900">{club.gluemates_count} Gluemates</span>
          </button>
        )}

        {/* About (description + goals) and Meeting Schedule — phone-only.
            Checked directly against apps/mobile/app/club/[clubId]/index.tsx:
            both sections are ALWAYS visible regardless of the active tab, so
            they live here in the persistent header, not in ClubHomeTab. The
            data (goals, meeting_schedule) and formatting helpers
            (parseMeetingSchedule, formatEventTime, formatEventLocation) were
            already built and tested on web — this was purely a missing
            render, nothing to fetch or compute. Desktop keeps the compact
            single-line description it already had; this is additive detail
            phone specifically had none of. */}
        {(club.description || club.goals.length > 0) && (
          <div className="mt-4 md:hidden">
            <h2 className="mb-1.5 text-base font-bold text-gray-900">About</h2>
            {club.description && (
              <p className="mb-2 text-[13px] leading-relaxed text-gray-800">{club.description}</p>
            )}
            {club.goals.map((goal) => (
              <div key={goal.id} className="mb-1 flex items-start gap-2">
                <span
                  className="mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[3px] text-white"
                  style={{ background: "#0FA6A6" }}
                  aria-hidden
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                </span>
                <span className="text-[13px] leading-relaxed text-gray-800">{goal.goal_text}</span>
              </div>
            ))}
          </div>
        )}

        {(() => {
          const slots = parseMeetingSchedule(
            club.meeting_schedule,
            club.meeting_day,
            club.meeting_time_start,
            club.meeting_time_end
          );
          const locationText = formatEventLocation(club.meeting_building, club.meeting_room, club.meeting_location);
          if (slots.length === 0 && !locationText) return null;
          return (
            <div className="mt-4 md:hidden">
              <h2 className="mb-1.5 text-base font-bold text-gray-900">Meeting Schedule</h2>
              <div className="rounded-[10px] bg-white p-3.5" style={{ boxShadow: "0 1px 6px rgba(0,0,0,0.05)" }}>
                {slots.map((slot, i) => (
                  <div key={`${slot.day}-${i}`} className="mb-1.5 flex items-start gap-2 last:mb-0">
                    <span className="mt-0.5 text-teal" aria-hidden><CalendarIcon size={16} /></span>
                    <span className="text-[13px] font-bold text-gray-900">
                      {slot.day}
                      {slot.start && slot.end ? ` ${formatEventTime(slot.start)} - ${formatEventTime(slot.end)}` : ""}
                    </span>
                  </div>
                ))}
                {locationText && (
                  <div className="flex items-center gap-2">
                    <span className="text-teal" aria-hidden><LocationIcon size={16} /></span>
                    <span className="text-[13px] font-bold text-gray-900">{locationText}</span>
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {/* Tab nav — desktop/tablet only. Native has no tabs at all: About,
            Meeting Schedule, Upcoming/Past Events, Photos, Calendar and
            Officers are one continuous scroll (checked directly against
            apps/mobile/app/club/[clubId]/index.tsx, a single ScrollView with
            every section inline) — ClubProfileClient renders that same
            stacked structure below on phone instead of tab-switching. */}
        <nav className="mt-4 hidden gap-8 border-t pt-3 md:flex" style={{ borderColor: "rgba(0,0,0,0.08)" }} aria-label="Club sections">
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

    {optionsOpen && (
      <div
        role="presentation"
        onClick={() => setOptionsOpen(false)}
        className="fixed inset-0 z-[110] flex items-center justify-center bg-black/35 p-8"
      >
        <div
          role="menu"
          aria-label={`${club.name} options`}
          onClick={(e) => e.stopPropagation()}
          className="min-w-[260px] overflow-hidden rounded-2xl bg-cream py-1.5"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => { setOptionsOpen(false); onEdit(); }}
            className="flex w-full items-center gap-3 px-4.5 py-3 text-left text-sm font-medium text-gray-900 hover:bg-black/[0.03]"
          >
            Edit club
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => { setOptionsOpen(false); onOpenAttendance(); }}
            className="flex w-full items-center gap-3 px-4.5 py-3 text-left text-sm font-medium text-gray-900 hover:bg-black/[0.03]"
          >
            QR attendance
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => { setOptionsOpen(false); onReport(); }}
            className="flex w-full items-center gap-3 px-4.5 py-3 text-left text-sm font-medium text-gray-900 hover:bg-black/[0.03]"
          >
            Report
          </button>
        </div>
      </div>
    )}
    </>
  );
}

// Mobile-parity chat action: an outlined-teal pill (1.5px border, transparent
// fill, teal semibold label) with the mobile chat-bubble icon; Officer Chat
// overlays the mobile star to denote officer scope. The click handler is passed
// in so it can later be pointed at the real web Messages routes without touching
// this layout.
function ChatPill({
  label,
  onClick,
  officer = false,
}: {
  label: string;
  onClick: () => void;
  officer?: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center justify-center gap-2 rounded-full border-[1.5px] bg-transparent px-4 py-2 text-[15px] font-semibold text-teal transition hover:bg-teal/5"
      style={{ borderColor: "#0FA6A6" }}
    >
      <span className="relative inline-flex" aria-hidden>
        <ChatBubbleOutlineIcon size={17} strokeWidth={1.9} />
        {officer && (
          <span className="absolute -right-1.5 -top-1.5 rounded-full bg-white">
            <StarOutlineIcon size={11} strokeWidth={2} filled />
          </span>
        )}
      </span>
      {label}
    </button>
  );
}

// Both counts open their list (mobile parity). Not gated on club role: an
// officer and an ordinary member get the same people list.
function Stat({
  value,
  label,
  onClick,
}: {
  value: number;
  label: string;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`View ${label}`}
      className="rounded-lg px-2 py-1 text-center transition hover:bg-black/[0.04] focus:outline-none focus-visible:ring-2"
    >
      <p className="text-xl font-bold text-gray-900">{value}</p>
      <p className="text-[13px] text-gray-600">{label}</p>
    </button>
  );
}
