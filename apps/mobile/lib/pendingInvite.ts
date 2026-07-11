import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── Deferred chat invitation token ─────────────────────────────────────────
// A chat invite must survive: cold app launch, a long account creation, closing
// onboarding, closing the app, and returning to the link later. We persist the
// token to disk the instant it arrives and only consume it once the user is
// fully authenticated + onboarded (or immediately if they already are).
//
// The token itself carries NO permissions — it is an opaque lookup key. All
// authorization happens server-side in join_chat_invitation.

const KEY = 'weglue-pending-invite-token';

export async function setPendingInvite(token: string): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, token);
  } catch {
    // A storage failure must never crash the launch path.
  }
}

export async function getPendingInvite(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export async function clearPendingInvite(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

/**
 * Extracts an invite token from any We Glue invite URL:
 *   weglue://invite/<token>
 *   https://weglue.app/invite/<token>
 * Returns null for non-invite links.
 */
export function parseInviteToken(url: string | null | undefined): string | null {
  if (typeof url !== 'string' || url.length === 0) return null;
  const match = url.match(/\/invite\/([A-Za-z0-9._-]+)/);
  return match ? match[1] : null;
}
