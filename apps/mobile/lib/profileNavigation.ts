import type { Router } from 'expo-router';
import { useAuthStore } from '@weglue/shared';

/**
 * The one way to open a person's profile from anywhere in the app.
 *
 * - Tapping YOUR OWN avatar/name opens canonical "Your Profile" (owner
 *   controls: Edit Profile, delete posts, manage Weekly Events, …).
 * - Tapping anyone else opens their normal profile.
 * - Always a plain stack push, so Back returns to the exact screen you came
 *   from — never the Home or Profile tab.
 *
 * Pass `viewerId` when the caller already has it (skips a store read); it
 * falls back to the authenticated session otherwise.
 */
export function openProfile(
  router: Pick<Router, 'push'>,
  userId: string | null | undefined,
  viewerId?: string | null,
): void {
  if (!userId) return;
  const meId = viewerId ?? useAuthStore.getState().session?.user.id ?? null;
  if (meId && userId === meId) {
    router.push('/profile/own');
    return;
  }
  router.push({ pathname: '/profile/[userId]', params: { userId } });
}

/** True when `userId` is the signed-in user. */
export function isOwnUser(userId: string | null | undefined, viewerId?: string | null): boolean {
  if (!userId) return false;
  const meId = viewerId ?? useAuthStore.getState().session?.user.id ?? null;
  return !!meId && userId === meId;
}
