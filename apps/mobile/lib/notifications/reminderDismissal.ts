/**
 * Dismissal cadence for the Home-tab "turn on notifications" reminder
 * (EnableNotificationsCard's `home` variant, above the Posts/Events
 * selector). Keyed per account, like hasAskedFirstLoginBefore in
 * permissions.ts, so switching accounts on the same device never inherits
 * another user's dismissal history.
 *
 * Rules: dismissing hides the reminder for 7 days, then it reappears if
 * notifications are still disabled; a maximum of 3 dismissals total, after
 * which it stops reappearing automatically. None of this applies once
 * permission is actually granted — that check lives in the card itself.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY_PREFIX = 'weglue-notif-reminder-dismissal:';
const HIDE_DAYS = 7;
const MAX_DISMISSALS = 3;

type DismissalState = {
  count: number;
  lastDismissedAt: number | null;
};

function keyFor(userId: string): string {
  return KEY_PREFIX + userId;
}

async function readState(userId: string): Promise<DismissalState> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(userId));
    if (!raw) return { count: 0, lastDismissedAt: null };
    const parsed = JSON.parse(raw) as Partial<DismissalState>;
    return { count: parsed.count ?? 0, lastDismissedAt: parsed.lastDismissedAt ?? null };
  } catch {
    return { count: 0, lastDismissedAt: null };
  }
}

export async function shouldShowReminder(userId: string): Promise<boolean> {
  const { count, lastDismissedAt } = await readState(userId);
  if (count >= MAX_DISMISSALS) return false;
  if (lastDismissedAt === null) return true;
  const elapsedDays = (Date.now() - lastDismissedAt) / (1000 * 60 * 60 * 24);
  return elapsedDays >= HIDE_DAYS;
}

export async function recordDismissal(userId: string): Promise<void> {
  const { count } = await readState(userId);
  const next: DismissalState = { count: count + 1, lastDismissedAt: Date.now() };
  try {
    await AsyncStorage.setItem(keyFor(userId), JSON.stringify(next));
  } catch {
    // Losing this only costs one extra reminder showing sooner than it should.
  }
}
