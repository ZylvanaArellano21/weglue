import { router } from 'expo-router';
import { getPendingInvite, setPendingInvite, parseInviteToken } from './pendingInvite';

// ─── The one invitation controller ──────────────────────────────────────────
// Every source that can hand this app an invite token funnels through
// `captureInviteToken`: a cold-start Universal/App Link, a warm-start
// Linking 'url' event, and (Feature 1) a first-launch Google Play Install
// Referrer read. None of them talk to AsyncStorage or the router directly —
// this is the single place that decides "have I already seen this token?"
// and "is the user ready to be routed to it right now?", so a link delivered
// twice (a documented Expo Linking quirk: getInitialURL and the first 'url'
// event can both fire for the same cold-start URL) or a referrer read that
// races a deep link can only ever produce ONE redemption and ONE navigation.
//
// The guard is module-level (not React state) on purpose: it must survive
// across the several independent call sites and re-renders that can all
// observe "no token captured yet" in the same tick.
//
// It does NOT release the instant the async work finishes. The two deliveries
// of a cold-start URL (getInitialURL() resolving and the first 'url' event)
// aren't guaranteed to land in the same tick — one can lag the other by real
// wall-clock time — so releasing early re-opens exactly the bug this exists
// to close: a second `router.push('/invite/<token>')` for the same token,
// which is the literal "a second Joining… screen slides in a moment later"
// symptom from the original video evidence. A short cooldown after the LAST
// time this token was captured covers that realistic re-delivery window
// while still letting a genuinely fresh tap of the same link later in the
// session (after the user has navigated away) through.
const RECENT_CAPTURE_COOLDOWN_MS = 4000;
let recentToken: string | null = null;
let recentAt = 0;

/**
 * Records that `token` has just arrived from any source, and — if the user
 * is already authenticated and onboarded — routes to the invite screen now.
 * If they are not, the token is simply persisted; `resumePendingInvite`
 * (called from the root screen once auth/onboarding settles) picks it up.
 *
 * Idempotent: a second delivery of the SAME token within the cooldown
 * window — whether truly concurrent or merely close in time — is a no-op.
 */
export async function captureInviteToken(
  token: string,
  opts: { hasSession: boolean; isOnboarded: boolean },
): Promise<void> {
  const now = Date.now();
  if (recentToken === token && now - recentAt < RECENT_CAPTURE_COOLDOWN_MS) return;
  recentToken = token;
  recentAt = now;

  await setPendingInvite(token);
  if (opts.hasSession && opts.isOnboarded) {
    router.push(`/invite/${token}` as any);
  }
  // Else: the auth/onboarding flow runs; resumePendingInvite consumes it.
}

/** Parses an incoming URL and, if it's an invite link, runs it through the
 *  single capture path above. Non-invite URLs are ignored here. */
export async function captureInviteUrl(
  url: string,
  opts: { hasSession: boolean; isOnboarded: boolean },
): Promise<void> {
  const token = parseInviteToken(url);
  if (!token) return;
  await captureInviteToken(token, opts);
}

/**
 * Called once auth/onboarding has fully settled (root index screen). If a
 * token was persisted while the user was signing up/logging in, this is
 * where it's finally routed to. Returns whether a pending invite was found,
 * so the caller knows whether to fall through to its normal destination.
 */
export async function resumePendingInvite(): Promise<boolean> {
  const token = await getPendingInvite();
  if (!token) return false;
  router.replace(`/invite/${token}` as any);
  return true;
}
