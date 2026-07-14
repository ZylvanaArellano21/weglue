import { create } from 'zustand';

// ─── Sidebar overlay state ────────────────────────────────────────────────────
//
// The sidebar is an OVERLAY, not a navigation container.
//
// It used to be a `presentation: 'transparentModal'` route, and every
// destination opened from it (Account Center, Privacy Center, Profile…) was
// pushed ABOVE that route — which on iOS means *inside* the modal's presentation
// container. That is why those screens rendered as partial sheets with rounded
// corners, a strip of the previous screen down the left edge, and dimmed content
// around them, and why Welcome itself came up as a rounded sheet after logout /
// account deletion (the replace landed inside the still-presented modal).
//
// Now the user simply stays on their underlying screen and the drawer is drawn
// over it from state. Destinations are plain pushes on the normal opaque root
// stack, so they are full-screen by construction — no per-screen patching.
//
// Back-returns-to-sidebar (the required Home → Sidebar → Destination → Back →
// Sidebar journey) is handled WITHOUT the sidebar being part of the history:
// when a destination is opened we close the drawer and remember the pathname we
// were sitting on (`reopenOverPathname`). SidebarHost watches the pathname; once
// the user has actually left that route and later comes back to it, it reopens
// the drawer. The underlying screen was never unmounted, so its tab, its
// Posts/Events selection and its scroll position are all still there.

interface SidebarState {
  isOpen: boolean;
  /**
   * Pathname the sidebar was open over when a destination was launched.
   * Non-null means "reopen the drawer when the user navigates back to here".
   * Null means there is nothing to restore.
   */
  reopenOverPathname: string | null;

  /** Show the drawer over the current screen. */
  open: () => void;
  /** Hide the drawer, and forget any pending return (an explicit dismissal). */
  close: () => void;
  /**
   * Launch an internal destination: hide the drawer and arm the return, so Back
   * from that destination lands on this same screen with the sidebar open again.
   */
  openDestination: (fromPathname: string) => void;
  /** Reopen after a Back (SidebarHost only). */
  reopen: () => void;
  /**
   * Drop a pending return without touching anything else. For flows that
   * deliberately move the user forward instead of back — Interests → Save →
   * "See my matches" lands on Home Events and must NOT resurrect the sidebar.
   */
  clearReturn: () => void;
  /** Full reset. Called by the shared session teardown (logout + deletion) so
   *  sidebar state can never survive into Welcome or into the next account. */
  reset: () => void;
}

export const useSidebarStore = create<SidebarState>((set) => ({
  isOpen: false,
  reopenOverPathname: null,

  // Idempotent: opening an already-open sidebar is a no-op, so a double tap on
  // the avatar can never stack two drawers.
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false, reopenOverPathname: null }),
  openDestination: (fromPathname) =>
    set({ isOpen: false, reopenOverPathname: fromPathname }),
  reopen: () => set({ isOpen: true, reopenOverPathname: null }),
  clearReturn: () => set({ reopenOverPathname: null }),
  reset: () => set({ isOpen: false, reopenOverPathname: null }),
}));
