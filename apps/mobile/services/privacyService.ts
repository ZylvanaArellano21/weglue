import { supabase } from '../lib/supabase';

// ─── Privacy Settings ─────────────────────────────────────────────────────────

export interface PrivacySettings {
  is_private: boolean;
  hide_interests: boolean;
  hide_events: boolean;
}

// ─── Fetch current settings ───────────────────────────────────────────────────

export async function getPrivacySettings(userId: string): Promise<PrivacySettings> {
  const { data } = await supabase
    .from('user_privacy')
    .select('is_private, hide_interests, hide_events')
    .eq('user_id', userId)
    .maybeSingle();

  return {
    is_private:     data?.is_private     ?? false,
    hide_interests: data?.hide_interests ?? false,
    hide_events:    data?.hide_events    ?? false,
  };
}

// ─── Update helpers ───────────────────────────────────────────────────────────
//
// Going private does NOT retroactively revoke existing accepted follows.
// It only gates NEW follow requests going forward: followUser() in
// followService.ts already checks is_private and sets status = 'pending'.
//

async function upsertPrivacyField(
  userId: string,
  fields: Partial<PrivacySettings>,
): Promise<void> {
  const { error } = await supabase
    .from('user_privacy')
    .upsert({ user_id: userId, ...fields }, { onConflict: 'user_id' });

  if (error) throw error;
}

export async function setPrivateAccount(
  userId: string,
  isPrivate: boolean,
): Promise<void> {
  await upsertPrivacyField(userId, { is_private: isPrivate });
}

export async function setHideInterests(
  userId: string,
  hide: boolean,
): Promise<void> {
  await upsertPrivacyField(userId, { hide_interests: hide });
}

export async function setHideEvents(
  userId: string,
  hide: boolean,
): Promise<void> {
  await upsertPrivacyField(userId, { hide_events: hide });
}

// ─── Visibility helper — used by any screen rendering someone else's profile ──
//
// Returns which sections should be visible to the viewer.
// Profile owner always sees full profile regardless of flags.
//
export interface ProfileVisibility {
  showInterests: boolean;
  showEvents: boolean;
}

export function resolveProfileVisibility(
  settings: PrivacySettings,
  isOwnProfile: boolean,
): ProfileVisibility {
  if (isOwnProfile) {
    return { showInterests: true, showEvents: true };
  }
  return {
    showInterests: !settings.hide_interests,
    showEvents:    !settings.hide_events,
  };
}

// ─── Prop / Callback interfaces for Cursor (Step 2) ──────────────────────────
//
// PrivacyCenterScreenProps (apps/mobile/app/privacy-center/index.tsx):
//   settings:           PrivacySettings
//   isLoading:          boolean
//   onTogglePrivate:    (value: boolean) => Promise<void>
//   onToggleHideInterests: (value: boolean) => Promise<void>
//   onToggleHideEvents:    (value: boolean) => Promise<void>
//   privateLabel:       string  — 'Private' | 'Public', toggled by is_private
//
// Note: going private shows a one-time info sheet to the user explaining
// that existing Gluemates are unaffected; only new follow requests are gated.
