import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import type { Router } from 'expo-router';
import type { QueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@weglue/shared';
import { supabase } from './supabase';
import { clearCachedProfile } from './profileCache';
import { deactivateCurrentPushToken } from './notifications/registerPush';
import { useHomeTabStore, POSTS_SEEN_AT_STORAGE_KEY } from '../store/homeTabStore';
import { useLeaveClubStore } from '../store/leaveClubStore';
import { useOfficerStore } from '../store/officerStore';
import { useSidebarStore } from '../store/sidebarStore';

// ─── Centralized authenticated-session teardown ──────────────────────────────
//
// THE single cleanup path for every way an authenticated session can end:
// normal logout, successful account deletion, and any forced invalidation.
// Logout and deletion previously each did their own partial cleanup, which is
// what left a half-torn-down "ghost" session behind (deleted account still
// inside the app, sidebar rendering an Unknown User, stale session restored on
// relaunch). There is now exactly one implementation, and both call it.
//
// ORDER IS LOAD-BEARING — do not reorder without reading this:
//
//   1. Session first. Clearing the Supabase session flips useAuthStore.session
//      to null, which makes the root guard redirect to /welcome and UNMOUNT the
//      whole authenticated tree. Doing this first is what prevents the
//      "Unknown User" flash: no authenticated screen is ever alive while its
//      data is missing. (Wiping caches first — the old deletion path — renders
//      the still-mounted sidebar/profile with no data, which is the ghost.)
//   2. Everything after runs against an unmounted tree, so it cannot flicker.
//
// The whole thing is bounded and local-only: no step waits on the network, so
// logout stays instant even on a dead connection.

const QUERY_CACHE_KEY = 'weglue-query-cache-v1';

/** Keys holding per-account state that must never survive into the next session. */
const AUTHED_STORAGE_KEYS = [
  QUERY_CACHE_KEY,
  '@weglue/pending_confirmation_email',
  '@weglue/resend_cooldown_until',
  // A parked push-tap destination belongs to the account that parked it. It was
  // already safe to leave behind (consuming it re-checks the recipient under
  // RLS, so it can never open inside someone else's session), but after an
  // account deletion the row it points at no longer exists, so keeping it just
  // leaves dead state on the device. Cleared with everything else.
  'weglue-pending-notification-route-v1',
  // "New posts" dot cadence (task 6) is per-account — the next account on this
  // device must not inherit a stranger's read-state and see a wrongly-hidden
  // (or wrongly-shown) dot.
  POSTS_SEEN_AT_STORAGE_KEY,
];

/**
 * Tears down every trace of the authenticated session on this device.
 *
 * Safe to call twice (logout double-tap, deletion retry): every step is
 * idempotent and failures are swallowed — a cleanup error must never strand
 * the user inside an account they asked to leave.
 *
 * @param userId  Owner of the per-user caches. Omit only if genuinely unknown.
 */
export async function tearDownAuthenticatedSession(
  queryClient: QueryClient,
  userId?: string,
): Promise<void> {
  // 0. Push token OFF for this device+account, while the session can still
  //    authenticate the RPC. Time-boxed so a dead connection can't delay the
  //    local logout below (the receipts loop cleans up if this loses).
  try {
    await Promise.race([
      deactivateCurrentPushToken(),
      new Promise((resolve) => setTimeout(resolve, 1500)),
    ]);
  } catch {
    // Best-effort only.
  }
  // The icon badge belongs to the account that just left.
  void Notifications.setBadgeCountAsync(0).catch(() => {});
  // 1. Stop realtime first so no subscription callback can rehydrate a cache
  //    we are about to wipe (a live message arriving mid-logout would
  //    otherwise repopulate the query cache after clear()).
  try {
    await supabase.removeAllChannels();
  } catch {
    // Channels are local objects; failing to remove them cannot block logout.
  }

  // 2. Clear the local Supabase session. Local-only (no network round trip), so
  //    this cannot hang on a bad connection — it is the step that flips the
  //    auth guard and unmounts the authenticated tree.
  try {
    await supabase.auth.signOut({ scope: 'local' });
  } catch {
    // Even if GoTrue's local clear throws, the store reset below still logs out.
  }

  // 3. Reset the auth store explicitly. onAuthStateChange normally does this,
  //    but it is an async listener — resetting here makes the logout
  //    synchronous from the UI's point of view and closes the race where
  //    navigation ran before the guard had observed the sign-out.
  try {
    const auth = useAuthStore.getState();
    auth.setSession(null);
    auth.setProfile(null);
    auth.setOnboarded(false);
  } catch {
    // Store shape changed — non-fatal.
  }

  // 4. In-memory query cache: drop everything (all of it is account-scoped).
  try {
    queryClient.clear();
  } catch {
    /* non-fatal */
  }

  // 5. Persisted caches + per-account AsyncStorage keys (drafts, optimistic
  //    sends, prompt state). Without this the *next* account on this device
  //    rehydrates the previous user's data from disk.
  try {
    await AsyncStorage.multiRemove(AUTHED_STORAGE_KEYS);
  } catch {
    /* non-fatal */
  }

  if (userId) {
    try {
      await clearCachedProfile(userId);
    } catch {
      /* non-fatal */
    }
  }

  // 6. Reset user-scoped zustand stores so no club/officer/scroll state bleeds
  //    into the next session. (zustand v4 has no getInitialState() — the
  //    data fields are reset explicitly; actions are left in place.)
  //
  //    The sidebar is included on purpose: it is an overlay driven by state, so
  //    without this reset an open drawer (or a pending "reopen me on Back")
  //    would survive the teardown and could reappear over Welcome, or over the
  //    next account that signs in on this device.
  try {
    useHomeTabStore.setState({
      activeTab: 'events',
      pendingScrollPostId: null,
      pendingScrollEventId: null,
      postsSeenAt: 0,
      latestForeignPostAt: 0,
    });
    useLeaveClubStore.setState({ request: null });
    useOfficerStore.getState().reset();
    useSidebarStore.getState().reset();
  } catch {
    /* non-fatal */
  }

  // 7. Best-effort THIS-SESSION token revocation, deliberately NOT awaited. The
  //    local session is already gone, so the user is logged out regardless; if
  //    this request never lands the refresh token simply expires on its own.
  //    Awaiting it here is what used to make logout feel slow.
  //
  //    Deliberately LOCAL scope (task 7): this teardown path is shared by the
  //    ordinary sidebar "Log Out" and account deletion. It used to hardcode
  //    `scope=global`, which revoked the refresh token on every OTHER device
  //    too — a plain logout on one phone was silently ending the session on
  //    every other signed-in device/browser. Account deletion does not depend
  //    on this call for its own "logged out everywhere" guarantee: deleting
  //    the auth user row server-side (supabase/functions/delete-account)
  //    already invalidates every refresh token for that account, since the
  //    account it would refresh into no longer exists.
  void revokeRefreshTokenInBackground();
}

/**
 * Lands the user on a genuinely full-screen Welcome after the session has been
 * torn down. Call it from a screen that was PUSHED over the authenticated tree
 * (Account Center after a confirmed deletion); a plain logout from the sidebar
 * overlay needs nothing, because the tabs guard already replaces the tree.
 *
 * `dismissAll()` first, then `replace()`. Dismissing pops the pushed screen off
 * so the stack is left holding exactly one entry — Welcome — which is what makes
 * Welcome a normal full-screen root screen with no Back path, no iOS swipe-back
 * path and no Android Back path into anything authenticated. This is correct
 * whether or not the tabs guard's own redirect has committed yet.
 */
export function resetToWelcome(router: Router): void {
  try {
    if (router.canDismiss()) router.dismissAll();
  } catch {
    // Nothing to dismiss (already the only screen) — the replace below is enough.
  }
  router.replace('/welcome');
}

let pendingRevocationToken: string | null = null;

/** Captures the access token *before* teardown so revocation can run after it. */
export function rememberTokenForRevocation(accessToken: string | null | undefined): void {
  pendingRevocationToken = accessToken ?? null;
}

async function revokeRefreshTokenInBackground(): Promise<void> {
  const token = pendingRevocationToken;
  pendingRevocationToken = null;
  if (!token) return;

  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL as string | undefined;
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY as string | undefined;
  if (!supabaseUrl || !anonKey) return;

  try {
    await fetch(`${supabaseUrl}/auth/v1/logout?scope=local`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, apikey: anonKey },
    });
  } catch {
    // Token expires on its own — nothing to do.
  }
}
