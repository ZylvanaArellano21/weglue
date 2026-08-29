import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState, type AppStateStatus } from "react-native";
import { createClient } from "@supabase/supabase-js";

// Expo injects EXPO_PUBLIC_* env vars at build time via Metro
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL as string;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY as string;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    // Tokens from deep links are parsed by useAuthDeepLink hook in _layout.tsx
    detectSessionInUrl: false,
  },
});

// ─── Foreground-only token refresh (Supabase's required React Native wiring) ──
//
// The unexpected-logout root cause: with `autoRefreshToken` alone, the internal
// refresh timer keeps ticking while the app is backgrounded. iOS suspends/kills
// a backgrounded app, so a refresh can rotate the refresh token server-side
// without the app ever persisting the new one — and on the next launch GoTrue
// rejects the stale token (`refresh_token_not_found` / `already_used`) and
// GoTrueClient emits SIGNED_OUT.
//
// Supabase's guidance (https://supabase.com/docs/reference/javascript/initializing
// → "React Native"): drive startAutoRefresh/stopAutoRefresh from AppState so a
// refresh only ever runs while the app is in the foreground and able to persist
// the result. A legitimate SIGNED_OUT (genuine revocation) is unaffected — this
// only stops the timer from firing where its result would be lost.
//
// Registered exactly once, at module scope. `apps/mobile/lib/supabase.ts` is a
// singleton module, so the listener is created a single time for the app's
// lifetime and is intentionally never removed.

// `createClient({ autoRefreshToken: true })` already starts the timer on init,
// so the initial tracked state is "running".
let autoRefreshRunning = true;

/**
 * Start the token-refresh timer while the app is in the foreground; stop it
 * otherwise. Exported for unit testing; called once at module load and on every
 * AppState change. Idempotent — repeated calls with the same effective state are
 * no-ops, so it can never create duplicate refresh loops.
 */
export function applyAutoRefreshForAppState(status: AppStateStatus): void {
  const shouldRun = status === "active";
  if (shouldRun === autoRefreshRunning) return;
  autoRefreshRunning = shouldRun;
  if (shouldRun) {
    void supabase.auth.startAutoRefresh();
  } else {
    void supabase.auth.stopAutoRefresh();
  }
}

// If the app launched into the background (a push-triggered or prewarm launch),
// stop the timer the client just started so it can't refresh where the result
// would be lost. A normal active launch is a no-op (already "running").
applyAutoRefreshForAppState(AppState.currentState);

AppState.addEventListener("change", applyAutoRefreshForAppState);
