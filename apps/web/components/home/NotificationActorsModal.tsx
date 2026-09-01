"use client";

import { useQuery } from "@tanstack/react-query";
import { Modal } from "../shared/Modal";
import { Avatar } from "../shared/Avatar";
import { ClickableUserIdentity } from "../shared/ClickableIdentity";
import { EmptyState } from "./EmptyState";
import { getNotificationActors } from "../../lib/hooks/useNotifications";

/**
 * The list behind a grouped "Eric and 7 others joined We Glue" notification.
 * Every student in the group; each row links to that student's profile.
 * Sits above the Notifications overlay so closing it returns there.
 */
export function NotificationActorsModal({
  notificationId,
  onClose,
}: {
  notificationId: string;
  onClose: () => void;
}): JSX.Element {
  const { data: actors, isLoading } = useQuery({
    queryKey: ["notificationActors", notificationId],
    queryFn: () => getNotificationActors(notificationId),
    enabled: !!notificationId,
  });

  return (
    <Modal onClose={onClose} labelledBy="notif-actors-title" maxWidth={480}>
      <div className="flex items-center justify-between px-5 pt-5 sm:px-6">
        <h2 id="notif-actors-title" className="text-lg font-bold text-gray-900">
          Everyone
        </h2>
      </div>
      <div className="max-h-[70vh] overflow-y-auto px-2 pb-4 pt-2 sm:px-3">
        {isLoading ? (
          <div className="space-y-3 p-3">
            {[0, 1, 2, 3].map((k) => (
              <div key={k} className="flex items-center gap-3">
                <div className="h-11 w-11 shrink-0 animate-pulse rounded-full bg-black/5" />
                <div className="h-3 w-1/2 flex-1 animate-pulse rounded bg-black/5" />
              </div>
            ))}
          </div>
        ) : !actors || actors.length === 0 ? (
          <EmptyState emoji="🫥" title="No one to show." />
        ) : (
          actors.map((a) => (
            <ClickableUserIdentity
              key={a.id}
              userId={a.id}
              ariaLabel={`Open ${a.username}'s profile`}
              className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-black/[0.03]"
            >
              <Avatar uri={a.avatarUrl} size={44} name={a.username} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-bold text-gray-900">{a.username}</span>
                {a.displayName && a.displayName !== a.username ? (
                  <span className="block truncate text-[13px] text-gray-500">{a.displayName}</span>
                ) : null}
              </span>
            </ClickableUserIdentity>
          ))
        )}
      </div>
    </Modal>
  );
}
