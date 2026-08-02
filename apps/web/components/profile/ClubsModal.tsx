"use client";

import { Modal } from "../shared/Modal";
import { Avatar } from "../shared/Avatar";
import { EmptyState } from "../home/EmptyState";
import { useOwnClubs } from "../../lib/hooks/useOwnProfile";

// "Your Clubs" — the desktop equivalent of the sheet the mobile profile opens
// when the Clubs stat is tapped (apps/mobile/app/profile/own.tsx). Same source
// (`club_members` joined to `clubs`), same rows (club name + membership role),
// and selecting one opens that club. The count on the profile and this list
// come from the same membership data, so they always agree.
export function ClubsModal({
  userId,
  onClose,
  onOpenClub,
}: {
  userId: string;
  onClose: () => void;
  onOpenClub: (clubId: string) => void;
}): JSX.Element {
  const { data: clubs, isLoading, isError } = useOwnClubs(userId);

  return (
    <Modal onClose={onClose} labelledBy="clubs-title" maxWidth={480}>
      <div className="p-5 sm:p-6">
        <h2 id="clubs-title" className="mb-4 text-center text-lg font-bold text-gray-900">
          Your Clubs
        </h2>

        <div className="max-h-[60vh] overflow-y-auto">
          {isLoading ? (
            <div className="space-y-3" aria-live="polite" aria-busy>
              <span className="sr-only">Loading your clubs…</span>
              {[0, 1, 2].map((k) => (
                <div key={k} className="flex items-center gap-3">
                  <div className="h-10 w-10 animate-pulse rounded-full bg-black/5" />
                  <div className="h-4 w-1/2 animate-pulse rounded bg-black/5" />
                </div>
              ))}
            </div>
          ) : isError ? (
            <p role="alert" className="py-8 text-center text-sm text-[#F02719]">
              We couldn&apos;t load your clubs. Please try again.
            </p>
          ) : !clubs || clubs.length === 0 ? (
            <EmptyState
              emoji="🎓"
              title="No clubs yet."
              subtitle="Clubs you join will appear here."
            />
          ) : (
            <ul className="space-y-1">
              {clubs.map((club) => (
                <li key={club.club_id}>
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenClub(club.club_id);
                    }}
                    className="flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal"
                  >
                    <Avatar uri={club.avatar_url} size={40} name={club.club_name} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-gray-900">
                        {club.club_name}
                      </span>
                      <span className="block truncate text-xs capitalize text-gray-400">
                        {club.role}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
}
