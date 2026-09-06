"use client";

/**
 * The single canonical foreground notification presentation on web
 * (correction 3) — an in-DOM banner driven by the realtime INSERT stream
 * already open in Providers' SessionRealtimeHub (via bannerBus, no second
 * subscription). No browser Notification permission, no service worker, no
 * web push. At most one banner per notification id (session-lived dedup
 * Set), never for the actor's own action, never while the exact destination
 * is already open.
 */
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  subscribeNotificationInsert,
  type BannerNotificationRow,
} from "../../lib/notifications/bannerBus";
import {
  resolveNotificationTarget,
  useMarkNotificationRead,
  type AppNotification,
  type NotificationTarget,
} from "../../lib/hooks/useNotifications";
import { messagesHref } from "../../lib/messages/routes";

const AUTO_DISMISS_MS = 4500;
const SHOWN_IDS_CAP = 200;

function targetHref(target: NotificationTarget): string | null {
  switch (target.kind) {
    case "event": return `/event/${target.id}`;
    case "post": return target.commentId
      ? `/home?comments=${target.id}&commentFocus=${target.commentId}`
      : `/post/${target.id}`;
    case "user": return `/u/${target.id}`;
    case "club": return `/club/${target.id}`;
    case "chat": return messagesHref({ conversationId: target.id, channelId: target.channelId });
    case "notification-actors": return `/home?notifications=1&notifActors=${target.id}`;
    case "notifications": return "/home?notifications=1";
    default: return null;
  }
}

export function ForegroundNotificationBanner({ userId }: { userId: string | undefined }): JSX.Element | null {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { mutate: markRead } = useMarkNotificationRead(userId);

  const [current, setCurrent] = useState<BannerNotificationRow | null>(null);
  const shownIds = useRef<Set<string>>(new Set());
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Live-read inside the subscription callback without re-subscribing on
  // every navigation (this hub mounts once for the whole session).
  const locationRef = useRef({ pathname, searchParams });
  locationRef.current = { pathname, searchParams };

  const hide = () => {
    if (dismissTimer.current) {
      clearTimeout(dismissTimer.current);
      dismissTimer.current = null;
    }
    setCurrent(null);
  };

  useEffect(() => {
    const unsubscribe = subscribeNotificationInsert((row) => {
      // Never notify the actor about their own action — defensive; the
      // domain triggers already never insert this row shape.
      if (row.actor_id && row.actor_id === row.user_id) return;
      if (!userId || row.user_id !== userId) return;

      // Dedup by notification id: at most one banner per event, even under a
      // realtime reconnect replay.
      if (shownIds.current.has(row.id)) return;

      const target = resolveNotificationTarget({ route: row.route } as AppNotification);
      const { pathname: path, searchParams: params } = locationRef.current;

      // Exact-destination suppression, mirroring mobile's four buckets:
      // conversation, exact post, exact event, or the directly relevant
      // active Home surface (everything else, while Home is open).
      const destinationOpen = (() => {
        if (!target) return path === "/home";
        if (target.kind === "post") {
          return path === `/post/${target.id}` || params.get("post") === target.id;
        }
        if (target.kind === "event") {
          return path === `/event/${target.id}` || params.get("event") === target.id;
        }
        if (target.kind === "chat") {
          return (
            path === "/messages" &&
            params.get("conversation") === target.id &&
            (!target.channelId || params.get("channel") === target.channelId)
          );
        }
        // user, club, notifications: no dedicated detail-screen suppression
        // requested — fall back to the Home-surface bucket.
        return path === "/home";
      })();
      if (destinationOpen) return;

      shownIds.current.add(row.id);
      if (shownIds.current.size > SHOWN_IDS_CAP) {
        const oldest = shownIds.current.values().next().value;
        if (oldest) shownIds.current.delete(oldest);
      }

      setCurrent(row);
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
      dismissTimer.current = setTimeout(hide, AUTO_DISMISS_MS);
    });
    return unsubscribe;
  }, [userId]);

  if (!current) return null;

  const handleClick = () => {
    const target = resolveNotificationTarget({ route: current.route } as AppNotification);
    const href = target ? targetHref(target) : null;
    hide();
    if (href) router.push(href);
    markRead(current.id);
  };

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-4 z-[300] flex justify-center px-4"
    >
      <button
        type="button"
        onClick={handleClick}
        className="pointer-events-auto flex max-w-md items-center gap-2.5 rounded-2xl px-4 py-3 text-left shadow-lg transition hover:brightness-110"
        style={{ background: "#1A1A1A" }}
      >
        <span
          aria-hidden
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
          style={{ background: "rgba(15,166,166,0.15)" }}
        >
          <span style={{ color: "#0FA6A6" }}>●</span>
        </span>
        <span className="text-sm font-semibold text-white">
          {current.message ?? "You have a new notification."}
        </span>
      </button>
    </div>
  );
}
