import { create } from 'zustand';

export type HomeTab = 'posts' | 'events';

interface HomeTabState {
  activeTab: HomeTab;
  setActiveTab: (tab: HomeTab) => void;
}

// The Home screen's selected section (Posts | Events). Lifted into a store so
// other screens can steer it — e.g. after creating a picture post we jump the
// user to Home → Posts so their new post is visible immediately.
export const useHomeTabStore = create<HomeTabState>((set) => ({
  activeTab: 'events',
  setActiveTab: (activeTab) => set({ activeTab }),
}));
