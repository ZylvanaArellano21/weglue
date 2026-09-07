"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { EventDetailModal } from "../home/EventDetailModal";
import { PostModal } from "../home/PostModal";
import { AttendanceListModal } from "../home/AttendanceListModal";
import { PostCommentsModal } from "../home/PostCommentsModal";

// URL-driven event/post overlays reusable on any page (profile, user profile).
// Opening preserves other params so browser Back closes the overlay and returns
// to the exact page state.
export function PageOverlays({ userId }: { userId: string }): JSX.Element | null {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const eventId = params.get("event");
  const postId = params.get("post");
  const attendanceEventId = params.get("attendees");
  const commentsPostId = params.get("comments");
  const commentFocusId = params.get("commentFocus");

  const remove = useCallback(
    (...keys: string[]) => {
      const sp = new URLSearchParams(params.toString());
      for (const key of keys) sp.delete(key);
      const qs = sp.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router]
  );

  const openClub = (clubId: string) => router.push(`/club/${clubId}`);
  const openUser = (id: string) => router.push(`/u/${id}`);

  return (
    <>
      {postId && (
        <PostModal
          key={`post-${postId}`}
          postId={postId}
          userId={userId}
          onClose={() => remove("post")}
          onOpenAuthor={openUser}
          onOpenComments={(id) => {
            const sp = new URLSearchParams(params.toString());
            sp.set("comments", id);
            router.push(`${pathname}?${sp.toString()}`, { scroll: false });
          }}
        />
      )}
      {eventId && (
        <EventDetailModal
          key={`event-${eventId}`}
          eventId={eventId}
          userId={userId}
          onClose={() => remove("event")}
          onOpenClub={openClub}
          onOpenAttendees={(id) => {
            const sp = new URLSearchParams(params.toString());
            sp.set("attendees", id);
            router.push(`${pathname}?${sp.toString()}`, { scroll: false });
          }}
        />
      )}
      {attendanceEventId && <AttendanceListModal eventId={attendanceEventId} userId={userId} onClose={() => remove("attendees")} />}
      {commentsPostId && <PostCommentsModal postId={commentsPostId} userId={userId} focusCommentId={commentFocusId ?? undefined} onClose={() => remove("comments", "commentFocus")} />}
    </>
  );
}
