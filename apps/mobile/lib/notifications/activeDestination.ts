/**
 * Tracks which non-chat destination the user is looking at right now, so the
 * foreground notification banner (correction 3) never duplicates something
 * already on screen. Chat has its own dedicated tracker (activeThread.ts,
 * which additionally distinguishes channel); this covers the rest of what
 * the correction calls out: "the exact post, exact event, or directly
 * relevant active Home surface."
 *
 * 'home' has no id — the Home tab itself is the destination for notification
 * types with no specific post/event target (club_joined, student_joined,
 * member_joined, and similar feed/membership updates that surface there).
 */
type DestinationKind = 'post' | 'event' | 'home';

let activeKind: DestinationKind | null = null;
let activeId: string | null = null;

export function setActiveDestination(kind: DestinationKind, id: string | null = null): void {
  activeKind = kind;
  activeId = id;
}

export function clearActiveDestination(kind: DestinationKind, id: string | null = null): void {
  // Only clear if this screen is still the active one (a navigation may have
  // replaced it before the old screen unmounted).
  if (activeKind === kind && activeId === id) {
    activeKind = null;
    activeId = null;
  }
}

export function isViewingDestination(kind: DestinationKind, id?: string | null): boolean {
  if (activeKind !== kind) return false;
  if (kind === 'home') return true;
  return !!id && activeId === id;
}
