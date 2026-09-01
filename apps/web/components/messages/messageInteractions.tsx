"use client";

/**
 * Web messaging — reactions, grouped media and the full-screen lightbox.
 *
 * The interaction model is transcribed from the mobile source of truth
 * (`apps/mobile/components/chat/{ReactionPicker,MessageBubble,MediaViewer}.tsx`):
 *
 *  • long-press on mobile → hover (or the ⋯ menu) on web reveals the quick
 *    reaction row ❤️ 👍 😂 😮 🎉 and a "+" that opens the full picker (👎 lives
 *    only there, per the product decision).
 *  • a reaction is add / change / remove of the viewer's own single reaction.
 *  • chips under the bubble show each emoji with its count; clicking a chip
 *    toggles the viewer's reaction, clicking the count opens "who reacted".
 *  • 1..5 photos render as ONE grouped media block with the mobile layouts;
 *    clicking any photo opens the lightbox at that photo with swipe / arrows.
 *
 * There are deliberately NO reaction notifications (Item 6) — this file never
 * touches the notification pipeline.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import EmojiPicker, { EmojiStyle, Theme, type EmojiClickData } from "emoji-picker-react";
import { QUICK_REACTIONS } from "@weglue/shared";
import { Avatar } from "../shared/Avatar";
import { CloseIcon } from "../shared/icons";
import {
  attachmentObjectUrl,
  getMessageReactors,
  releaseAttachmentUrl,
  type MessageAttachment,
  type MessageReactionSummary,
} from "../../lib/messages/service";

// ─── Signed-URL resolution for grouped attachments ──────────────────────────

/**
 * Resolves a list of private storage paths to same-origin blob: URLs, keyed by
 * path. Every blob is revoked when the paths change or the component unmounts.
 * `blob:` previews (a local optimistic send) are passed straight through.
 */
export function useAttachmentUrls(paths: string[], blocked?: boolean): Map<string, string> {
  const key = paths.join("|");
  const [urls, setUrls] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    if (blocked) {
      setUrls(new Map());
      return;
    }
    let alive = true;
    const created: string[] = [];
    const list = key ? key.split("|") : [];
    void Promise.all(
      list.map(async (path) => {
        if (path.startsWith("blob:")) return [path, path] as const;
        try {
          const url = await attachmentObjectUrl(path);
          return url ? ([path, url] as const) : null;
        } catch {
          return null;
        }
      }),
    ).then((entries) => {
      const resolved = entries.filter((e): e is readonly [string, string] => !!e);
      resolved.forEach(([p, u]) => {
        if (!p.startsWith("blob:")) created.push(u);
      });
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
  }, [key, blocked]);
  return urls;
}

// ─── Quick reaction row + full picker ──────────────────────────────────────

/**
 * The hover strip. Tapping an emoji sets it; tapping the one already chosen
 * removes it (the parent decides — `onReact` is passed the raw emoji). `+`
 * opens the full picker.
 */
export function QuickReactionRow({
  current,
  onReact,
  onMore,
}: {
  current: string | null;
  onReact: (emoji: string) => void;
  onMore: () => void;
}): JSX.Element {
  return (
    <div
      className="flex items-center gap-0.5 rounded-full border bg-white px-1 py-0.5 shadow-[0_3px_10px_rgba(0,0,0,0.16)]"
      style={{ borderColor: "rgba(0,0,0,0.08)" }}
      role="group"
      aria-label="React to message"
    >
      {QUICK_REACTIONS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          onClick={() => onReact(emoji)}
          aria-label={`React ${emoji}`}
          aria-pressed={current === emoji}
          className={`flex h-7 w-7 items-center justify-center rounded-full text-base leading-none transition hover:scale-110 ${
            current === emoji ? "bg-teal/15" : ""
          }`}
        >
          {emoji}
        </button>
      ))}
      <button
        type="button"
        onClick={onMore}
        aria-label="More reactions"
        className="flex h-7 w-7 items-center justify-center rounded-full text-gray-500 hover:bg-black/5"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
    </div>
  );
}

/**
 * The full emoji picker — the real thing, WhatsApp-style: a bottom sheet with a
 * search bar, "Frequently used", every category and a category bar. Backed by
 * `emoji-picker-react` (native emoji, so it matches the rest of the product).
 * Any emoji is a valid reaction (👎 included). Rendered as a fixed sheet so the
 * thread's scroll container never clips it.
 */
export function EmojiPickerPopover({
  onPick,
  onClose,
}: {
  current?: string | null;
  onPick: (emoji: string) => void;
  onClose: () => void;
}): JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center bg-black/40 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Choose a reaction"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm overflow-hidden rounded-t-2xl shadow-[0_-8px_40px_rgba(0,0,0,0.35)] sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <EmojiPicker
          onEmojiClick={(data: EmojiClickData) => onPick(data.emoji)}
          theme={Theme.DARK}
          emojiStyle={EmojiStyle.NATIVE}
          lazyLoadEmojis
          skinTonesDisabled
          previewConfig={{ showPreview: false }}
          width="100%"
          height={420}
        />
      </div>
    </div>
  );
}

// ─── Reaction chips + who-reacted ──────────────────────────────────────────

export function ReactionChips({
  messageId,
  reactions,
  align,
  currentUserId,
  onRemoveOwn,
}: {
  messageId: string;
  reactions: MessageReactionSummary[];
  align: "start" | "end";
  currentUserId?: string;
  /** Remove the viewer's own reaction (invoked from the reactors sheet). */
  onRemoveOwn?: () => void;
}): JSX.Element | null {
  const [reactorsOpen, setReactorsOpen] = useState(false);
  if (!reactions.length) return null;
  return (
    <div className={`mt-1 flex flex-wrap gap-1 ${align === "end" ? "justify-end" : "justify-start"}`}>
      {reactions.map((reaction) => (
        <button
          key={reaction.emoji}
          type="button"
          onClick={() => setReactorsOpen(true)}
          aria-label={`${reaction.emoji} ${reaction.count}${reaction.reactedByMe ? ", including you" : ""} — see who reacted`}
          className={`flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] leading-none transition ${
            reaction.reactedByMe ? "border-teal/40 bg-teal/15 text-teal" : "border-black/10 bg-white text-gray-500 hover:bg-black/[0.03]"
          }`}
        >
          <span className="text-xs">{reaction.emoji}</span>
          {reaction.count > 1 && <span className="font-semibold">{reaction.count}</span>}
        </button>
      ))}
      {reactorsOpen && (
        <ReactorsSheet
          messageId={messageId}
          currentUserId={currentUserId}
          onRemoveOwn={onRemoveOwn}
          onClose={() => setReactorsOpen(false)}
        />
      )}
    </div>
  );
}

/**
 * "Who reacted with what" — WhatsApp-style bottom sheet: an "All" tab plus one
 * tab per emoji (emoji + count), and a list of every reactor showing the emoji
 * they used. Tapping your own row removes your reaction.
 */
function ReactorsSheet({
  messageId,
  currentUserId,
  onRemoveOwn,
  onClose,
}: {
  messageId: string;
  currentUserId?: string;
  onRemoveOwn?: () => void;
  onClose: () => void;
}): JSX.Element {
  const [filter, setFilter] = useState<string | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["messages", "reactors", messageId],
    queryFn: () => getMessageReactors(messageId),
    staleTime: 5_000,
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const reactors = data ?? [];
  const total = reactors.length;
  const tabs = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of reactors) counts.set(r.emoji, (counts.get(r.emoji) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [reactors]);
  const shown = reactors.filter((r) => !filter || r.emoji === filter);

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="People who reacted"
      onClick={onClose}
    >
      <div
        className="max-h-[70vh] w-full max-w-sm overflow-hidden rounded-t-2xl bg-white shadow-[0_-8px_40px_rgba(0,0,0,0.35)] sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: "rgba(0,0,0,0.06)" }}>
          <span className="text-sm font-semibold text-gray-900">
            {total} {total === 1 ? "Reaction" : "Reactions"}
          </span>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-1 text-gray-500 hover:bg-black/5">
            <CloseIcon size={16} />
          </button>
        </div>

        {tabs.length > 1 && (
          <div className="flex gap-2 overflow-x-auto px-4 py-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <button
              type="button"
              onClick={() => setFilter(null)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                filter === null ? "bg-teal/15 text-teal" : "bg-black/[0.04] text-gray-500"
              }`}
            >
              All {total}
            </button>
            {tabs.map(([emoji, count]) => (
              <button
                key={emoji}
                type="button"
                onClick={() => setFilter(emoji)}
                className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                  filter === emoji ? "bg-teal/15 text-teal" : "bg-black/[0.04] text-gray-500"
                }`}
              >
                <span className="text-sm">{emoji}</span>
                {count}
              </button>
            ))}
          </div>
        )}

        <div className="max-h-[46vh] overflow-y-auto px-2 py-1.5">
          {isLoading ? (
            <p className="px-2 py-6 text-center text-xs text-gray-400">Loading…</p>
          ) : shown.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-gray-400">No reactions</p>
          ) : (
            shown.map((reactor, i) => {
              const isMe = !!currentUserId && reactor.userId === currentUserId;
              return (
                <button
                  key={`${reactor.userId}:${reactor.emoji}:${i}`}
                  type="button"
                  disabled={!isMe || !onRemoveOwn}
                  onClick={() => {
                    if (isMe && onRemoveOwn) {
                      onRemoveOwn();
                      onClose();
                    }
                  }}
                  className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left enabled:hover:bg-black/[0.03]"
                >
                  <Avatar uri={reactor.avatarUrl} size={36} name={reactor.displayName} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-gray-900">
                      {isMe ? "You" : reactor.displayName}
                    </span>
                    {isMe && onRemoveOwn && <span className="block text-xs text-gray-400">Tap to remove</span>}
                  </span>
                  <span className="text-lg">{reactor.emoji}</span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Grouped media (1..5) ─────────────────────────────────────────────────

const TILE = "block h-full w-full bg-cover bg-center bg-gray-200";

/**
 * 1..5 images as one rounded block. Layout adapts to the count, matching
 * mobile's `GroupedMedia`. A single image keeps its natural aspect; 2+ use
 * fixed geometry so the block never reflows once the bytes land.
 */
export function GroupedMedia({
  attachments,
  urls,
  onOpen,
}: {
  attachments: MessageAttachment[];
  urls: Map<string, string>;
  onOpen: (index: number) => void;
}): JSX.Element {
  const images = attachments.filter((a) => a.kind === "image");
  const n = images.length;

  const Tile = ({ i, className }: { i: number; className: string }): JSX.Element => {
    const url = urls.get(images[i]!.storage_path);
    return (
      <button
        type="button"
        onClick={() => onOpen(i)}
        aria-label={`Open photo ${i + 1} of ${n}`}
        className={`relative overflow-hidden ${className}`}
      >
        {url ? (
          <span className={TILE} style={{ backgroundImage: `url(${url})` }} role="img" aria-label="" />
        ) : (
          <span className="flex h-full w-full items-center justify-center bg-black/5">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-teal border-t-transparent" />
          </span>
        )}
      </button>
    );
  };

  if (n === 1) {
    return (
      <div className="max-w-[300px] overflow-hidden rounded-2xl">
        <div className="aspect-[4/5] w-[300px] max-w-full">
          <Tile i={0} className="h-full w-full" />
        </div>
      </div>
    );
  }

  const box = "grid w-[300px] max-w-full gap-0.5 overflow-hidden rounded-2xl";
  if (n === 2) {
    return (
      <div className={`${box} aspect-[2/1] grid-cols-2`}>
        <Tile i={0} className="h-full w-full" />
        <Tile i={1} className="h-full w-full" />
      </div>
    );
  }
  if (n === 3) {
    return (
      <div className={`${box} aspect-square grid-cols-3 grid-rows-2`}>
        <Tile i={0} className="col-span-2 row-span-2 h-full w-full" />
        <Tile i={1} className="h-full w-full" />
        <Tile i={2} className="h-full w-full" />
      </div>
    );
  }
  if (n === 4) {
    return (
      <div className={`${box} aspect-square grid-cols-2 grid-rows-2`}>
        {[0, 1, 2, 3].map((i) => (
          <Tile key={i} i={i} className="h-full w-full" />
        ))}
      </div>
    );
  }
  // 5 — one wide on top, 2×2 below
  return (
    <div className={`${box} aspect-[4/5] grid-cols-2 grid-rows-3`}>
      <Tile i={0} className="col-span-2 h-full w-full" />
      <Tile i={1} className="h-full w-full" />
      <Tile i={2} className="h-full w-full" />
      <Tile i={3} className="h-full w-full" />
      <Tile i={4} className="h-full w-full" />
    </div>
  );
}

// ─── Full-screen lightbox ─────────────────────────────────────────────────

export interface LightboxItem {
  url: string | null;
  kind: "image" | "video";
  senderName?: string;
}

export function MediaLightbox({
  items,
  index,
  onIndex,
  onClose,
}: {
  items: LightboxItem[];
  index: number;
  onIndex: (next: number) => void;
  onClose: () => void;
}): JSX.Element | null {
  const touchStart = useRef<number | null>(null);
  const go = useCallback(
    (delta: number) => {
      const next = index + delta;
      if (next >= 0 && next < items.length) onIndex(next);
    },
    [index, items.length, onIndex],
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [go, onClose]);

  const current = items[index];
  if (!current) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90"
      role="dialog"
      aria-modal="true"
      aria-label="Media viewer"
      onClick={onClose}
      onTouchStart={(e) => {
        touchStart.current = e.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(e) => {
        if (touchStart.current == null) return;
        const dx = (e.changedTouches[0]?.clientX ?? 0) - touchStart.current;
        if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
        touchStart.current = null;
      }}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
      >
        <CloseIcon size={22} />
      </button>
      {items.length > 1 && (
        <span className="absolute top-5 left-1/2 -translate-x-1/2 text-sm font-medium text-white/80">
          {index + 1} / {items.length}
        </span>
      )}
      {index > 0 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            go(-1);
          }}
          aria-label="Previous"
          className="absolute left-3 rounded-full bg-white/10 p-3 text-2xl text-white hover:bg-white/20"
        >
          ‹
        </button>
      )}
      {index < items.length - 1 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            go(1);
          }}
          aria-label="Next"
          className="absolute right-3 rounded-full bg-white/10 p-3 text-2xl text-white hover:bg-white/20"
        >
          ›
        </button>
      )}
      <div className="max-h-[90vh] max-w-[92vw]" onClick={(e) => e.stopPropagation()}>
        {current.url == null ? (
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-white border-t-transparent" />
        ) : current.kind === "video" ? (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video src={current.url} controls autoPlay className="max-h-[90vh] max-w-[92vw] rounded-lg" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={current.url} alt={current.senderName ? `Photo from ${current.senderName}` : "Photo"} className="max-h-[90vh] max-w-[92vw] rounded-lg object-contain" />
        )}
      </div>
    </div>
  );
}

// ─── Multi-photo composer tray ────────────────────────────────────────────

/**
 * The preview tray shown after Photos are picked in the composer's "+" menu.
 * Instagram-style: a strip of numbered thumbnails, each removable and
 * re-orderable, an "add more" tile up to 5, and a Send button. Order is
 * preserved on send.
 */
export function PhotoTray({
  files,
  onChange,
  onAddMore,
  onSend,
  onCancel,
  sending,
}: {
  files: File[];
  onChange: (next: File[]) => void;
  onAddMore: () => void;
  onSend: () => void;
  onCancel: () => void;
  sending: boolean;
}): JSX.Element {
  const previews = useMemo(() => files.map((f) => ({ f, url: URL.createObjectURL(f) })), [files]);
  useEffect(() => () => previews.forEach((p) => URL.revokeObjectURL(p.url)), [previews]);

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= files.length) return;
    const next = files.slice();
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };

  return (
    <div className="border-t bg-[#fffdf4] px-5 py-3" style={{ borderColor: "rgba(0,0,0,0.16)" }}>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-600">{files.length} photo{files.length === 1 ? "" : "s"}</span>
        <button type="button" onClick={onCancel} aria-label="Discard photos" className="rounded-full p-1 text-gray-500 hover:bg-black/5">
          <CloseIcon size={16} />
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {previews.map((p, i) => (
          <div key={p.url} className="relative h-20 w-20 overflow-hidden rounded-lg">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.url} alt="" className="h-full w-full object-cover" />
            <span className="absolute left-1 top-1 rounded-full bg-black/60 px-1.5 text-[10px] font-bold text-white">{i + 1}</span>
            <button
              type="button"
              onClick={() => onChange(files.filter((_, idx) => idx !== i))}
              aria-label={`Remove photo ${i + 1}`}
              className="absolute right-0.5 top-0.5 rounded-full bg-black/70 p-0.5 text-white"
            >
              <CloseIcon size={11} />
            </button>
            <span className="absolute inset-x-0.5 bottom-0.5 flex justify-between">
              <button type="button" disabled={i === 0} onClick={() => move(i, -1)} className="rounded bg-black/55 px-1 text-[11px] text-white disabled:opacity-30">‹</button>
              <button type="button" disabled={i === files.length - 1} onClick={() => move(i, 1)} className="rounded bg-black/55 px-1 text-[11px] text-white disabled:opacity-30">›</button>
            </span>
          </div>
        ))}
        {files.length < 5 && (
          <button
            type="button"
            onClick={onAddMore}
            aria-label="Add more photos"
            className="flex h-20 w-20 items-center justify-center rounded-lg border-2 border-dashed text-2xl"
            style={{ borderColor: "#0FA6A6", color: "#0FA6A6" }}
          >
            +
          </button>
        )}
      </div>
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={onSend}
          disabled={sending || files.length === 0}
          className="rounded-full bg-teal px-5 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          {sending ? "Sending…" : `Send ${files.length} photo${files.length === 1 ? "" : "s"}`}
        </button>
      </div>
    </div>
  );
}
