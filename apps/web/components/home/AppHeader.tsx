"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CountBadge } from "../shared/CountBadge";
import { HomeIcon, PeopleIcon, ChatIcon, SearchIcon } from "../shared/icons";
import { ProfileMenu } from "../profile/ProfileMenu";
import { messageBadgeCounts, useUnreadSummaryValue } from "../../lib/hooks/useUnreadSummary";
import { useDiscoverySearch } from "../../lib/hooks/useDiscoverySearch";
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
  const { data: searchResults, isLoading: searchLoading, isError: searchError } = useDiscoverySearch(userId, value);

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
    <header
      className="sticky top-0 z-40 border-b bg-cream/95 backdrop-blur"
      style={{ borderColor: "rgba(0,0,0,0.06)" }}
    >
      <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-4 px-4 sm:px-6">
        {/* The WHOLE logo is the link: the anchor is an inline-flex box that
            wraps the image exactly, so every pixel of the mark navigates Home
            from any authenticated route. The asset is 611x409 — passing its
            real intrinsic size and sizing with CSS keeps it undistorted, where
            the previous 40x40 squashed it into a square. `h-11 w-auto` renders
            ~66x44: noticeably larger and easier to see, and still well inside
            the 64px header, so no layout moves. */}
        <Link
          href="/home"
          aria-label="We Glue home"
          title="Home"
          className="inline-flex shrink-0 items-center rounded-md focus:outline-none focus-visible:ring-2"
        >
          <Image src="/logo.png" alt="We Glue" width={611} height={409} priority className="h-11 w-auto" />
        </Link>

        {/* The search region is ALWAYS flex-1 so the nav icons keep a fixed
            right-aligned position whether the field is expanded or collapsed —
            expanding/collapsing must never make the icons jump (spec §3). */}
        <div className="flex min-w-0 flex-1 items-center">
          {showInput ? (
            <div ref={fieldRef} className="relative w-full max-w-xl">
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
            <button
              type="button"
              aria-label="Open search"
              aria-expanded={false}
              onClick={() => {
                setExpanded(true);
                // Focus once the input has rendered.
                requestAnimationFrame(() => inputRef.current?.focus());
              }}
              className="flex h-10 w-10 items-center justify-center rounded-full border bg-white text-gray-600 shadow-sm transition hover:bg-gray-50 focus:outline-none focus:ring-2"
              style={{ borderColor: "rgba(0,0,0,0.1)" }}
            >
              <SearchIcon size={18} />
            </button>
          )}
        </div>

        <nav className="flex shrink-0 items-center gap-4 sm:gap-5" aria-label="Primary">
          <NavIcon href="/home" label="Home" active={isHome} badge={notifications} badgeLabel="unread notifications">
            <HomeIcon size={26} filled={isHome} />
          </NavIcon>
          <NavIcon href="/clubs" label="Clubs" active={isClubs}>
            <PeopleIcon size={27} filled={isClubs} />
          </NavIcon>
          <NavIcon href="/messages" label="Messages" active={isMessages} badge={messages} badgeLabel="unread messages">
            <ChatIcon size={26} filled={isMessages} />
          </NavIcon>

          <ProfileMenu userId={userId} />
        </nav>
      </div>
    </header>
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
