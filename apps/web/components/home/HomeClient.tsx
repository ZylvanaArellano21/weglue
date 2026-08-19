"use client";

import { Suspense, useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ToastProvider } from "../shared/Toast";
import { AppHeader } from "./AppHeader";
import { ProfileSidebar } from "./ProfileSidebar";
import { HomeFeed } from "./HomeFeed";
import { RightColumn } from "./RightColumn";
import { EventDetailModal } from "./EventDetailModal";
import { SavedEventsModal } from "./SavedEventsModal";
import { NotificationsModal } from "./NotificationsModal";
import { GluematesModal } from "./GluematesModal";
import { CalendarModal } from "./CalendarModal";
import { PostModal } from "./PostModal";
import { PostCommentsModal } from "./PostCommentsModal";
import { AttendanceListModal } from "./AttendanceListModal";
import { ComposePostModal } from "./ComposePostModal";
import { ComposeEventModal } from "./ComposeEventModal";
import type { NotificationTarget } from "../../lib/hooks/useNotifications";
import { useOwnProfile } from "../../lib/hooks/useOwnProfile";
import { messagesHref } from "../../lib/messages/routes";

// Root of the authenticated web Home experience. The live unread-summary,
// notifications, and my-clubs subscriptions are owned once for the whole
// session by Providers (useSessionRealtimeHub), not remounted here. Lays out
// the three desktop columns. Every overlay (event, post, saved, notifications,
// gluemates) is URL-driven so browser Back closes it and restores the exact
// prior Home state (tab + scroll).
export function HomeClient({ userId }: { userId: string }): JSX.Element {
  return (
    <ToastProvider>
      <div className="min-h-screen bg-cream pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0">
        <AppHeader userId={userId} />
        <Suspense fallback={<div className="h-96 animate-pulse" />}>
          <HomeMain userId={userId} />
        </Suspense>
      </div>
    </ToastProvider>
  );
}

function HomeMain({ userId }: { userId: string }): JSX.Element {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { data: profile } = useOwnProfile(userId);

  const eventId = params.get("event");
  const postId = params.get("post");
  const commentsPostId = params.get("comments");
  const attendanceEventId = params.get("attendees");
  const savedOpen = params.get("saved") === "1";
  const notifOpen = params.get("notifications") === "1";
  const gluematesOpen = params.get("gluemates") === "1";
  // Opened by the phone bottom tab bar's Calendar tab (AppHeader) — there is
  // no standalone /calendar route, so it reuses the same overlay
  // RightColumn's "Expand calendar" button opens, just URL-driven instead of
  // local state so it's reachable from outside this component.
  const calendarOpen = params.get("calendar") === "1";
  const compose = params.get("compose"); // "post" | "event"

  const buildUrl = useCallback(
    (mutate: (sp: URLSearchParams) => void) => {
      const sp = new URLSearchParams(params.toString());
      mutate(sp);
      const qs = sp.toString();
      return qs ? `${pathname}?${qs}` : pathname;
    },
    [params, pathname]
  );

  const set = useCallback(
    (key: string, val: string) => router.push(buildUrl((sp) => sp.set(key, val)), { scroll: false }),
    [router, buildUrl]
  );
  const clear = useCallback(
    (key: string) => router.push(buildUrl((sp) => sp.delete(key)), { scroll: false }),
    [router, buildUrl]
  );

  const openEvent = useCallback((id: string) => set("event", id), [set]);
  const openPost = useCallback((id: string) => set("post", id), [set]);
  const openClub = useCallback((clubId: string) => router.push(`/club/${clubId}`), [router]);

  // After creating a post/event: switch to the matching tab and close compose,
  // so the user lands on the feed where their new item appears.
  const afterCreate = useCallback(
    (tab: "posts" | "events") =>
      router.push(
        buildUrl((sp) => {
          sp.delete("compose");
          if (tab === "posts") sp.set("tab", "posts");
          else sp.delete("tab");
        }),
        { scroll: false }
      ),
    [router, buildUrl]
  );

  // Notification deep-links → the right web destination.
  const openTarget = useCallback(
    (target: NotificationTarget) => {
      switch (target.kind) {
        case "event": return openEvent(target.id);
        case "post": return openPost(target.id);
        case "user": return router.push(`/u/${target.id}`);
        case "club": return router.push(`/club/${target.id}`);
        case "chat": return router.push(messagesHref({ conversationId: target.id, channelId: target.channelId }));
        case "notifications": return; // already here
      }
    },
    [openEvent, openPost, router]
  );

  return (
    <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
      {/* The third (Upcoming Events/Calendar) column used to only appear at
          xl (1280px+) while the left sidebar appeared at lg (1024px+) — no
          iPad, portrait or landscape, ever reaches 1280px, so the right
          column could never show on any tablet. Both columns now key off
          the same lg breakpoint; the middle track's minmax(0,1fr) and the
          narrower fixed side tracks keep all three columns fitting down to
          1024px (the narrowest common tablet-landscape width) with no
          horizontal overflow. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[220px_minmax(0,1fr)_minmax(240px,280px)] lg:justify-center">
        <div className="hidden lg:block">
          <ProfileSidebar userId={userId} />
        </div>
        <div>
          <HomeFeed userId={userId} onOpenEvent={openEvent} />
        </div>
        <div className="hidden lg:block">
          <RightColumn userId={userId} onOpenEvent={openEvent} />
        </div>
      </div>

      {/* Base overlays hide while an event/post overlay is on top so Back from
          the inner overlay returns to them rather than double-dimming. */}
      {savedOpen && !eventId && !postId && (
        <SavedEventsModal userId={userId} onClose={() => clear("saved")} onOpenEvent={openEvent} />
      )}
      {notifOpen && !eventId && !postId && (
        <NotificationsModal
          userId={userId}
          username={profile?.username}
          onClose={() => clear("notifications")}
          onOpenTarget={openTarget}
        />
      )}
      {gluematesOpen && !eventId && !postId && (
        <GluematesModal
          userId={userId}
          onClose={() => clear("gluemates")}
          onOpenUser={(id) => router.push(`/u/${id}`)}
        />
      )}
      {calendarOpen && !eventId && !postId && (
        <CalendarModal
          userId={userId}
          initialDate={null}
          onClose={() => clear("calendar")}
          onOpenEvent={openEvent}
        />
      )}

      {compose === "post" && (
        <ComposePostModal userId={userId} onClose={() => clear("compose")} onCreated={() => afterCreate("posts")} />
      )}
      {compose === "event" && (
        <ComposeEventModal userId={userId} onClose={() => clear("compose")} onCreated={() => afterCreate("events")} />
      )}

      {postId && (
        <PostModal
          key={`post-${postId}`}
          postId={postId}
          userId={userId}
          onClose={() => clear("post")}
          onOpenAuthor={(id) => router.push(`/u/${id}`)}
          onOpenComments={(id) => set("comments", id)}
        />
      )}
      {eventId && (
        <EventDetailModal
          key={`event-${eventId}`}
          eventId={eventId}
          userId={userId}
          onClose={() => clear("event")}
          onOpenClub={openClub}
          onOpenAttendees={(id) => set("attendees", id)}
        />
      )}
      {commentsPostId && <PostCommentsModal postId={commentsPostId} userId={userId} onClose={() => clear("comments")} />}
      {attendanceEventId && <AttendanceListModal eventId={attendanceEventId} userId={userId} onClose={() => clear("attendees")} />}
    </main>
  );
}
