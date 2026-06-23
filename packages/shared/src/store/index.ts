import { create } from "zustand";
import type { User } from "../types/index.js";

interface AuthState {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  setUser: (user: User | null) => void;
  setLoading: (loading: boolean) => void;
  reset: () => void;
}

const initialState = {
  user: null,
  isLoading: true,
  isAuthenticated: false,
};

export const useAuthStore = create<AuthState>((set) => ({
  ...initialState,
  setUser: (user) =>
    set({ user, isAuthenticated: user !== null, isLoading: false }),
  setLoading: (isLoading) => set({ isLoading }),
  reset: () => set(initialState),
}));

// ─── App UI Store ─────────────────────────────────────────────────────────────

interface AppState {
  theme: "light" | "dark" | "system";
  setTheme: (theme: AppState["theme"]) => void;
}

export const useAppStore = create<AppState>((set) => ({
  theme: "system",
  setTheme: (theme) => set({ theme }),
}));
