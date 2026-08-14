/**
 * Keeps notification_preferences honest about OS permission state.
 *
 * Correction 2: Allow must turn ON the master switch AND every category;
 * Don't Allow must turn OFF the master switch AND every category — not just
 * push_enabled, and not merely dimmed in the UI while the database still
 * claims a category is on. A later MANUAL per-category choice must stay
 * independent, so this only ever cascades on an actual decision or a real
 * observed transition — never on a routine re-check that found no change
 * (which would otherwise silently wipe a user's customization every time the
 * app foregrounds).
 */
import { supabase } from '../supabase';
import type { PermissionState } from './permissions';

function isGranted(state: PermissionState): boolean {
  return state === 'granted';
}

async function cascadePermissionToPreferences(
  userId: string,
  state: PermissionState,
): Promise<void> {
  const enabled = isGranted(state);
  const { error } = await supabase.from('notification_preferences').upsert(
    {
      user_id: userId,
      push_enabled: enabled,
      push_messages: enabled,
      push_events: enabled,
      push_clubs: enabled,
      push_social: enabled,
      push_social_proof: enabled,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );
  if (error) {
    console.warn('[push] cascadePermissionToPreferences failed:', error);
  }
}

// Per-process memory of the last permission value actually observed, so a
// routine foreground re-check can tell "nothing changed" from "this flipped
// while backgrounded." Resets on cold start — the first read each session
// primes silently rather than risk cascading on ordinary app boot.
let lastKnown: PermissionState | null = null;

/**
 * Call after the user answers the native OS box (any call site of
 * requestPermissionFromUserAction). This IS the "initial system response" —
 * it always cascades, unconditionally.
 */
export async function onPermissionDecision(
  userId: string,
  state: PermissionState,
): Promise<void> {
  lastKnown = state;
  await cascadePermissionToPreferences(userId, state);
}

/**
 * Call from a passive re-check (AppState foreground listeners that already
 * poll getPermissionState for other reasons). Cascades ONLY when granted vs.
 * not-granted actually differs from the last known value in this process —
 * e.g. the user flipped it in the OS Settings app while backgrounded.
 */
export async function reconcilePermissionChange(
  userId: string,
  state: PermissionState,
): Promise<void> {
  const previous = lastKnown;
  lastKnown = state;
  if (previous === null) return; // first read this session — nothing to compare yet
  if (isGranted(previous) === isGranted(state)) return; // no real transition
  await cascadePermissionToPreferences(userId, state);
}
