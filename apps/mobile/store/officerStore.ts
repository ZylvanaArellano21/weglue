import { create } from 'zustand';

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
