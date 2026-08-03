"use client";

import { Modal } from "../shared/Modal";
import { Avatar } from "../shared/Avatar";
import { ClickableUserIdentity } from "../shared/ClickableIdentity";
import { useEventAttendees } from "../../lib/hooks/useEventAttendees";

export function AttendanceListModal({ eventId, onClose }: { eventId: string; onClose: () => void }): JSX.Element {
  const { data: attendees, isLoading, isError } = useEventAttendees(eventId);
  return (
    <Modal onClose={onClose} labelledBy="attendance-title" maxWidth={460}>
      <div className="p-5 sm:p-6">
        <h2 id="attendance-title" className="pr-8 text-xl font-bold text-gray-900">Who&apos;s going</h2>
        {isLoading ? (
          <div className="mt-5 space-y-3" aria-label="Loading attendees">
            {[0, 1, 2].map((item) => <div key={item} className="h-12 animate-pulse rounded-lg bg-black/5" />)}
          </div>
        ) : isError ? (
          <p className="mt-6 text-sm text-gray-500">We couldn&apos;t load attendees. Please try again.</p>
        ) : attendees?.length ? (
          <ul className="mt-4 space-y-1">
            {attendees.map((attendee) => (
              <li key={attendee.id}>
                <ClickableUserIdentity userId={attendee.id} className="flex items-center gap-3 p-2.5 hover:bg-black/[0.03]" ariaLabel={`Open ${attendee.full_name ?? attendee.username}'s profile`}>
                  <Avatar uri={attendee.avatar_url} size={40} name={attendee.full_name ?? attendee.username} />
                  <span className="min-w-0">
                    {attendee.full_name && <span className="block truncate text-sm font-semibold text-gray-900">{attendee.full_name}</span>}
                    <span className="block truncate text-sm text-gray-500">@{attendee.username}</span>
                  </span>
                </ClickableUserIdentity>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-6 text-sm text-gray-500">No one is going yet. Be the first to RSVP.</p>
        )}
      </div>
    </Modal>
  );
}
