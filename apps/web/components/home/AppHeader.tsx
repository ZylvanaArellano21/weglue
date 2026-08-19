"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CountBadge } from "../shared/CountBadge";
import { HomeIcon, PeopleIcon, ChatIcon, SearchIcon, CalendarIcon, PersonAddIcon, PlusIcon, ImageIcon } from "../shared/icons";
import { ProfileMenu } from "../profile/ProfileMenu";
import { messageBadgeCounts, useUnreadSummaryValue } from "../../lib/hooks/useUnreadSummary";
import { useDiscoverySearch } from "../../lib/hooks/useDiscoverySearch";
import { useIsOfficer } from "../../lib/hooks/useClubMembership";
import { Avatar } from "../shared/Avatar";

// Fixed top navigation (matches the web Home + Club screenshots): logo, the
// global search, then Home / Clubs / Messages icons + the user's avatar. Badges
// use the SAME shared counts as mobile — Home = unread notifications,
// Messages = unread direct messages + unread group messages. Mobile has no
// club-activity badge, so the Clubs icon shows none.
//
// The avatar is NOT a link to the profile: clicking it toggles the profile
// dropdown (ProfileMenu), which is the desktop stand-in for the mobile sidebar
// drawer. The profile page is reached from inside the dropdown. This is the
// only avatar with that behaviour — the large one on the profile page opens the
// picture editor instead.
//
// GLOBAL SEARCH BEHAVIOR (spec §3):
//  • On Home the search is ALWAYS expanded (a full field, even empty/unfocused).
//  • On every other destination it collapses to the small circular search
//    button; clicking it expands the field; it stays open while focused or
//    non-empty; it re-collapses when blurred empty; and navigating away from
//    Home resets it to the collapsed circle. This is the GLOBAL search, not the
//    Club-tab's own filter input.
//  • The results panel is PORTALLED to document.body. The Message tab's shell
//    is a fixed-height `overflow-hidden` container, which used to clip an
//    absolutely-positioned panel away entirely — global search looked broken on
//    that tab even though the query ran. A fixed-position portal cannot be
//    clipped by any ancestor, so the one shared implementation now behaves
//    identically on Home, Clubs, Messages, profiles and every other route.
export function AppHeader({ userId }: { userId: string }): JSX.Element {
  const pathname = usePathname();
  const router = useRouter();
  const { data: summary } = useUnreadSummaryValue(userId);
  // Backs the phone-only compose picker below — same permission source
  // ShareAGlue already uses on desktop (event creation is officer-only,
  // enforced server-side; this only decides whether to show the option).
  const { data: isOfficer } = useIsOfficer(userId);
  const [composeOpen, setComposeOpen] = useState(false);

  const isHome = pathname === "/home" || pathname === "/dashboard";
  const notifications = summary?.unread_notifications ?? 0;
  // Messages badge = Single + Groups from the SAME canonical RPC the two
  // Message-tab controls read, so the three numbers can never disagree.
  const messages = messageBadgeCounts(summary).total;
  const isClubs = pathname === "/clubs" || pathname.startsWith("/club/");
  const isMessages = pathname === "/messages";

  // Off-Home expand/collapse state for the global search.
  const [expanded, setExpanded] = useState(false);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const fieldRef = useRef<HTMLDivElement>(null);
  const composeRef = useRef<HTMLDivElement>(null);
  const { data: searchResults, isLoading: searchLoading, isError: searchError } = useDiscoverySearch(userId, value);

  // Closes the phone compose picker on outside click/Escape — same pattern
  // ShareAGlue already uses for the identical desktop menu.
  useEffect(() => {
    if (!composeOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (composeRef.current && !composeRef.current.contains(e.target as Node)) setComposeOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setComposeOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [composeOpen]);

  // Navigating to any non-Home destination returns the search to its collapsed
  // circular state (spec §3). Home always renders it expanded regardless.
  useEffect(() => {
    if (!isHome) {
      setExpanded(false);
      setValue("");
    }
  }, [pathname, isHome]);

  const showInput = isHome || expanded;
  const panelOpen = showInput && value.trim().length > 0;

  // Where to draw the portalled results panel: directly under the field, the
  // same width. Re-measured on open and on any scroll/resize so it stays glued
  // to the input the way an absolutely-positioned panel would.
  const [anchor, setAnchor] = useState<{ top: number; left: number; width: number } | null>(null);
  const measure = useCallback(() => {
    const box = fieldRef.current?.getBoundingClientRect();
    if (box) setAnchor({ top: box.bottom + 8, left: box.left, width: box.width });
  }, []);

  // useEffect, NOT useLayoutEffect: this component is server-rendered, and
  // useLayoutEffect warns on the server. There is no flash either way — the
  // panel does not render at all until `anchor` has been measured.
  useEffect(() => {
    if (!panelOpen) return;
    measure();
    window.addEventListener("resize", measure);
    // `true` = capture, so scrolling ANY ancestor (including the Message tab's
    // inner scroll containers) keeps the panel aligned.
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [panelOpen, measure]);

  // Portals need a DOM target, which does not exist during SSR.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const openResult = (result: { result_type: "person" | "club"; id: string }) => {
    setValue("");
    setExpanded(false);
    // People open the real profile, clubs open the real club profile — the same
    // two destinations mobile search uses.
    router.push(result.result_type === "person" ? `/u/${result.id}` : `/club/${result.id}`);
  };

  return (
    <>
    {/* On phone, native has no persistent top bar at all outside Home — Club
        Profile, Clubs, and every other screen start straight into their own
        content (each with its own header treatment, if any). Hiding every
        child below still left this element itself rendering as an empty
        64px strip pinned to the top of every phone page. Hidden entirely
        below md unless isHome; md:block always restores it for desktop,
        which keeps the persistent top nav on every page there. */}
    <header
      className={`${isHome ? "" : "hidden md:block"} sticky top-0 z-40 border-b bg-cream/95 backdrop-blur`}
      style={{ borderColor: "rgba(0,0,0,0.06)" }}
    >
      <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-4 px-4 sm:px-6">
        {/* Phone width has no logo/search-bar chrome at all (matches the
            native app's header, which is just the avatar + a couple of
            icons) — the avatar sits first in DOM/left on phone via `order-1`,
            then reorders to its normal desktop position (right, after
            everything else) at md+ via `md:order-5`. Rendered ONCE only —
            duplicate-mounting ProfileMenu for a second breakpoint position
            was a real bug caught in an earlier pass.
            Phone-only AND Home-only: native's compact avatar/+/notifications
            row exists on the Home screen alone — Club Profile, Clubs, and
            every other screen have no such bar (each has its own top
            treatment, e.g. Club Profile's back chevron floating on its own
            cover image). This was rendering on every AppHeader-mounting
            page below md, overlapping content that has its own header.
            Desktop's top nav is unaffected — it's meant to persist across
            every page there, this only scopes the phone-specific row. */}
        <div className={`${isHome ? "order-1" : "hidden md:block"} shrink-0 md:order-5`}>
          <ProfileMenu userId={userId} />
        </div>

        {/* The WHOLE logo is the link: the anchor is an inline-flex box that
            wraps the image exactly, so every pixel of the mark navigates Home
            from any authenticated route. The asset is 611x409 — passing its
            real intrinsic size and sizing with CSS keeps it undistorted, where
            the previous 40x40 squashed it into a square. `h-11 w-auto` renders
            ~66x44: noticeably larger and easier to see, and still well inside
            the 64px header, so no layout moves. Hidden below md — phone gets
            no logo, matching native. */}
        <Link
          href="/home"
          aria-label="We Glue home"
          title="Home"
          className="hidden shrink-0 items-center rounded-md focus:outline-none focus-visible:ring-2 md:order-1 md:inline-flex"
        >
          <Image src="/logo.png" alt="We Glue" width={611} height={409} priority className="h-11 w-auto" />
        </Link>

        {/* The search region is ALWAYS flex-1 so the nav icons keep a fixed
            right-aligned position whether the field is expanded or collapsed —
            expanding/collapsing must never make the icons jump (spec §3). On
            phone, the field itself (not this flex-1 spacer) stays hidden
            unless the user explicitly opened it from the bottom tab bar's
            Search tab — Home no longer auto-shows a persistent search bar
            below md, matching native (search lives only on the bottom tab). */}
        <div className="order-2 flex min-w-0 flex-1 items-center md:order-2">
          {showInput ? (
            <div
              ref={fieldRef}
              className={`relative w-full max-w-xl ${isHome && !expanded ? "hidden md:block" : ""}`}
            >
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                <SearchIcon size={18} />
              </span>
              <input
                ref={inputRef}
                type="search"
                aria-label="Search"
                placeholder="Search"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onBlur={() => {
                  // Off-Home: collapse back to the circle only when left empty.
                  if (!isHome && value.trim() === "") setExpanded(false);
                }}
                className="h-10 w-full rounded-full border bg-white pl-10 pr-4 text-sm outline-none focus:ring-2"
                style={{ borderColor: "rgba(0,0,0,0.1)" }}
              />
              {panelOpen && mounted && anchor &&
                createPortal(
                  <div
                    role="listbox"
                    aria-label="Search results"
                    className="overflow-hidden rounded-xl border bg-white p-1 shadow-xl"
                    style={{
                      position: "fixed",
                      top: anchor.top,
                      left: anchor.left,
                      width: anchor.width,
                      maxHeight: "min(60vh, 420px)",
                      overflowY: "auto",
                      zIndex: 60,
                      borderColor: "rgba(0,0,0,0.1)",
                    }}
                  >
                    {searchLoading ? <p className="px-3 py-3 text-sm text-gray-500" role="status">Searching…</p> : searchError ? <p className="px-3 py-3 text-sm text-red-600" role="alert">Search is unavailable. Try again.</p> : !searchResults?.length ? <p className="px-3 py-3 text-sm text-gray-500">No people or clubs match that search.</p> : searchResults.map((result) => (
                      <button
                        key={`${result.result_type}-${result.id}`}
                        type="button"
                        role="option"
                        aria-label={`Open ${result.name}`}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => openResult(result)}
                        className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-black/[0.04] focus:bg-black/[0.04] focus:outline-none"
                      >
                        <Avatar uri={result.avatar_url} size={32} name={result.name} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-gray-900">{result.name}</span>
                          <span className="block truncate text-xs text-gray-500">{result.sub ?? (result.result_type === "person" ? "Person" : "Club")}</span>
                        </span>
                        {result.result_type === "club" && <span className="text-xs font-semibold text-teal">{result.is_member ? "Joined" : "View"}</span>}
                      </button>
                    ))}
                  </div>,
                  document.body
                )}
            </div>
          ) : (
            // Hidden below md — phone shows no search affordance in the top
            // row at all (reachable only via the bottom tab bar's Search
            // tab), matching native.
            <button
              type="button"
              aria-label="Open search"
              aria-expanded={false}
              onClick={() => {
                setExpanded(true);
                // Focus once the input has rendered.
                requestAnimationFrame(() => inputRef.current?.focus());
              }}
              className="hidden h-10 w-10 items-center justify-center rounded-full border bg-white text-gray-600 shadow-sm transition hover:bg-gray-50 focus:outline-none focus:ring-2 md:flex"
              style={{ borderColor: "rgba(0,0,0,0.1)" }}
            >
              <SearchIcon size={18} />
            </button>
          )}
        </div>

        {/* Hidden below md (768px) — the bottom tab bar (rendered after this
            header) takes over Home/Clubs/Messages/Calendar navigation on
            phone widths, matching the native app's bottom bar instead of a
            top icon row. md, not lg: tablets (iPad portrait and up) get the
            desktop-style top nav, same as the rest of the desktop-equivalent
            IA tablets get elsewhere (see HomeClient's column grid) — the
            phone bottom bar is strictly a phone-width feature. Search stays
            reachable up here too (its expand/collapse behavior is
            unchanged) since the bottom bar's Search tab just expands and
            focuses this same field. */}
        <nav className="hidden shrink-0 items-center gap-4 sm:gap-5 md:order-3 md:flex" aria-label="Primary">
          <NavIcon href="/home" label="Home" active={isHome} badge={notifications} badgeLabel="unread notifications">
            <HomeIcon size={26} filled={isHome} />
          </NavIcon>
          <NavIcon href="/clubs" label="Clubs" active={isClubs}>
            <PeopleIcon size={27} filled={isClubs} />
          </NavIcon>
          <NavIcon href="/messages" label="Messages" active={isMessages} badge={messages} badgeLabel="unread messages">
            <ChatIcon size={26} filled={isMessages} />
          </NavIcon>
        </nav>

        {/* Phone-only AND Home-only: compose. Native's "+" opens a small
            picker (Picture / Event, Event gated to officers — same
            permission ShareAGlue already uses on desktop, server-enforced
            either way) rather than posting directly. Always routes to
            /home: compose is a Home-tab concept there's no equivalent
            surface for on Clubs/Messages, and that's exactly how native's
            own Home-tab "+" behaves — it also only exists on that one
            screen, not a persistent bar everywhere. */}
        <div ref={composeRef} className={isHome ? "relative order-3 md:hidden" : "hidden"}>
          <button
            type="button"
            aria-label="New post"
            aria-haspopup="menu"
            aria-expanded={composeOpen}
            onClick={() => setComposeOpen((v) => !v)}
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#0FA6A6] text-white shadow-sm"
          >
            <PlusIcon size={20} strokeWidth={2.2} />
          </button>
          {composeOpen && (
            <div
              role="menu"
              className="absolute right-0 top-12 z-50 min-w-[150px] overflow-hidden rounded-xl bg-white py-1.5"
              style={{ boxShadow: "0 8px 24px rgba(0,0,0,0.14)" }}
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setComposeOpen(false);
                  router.push("/home?compose=post");
                }}
                className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-[15px] text-gray-900 hover:bg-gray-50"
              >
                <ImageIcon size={20} /> Picture
              </button>
              {isOfficer && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setComposeOpen(false);
                    router.push("/home?compose=event");
                  }}
                  className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-[15px] text-gray-900 hover:bg-gray-50"
                >
                  <CalendarIcon size={20} /> Event
                </button>
              )}
            </div>
          )}
        </div>

        {/* Phone-only: Notifications. Checked directly against
            apps/mobile/app/(tabs)/index.tsx — this second top-right icon
            (person-add glyph; that's the native icon choice, kept here for
            an exact visual match even though it reads oddly for
            notifications) calls handleNotificationsPress, which routes to
            /home/notifications. An earlier pass wired this to Gluemates
            instead, going only by the icon's shape rather than checking
            what it actually does — Gluemates was never the gap that needed
            filling (it's already reachable from the profile page's stat
            row, same as native), Notifications was: ProfileSidebar carries
            the only other entry point and it's `hidden lg:block`, so phone
            had no way to reach it at all until this icon. Home-only on
            phone too, for the same reason as the compose button above —
            native's icon only exists on that one screen. */}
        <Link
          href="/home?notifications=1"
          aria-label="Notifications"
          className={
            isHome
              ? "relative order-3 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border bg-white text-gray-700 shadow-sm md:hidden"
              : "hidden"
          }
          style={{ borderColor: "rgba(0,0,0,0.1)" }}
        >
          <PersonAddIcon size={20} />
          {notifications > 0 && (
            <CountBadge
              count={notifications}
              label="unread notifications"
              style={{ position: "absolute", top: -4, right: -4 }}
            />
          )}
        </Link>
      </div>
    </header>

    {/* Rendered as a SIBLING of <header>, never a descendant: `header` has
        `backdrop-blur` (backdrop-filter), and per the CSS spec a filter or
        backdrop-filter on an ancestor creates a new containing block for
        `position: fixed` descendants — so a fixed child positions itself
        relative to THAT ANCESTOR's box, not the viewport. With BottomTabBar
        nested inside header, "bottom: 0" resolved to the bottom of the
        ~64px header instead of the real screen bottom, so on an actual
        phone the bar rendered stuck right under the top content instead of
        docked to the bottom of the screen — invisible to `tsc`/desktop
        testing, only visible on a real device. */}
    <BottomTabBar
      isHome={isHome}
      isClubs={isClubs}
      isMessages={isMessages}
      notifications={notifications}
      messages={messages}
      onSearchTap={() => {
        setExpanded(true);
        window.scrollTo({ top: 0, behavior: "smooth" });
        requestAnimationFrame(() => inputRef.current?.focus());
      }}
    />
    </>
  );
}

// Phone-width (below md/768px) bottom navigation — same destinations as the
// top `nav` above (Home, Clubs, Messages) plus Search (expands/focuses the
// existing header search field rather than duplicating that logic) and
// Calendar (opens the existing Home calendar overlay via a query param;
// there is no standalone /calendar route). Fixed to the viewport bottom
// like the native app's tab bar; every AppHeader-mounting page reserves
// matching bottom padding below `md` so this never covers real content.
function BottomTabBar({
  isHome,
  isClubs,
  isMessages,
  notifications,
  messages,
  onSearchTap,
}: {
  isHome: boolean;
  isClubs: boolean;
  isMessages: boolean;
  notifications: number;
  messages: number;
  onSearchTap: () => void;
}): JSX.Element {
  return (
    <nav
      // Solid brand teal with white icons — matches the native app's tab bar
      // exactly (#0FA6A6, sampled directly from the running iOS build), not
      // the previous cream bar with dark/teal icons that read as a web
      // toolbar rather than an app tab bar.
      className="fixed inset-x-0 bottom-0 z-40 flex items-stretch justify-around bg-[#0FA6A6] md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="Primary"
    >
      <BottomTabIcon href="/home" label="Home" active={isHome} badge={notifications} badgeLabel="unread notifications">
        <HomeIcon size={24} filled={isHome} />
      </BottomTabIcon>
      <BottomTabIcon href="/clubs" label="Clubs" active={isClubs}>
        <PeopleIcon size={25} filled={isClubs} />
      </BottomTabIcon>
      <button
        type="button"
        aria-label="Search"
        onClick={onSearchTap}
        className="flex h-14 flex-1 flex-col items-center justify-center text-white"
      >
        <SearchIcon size={24} />
      </button>
      <BottomTabIcon href="/messages" label="Messages" active={isMessages} badge={messages} badgeLabel="unread messages">
        <ChatIcon size={24} filled={isMessages} />
      </BottomTabIcon>
      <BottomTabIcon href="/home?calendar=1" label="Calendar" active={false}>
        <CalendarIcon size={23} />
      </BottomTabIcon>
    </nav>
  );
}

function BottomTabIcon({
  href,
  label,
  active,
  badge = 0,
  badgeLabel,
  children,
}: {
  href: string;
  label: string;
  active?: boolean;
  badge?: number;
  badgeLabel?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <Link
      href={href}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      // White on the solid-teal bar for every tab — matches native, where
      // the active/inactive distinction is the icon's filled vs. outline
      // shape (already passed as `filled={...}` by each caller), not a
      // color change.
      className="relative flex h-14 flex-1 flex-col items-center justify-center text-white"
    >
      {children}
      {badge > 0 && (
        <CountBadge
          count={badge}
          label={badgeLabel}
          style={{ position: "absolute", top: 2, right: "28%" }}
        />
      )}
    </Link>
  );
}

function NavIcon({
  href,
  label,
  active,
  badge = 0,
  badgeLabel,
  children,
}: {
  href: string;
  label: string;
  active?: boolean;
  badge?: number;
  badgeLabel?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <Link
      href={href}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      className="relative flex flex-col items-center"
      style={{ color: active ? "#0FA6A6" : "#1F2937" }}
    >
      {children}
      {badge > 0 && (
        <CountBadge
          count={badge}
          label={badgeLabel}
          style={{ position: "absolute", top: -6, right: -8 }}
        />
      )}
      <span
        aria-hidden
        className="absolute -bottom-[13px] h-0.5 w-6 rounded-full"
        style={{ background: active ? "#0FA6A6" : "transparent" }}
      />
    </Link>
  );
}
