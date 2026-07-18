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
import { useUnreadSummary } from "../../lib/hooks/useUnreadSummary";

// Root of the authenticated web Home experience. Mounts the single live
// unread-summary subscription and lays out the three desktop columns. The
// event-detail overlay is URL-driven (?event=) so it opens from the feed,
// Upcoming Events or the calendar, deep-links when opened directly, and Back /
// close restores the exact prior Home state (tab + scroll).
export function HomeClient({ userId }: { userId: string }): JSX.Element {
  useUnreadSummary(userId); // owns the realtime badge subscription

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
  const eventId = params.get("event");
  const savedOpen = params.get("saved") === "1";

  const buildUrl = useCallback(
    (mutate: (sp: URLSearchParams) => void) => {
      const sp = new URLSearchParams(params.toString());
      mutate(sp);
      const qs = sp.toString();
      return qs ? `${pathname}?${qs}` : pathname;
    },
    [params, pathname]
  );

  // Push (adds a history entry) so browser Back closes the overlay and returns
  // to the same feed/tab/scroll; keeps the current ?tab so the tab is preserved.
  const openEvent = useCallback(
    (id: string) => router.push(buildUrl((sp) => sp.set("event", id)), { scroll: false }),
    [router, buildUrl]
  );
  const closeEvent = useCallback(
    () => router.push(buildUrl((sp) => sp.delete("event")), { scroll: false }),
    [router, buildUrl]
  );
  const closeSaved = useCallback(
    () => router.push(buildUrl((sp) => sp.delete("saved")), { scroll: false }),
    [router, buildUrl]
  );
  const openClub = useCallback((clubId: string) => router.push(`/club/${clubId}`), [router]);

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

      {/* Saved overlay hides while an event overlay is on top, so Back from the
          event returns to Saved rather than double-dimming the screen. */}
      {savedOpen && !eventId && (
        <SavedEventsModal userId={userId} onClose={closeSaved} onOpenEvent={openEvent} />
      )}

      {eventId && (
        <EventDetailModal
          key={eventId}
          eventId={eventId}
          userId={userId}
          onClose={closeEvent}
          onOpenClub={openClub}
        />
      )}
    </main>
  );
}
