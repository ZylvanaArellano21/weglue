import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type HomeTab = 'posts' | 'events';

// Epoch-ms the user last OPENED the Posts tab. Persisted so the "new posts"
// dot survives an app restart / background and only clears when Posts is
// actually opened (not on refresh, navigation, or relaunch). Exported so
// sessionCleanup.ts can wipe it on logout/deletion like every other
// per-account AsyncStorage key.
export const POSTS_SEEN_AT_STORAGE_KEY = 'weglue.home.postsSeenAt.v1';

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

  // ── "New posts" indicator (red dot beside Posts in the selector) ───────────
  // postsSeenAt:         epoch-ms the user last opened the Posts tab (persisted).
  // latestForeignPostAt: epoch-ms of the newest post from ANOTHER user we have
  //                      observed (realtime insert or a feed refetch).
  // The dot shows while latestForeignPostAt > postsSeenAt.
  postsSeenAt: number;
  latestForeignPostAt: number;
  /** Record a post from another user (ISO timestamp). No-ops for our own posts
   *  — callers pass only foreign posts. */
  registerForeignPost: (createdAtIso: string) => void;
  /** Called when the user opens the Posts tab: clears the dot and persists. */
  markPostsOpened: () => void;
}

// The Home screen's selected section (Posts | Events). Lifted into a store so
// other screens can steer it — e.g. after creating a picture post we jump the
// user to Home → Posts so their new post is visible immediately.
export const useHomeTabStore = create<HomeTabState>((set, get) => ({
  activeTab: 'events',
  setActiveTab: (activeTab) => {
    set({ activeTab });
    if (activeTab === 'posts') get().markPostsOpened();
  },
  pendingScrollPostId: null,
  setPendingScrollPostId: (pendingScrollPostId) => set({ pendingScrollPostId }),
  pendingScrollEventId: null,
  setPendingScrollEventId: (pendingScrollEventId) => set({ pendingScrollEventId }),

  postsSeenAt: 0,
  latestForeignPostAt: 0,
  registerForeignPost: (createdAtIso) => {
    const t = Date.parse(createdAtIso);
    if (!Number.isFinite(t)) return;
    if (t > get().latestForeignPostAt) set({ latestForeignPostAt: t });
  },
  markPostsOpened: () => {
    const now = Date.now();
    set({ postsSeenAt: now });
    void AsyncStorage.setItem(POSTS_SEEN_AT_STORAGE_KEY, String(now)).catch(() => {});
  },
}));

// Hydrate postsSeenAt once at module load. Until it resolves postsSeenAt is 0;
// the dot selector also requires a genuinely newer foreign post, so a stale
// dot cannot flash before hydration completes.
void AsyncStorage.getItem(POSTS_SEEN_AT_STORAGE_KEY)
  .then((raw) => {
    const stored = raw ? Number(raw) : NaN;
    if (!Number.isFinite(stored)) return;
    useHomeTabStore.setState((s) =>
      // Don't clobber a markPostsOpened() that already ran this session.
      s.postsSeenAt === 0 ? { postsSeenAt: stored } : s,
    );
  })
  .catch(() => {});
