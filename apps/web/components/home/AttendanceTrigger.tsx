"use client";

import { AvatarStack } from "../shared/AvatarStack";
import type { AttendeePreview } from "../../lib/hooks/useHomeEventsFeed";

export function AttendanceTrigger({
  eventId,
  attendees,
  count,
  onOpen,
  className = "",
}: {
  eventId: string;
  attendees: AttendeePreview[];
  count: number;
  onOpen: (eventId: string) => void;
  className?: string;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={() => onOpen(eventId)}
      className={`flex items-center gap-2 rounded-md text-left outline-none transition hover:opacity-75 focus-visible:ring-2 focus-visible:ring-[#0FA6A6] focus-visible:ring-offset-2 ${className}`}
      aria-label={`Open attendance list, ${count} going`}
    >
      {attendees.length > 0 && <AvatarStack avatars={attendees} size={26} overlap={8} />}
      <span className="text-xs text-black">{count} going</span>
    </button>
  );
}
