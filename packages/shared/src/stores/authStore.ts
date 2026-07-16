import { create } from "zustand";
import type { User, Session } from "@supabase/supabase-js";

export interface Profile {
  id: string;
  username: string;
  full_name: string;
  avatar_url: string | null;
  major: string | null;
  bio: string | null;
  is_seed: boolean;
  /**
   * True for every password account (042 backfilled the legacy gate away).
   * False ONLY for an OAuth (Microsoft) account that has not yet completed
   * Interests → Activities → username — the root guard routes those into the
   * onboarding flow until complete_oauth_onboarding flips this to true.
   */
  onboarding_completed?: boolean;
  /** Canonical campus (single-campus launch mode assigns this server-side). */
  university_id?: string | null;
  /**
   * "pending" only for genuinely new accounts that have not yet tapped or
   * dismissed the Home "Personalize your picture!" prompt. Persisted
   * server-side so it survives logout, reinstall, and a second device.
   */
  picture_prompt_status?: "pending" | "hidden";
  created_at: string;
  updated_at: string;
}

interface AuthState {
  user: User | null;
  profile: Profile | null;
  session: Session | null;
  isLoading: boolean;
  isOnboarded: boolean;
  setUser: (user: User | null) => void;
  setProfile: (profile: Profile | null) => void;
  setSession: (session: Session | null) => void;
  setOnboarded: (v: boolean) => void;
  setLoading: (v: boolean) => void;
  reset: () => void;
}

const initialState = {
  user: null,
  profile: null,
  session: null,
  isLoading: true,
  isOnboarded: false,
};

export const useAuthStore = create<AuthState>((set) => ({
  ...initialState,
  setUser: (user) => set({ user }),
  setProfile: (profile) => set({ profile }),
  setSession: (session) =>
    set({ session, user: session?.user ?? null }),
  setOnboarded: (isOnboarded) => set({ isOnboarded }),
  setLoading: (isLoading) => set({ isLoading }),
  reset: () => set(initialState),
}));

// ─── App UI Store ──────────────────────────────────────────────────────────────

interface AppState {
  theme: "light" | "dark" | "system";
  setTheme: (theme: AppState["theme"]) => void;
}

export const useAppStore = create<AppState>((set) => ({
  theme: "system",
  setTheme: (theme) => set({ theme }),
}));
