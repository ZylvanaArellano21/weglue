import { supabase } from '../lib/supabase';

// ─── Constants ───────────────────────────────────────────────────────────────

const COOLDOWN_DAYS = 30;

export const ACCOUNT_CENTER_ERRORS = {
  COOLDOWN: 'cooldown',
  USERNAME_TAKEN: 'username_taken',
  INVALID_EMAIL: 'invalid_email',
  WRONG_PASSWORD: 'wrong_password',
  MISMATCH: 'password_mismatch',
  WEAK_PASSWORD: 'weak_password',
} as const;

export type AccountCenterError = (typeof ACCOUNT_CENTER_ERRORS)[keyof typeof ACCOUNT_CENTER_ERRORS];

export interface CooldownError {
  type: typeof ACCOUNT_CENTER_ERRORS.COOLDOWN;
  nextAllowedDate: Date;
}

// Educational email validation (mirrors onboarding isEducationalEmail)
export function isEducationalEmail(email: string): boolean {
  const lower = email.toLowerCase().trim();
  const eduPatterns = ['.edu', '.edu.au', '.ac.uk', '.ac.in', '.edu.sg'];
  return eduPatterns.some((pattern) => lower.endsWith(pattern));
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

export async function changeEmail(
  userId: string,
  newEmail: string,
): Promise<ChangeEmailResult> {
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

  const trimmedEmail = newEmail.trim().toLowerCase();

  if (!isEducationalEmail(trimmedEmail)) {
    return {
      success: false,
      error: ACCOUNT_CENTER_ERRORS.INVALID_EMAIL,
      message: 'We Glue requires a valid .edu email address.',
    };
  }

  // Supabase sends a confirmation to the NEW email — stays inactive until verified.
  const { error } = await supabase.auth.updateUser({ email: trimmedEmail });
  if (error) throw error;

  // Track cooldown timestamp immediately
  await supabase
    .from('profiles')
    .update({ email_changed_at: new Date().toISOString() })
    .eq('id', userId);

  return { success: true };
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
// Two-phase:
//   Phase 1: call deleteOwnUserData() RPC — cleans all DB rows, anonymizes messages
//   Phase 2: call the web API route DELETE /api/delete-account to delete auth.users
//
// The caller (UI) is responsible for:
//   - Showing a double-confirmation dialog before invoking this
//   - Deleting Storage objects (avatar, post images) before calling this
//   - Signing out and routing to the welcome screen after this resolves
//
export async function deleteOwnAccount(userId: string): Promise<void> {
  // Delete avatar from Storage if it exists
  const { data: profile } = await supabase
    .from('profiles')
    .select('avatar_url, avatar_type')
    .eq('id', userId)
    .maybeSingle();

  if (profile?.avatar_url && profile?.avatar_type !== 'text') {
    const url = profile.avatar_url as string;
    const avatarPath = url.split('/storage/v1/object/public/avatars/')[1];
    if (avatarPath) {
      await supabase.storage.from('avatars').remove([avatarPath]);
    }
  }

  // Delete all post images from Storage
  const { data: posts } = await supabase
    .from('posts')
    .select('image_url')
    .eq('author_id', userId)
    .not('image_url', 'is', null);

  if (posts && posts.length > 0) {
    const postPaths = (posts as any[])
      .map((p) => {
        const u = p.image_url as string;
        const parts = u.split('/storage/v1/object/public/posts/');
        return parts.length === 2 ? parts[1] : null;
      })
      .filter(Boolean) as string[];

    if (postPaths.length > 0) {
      await supabase.storage.from('posts').remove(postPaths);
    }
  }

  // Phase 1: Delete all DB data via SECURITY DEFINER RPC
  const { error: rpcError } = await supabase.rpc('delete_own_user_data');
  if (rpcError) throw rpcError;

  // Phase 2: Delete auth.users via web API route (uses admin client)
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) {
    // Session already destroyed by the RPC (profile deleted → auth mismatch)
    // Sign out locally and proceed — the auth.users row will be cleaned up
    // by the nightly admin job or webhook.
    return;
  }

  const apiBase = process.env.EXPO_PUBLIC_WEB_URL ?? 'https://weglue.app';
  const response = await fetch(`${apiBase}/api/delete-account`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok && response.status !== 401) {
    // If 401, auth record was already cleaned up. All other errors: log + continue.
    console.error('[deleteOwnAccount] API error:', response.status, await response.text());
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
