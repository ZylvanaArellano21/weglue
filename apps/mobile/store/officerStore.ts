import { create } from 'zustand';
import { getUserOfficerStatus } from '../services/clubService';

interface OfficerState {
  isOfficer: boolean;
  officerClubIds: string[];
  setOfficerStatus: (isOfficer: boolean, officerClubIds: string[]) => void;
  reset: () => void;
}

export const useOfficerStore = create<OfficerState>((set) => ({
  isOfficer: false,
  officerClubIds: [],
  setOfficerStatus: (isOfficer, officerClubIds) => set({ isOfficer, officerClubIds }),
  reset: () => set({ isOfficer: false, officerClubIds: [] }),
}));

// Re-reads officer status from the DB (the real club_members source) and pushes
// it into the store. Called on Home mount + focus and after any action that can
// change officer roles (leaving a club, being promoted/demoted) so the Home
// plus-menu Event option, the New Event club picker, and every officer-gated UI
// update quickly without a full app restart. Works identically on iOS/Android.
export async function refreshOfficerStatus(userId: string | undefined): Promise<void> {
  if (!userId) return;
  try {
    const { isOfficer, officerClubIds } = await getUserOfficerStatus(userId);
    useOfficerStore.getState().setOfficerStatus(isOfficer, officerClubIds);
  } catch {
    // Non-fatal: keep the last known status rather than flipping officer UI off
    // on a transient network error.
  }
}
