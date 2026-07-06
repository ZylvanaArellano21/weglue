import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Profile } from '@weglue/shared';

// Cold-start bootstrap cache: the last known profile + onboarded flag, keyed by
// user id so accounts never leak into each other. Lets the navigation guard
// route to the tabs instantly on reopen instead of blocking on two network
// round trips; a background sync refreshes the real data right after.

const KEY_PREFIX = 'weglue-profile-cache-v1:';

export interface CachedProfileState {
  profile: Profile;
  isOnboarded: boolean;
}

export async function readCachedProfile(
  userId: string,
): Promise<CachedProfileState | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY_PREFIX + userId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedProfileState;
    if (!parsed?.profile?.id || parsed.profile.id !== userId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function writeCachedProfile(
  userId: string,
  state: CachedProfileState,
): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_PREFIX + userId, JSON.stringify(state));
  } catch {
    // Cache write failures must never break auth
  }
}

export async function clearCachedProfile(userId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY_PREFIX + userId);
  } catch {
    // ignore
  }
}
