"use client";

import { useMemo, useState } from "react";
import { Modal } from "../shared/Modal";
import { Avatar } from "../shared/Avatar";
import { ClickableUserIdentity } from "../shared/ClickableIdentity";
import { ChatBubbleOutlineIcon, SearchIcon, CloseIcon } from "../shared/icons";
import { useToast } from "../shared/Toast";
import { useEventAttendees } from "../../lib/hooks/useEventAttendees";
import { useFollow } from "../../lib/hooks/useUserProfile";
import { personMessageHref } from "../../lib/messages/routes";
import { useRouter } from "next/navigation";

// Checked directly against apps/mobile/app/home/attendees.tsx: "N Going"
// heading, a search field, and per-row chat + Follow/Gluemate pill (self
// excluded). Search there is server-paginated; here the full RSVP list is
// already fetched in one query, so filtering client-side is the simpler
// match for the same result, not a smaller feature.
export function AttendanceListModal({
  eventId,
  userId,
  onClose,
}: {
  eventId: string;
  userId: string;
  onClose: () => void;
}): JSX.Element {
  const router = useRouter();
  const show = useToast();
  const { data: attendees, isLoading, isError } = useEventAttendees(eventId, userId);
  const { mutate: follow } = useFollow(userId);
  const [search, setSearch] = useState("");
  const [justFollowed, setJustFollowed] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    const list = attendees ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (a) => a.username.toLowerCase().includes(q) || (a.full_name ?? "").toLowerCase().includes(q)
    );
  }, [attendees, search]);

  const handleFollow = (targetId: string) => {
    follow(targetId, {
      onSuccess: () => {
        setJustFollowed((prev) => new Set(prev).add(targetId));
        show("Following! 🎉");
      },
      onError: () => show("Failed to follow.", "error"),
    });
  };

  return (
    <Modal onClose={onClose} labelledBy="attendance-title" maxWidth={460}>
      <div className="p-5 sm:p-6">
        <h2 id="attendance-title" className="pr-8 text-xl font-bold text-gray-900">
          {attendees ? `${attendees.length} Going` : "Attendees"}
        </h2>

        <div className="relative mt-4">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
            <SearchIcon size={18} />
          </span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search attendees…"
            aria-label="Search attendees"
            className="h-11 w-full rounded-xl border bg-white pl-10 pr-9 text-sm outline-none focus:ring-2"
            style={{ borderColor: "#E5E7EB" }}
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label="Clear search"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <CloseIcon size={16} />
            </button>
          )}
        </div>

        {isLoading ? (
          <div className="mt-5 space-y-3" aria-label="Loading attendees">
            {[0, 1, 2].map((item) => <div key={item} className="h-12 animate-pulse rounded-lg bg-black/5" />)}
          </div>
        ) : isError ? (
          <p className="mt-6 text-sm text-gray-500">This attendee list is no longer available.</p>
        ) : filtered.length ? (
          <ul className="mt-3 space-y-1">
            {filtered.map((attendee) => {
              const isMe = attendee.id === userId;
              const isFollowing = attendee.is_following || justFollowed.has(attendee.id);
              return (
                <li key={attendee.id} className="flex items-center gap-3 p-2.5 hover:bg-black/[0.03]">
                  <ClickableUserIdentity userId={attendee.id} className="flex min-w-0 flex-1 items-center gap-3" ariaLabel={`Open ${attendee.full_name ?? attendee.username}'s profile`}>
                    <Avatar uri={attendee.avatar_url} size={40} name={attendee.full_name ?? attendee.username} />
                    <span className="min-w-0 truncate text-sm font-semibold text-gray-900">
                      {attendee.full_name || attendee.username}
                    </span>
                  </ClickableUserIdentity>

                  <button
                    type="button"
                    onClick={() => router.push(personMessageHref(attendee.id))}
                    aria-label={`Message ${attendee.username}`}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border text-gray-700"
                    style={{ borderColor: "#D1D5DB" }}
                  >
                    <ChatBubbleOutlineIcon size={18} />
                  </button>

                  {!isMe && (
                    <button
                      type="button"
                      onClick={() => {
                        if (!attendee.is_gluemate && !isFollowing) handleFollow(attendee.id);
                      }}
                      disabled={attendee.is_gluemate || isFollowing}
                      className="shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-semibold disabled:cursor-default"
                      style={
                        attendee.is_gluemate || isFollowing
                          ? { border: "1.5px solid #0FA6A6", color: "#0FA6A6", background: "rgba(15,166,166,0.08)" }
                          : { background: "#0FA6A6", color: "#fff" }
                      }
                    >
                      {attendee.is_gluemate ? "Gluemate" : isFollowing ? "Following" : "Follow"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-6 text-center text-sm text-gray-500">No attendees found.</p>
        )}
      </div>
    </Modal>
  );
}
