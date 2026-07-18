"use client";

import { Suspense } from "react";
import { ToastProvider } from "../shared/Toast";
import { AppHeader } from "./AppHeader";
import { ProfileSidebar } from "./ProfileSidebar";
import { HomeFeed } from "./HomeFeed";
import { useUnreadSummary } from "../../lib/hooks/useUnreadSummary";

// Root of the authenticated web Home experience. Mounts the single live
// unread-summary subscription (keeps every badge fresh across devices) and
// lays out the desktop columns. The right Upcoming Events + calendar column
// arrives in Phase 2; the grid collapses cleanly on smaller laptops with no
// horizontal page scroll.
export function HomeClient({ userId }: { userId: string }): JSX.Element {
  useUnreadSummary(userId); // owns the realtime badge subscription

  return (
    <ToastProvider>
      <div className="min-h-screen bg-cream">
        <AppHeader userId={userId} />

        <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_minmax(0,640px)] lg:justify-center">
            <div className="hidden lg:block">
              <ProfileSidebar userId={userId} />
            </div>

            <div>
              <Suspense fallback={<div className="h-96 animate-pulse rounded-xl bg-black/5" />}>
                <HomeFeed userId={userId} />
              </Suspense>
            </div>
          </div>
        </main>
      </div>
    </ToastProvider>
  );
}
