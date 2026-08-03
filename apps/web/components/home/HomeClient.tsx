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
import { PostModal } from "./PostModal";
import { PostCommentsModal } from "./PostCommentsModal";
import { AttendanceListModal } from "./AttendanceListModal";
import { ComposePostModal } from "./ComposePostModal";
import { ComposeEventModal } from "./ComposeEventModal";
import { useUnreadSummary } from "../../lib/hooks/useUnreadSummary";
import { useRealtimeNotifications, type NotificationTarget } from "../../lib/hooks/useNotifications";
import { useOwnProfile } from "../../lib/hooks/useOwnProfile";
import { messagesHref } from "../../lib/messages/routes";

// Root of the authenticated web Home experience. Mounts the live unread-summary
// + notifications subscriptions and lays out the three desktop columns. Every
// overlay (event, post, saved, notifications, gluemates) is URL-driven so
// browser Back closes it and restores the exact prior Home state (tab + scroll).
export function HomeClient({ userId }: { userId: string }): JSX.Element {
  useUnreadSummary(userId); // realtime badge subscription
  useRealtimeNotifications(userId); // live notification inserts

  return (
    <ToastProvider>
      <div className="min-h-screen bg-cream">
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
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[240px_minmax(0,600px)] xl:grid-cols-[240px_minmax(0,600px)_320px] lg:justify-center">
        <div className="hidden lg:block">
          <ProfileSidebar userId={userId} />
        </div>
        <div>
          <HomeFeed userId={userId} onOpenEvent={openEvent} />
        </div>
        <div className="hidden xl:block">
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
      {attendanceEventId && <AttendanceListModal eventId={attendanceEventId} onClose={() => clear("attendees")} />}
    </main>
  );
}
