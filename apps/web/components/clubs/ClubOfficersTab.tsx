"use client";

import { Avatar } from "../shared/Avatar";
import type { ClubOfficer } from "../../lib/clubs/clubProfileService";

// Officers tab (spec §18): real officers of the club — avatar, role title, name,
// and a Message action (hidden on your own row; self is decided by user id, never
// by display name which can change). Two-up grid on desktop.
export function ClubOfficersTab({
  officers,
  currentUserId,
  canManage,
  onManage,
  onOpenProfile,
  onMessage,
}: {
  officers: ClubOfficer[];
  currentUserId: string;
  canManage: boolean;
  onManage: () => void;
  onOpenProfile: (userId: string) => void;
  onMessage: (userId: string) => void;
}): JSX.Element {
  return (
    <div className="mt-6">
      {canManage && (
        <div className="mb-5 flex justify-end">
          <button
            type="button"
            onClick={onManage}
            className="rounded-full bg-teal px-5 py-2 text-sm font-semibold text-white transition hover:opacity-90"
          >
            Manage members
          </button>
        </div>
      )}
      {officers.length === 0 ? (
        <p className="mt-4 text-center text-sm text-gray-500">No officers listed yet.</p>
      ) : (
        <div className="grid grid-cols-1 gap-x-10 gap-y-6 sm:grid-cols-2">
          {officers.map((officer) => {
        const isSelf = !!officer.user_id && officer.user_id === currentUserId;
        return (
          <div key={officer.id} className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => officer.user_id && onOpenProfile(officer.user_id)}
              disabled={!officer.user_id}
              aria-label={`Open ${officer.display_name}'s profile`}
            >
              <Avatar uri={officer.avatar_url} size={64} name={officer.display_name} />
            </button>
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-semibold italic text-teal">{officer.role_title}</p>
              <p className="truncate text-[16px] font-bold text-gray-900">{officer.display_name}</p>
            </div>
            {!isSelf && officer.user_id && (
              <button
                type="button"
                onClick={() => onMessage(officer.user_id!)}
                className="rounded-full border-[1.5px] bg-transparent px-5 py-1.5 text-[14px] font-semibold text-teal transition hover:bg-teal/5"
                style={{ borderColor: "#0FA6A6" }}
              >
                Message
              </button>
            )}
          </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
