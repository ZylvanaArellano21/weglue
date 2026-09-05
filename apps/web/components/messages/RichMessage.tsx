"use client";

/**
 * The ONE set of rich-message renderers for web messaging.
 *
 * Every conversation type — direct, custom group, club members chat, officers
 * chat and every subchannel — renders shared events, shared posts, images and
 * files through these components. There is deliberately no per-conversation
 * variant: a shared event must look and behave the same wherever it is sent.
 *
 * The structure is transcribed from the mobile source of truth in
 * `apps/mobile/components/chat/{EventShareCard,PostShareCard,MessageBubble}.tsx`
 * and the mobile screenshots in `corrections/`. Only sizing is adapted for
 * responsive desktop width — the hierarchy, ordering, iconography, surfaces and
 * interactions are the mobile ones.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { clampChatImageAspect, fileSubtitle } from "@weglue/shared";
import { Avatar } from "../shared/Avatar";
import { ClickableUserIdentity } from "../shared/ClickableIdentity";
import { CalendarIcon, ImageIcon, PeopleIcon } from "../shared/icons";
import { LinkifiedText } from "../shared/LinkifiedText";
import {
  attachmentObjectUrl,
  getSharedEventPreview,
  getSharedPostPreview,
  releaseAttachmentUrl,
  type ThreadMessage,
} from "../../lib/messages/service";

/** Mobile's card: white surface, hairline border, 16px radius, soft shadow.
 *  Width is capped rather than fixed at mobile's 260px, so the card can breathe
 *  on desktop without becoming a full-width banner. */
const CARD_CLASS =
  "block w-full max-w-[300px] overflow-hidden rounded-2xl border bg-white p-2.5 text-left shadow-[0_2px_6px_rgba(0,0,0,0.10)] transition hover:brightness-[0.985] focus:outline-none focus:ring-2 focus:ring-teal";
const CARD_STYLE: React.CSSProperties = { borderColor: "rgba(0,0,0,0.10)" };

function CardShell({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div className={CARD_CLASS.replace("transition hover:brightness-[0.985] ", "")} style={CARD_STYLE}>
      {children}
    </div>
  );
}

function CardBadge({ label, icon }: { label: string; icon: JSX.Element }): JSX.Element {
  return (
    <span className="mb-2 flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.5px] text-teal">
      {icon}
      {label}
    </span>
  );
}

function CardNotice({ text, icon }: { text: string; icon: JSX.Element }): JSX.Element {
  return (
    <CardShell>
      <span className="flex items-center gap-2 px-1.5 py-2 text-xs text-gray-500">
        {icon}
        {text}
      </span>
    </CardShell>
  );
}

/** Mobile's `formatDate`/`formatTime` from EventShareCard, so the same event
 *  reads identically on both platforms. The date string is a plain `YYYY-MM-DD`
 *  calendar day and is parsed as LOCAL midnight — `new Date("2026-08-20")`
 *  alone would be parsed as UTC and can render the previous day. */
function formatEventDate(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function formatEventTime(value: string | null): string | null {
  if (!value) return null;
  const [rawHours, rawMinutes] = value.split(":");
  const hours = Number(rawHours);
  const minutes = Number(rawMinutes ?? "0");
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  const suffix = hours >= 12 ? "pm" : "am";
  const hour = hours % 12 || 12;
  return `${hour}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

function ClockIcon({ size = 12 }: { size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function DocumentIcon({ size = 22 }: { size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6M9 17h4" />
    </svg>
  );
}

/**
 * Update 2 — the full shared-event preview, replacing the bare
 * "📅 View shared event" link.
 */
export function EventShareCard({
  eventId,
  onOpenEvent,
}: {
  eventId: string | null;
  onOpenEvent: (eventId: string) => void;
}): JSX.Element {
  const { data: event, isLoading } = useQuery({
    // Kept under the "messages" root so the existing permission-sensitive cache
    // reset already drops it and it re-resolves after a block or an unblock.
    queryKey: ["messages", "sharedEventPreview", eventId],
    queryFn: () => getSharedEventPreview(eventId!),
    enabled: !!eventId,
    staleTime: 60_000,
  });

  if (!eventId) return <CardNotice text="This event is no longer available." icon={<CalendarIcon size={16} />} />;
  if (isLoading) return <CardNotice text="Loading event…" icon={<CalendarIcon size={16} />} />;
  if (!event) return <CardNotice text="This event is no longer available." icon={<CalendarIcon size={16} />} />;

  const time = formatEventTime(event.start_time);
  return (
    <button type="button" onClick={() => onOpenEvent(event.id)} className={CARD_CLASS} style={CARD_STYLE} aria-label={`Open event ${event.title}`}>
      <CardBadge label="Event" icon={<CalendarIcon size={12} filled />} />
      {event.cover_image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={event.cover_image_url} alt="" className="mb-2 aspect-[16/9] w-full rounded-[10px] object-cover" />
      ) : (
        <span className="mb-2 flex aspect-[16/9] w-full items-center justify-center rounded-[10px] bg-teal/10 text-gray-400">
          <ImageIcon size={26} />
        </span>
      )}
      <span className="mb-1.5 block text-sm font-semibold leading-tight text-gray-950 line-clamp-2">
        {event.emoji ? `${event.emoji} ` : ""}
        {event.title}
      </span>
      <span className="mb-0.5 flex items-center gap-1 text-[11px] text-gray-500">
        <ClockIcon />
        <span className="truncate">
          {formatEventDate(event.event_date)}
          {time ? ` · ${time}` : ""}
        </span>
      </span>
      {event.club_name && (
        <span className="flex items-center gap-1 text-[11px] font-medium text-teal">
          <PeopleIcon size={12} />
          <span className="truncate">{event.club_name}</span>
        </span>
      )}
    </button>
  );
}

/**
 * Update 3 — the shared-post card: mobile's light surface with the POST label,
 * author identity, media and caption hierarchy. Never a teal message bubble.
 */
export function PostShareCard({
  postId,
  onOpenPost,
  onOpenProfile,
}: {
  postId: string | null;
  onOpenPost: (postId: string) => void;
  onOpenProfile?: (userId: string) => void;
}): JSX.Element {
  const { data: post, isLoading } = useQuery({
    queryKey: ["messages", "sharedPostPreview", postId],
    queryFn: () => getSharedPostPreview(postId!),
    enabled: !!postId,
    staleTime: 60_000,
  });

  if (!postId) return <CardNotice text="This post is no longer available." icon={<ImageIcon size={16} />} />;
  if (isLoading) return <CardNotice text="Loading post…" icon={<ImageIcon size={16} />} />;
  if (!post) return <CardNotice text="This post is no longer available." icon={<ImageIcon size={16} />} />;

  const authorName = post.author_username ?? "We Glue member";
  return (
    // The card is a div, not a button: the author identity inside it is its own
    // control (Update 1), and a button may not contain another button.
    <div
      className={`${CARD_CLASS} cursor-pointer`}
      style={CARD_STYLE}
      role="button"
      tabIndex={0}
      onClick={() => onOpenPost(post.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpenPost(post.id);
        }
      }}
      aria-label={`Open post by ${authorName}`}
    >
      <CardBadge label="Post" icon={<ImageIcon size={12} />} />
      <span className="mb-2 flex items-center gap-1.5">
        {post.author_id && onOpenProfile ? (
          <PersonIdentity
            userId={post.author_id}
            username={post.author_username}
            fullName={post.author_full_name}
            avatarUrl={post.author_avatar_url}
            onOpenProfile={onOpenProfile}
            size={24}
            render="username"
          />
        ) : (
          <>
            <Avatar uri={post.author_avatar_url} size={24} name={post.author_full_name ?? authorName} />
            <span className="truncate text-xs font-semibold text-gray-950">@{authorName}</span>
          </>
        )}
      </span>
      {post.image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={post.image_url} alt="" className="mb-2 aspect-[16/9] w-full rounded-[10px] object-cover" />
      ) : (
        <span className="mb-2 flex aspect-[16/9] w-full items-center justify-center rounded-[10px] bg-teal/10 text-gray-400">
          <ImageIcon size={26} />
        </span>
      )}
      {post.caption && <span className="block text-xs leading-[17px] text-gray-500 line-clamp-2"><LinkifiedText text={post.caption} /></span>}
    </div>
  );
}

/**
 * Update 1 — a person identity in messaging.
 *
 * The avatar and the name are two SEPARATE `ClickableUserIdentity` links
 * pointing at the same `/u/<id>`, so "click the picture" and "click the name"
 * can never resolve to different people. This deliberately composes the app's
 * existing canonical profile link rather than introducing a messaging-only
 * navigation handler — `ClickableUserIdentity` is a real anchor (middle-click
 * and open-in-new-tab work) and already stops propagation, which is what lets
 * an identity sit safely inside a clickable card such as the shared-post
 * preview.
 */
export function PersonIdentity({
  userId,
  username,
  fullName,
  avatarUrl,
  size = 36,
  render = "both",
  subtitle,
  className,
}: {
  userId: string;
  username: string | null;
  fullName: string | null;
  avatarUrl: string | null;
  /** Accepted for call sites that still pass it; navigation is the canonical
   *  link, so this is intentionally unused. */
  onOpenProfile?: (userId: string) => void;
  size?: number;
  /** "both" = name over @username (rosters); "username" = a single @handle. */
  render?: "both" | "username" | "name";
  subtitle?: string | null;
  className?: string;
}): JSX.Element {
  const display = fullName?.trim() || username || "We Glue member";
  return (
    <span className={`flex min-w-0 items-center gap-2 ${className ?? ""}`}>
      <ClickableUserIdentity userId={userId} ariaLabel={`Open ${display}'s profile`} className="shrink-0">
        <Avatar uri={avatarUrl} size={size} name={display} />
      </ClickableUserIdentity>
      <ClickableUserIdentity userId={userId} ariaLabel={`Open ${display}'s profile`} className="min-w-0 flex-1 block">
        {render === "username" ? (
          <span className="block truncate text-xs font-semibold text-gray-950">@{username ?? "weglue"}</span>
        ) : (
          <>
            <span className="block truncate text-sm font-semibold text-gray-900">{display}</span>
            {render === "both" && (
              <span className="block truncate text-xs text-gray-500">{subtitle ?? (username ? `@${username}` : "")}</span>
            )}
          </>
        )}
      </ClickableUserIdentity>
    </span>
  );
}

/**
 * Update 3 + Bug 3 — the chat image.
 *
 * Rendered bare with mobile's rounded treatment: no teal bubble, no coloured
 * outline. The wrapper reserves a clamped aspect-ratio box BEFORE the bytes
 * arrive, which is what stops an image whose intrinsic size is not yet known
 * from collapsing into the "tiny dot" seen in the correction screenshots.
 */
export function ChatImage({
  message,
  objectUrl,
  onOpen,
}: {
  message: ThreadMessage;
  objectUrl: string | null;
  onOpen?: () => void;
}): JSX.Element {
  const [aspect, setAspect] = useState<number | null>(null);
  const ratio = clampChatImageAspect(aspect);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="block w-full max-w-[300px] overflow-hidden rounded-2xl bg-black/5 focus:outline-none focus:ring-2 focus:ring-teal"
      style={{ aspectRatio: String(ratio) }}
      aria-label={message.attachment_name ?? "Open image"}
    >
      {objectUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={objectUrl}
          alt={message.attachment_name ?? "Shared image"}
          className="h-full w-full object-cover"
          onLoad={(event) => {
            const image = event.currentTarget;
            if (image.naturalWidth > 0 && image.naturalHeight > 0) {
              setAspect(image.naturalWidth / image.naturalHeight);
            }
          }}
        />
      ) : (
        <span className="flex h-full w-full items-center justify-center">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-teal border-t-transparent" />
        </span>
      )}
    </button>
  );
}

export function ChatVideo({ objectUrl }: { objectUrl: string | null }): JSX.Element {
  if (!objectUrl) {
    return <span className="flex aspect-video w-full max-w-[300px] items-center justify-center rounded-2xl bg-black/5"><span className="h-6 w-6 animate-spin rounded-full border-2 border-teal border-t-transparent" /></span>;
  }
  return <video controls src={objectUrl} className="w-full max-w-[300px] rounded-2xl" />;
}

/**
 * Update 3 — the file card: mobile's cream/light surface with the teal document
 * badge, the filename, and the "PDF · 92 KB" subtitle. Never a teal bubble and
 * never a bare underlined link.
 */
export function ChatFileCard({
  message,
  objectUrl,
  pending,
}: {
  message: ThreadMessage;
  objectUrl: string | null;
  pending?: boolean;
}): JSX.Element {
  const name = message.attachment_name ?? message.content ?? "File";
  const subtitle = fileSubtitle(message.attachment_name, message.attachment_mime, message.attachment_size);
  const body = (
    <>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-teal/10 text-teal">
        {pending ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-teal border-t-transparent" /> : <DocumentIcon size={20} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-bold text-gray-950">{name}</span>
        <span className="block truncate text-xs text-gray-500">{pending ? "Uploading…" : subtitle}</span>
      </span>
    </>
  );
  const shell = "flex w-full max-w-[300px] items-center gap-2.5 rounded-2xl border bg-white p-2.5 text-left shadow-[0_2px_6px_rgba(0,0,0,0.10)]";
  if (!objectUrl) return <span className={shell} style={CARD_STYLE}>{body}</span>;
  return (
    <a href={objectUrl} download={message.attachment_name ?? undefined} target="_blank" rel="noreferrer" className={`${shell} transition hover:brightness-[0.985] focus:outline-none focus:ring-2 focus:ring-teal`} style={CARD_STYLE}>
      {body}
    </a>
  );
}

/**
 * Resolves a chat attachment to a same-origin blob: URL.
 *
 * Authorization is re-checked by Storage on every fetch (see
 * `attachmentObjectUrl`), and the blob is revoked when the message unmounts or
 * the path changes. `pending` local previews are passed straight through: they
 * are already object URLs owned by the composer, so this must not revoke them.
 */
export function useAttachmentUrl(path: string | null, blocked?: boolean): string | null {
  const [url, setUrl] = useState<string | null>(null);
  const localPreview = !!path && path.startsWith("blob:");
  useEffect(() => {
    if (localPreview) {
      setUrl(path);
      return;
    }
    let alive = true;
    let created: string | null = null;
    setUrl(null);
    if (path && !blocked) {
      void attachmentObjectUrl(path)
        .then((next) => {
          if (!alive) {
            releaseAttachmentUrl(next);
            return;
          }
          created = next;
          setUrl(next);
        })
        .catch(() => {});
    }
    return () => {
      alive = false;
      releaseAttachmentUrl(created);
    };
  }, [blocked, localPreview, path]);
  return url;
}

/**
 * Bug 2 — the temporary highlight applied to a message selected from search.
 *
 * Returns a ref to attach to the message element. When the message becomes the
 * search target it is scrolled into view and highlighted, then the highlight
 * fades. Selecting the SAME result again re-triggers it, which is why the
 * caller passes a nonce rather than only the id.
 */
export function useSearchHighlight(isTarget: boolean, nonce: number): {
  ref: React.RefObject<HTMLDivElement>;
  highlighted: boolean;
} {
  const ref = useRef<HTMLDivElement>(null);
  const [highlighted, setHighlighted] = useState(false);
  useEffect(() => {
    if (!isTarget) return;
    const node = ref.current;
    if (!node) return;
    // `block: "center"` puts the match in the middle of the thread rather than
    // flush against the header, so surrounding context stays readable.
    node.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlighted(true);
    const timer = window.setTimeout(() => setHighlighted(false), 2200);
    return () => window.clearTimeout(timer);
  }, [isTarget, nonce]);
  return { ref, highlighted };
}

/** Shared by the thread and the info panel so a "Photo"/"File"/"Poll" label is
 *  never spelled two different ways. */
export function useObjectUrls(messages: ThreadMessage[]): Map<string, string> {
  const paths = useMemo(
    () => messages.map((message) => message.attachment_url).filter((path): path is string => !!path),
    [messages]
  );
  const [urls, setUrls] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    let alive = true;
    const created: string[] = [];
    void Promise.all(
      paths.map(async (path) => {
        try {
          const url = await attachmentObjectUrl(path);
          return url ? ([path, url] as const) : null;
        } catch {
          return null;
        }
      })
    ).then((entries) => {
      const resolved = entries.filter((entry): entry is readonly [string, string] => !!entry);
      resolved.forEach(([, url]) => created.push(url));
      if (!alive) {
        created.forEach(releaseAttachmentUrl);
        return;
      }
      setUrls(new Map(resolved));
    });
    return () => {
      alive = false;
      created.forEach(releaseAttachmentUrl);
    };
  }, [paths.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps
  return urls;
}
