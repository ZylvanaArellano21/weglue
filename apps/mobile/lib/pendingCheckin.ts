import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';

// ─── Deferred check-in destination ──────────────────────────────────────────
// Mirrors lib/pendingInvite.ts's contract exactly, for the same reason: a
// student who scans the permanent attendance QR while signed out has to
// survive Login (or Create an Account → verify email → onboarding) and still
// land back on that exact event's check-in screen, not Home. Persisted to
// disk the instant the checkin screen sees no session, consumed once by
// resumePendingCheckin (called from app/index.tsx, right next to
// resumePendingInvite) after auth/onboarding settles.

const KEY = 'weglue-pending-checkin';

interface PendingCheckin {
  clubId: string;
  /** Absent when the QR/link was the club-level resolver (event not yet
   *  chosen) — resume then returns to the resolver, which re-resolves the
   *  active event(s) itself rather than trusting a stale eventId. */
  eventId?: string;
}

export async function setPendingCheckin(target: PendingCheckin): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(target));
  } catch {
    // A storage failure must never crash the checkin screen.
  }
}

export async function getPendingCheckin(): Promise<PendingCheckin | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.clubId === 'string' && (parsed.eventId === undefined || typeof parsed.eventId === 'string')) {
      return parsed as PendingCheckin;
    }
    return null;
  } catch {
    return null;
  }
}

export async function clearPendingCheckin(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

/**
 * Called once auth/onboarding has fully settled (root index screen), right
 * alongside resumePendingInvite. Returns whether a pending checkin was found,
 * so the caller knows whether to fall through to its normal destination.
 */
export async function resumePendingCheckin(): Promise<boolean> {
  const target = await getPendingCheckin();
  if (!target) return false;
  await clearPendingCheckin();
  if (target.eventId) {
    router.replace({
      pathname: '/checkin/[clubId]/[eventId]',
      params: { clubId: target.clubId, eventId: target.eventId },
    } as any);
  } else {
    router.replace({ pathname: '/checkin/[clubId]', params: { clubId: target.clubId } } as any);
  }
  return true;
}
