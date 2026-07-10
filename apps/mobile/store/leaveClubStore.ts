import { create } from 'zustand';

// One app-wide "leave club" request at a time.
//
// Every surface that can leave a club (Home event cards, both event detail
// screens, Club Profile, chat info) funnels through requestLeaveClub(). The
// single LeaveClubHost (mounted once in the root layout) consumes the
// request, verifies eligibility against the server, and renders exactly ONE
// confirmation modal. Because there is exactly one host and one request
// slot, the sole-officer warning and the leave confirmation can never be
// mounted at the same time — the two-stacked-modals bug is structurally
// impossible, on every screen, not just the one in the screenshot.

export interface LeaveClubRequest {
  clubId: string;
  /** For modal copy; the host resolves it from the clubs table if omitted. */
  clubName?: string;
  /** Runs after the leave really succeeded (e.g. navigate away). */
  onLeft?: () => void;
}

interface LeaveClubState {
  request: LeaveClubRequest | null;
  setRequest: (request: LeaveClubRequest | null) => void;
}

export const useLeaveClubStore = create<LeaveClubState>((set) => ({
  request: null,
  setRequest: (request) => set({ request }),
}));

/** Ask to leave a club from anywhere in the app. Repeated rapid taps while a
 * request is already active are ignored (one request slot). */
export function requestLeaveClub(request: LeaveClubRequest): void {
  const { request: active, setRequest } = useLeaveClubStore.getState();
  if (active) return;
  setRequest(request);
}
