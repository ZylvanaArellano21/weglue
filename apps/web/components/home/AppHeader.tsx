"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { Avatar } from "../shared/Avatar";
import { CountBadge } from "../shared/CountBadge";
import { HomeIcon, PeopleIcon, ChatIcon, SearchIcon } from "../shared/icons";
import { useUnreadSummaryValue } from "../../lib/hooks/useUnreadSummary";
import { useOwnProfile } from "../../lib/hooks/useOwnProfile";

// Fixed top navigation (matches the web Home screenshots): logo, search, then
// Home / Clubs / Messages icons + the user's avatar. Badges use the SAME shared
// counts as mobile — Home = unread notifications, Messages = unread threads.
// Mobile has no club-activity badge, so the Clubs icon shows none.
export function AppHeader({ userId }: { userId: string }): JSX.Element {
  const pathname = usePathname();
  const { data: summary } = useUnreadSummaryValue(userId);
  const { data: profile } = useOwnProfile(userId);

  const isHome = pathname === "/home" || pathname === "/dashboard";
  const notifications = summary?.unread_notifications ?? 0;
  const threads = summary?.unread_threads ?? 0;

  return (
    <header
      className="sticky top-0 z-40 border-b bg-cream/95 backdrop-blur"
      style={{ borderColor: "rgba(0,0,0,0.06)" }}
    >
      <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-4 px-4 sm:px-6">
        <Link href="/home" aria-label="We Glue home" className="shrink-0">
          <Image src="/logo.png" alt="We Glue" width={40} height={40} priority />
        </Link>

        <div className="relative min-w-0 flex-1 max-w-xl">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
            <SearchIcon size={18} />
          </span>
          <input
            type="search"
            aria-label="Search"
            placeholder="Search"
            className="h-10 w-full rounded-full border bg-white pl-10 pr-4 text-sm outline-none focus:ring-2"
            style={{ borderColor: "rgba(0,0,0,0.1)" }}
          />
        </div>

        <nav className="flex shrink-0 items-center gap-4 sm:gap-5" aria-label="Primary">
          <NavIcon href="/home" label="Home" active={isHome} badge={notifications} badgeLabel="unread notifications">
            <HomeIcon size={26} filled={isHome} />
          </NavIcon>
          <NavIcon href="/clubs" label="Clubs">
            <PeopleIcon size={27} />
          </NavIcon>
          <NavIcon href="/messages" label="Messages" badge={threads} badgeLabel="unread conversations">
            <ChatIcon size={26} />
          </NavIcon>

          <Link href="/profile" aria-label="Your profile" className="ml-1 shrink-0">
            <Avatar uri={profile?.avatar_url} size={38} name={profile?.full_name ?? profile?.username} />
          </Link>
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
