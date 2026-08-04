"use client";

import { Modal } from "../shared/Modal";
import { Avatar } from "../shared/Avatar";
import { EmptyState } from "./EmptyState";
import { useToast } from "../shared/Toast";
import { timeAgo } from "../../lib/datetime";
import {
  useNotifications,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useAcceptFollowRequest,
  useDeclineFollowRequest,
  useFollowBack,
  notificationDescription,
  resolveNotificationTarget,
  type AppNotification,
  type NotificationTarget,
} from "../../lib/hooks/useNotifications";
import { resolveNotificationVisual } from "@weglue/shared";

// Desktop adaptation of apps/mobile/app/home/notifications.tsx as a URL-driven
// overlay (?notifications=1). Real records, same grouping, same read semantics
// (open a row marks that row; "Mark all as read" marks all), same follow
// actions. Clicking a row resolves to its exact destination via onOpenTarget.
export function NotificationsModal({
  userId,
  username,
  onClose,
  onOpenTarget,
}: {
  userId: string;
  username?: string;
  onClose: () => void;
  onOpenTarget: (target: NotificationTarget) => void;
}): JSX.Element {
  const show = useToast();
  const { data: sections, isLoading } = useNotifications(userId);
  const { mutate: markAll } = useMarkAllNotificationsRead(userId);
  const { mutate: markOne } = useMarkNotificationRead(userId);
  const { mutate: accept } = useAcceptFollowRequest(userId);
  const { mutate: decline } = useDeclineFollowRequest(userId);
  const { mutate: followBack } = useFollowBack(userId);

  const hasUnread = (sections ?? []).some((s) => s.data.some((n) => !n.is_read));

  const open = (item: AppNotification) => {
    const target = resolveNotificationTarget(item);
    if (!item.is_read) markOne(item.id);
    if (target) onOpenTarget(target);
  };

  return (
    <Modal onClose={onClose} labelledBy="notifications-title" maxWidth={560}>
      <div className="flex items-center justify-between px-5 pt-5 sm:px-6">
        <h2 id="notifications-title" className="text-lg font-bold text-gray-900">
          {username ?? "Notifications"}
        </h2>
        {hasUnread && (
          <button
            type="button"
            onClick={() => markAll()}
            className="mr-8 text-[13px] font-semibold"
            style={{ color: "#0FA6A6" }}
          >
            Mark all as read
          </button>
        )}
      </div>

      <div className="max-h-[70vh] overflow-y-auto px-2 pb-4 pt-2 sm:px-3">
        {isLoading ? (
          <div className="space-y-3 p-3">
            {[0, 1, 2].map((k) => (
              <div key={k} className="flex items-center gap-3">
                <div className="h-11 w-11 shrink-0 animate-pulse rounded-full bg-black/5" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 w-2/3 animate-pulse rounded bg-black/5" />
                  <div className="h-3 w-1/3 animate-pulse rounded bg-black/5" />
                </div>
              </div>
            ))}
          </div>
        ) : !sections || sections.length === 0 ? (
          <EmptyState emoji="✅" title="You're all caught up!" />
        ) : (
          sections.map((section) => (
            <div key={section.group}>
              <p className="px-3 pb-1 pt-3 text-[15px] font-bold text-gray-900 font-zain">
                {section.group}
              </p>
              {section.data.map((item) => (
                <NotificationRow
                  key={item.id}
                  item={item}
                  onOpen={() => open(item)}
                  onAccept={() =>
                    item.sender && accept(item.sender.id, {
                      onSuccess: () => show("Request accepted! 🎉"),
                      onError: () => show("Failed to accept.", "error"),
                    })
                  }
                  onDecline={() =>
                    item.sender && decline(item.sender.id, {
                      onSuccess: () => show("Request declined."),
                      onError: () => show("Failed to decline.", "error"),
                    })
                  }
                  onFollowBack={() =>
                    item.sender && followBack(item.sender.id, {
                      onSuccess: () => show("Following back! 🎉"),
                      onError: () => show("Failed to follow.", "error"),
                    })
                  }
                />
              ))}
            </div>
          ))
        )}
      </div>
    </Modal>
  );
}

function NotificationRow({
  item,
  onOpen,
  onAccept,
  onDecline,
  onFollowBack,
}: {
  item: AppNotification;
  onOpen: () => void;
  onAccept: () => void;
  onDecline: () => void;
  onFollowBack: () => void;
}): JSX.Element {
  const isFollowRequest = item.type === "follow_request";
  const isFollowType = item.type === "new_follower" || item.type === "follow_accepted";
  const showFollowBack = isFollowType && item.actor_follow_state === "not_following";
  const showRequested = isFollowType && item.actor_follow_state === "pending";

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left hover:bg-black/[0.03]"
      style={{ background: item.is_read ? "transparent" : "rgba(15,166,166,0.06)" }}
    >
      <NotificationVisual visual={item.visual ?? resolveNotificationVisual({ type: item.type, group_count: item.group_count, actor: item.sender, actors: item.actors, entity: item.entity })} />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-gray-900">
          {item.message ? (
            item.message
          ) : (
            <>
              <span className="font-bold">{item.sender?.username ?? "Someone"}</span>{" "}
              {notificationDescription(item)}
            </>
          )}
        </p>
        <p className="mt-0.5 text-xs text-gray-400">{timeAgo(item.created_at)}</p>
      </div>

      {isFollowRequest && item.sender && (
        <span className="flex shrink-0 items-center gap-2" onClick={(e) => e.stopPropagation()}>
          <span
            role="button"
            tabIndex={0}
            onClick={onAccept}
            onKeyDown={(e) => e.key === "Enter" && onAccept()}
            className="rounded-full px-4 py-1.5 text-[13px] font-semibold text-white"
            style={{ background: "#0FA6A6" }}
          >
            Accept
          </span>
          <span
            role="button"
            tabIndex={0}
            onClick={onDecline}
            onKeyDown={(e) => e.key === "Enter" && onDecline()}
            className="rounded-full border-[1.5px] px-3.5 py-1.5 text-[13px] font-semibold"
            style={{ borderColor: "#0FA6A6", color: "#0FA6A6" }}
          >
            Decline
          </span>
        </span>
      )}

      {showFollowBack && item.sender && (
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            onFollowBack();
          }}
          onKeyDown={(e) => e.key === "Enter" && onFollowBack()}
          className="shrink-0 rounded-full px-4 py-1.5 text-[13px] font-semibold text-white"
          style={{ background: "#0FA6A6" }}
        >
          Follow back
        </span>
      )}

      {showRequested && (
        <span
          className="shrink-0 rounded-full border-[1.5px] px-3.5 py-1.5 text-[13px] font-semibold"
          style={{ borderColor: "#0FA6A6", color: "#0FA6A6" }}
        >
          Requested
        </span>
      )}
    </button>
  );
}

function NotificationVisual({ visual }: { visual: ReturnType<typeof resolveNotificationVisual> }): JSX.Element {
  if (visual.kind === "actors") return <span className="flex h-[46px] w-[58px] shrink-0 items-center pl-1"><span className="flex -space-x-3">{visual.actors.map((actor) => <Avatar key={actor.id} uri={actor.avatar_url} size={38} name={actor.username} />)}</span></span>;
  if (visual.kind === "actor") return <Avatar uri={visual.actor.avatar_url} size={46} name={visual.actor.username} />;
  if (visual.kind === "entity") return <Avatar uri={visual.entity.avatar_url} size={46} name={visual.entity.name} />;
  if (visual.kind === "system") return <span className="flex h-[46px] w-[46px] items-center justify-center rounded-full bg-[#0FA6A6] text-xl text-white">W</span>;
  return <span className="flex h-[46px] w-[46px] items-center justify-center rounded-full bg-gray-200 text-xl text-gray-500">•••</span>;
}
