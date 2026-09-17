import { type Campus, toCampuses, validateCampusEmail } from '@weglue/shared';
import { supabase } from '../lib/supabase';
import { CONFIRM_EMAIL_CHANGE_REDIRECT } from '../lib/authFlow';

// ─── Constants ───────────────────────────────────────────────────────────────

const COOLDOWN_DAYS = 30;

export const ACCOUNT_CENTER_ERRORS = {
  COOLDOWN: 'cooldown',
  USERNAME_TAKEN: 'username_taken',
  INVALID_EMAIL: 'invalid_email',
  EMAIL_IN_USE: 'email_in_use',
  SEND_FAILED: 'send_failed',
  SESSION_EXPIRED: 'session_expired',
  NETWORK: 'network',
  WRONG_PASSWORD: 'wrong_password',
  MISMATCH: 'password_mismatch',
  WEAK_PASSWORD: 'weak_password',
} as const;

export type AccountCenterError = (typeof ACCOUNT_CENTER_ERRORS)[keyof typeof ACCOUNT_CENTER_ERRORS];

export interface CooldownError {
  type: typeof ACCOUNT_CENTER_ERRORS.COOLDOWN;
  nextAllowedDate: Date;
}

// Password strength: at least 8 chars, 1 uppercase, 1 number
export function isStrongPassword(password: string): boolean {
  return (
    password.length >= 8 &&
    /[A-Z]/.test(password) &&
    /[0-9]/.test(password)
  );
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function formatDateForError(date: Date): string {
  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

// ─── Username Change ──────────────────────────────────────────────────────────

export interface UsernameAvailability {
  available: boolean;
}

export async function checkUsernameAvailability(
  username: string,
  currentUserId: string,
): Promise<UsernameAvailability> {
  if (!username.trim()) return { available: false };

  const { data } = await supabase
    .from('profiles')
    .select('id')
    .eq('username', username.trim().toLowerCase())
    .neq('id', currentUserId)
    .maybeSingle();

  return { available: !data };
}

export type ChangeUsernameResult =
  | { success: true }
  | { success: false; error: AccountCenterError; message: string };

export async function changeUsername(
  userId: string,
  newUsername: string,
): Promise<ChangeUsernameResult> {
  // Fetch current cooldown state
  const { data: profile } = await supabase
    .from('profiles')
    .select('username_changed_at')
    .eq('id', userId)
    .single();

  if (profile?.username_changed_at) {
    const lastChanged = new Date(profile.username_changed_at as string);
    const nextAllowed = addDays(lastChanged, COOLDOWN_DAYS);
    if (new Date() < nextAllowed) {
      return {
        success: false,
        error: ACCOUNT_CENTER_ERRORS.COOLDOWN,
        message: `You can change your username again on ${formatDateForError(nextAllowed)}.`,
      };
    }
  }

  const trimmed = newUsername.trim().toLowerCase();

  // Check uniqueness
  const { available } = await checkUsernameAvailability(trimmed, userId);
  if (!available) {
    return {
      success: false,
      error: ACCOUNT_CENTER_ERRORS.USERNAME_TAKEN,
      message: 'That username is already taken.',
    };
  }

  const { error } = await supabase
    .from('profiles')
    .update({ username: trimmed, username_changed_at: new Date().toISOString() })
    .eq('id', userId);

  if (error) throw error;
  return { success: true };
}

// ─── Email Change ─────────────────────────────────────────────────────────────

export type ChangeEmailResult =
  | { success: true }
  | { success: false; error: AccountCenterError; message: string };

const EMAIL_FORMAT_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * The campus of the signed-in account, for the email rule that applies to it.
 *
 * Read from `my_campus()` rather than from the picker's `list_active_campuses()`
 * — that one is keyed by slug and only returns active campuses, and an account
 * must still be able to manage its email if its campus is temporarily
 * deactivated. Returns null on any failure so callers can fail CLOSED instead
 * of silently applying some other campus's rule.
 */
async function loadMyCampus(): Promise<Campus | null> {
  try {
    const { data, error } = await supabase.rpc('my_campus');
    if (error) return null;
    return toCampuses(data)[0] ?? null;
  } catch {
    return null;
  }
}

// Safe email-change flow:
//   1. Validate the format locally, then the new address against the account's
//      own campus rule.
//   2. Confirm the session is still alive (local check, no network).
//   3. Ask Supabase Auth to start the change — GoTrue itself rejects an email
//      that is already registered to another account, so nothing is ever sent
//      in that case; on success it emails a verification link to the NEW
//      address. The account email does NOT change until that link is opened.
//   4. Every failure path returns a typed result (never throws), so the UI
//      can re-enable the button and show a clear message without freezing.
export async function changeEmail(
  userId: string,
  newEmail: string,
): Promise<ChangeEmailResult> {
  try {
    const trimmedEmail = newEmail.trim().toLowerCase();

    if (!EMAIL_FORMAT_REGEX.test(trimmedEmail)) {
      return {
        success: false,
        error: ACCOUNT_CENTER_ERRORS.INVALID_EMAIL,
        message: 'Please enter a valid email address.',
      };
    }

    // The rule that applies is THIS account's campus rule: Lone Star rejects
    // school-issued addresses, Texas A&M accepts only its own domain. Signup
    // and Account Center must agree, or the campus rule could be escaped by
    // creating an account and then changing its email. The backend enforces the
    // same policy on the email change itself, so a bypassed client gains
    // nothing; this is the immediate, in-form answer.
    const campus = await loadMyCampus();
    if (!campus) {
      return {
        success: false,
        error: ACCOUNT_CENTER_ERRORS.NETWORK,
        message: 'Network error. Check your connection and try again.',
      };
    }

    const emailCheck = validateCampusEmail(campus, trimmedEmail);
    if (!emailCheck.valid) {
      return {
        success: false,
        error: ACCOUNT_CENTER_ERRORS.INVALID_EMAIL,
        message: emailCheck.reason!,
      };
    }

    // Local session check — no network round-trip.
    const { data: sessionData } = await supabase.auth.getSession();
    const session = sessionData?.session;
    if (!session) {
      return {
        success: false,
        error: ACCOUNT_CENTER_ERRORS.SESSION_EXPIRED,
        message: 'Your session has expired. Please log in again.',
      };
    }

    if (session.user.email?.toLowerCase() === trimmedEmail) {
      return {
        success: false,
        error: ACCOUNT_CENTER_ERRORS.INVALID_EMAIL,
        message: 'That is already your current email address.',
      };
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('email_changed_at')
      .eq('id', userId)
      .single();

    if (profile?.email_changed_at) {
      const lastChanged = new Date(profile.email_changed_at as string);
      const nextAllowed = addDays(lastChanged, COOLDOWN_DAYS);
      if (new Date() < nextAllowed) {
        return {
          success: false,
          error: ACCOUNT_CENTER_ERRORS.COOLDOWN,
          message: `You can change your email again on ${formatDateForError(nextAllowed)}.`,
        };
      }
    }

    // Starts the verified email change. The current email stays active and
    // displayed until the new address is verified. emailRedirectTo carries our
    // own flow=email_change marker so the landing page never has to guess
    // whether this confirmation came from Account Center or from signup.
    const { error } = await supabase.auth.updateUser(
      { email: trimmedEmail },
      { emailRedirectTo: CONFIRM_EMAIL_CHANGE_REDIRECT },
    );

    if (error) {
      const msg = (error.message ?? '').toLowerCase();
      const code = (error as { code?: string }).code ?? '';
      if (
        code === 'email_exists' ||
        (msg.includes('already') &&
          (msg.includes('registered') || msg.includes('exists') || msg.includes('in use')))
      ) {
        return {
          success: false,
          error: ACCOUNT_CENTER_ERRORS.EMAIL_IN_USE,
          message: 'That email is already used by another account.',
        };
      }
      if (code === 'over_email_send_rate_limit' || msg.includes('rate limit') || msg.includes('security purposes')) {
        return {
          success: false,
          error: ACCOUNT_CENTER_ERRORS.SEND_FAILED,
          message: 'Too many attempts. Please wait a minute and try again.',
        };
      }
      return {
        success: false,
        error: ACCOUNT_CENTER_ERRORS.SEND_FAILED,
        message: 'Could not send the verification email. Please try again.',
      };
    }

    // Track cooldown timestamp only after the verification email actually sent.
    await supabase
      .from('profiles')
      .update({ email_changed_at: new Date().toISOString() })
      .eq('id', userId);

    return { success: true };
  } catch {
    return {
      success: false,
      error: ACCOUNT_CENTER_ERRORS.NETWORK,
      message: 'Network error. Check your connection and try again.',
    };
  }
}

// ─── Password Change ──────────────────────────────────────────────────────────

export type ChangePasswordResult =
  | { success: true }
  | { success: false; error: AccountCenterError; message: string };

export async function changePassword(
  newPassword: string,
  confirmPassword: string,
): Promise<ChangePasswordResult> {
  if (newPassword !== confirmPassword) {
    return {
      success: false,
      error: ACCOUNT_CENTER_ERRORS.MISMATCH,
      message: 'Passwords do not match.',
    };
  }

  if (!isStrongPassword(newPassword)) {
    return {
      success: false,
      error: ACCOUNT_CENTER_ERRORS.WEAK_PASSWORD,
      message: 'Password must be at least 8 characters with one uppercase letter and one number.',
    };
  }

  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) {
    if (error.message.toLowerCase().includes('password')) {
      return {
        success: false,
        error: ACCOUNT_CENTER_ERRORS.WRONG_PASSWORD,
        message: error.message,
      };
    }
    throw error;
  }

  return { success: true };
}

// ─── Account Deletion ─────────────────────────────────────────────────────────
//
// One server-side call: the `delete-account` Supabase Edge Function verifies
// the caller's own JWT, runs delete_own_user_data() (anonymizes messages in
// shared conversations, deletes all owned rows), and removes the auth.users
// record with the service-role admin client. The service-role key never
// touches this app. Storage objects (avatar, post images) are best-effort
// cleaned client-side first.
//
// The caller (UI) is responsible for:
//   - Showing a double-confirmation dialog before invoking this
//   - Signing out and routing to the welcome screen after this resolves
//
export async function deleteOwnAccount(): Promise<void> {
  // NOTHING destructive happens client-side before the server confirms.
  //
  // This function used to delete the user's avatar and post images from Storage
  // FIRST, then call the Edge Function. When the server call then failed, the
  // account still existed but its images were already gone — the profile
  // rendered empty and the sidebar showed an Unknown User while the user was
  // still signed in. That is the ghost account. Storage cleanup now happens
  // server-side inside the Edge Function, with the service-role client, only
  // after the data deletion has succeeded — and only ever as part of a
  // deletion that actually goes through.
  //
  // Retrying after a partial failure is safe: every server-side step is
  // idempotent.
  const { data, error } = await supabase.functions.invoke('delete-account', {
    method: 'POST',
    body: {},
  });

  if (error) {
    console.error('[deleteOwnAccount] edge function error:', error);
    throw error;
  }

  const result = data as
    | { success?: boolean; dataDeleted?: boolean; authDeleted?: boolean }
    | null;

  // The account is only gone when the auth record is gone. A response that
  // deleted the data but left auth.users behind is a FAILURE, not a success —
  // treating it as success is what let a half-deleted account sign back in.
  if (!result?.success || !result.authDeleted) {
    throw new Error('Account deletion failed');
  }
}

// ─── Prop / Callback interfaces for Cursor (Step 2) ──────────────────────────
//
// AccountCenterScreenProps (apps/mobile/app/account-center/index.tsx):
//   currentEmail:       string                   — from supabase.auth.getUser()
//   currentUsername:    string
//   onChangeEmail:      (newEmail: string) => Promise<ChangeEmailResult>
//   onChangeUsername:   (newUsername: string) => Promise<ChangeUsernameResult>
//   onChangePassword:   (newPw: string, confirmPw: string) => Promise<ChangePasswordResult>
//   onDeleteAccount:    () => Promise<void>       — after double-confirm dialog
//   usernameAvailability: UsernameAvailability | null  — real-time check result
//   onCheckUsername:    (username: string) => void  — debounced trigger
//
// DeletionConfirmationCallbackShape:
//   step:       1 | 2    — two-step confirmation
//   onConfirm1: () => void   — advance to step 2
//   onConfirm2: () => Promise<void>  — execute deletion
//   onCancel:   () => void
