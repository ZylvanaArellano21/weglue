import { create } from "zustand";

// The mandatory profile-picture onboarding step's result. Preset/text travel
// to the server as plain signup metadata (same trust model as interests and
// activities). Photo/camera are uploaded to the `pending-avatars` storage
// bucket by the picture screen itself before it stores the choice here — only
// the resulting token travels onward, never a local file uri (which can't
// survive to a different device anyway).
export type AvatarChoice =
  | { kind: "preset"; id: string }
  | { kind: "text"; value: string }
  | { kind: "photo" | "camera"; token: string };

interface OnboardingState {
  /**
   * Slug of the campus chosen on the "Choose your university" step, which now
   * opens the signup flow. It travels to the server in the signup metadata and
   * is what the account's campus membership is created from, so signup cannot
   * proceed without it.
   */
  selectedCampusSlug: string | null;
  selectedInterests: string[];
  selectedActivities: string[];
  matchCount: number;
  pendingUsername: string;
  pendingEmail: string;
  // Kept in memory only (never persisted) so the confirm-email screen can
  // silently sign the user in to detect verification. Wiped on reset.
  pendingPassword: string;
  avatarChoice: AvatarChoice | null;

  setSelectedCampusSlug: (slug: string | null) => void;
  setSelectedInterests: (interests: string[]) => void;
  toggleInterest: (interest: string) => void;
  setSelectedActivities: (activities: string[]) => void;
  toggleActivity: (activity: string) => void;
  setMatchCount: (count: number) => void;
  setPendingUsername: (username: string) => void;
  setPendingEmail: (email: string) => void;
  setPendingPassword: (password: string) => void;
  setAvatarChoice: (choice: AvatarChoice | null) => void;
  reset: () => void;
}

const initialState = {
  selectedCampusSlug: null as string | null,
  selectedInterests: [] as string[],
  selectedActivities: [] as string[],
  matchCount: 0,
  pendingUsername: "",
  pendingEmail: "",
  pendingPassword: "",
  avatarChoice: null as AvatarChoice | null,
};

export const useOnboardingStore = create<OnboardingState>((set, get) => ({
  ...initialState,

  setSelectedCampusSlug: (selectedCampusSlug) => set({ selectedCampusSlug }),

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

  setPendingEmail: (pendingEmail) => set({ pendingEmail }),

  setPendingPassword: (pendingPassword) => set({ pendingPassword }),

  setAvatarChoice: (avatarChoice) => set({ avatarChoice }),

  reset: () => set(initialState),
}));
