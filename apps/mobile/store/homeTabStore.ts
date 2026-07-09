import { create } from 'zustand';

export type HomeTab = 'posts' | 'events';

interface HomeTabState {
  activeTab: HomeTab;
  setActiveTab: (tab: HomeTab) => void;
  // Post ID the Posts feed should scroll to as soon as it appears in the
  // feed data — set right after creating a post so the user lands directly
  // on what they just shared. Cleared by PostsFeed once the scroll happens.
  pendingScrollPostId: string | null;
  setPendingScrollPostId: (postId: string | null) => void;
  // Event ID the Events feed should scroll to as soon as it appears in the
  // feed data — set right after creating an event so the user lands on the
  // new event card (not its detail screen). Cleared by EventsFeed after the
  // scroll happens.
  pendingScrollEventId: string | null;
  setPendingScrollEventId: (eventId: string | null) => void;
}

// The Home screen's selected section (Posts | Events). Lifted into a store so
// other screens can steer it — e.g. after creating a picture post we jump the
// user to Home → Posts so their new post is visible immediately.
export const useHomeTabStore = create<HomeTabState>((set) => ({
  activeTab: 'events',
  setActiveTab: (activeTab) => set({ activeTab }),
  pendingScrollPostId: null,
  setPendingScrollPostId: (pendingScrollPostId) => set({ pendingScrollPostId }),
  pendingScrollEventId: null,
  setPendingScrollEventId: (pendingScrollEventId) => set({ pendingScrollEventId }),
}));
