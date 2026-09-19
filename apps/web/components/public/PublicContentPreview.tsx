"use client";

import { createContext, useContext } from "react";
import Link from "next/link";
import { PhotoCarousel } from "../shared/PhotoCarousel";
import { HeartIcon, CommentIcon, CalendarIcon, LocationIcon, ImageIcon } from "../shared/icons";
import { DOWNLOAD_APP_URL } from "../../lib/deviceRouting";
import { trackShareFunnelEvent } from "../shared/UnifiedShareSheet";
import { MoreAtCampus, type MoreAtCampusItem } from "./MoreAtCampus";

// Public, anonymous-safe rendering of a single post/event, backed by the
// narrow anonymous RPCs (get_public_preview_post / get_public_preview_event).
// Deliberately close to the real PostsFeed/EventCard visual language — same
// card surface, same teal/cream tokens — so this reads as content shared FROM
// We Glue, not a separately-designed marketing page. No authenticated action
// is ever performed here: every interactive-looking element (like, comment,
// RSVP) routes to "Get We Glue" instead, since there is no session to act on.

export interface PublicPostPreview {
  type: "post";
  caption: string | null;
  image_url: string | null;
  post_images: Array<{ storage_path: string; position: number; width: number | null; height: number | null }>;
  author: { display_name: string; avatar_url: string | null } | null;
  club: { name: string; avatar_url: string | null } | null;
  created_at: string;
}

export interface PublicEventPreview {
  type: "event";
  title: string;
  description: string | null;
  cover_image_url: string | null;
  event_date: string;
  start_time: string;
  end_time: string;
  location: string | null;
  building: string | null;
  room: string | null;
  club: { name: string; avatar_url: string | null };
}

export type PublicContentPreviewData = PublicPostPreview | PublicEventPreview;

/** Shape actually returned by the RPCs (no `type` discriminant — the caller
 *  already knows which one it called). */
export type PublicPostPreviewRaw = Omit<PublicPostPreview, "type">;
export type PublicEventPreviewRaw = Omit<PublicEventPreview, "type">;

function fmtEventDate(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function fmtEventTime(timeStr: string): string {
  const [h = 0, m = 0] = timeStr.split(":").map(Number);
  const ampm = h >= 12 ? "pm" : "am";
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, "0")} ${ampm}`;
}

// The share_session_id from the URL (?ssid=...) — present only when this
// visitor arrived via an actual share act; null for a direct/unattributed
// visit. Provided once by PublicPreviewShell, read by any tracked action
// nested inside it, so it doesn't need threading through every component.
const PreviewSessionContext = createContext<string | null>(null);

/** Any element that would normally perform an authenticated action becomes a
 *  plain link to Get We Glue — never a silent no-op, never a real mutation. */
function GetAppAction({
  children,
  ariaLabel,
  entityType,
  entityId,
}: {
  children: React.ReactNode;
  ariaLabel: string;
  entityType: "post" | "event";
  entityId: string;
}): JSX.Element {
  const sessionId = useContext(PreviewSessionContext);
  return (
    <Link
      href={DOWNLOAD_APP_URL}
      aria-label={ariaLabel}
      onClick={() => trackShareFunnelEvent("store_clicked", entityType, entityId, "direct_unknown", sessionId)}
      className="flex items-center gap-1.5 text-gray-700 hover:text-[#0FA6A6]"
    >
      {children}
    </Link>
  );
}

export function PublicContentPreview({ data, entityId }: { data: PublicContentPreviewData; entityId: string }): JSX.Element {
  if (data.type === "post") return <PublicPostCard post={data} entityId={entityId} />;
  return <PublicEventCard event={data} entityId={entityId} />;
}

function PublicPostCard({ post, entityId }: { post: PublicPostPreview; entityId: string }): JSX.Element {
  const images = post.post_images.length > 0
    ? [...post.post_images].sort((a, b) => a.position - b.position).map((img) => ({ uri: img.storage_path, width: img.width, height: img.height }))
    : post.image_url
      ? [{ uri: post.image_url }]
      : [];
  const identity = post.club ?? post.author;
  const identityName = post.club?.name ?? post.author?.display_name ?? "We Glue";

  return (
    <article className="overflow-hidden rounded-2xl shadow-card" style={{ background: "#FEFFF8" }}>
      <div className="flex items-center gap-2.5 px-3.5 py-3">
        {identity?.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={identity.avatar_url} alt="" width={34} height={34} className="rounded-full object-cover" />
        ) : (
          <div className="h-[34px] w-[34px] rounded-full bg-gray-200" />
        )}
        <span className="truncate text-[15px] font-semibold text-gray-800">{identityName}</span>
      </div>

      {images.length > 0 ? (
        <PhotoCarousel images={images} aspectRatio={4 / 5} naturalRatio />
      ) : (
        <div className="flex aspect-square w-full items-center justify-center" style={{ background: "#E5E7EB", color: "#9CA3AF" }}>
          <ImageIcon size={40} />
        </div>
      )}

      <div className="px-3.5 py-3">
        <div className="flex items-center gap-4">
          <GetAppAction ariaLabel="Like this post in We Glue" entityType="post" entityId={entityId}>
            <HeartIcon size={22} filled={false} />
          </GetAppAction>
          <GetAppAction ariaLabel="Comment on this post in We Glue" entityType="post" entityId={entityId}>
            <CommentIcon size={20} />
          </GetAppAction>
        </div>
        {post.caption && (
          <p className="mt-2 text-sm text-gray-800">
            <span className="font-semibold">{identityName}</span> {post.caption}
          </p>
        )}
      </div>
    </article>
  );
}

function PublicEventCard({ event, entityId }: { event: PublicEventPreview; entityId: string }): JSX.Element {
  const location = event.location ?? (event.building ? `Building ${event.building}${event.room ? `, Room ${event.room}` : ""}` : null);

  return (
    <article className="overflow-hidden rounded-2xl shadow-card" style={{ background: "#FEFFF8" }}>
      <div className="flex items-center gap-2.5 px-3.5 pt-3 pb-2">
        {event.club.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={event.club.avatar_url} alt="" width={34} height={34} className="rounded-full object-cover" />
        ) : (
          <div className="h-[34px] w-[34px] rounded-full bg-gray-200" />
        )}
        <span className="truncate text-[15px] font-semibold" style={{ color: "#5F5D5D" }}>{event.club.name}</span>
      </div>

      {event.cover_image_url ? (
        <PhotoCarousel images={[{ uri: event.cover_image_url }]} naturalRatio rounded={false} />
      ) : (
        <div className="flex aspect-[3/2] w-full items-center justify-center" style={{ background: "#E5E7EB", color: "#9CA3AF" }}>
          <ImageIcon size={40} />
        </div>
      )}

      <div className="px-3.5 py-3">
        <h1 className="mb-1 text-lg font-semibold text-black">{event.title}</h1>
        {event.description && <p className="mb-2 text-sm" style={{ color: "#5F5D5D" }}>{event.description}</p>}
        <div className="mb-1.5 flex items-center gap-1.5 text-xs" style={{ color: "#5F5D5D" }}>
          <CalendarIcon size={16} />
          <span>{fmtEventDate(event.event_date)} · {fmtEventTime(event.start_time)}–{fmtEventTime(event.end_time)}</span>
        </div>
        {location && (
          <div className="mb-2 flex items-center gap-1.5 text-xs" style={{ color: "#5F5D5D" }}>
            <LocationIcon size={16} />
            <span>{location}</span>
          </div>
        )}
        <GetAppAction ariaLabel="RSVP to this event in We Glue" entityType="event" entityId={entityId}>
          <span className="mt-1 inline-block rounded-full px-4 py-1.5 text-[13px] font-semibold text-white" style={{ background: "#0FA6A6" }}>
            RSVP in We Glue
          </span>
        </GetAppAction>
      </div>
    </article>
  );
}

/**
 * Full public-preview page body: top "Open in We Glue" link, the hero card,
 * "More happening at your campus", and a fallback "Get We Glue" link when
 * there are no more items (MoreAtCampus already renders its own when it has
 * items, so this never duplicates it). Owns every funnel-tracked click for
 * the page — this is why the whole file is a client component.
 */
export function PublicPreviewShell({
  data,
  entityId,
  more,
  loginNext,
  sessionId,
}: {
  data: PublicContentPreviewData;
  entityId: string;
  more: MoreAtCampusItem[];
  loginNext: string;
  /** From the URL's `?ssid=` — null for a direct/unattributed visit. */
  sessionId: string | null;
}): JSX.Element {
  return (
    <PreviewSessionContext.Provider value={sessionId}>
    <main className="mx-auto min-h-screen max-w-md px-4 py-6">
      <Link
        href={`/login?next=${encodeURIComponent(loginNext)}`}
        onClick={() => trackShareFunnelEvent("open_in_app_clicked", data.type, entityId, "direct_unknown", sessionId)}
        className="mb-4 block rounded-full py-2.5 text-center text-[13px] font-semibold text-white"
        style={{ background: "#0FA6A6" }}
      >
        Open in We Glue
      </Link>
      <PublicContentPreview data={data} entityId={entityId} />
      <MoreAtCampus items={more} heroType={data.type} heroId={entityId} sessionId={sessionId} />
      {more.length === 0 && (
        <Link
          href={DOWNLOAD_APP_URL}
          onClick={() => trackShareFunnelEvent("store_clicked", data.type, entityId, "direct_unknown", sessionId)}
          className="mt-6 block text-center text-xs text-gray-400 underline"
        >
          Get We Glue
        </Link>
      )}
    </main>
    </PreviewSessionContext.Provider>
  );
}
