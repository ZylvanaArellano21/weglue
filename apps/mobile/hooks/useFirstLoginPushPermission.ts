import { useEffect, useRef } from 'react';
import { useAuthStore } from '@weglue/shared';
import { supabase } from '../lib/supabase';
import { writeCachedProfile } from '../lib/profileCache';
import {
  hasAskedFirstLoginBefore,
  markFirstLoginAsked,
  requestPermissionFromUserAction,
} from '../lib/notifications/permissions';
import { onPermissionDecision } from '../lib/notifications/permissionSync';
import { registerPushTokenIfPermitted } from '../lib/notifications/registerPush';

/**
 * Fires the native OS notification-permission box exactly once: the moment a
 * brand-new account's session first reaches the authenticated tabs.
 *
 * Gated by profiles.push_permission_prompt_pending (migration 081), which is
 * set true ONLY at the moment handle_new_user()/ensure_profile() insert a
 * brand-new profile row — an existing account's row is never touched, so it
 * always reads false and this hook is a no-op for it. Two independent
 * one-shot guards make a repeat ask impossible even under a killed-app race:
 * the server flag (authoritative, consumed via consume_push_permission_
 * prompt()) and a device-local AsyncStorage flag (fast, set synchronously
 * before the request fires).
 *
 * Mounted unconditionally in (tabs)/_layout.tsx, alongside the other
 * app-wide effects — see that file for why every route into the tabs other
 * than an explicit signInWithPassword() success is closed off before this
 * can ever run (apps/mobile/app/auth/confirmed.tsx no longer lands a
 * just-verified session in Home; it signs back out and hands off to Login).
 */
export function useFirstLoginPushPermission(): void {
  const { session, profile, setProfile } = useAuthStore();
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    if (!session?.user?.email_confirmed_at) return;
    if (!profile || profile.push_permission_prompt_pending !== true) return;

    const userId = session.user.id;

    attempted.current = true;
    void (async () => {
      if (await hasAskedFirstLoginBefore(userId)) {
        // The server flag is still true only because a prior attempt's
        // consume call never completed — never re-show the OS box for it.
        return;
      }

      // Optimistic: clear locally so a re-render/re-mount within this same
      // session can never re-enter (the ref guard already prevents that, but
      // this keeps profile state consistent with what we are about to ask).
      const cleared = { ...profile, push_permission_prompt_pending: false };
      setProfile(cleared);
      void writeCachedProfile(userId, { profile: cleared, isOnboarded: true });

      await markFirstLoginAsked(userId);

      const result = await requestPermissionFromUserAction();
      // Correction 2: this IS the account's "initial system response" —
      // Allow/Don't Allow cascades onto the master switch and every category.
      void onPermissionDecision(userId, result);
      if (result === 'granted') {
        void registerPushTokenIfPermitted();
      }

      try {
        await supabase.rpc('consume_push_permission_prompt');
      } catch (e) {
        // The device-local guard above already prevents a repeat ask; the
        // server flag catching up on a later successful call is a bonus.
        console.warn('[push] consume_push_permission_prompt failed:', e);
      }
    })();
  }, [session?.user?.id, session?.user?.email_confirmed_at, profile, setProfile]);
}
