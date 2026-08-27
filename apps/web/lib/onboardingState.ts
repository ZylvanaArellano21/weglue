"use client";

/**
 * Web-specific onboarding flow state, persisted in sessionStorage so browser
 * refresh and Back/Forward navigation preserve the user's progress. The
 * shared @weglue/shared zustand store is memory-only (fine for the mobile
 * app, lossy on a web refresh), so the web keeps its own copy and never
 * touches the shared one.
 *
 * The password is deliberately NOT stored here — it stays in component state
 * only. Terms & Privacy Policy open as an in-app modal (LegalModal), not a
 * navigation, so signup form state never needs to survive a round trip.
 */

import type { AvatarChoice } from "@weglue/shared";

const KEY = "weglue-web/onboarding";

export interface OnboardingFlowState {
  selectedInterests: string[];
  selectedActivities: string[];
  matchCount: number;
  pendingUsername: string;
  pendingEmail: string;
  avatarChoice: AvatarChoice | null;
}

const initialState: OnboardingFlowState = {
  selectedInterests: [],
  selectedActivities: [],
  matchCount: 0,
  pendingUsername: "",
  pendingEmail: "",
  avatarChoice: null,
};

export function readOnboardingState(): OnboardingFlowState {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return { ...initialState };
    const parsed = JSON.parse(raw) as Partial<OnboardingFlowState>;
    return {
      ...initialState,
      ...parsed,
      selectedInterests: Array.isArray(parsed.selectedInterests)
        ? parsed.selectedInterests
        : [],
      selectedActivities: Array.isArray(parsed.selectedActivities)
        ? parsed.selectedActivities
        : [],
    };
  } catch {
    return { ...initialState };
  }
}

export function writeOnboardingState(patch: Partial<OnboardingFlowState>): OnboardingFlowState {
  const next = { ...readOnboardingState(), ...patch };
  try {
    sessionStorage.setItem(KEY, JSON.stringify(next));
  } catch {}
  return next;
}

export function resetOnboardingState(): void {
  transientPassword = "";
  try {
    sessionStorage.removeItem(KEY);
  } catch {}
}

// ─── Transient password holder ───────────────────────────────────────────────
// Survives CLIENT-SIDE navigations only (the module stays alive as long as no
// full page load happens), and is gone on any full page load. Deliberately
// never written to session/local storage or a URL.

let transientPassword = "";

export function setTransientPassword(password: string): void {
  transientPassword = password;
}

export function getTransientPassword(): string {
  return transientPassword;
}
