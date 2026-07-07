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
  onboarding_completed?: boolean;
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
