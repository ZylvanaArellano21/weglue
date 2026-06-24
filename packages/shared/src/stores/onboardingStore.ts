import { create } from "zustand";

interface OnboardingState {
  selectedInterests: string[];
  selectedActivities: string[];
  matchCount: number;
  pendingUsername: string;

  setSelectedInterests: (interests: string[]) => void;
  toggleInterest: (interest: string) => void;
  setSelectedActivities: (activities: string[]) => void;
  toggleActivity: (activity: string) => void;
  setMatchCount: (count: number) => void;
  setPendingUsername: (username: string) => void;
  reset: () => void;
}

const initialState = {
  selectedInterests: [] as string[],
  selectedActivities: [] as string[],
  matchCount: 0,
  pendingUsername: "",
};

export const useOnboardingStore = create<OnboardingState>((set, get) => ({
  ...initialState,

  setSelectedInterests: (selectedInterests) => set({ selectedInterests }),

  toggleInterest: (interest) => {
    const current = get().selectedInterests;
    const next = current.includes(interest)
      ? current.filter((i) => i !== interest)
      : [...current, interest];
    set({ selectedInterests: next });
  },

  setSelectedActivities: (selectedActivities) => set({ selectedActivities }),

  toggleActivity: (activity) => {
    const current = get().selectedActivities;
    const next = current.includes(activity)
      ? current.filter((a) => a !== activity)
      : [...current, activity];
    set({ selectedActivities: next });
  },

  setMatchCount: (matchCount) => set({ matchCount }),

  setPendingUsername: (pendingUsername) => set({ pendingUsername }),

  reset: () => set(initialState),
}));
