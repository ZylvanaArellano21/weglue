"use client";

import Link from "next/link";
import { DOWNLOAD_APP_URL } from "../../lib/deviceRouting";
import { ImageIcon, CalendarIcon } from "../shared/icons";
import { trackShareFunnelEvent } from "../shared/UnifiedShareSheet";

// "More happening at your campus" — up to 3 additional publicly-shareable
// items from the same campus as the hero, backed by get_public_preview_more.
// Every item here already passed the exact same eligibility rule as the hero
// (content_is_student_visible + externally enabled + campus-active, and for
// events visibility='everyone' + not yet ended) — nothing is invented or
// filled in when there are fewer than 3 eligible items.

export interface MoreAtCampusPostItem {
  type: "post";
  id: string;
  caption: string | null;
  image_url: string | null;
  author: { display_name: string; avatar_url: string | null } | null;
  club: { name: string; avatar_url: string | null } | null;
}

export interface MoreAtCampusEventItem {
  type: "event";
  id: string;
  title: string;
  cover_image_url: string | null;
  event_date: string;
  club: { name: string; avatar_url: string | null };
}

export type MoreAtCampusItem = MoreAtCampusPostItem | MoreAtCampusEventItem;

function fmtShortDate(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function MoreAtCampus({
  items,
  heroType,
  heroId,
  sessionId,
}: {
  items: MoreAtCampusItem[];
  heroType: "post" | "event";
  heroId: string;
  sessionId: string | null;
}): JSX.Element | null {
  if (items.length === 0) return null;

  return (
    <section className="mt-8">
      <p className="mb-3 text-center text-sm font-medium text-gray-500">There&rsquo;s more here than you think.</p>
      <div className="grid grid-cols-3 gap-2">
        {items.map((item) => (
          <Link
            key={`${item.type}:${item.id}`}
            href={`/${item.type}/${item.id}`}
            className="block overflow-hidden rounded-xl shadow-card"
            style={{ background: "#FEFFF8" }}
          >
            <div className="relative aspect-square w-full bg-gray-200">
              {(item.type === "post" ? item.image_url : item.cover_image_url) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={(item.type === "post" ? item.image_url : item.cover_image_url) ?? undefined}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-gray-400">
                  <ImageIcon size={24} />
                </div>
              )}
            </div>
            <div className="px-2 py-1.5">
              <p className="truncate text-[11px] font-semibold text-gray-800">
                {item.type === "post" ? (item.club?.name ?? item.author?.display_name ?? "We Glue") : item.club.name}
              </p>
              {item.type === "event" && (
                <p className="flex items-center gap-1 truncate text-[10px] text-gray-500">
                  <CalendarIcon size={10} /> {fmtShortDate(item.event_date)}
                </p>
              )}
            </div>
          </Link>
        ))}
      </div>
      <Link
        href={DOWNLOAD_APP_URL}
        onClick={() => trackShareFunnelEvent("store_clicked", heroType, heroId, "direct_unknown", sessionId)}
        className="mt-5 block w-full rounded-full py-3 text-center text-[15px] font-semibold text-white"
        style={{ background: "#0FA6A6" }}
      >
        Get We Glue
      </Link>
    </section>
  );
}
