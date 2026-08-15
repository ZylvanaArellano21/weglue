import { useEffect } from 'react';
import * as Linking from 'expo-linking';
import { useAuthStore } from '@weglue/shared';
import { captureInviteUrl } from '../lib/inviteController';
import { shouldHandleDeepLinkNavigation } from '../lib/platformAdmin';

// ─── Invite deep-link capture ────────────────────────────────────────────────
// Captures invite tokens from cold-start and warm-start deep links and hands
// them to the one invitation controller (lib/inviteController.ts), which
// dedupes and decides whether to persist-only or persist-and-navigate.
// Non-invite links are ignored (auth links are handled by useAuthDeepLink).
//
// Expo Linking can deliver the SAME cold-start URL twice — both
// getInitialURL() and the first 'url' event can fire for one launch — so
// both call sites below funnel through the controller's single dedup guard
// rather than each independently deciding to navigate.

export function useInviteDeepLink(accessResolved = true) {
  const session = useAuthStore((s) => s.session);
  // A verified email is the only thing that makes an account usable now — a
  // missing profile picture no longer means "still onboarding".
  const hasSession = !!session?.user?.email_confirmed_at;
  const isOnboarded = hasSession;
  // A platform-admin identity is never routed into a student destination by an
  // incoming URL — not even a persisted one. Without this, an invite link would
  // push /invite/<token> for an admin session (it has a confirmed email, so it
  // satisfies hasSession) and drag it into the chat surface.
  const allowDeepLinks = accessResolved && shouldHandleDeepLinkNavigation(session);

  useEffect(() => {
    if (!allowDeepLinks) return;

    Linking.getInitialURL().then((url) => {
      if (url) void captureInviteUrl(url, { hasSession, isOnboarded });
    });

    const subscription = Linking.addEventListener('url', ({ url }) => {
      void captureInviteUrl(url, { hasSession, isOnboarded });
    });

    return () => subscription.remove();
  }, [isOnboarded, hasSession, allowDeepLinks]);
}
