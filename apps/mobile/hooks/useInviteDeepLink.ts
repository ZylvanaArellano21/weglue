import { useEffect } from 'react';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useAuthStore } from '@weglue/shared';
import { parseInviteToken, setPendingInvite } from '../lib/pendingInvite';
import { shouldHandleDeepLinkNavigation } from '../lib/platformAdmin';

// ─── Invite deep-link capture ────────────────────────────────────────────────
// Captures invite tokens from cold-start and warm-start deep links. The token
// is ALWAYS persisted first (so it survives onboarding / app restart), then:
//   • signed-in + onboarded  → open the invite screen now
//   • otherwise              → leave it persisted; index.tsx routing consumes
//                              it once onboarding completes.
// Non-invite links are ignored (auth links are handled by useAuthDeepLink).

async function handleUrl(url: string, isOnboarded: boolean, hasSession: boolean) {
  const token = parseInviteToken(url);
  if (!token) return;

  // Persist immediately — the whole point of a deferred invite.
  await setPendingInvite(token);

  if (hasSession && isOnboarded) {
    router.push(`/invite/${token}` as any);
  }
  // Else: onboarding/login flow runs; index.tsx picks the token up at the end.
}

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
      if (url) void handleUrl(url, isOnboarded, hasSession);
    });

    const subscription = Linking.addEventListener('url', ({ url }) => {
      void handleUrl(url, isOnboarded, hasSession);
    });

    return () => subscription.remove();
  }, [isOnboarded, hasSession, allowDeepLinks]);
}
