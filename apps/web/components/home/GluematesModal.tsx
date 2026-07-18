"use client";

import { Modal } from "../shared/Modal";
import { Avatar } from "../shared/Avatar";
import { EmptyState } from "./EmptyState";
import { useOwnGluemates } from "../../lib/hooks/useOwnProfile";

// Gluemates = MUTUAL accepted follows only. The list and the count come from
// the same query, so they always agree. Clicking a Gluemate opens their profile.
export function GluematesModal({
  userId,
  onClose,
  onOpenUser,
}: {
  userId: string;
  onClose: () => void;
  onOpenUser: (userId: string) => void;
}): JSX.Element {
  const { data: gluemates, isLoading } = useOwnGluemates(userId);

  return (
    <Modal onClose={onClose} labelledBy="gluemates-title" maxWidth={480}>
      <div className="p-5 sm:p-6">
        <h2 id="gluemates-title" className="mb-4 text-center text-lg font-bold text-gray-900">
          Gluemates
        </h2>

        {isLoading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((k) => (
              <div key={k} className="flex items-center gap-3">
                <div className="h-10 w-10 animate-pulse rounded-full bg-black/5" />
                <div className="h-4 w-1/2 animate-pulse rounded bg-black/5" />
              </div>
            ))}
          </div>
        ) : !gluemates || gluemates.length === 0 ? (
          <EmptyState
            emoji="🤝"
            title="No Gluemates yet."
            subtitle="When you and someone follow each other, they'll appear here."
          />
        ) : (
          <div className="space-y-1">
            {gluemates.map((mate) => (
              <button
                key={mate.user_id}
                type="button"
                onClick={() => onOpenUser(mate.user_id)}
                className="flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-gray-50"
              >
                <Avatar uri={mate.avatar_url} size={40} name={mate.username} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-gray-900">{mate.full_name}</p>
                  <p className="truncate text-xs text-gray-400">@{mate.username}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
