import { useEffect, useRef } from 'react';
import { useAuthStore } from '@weglue/shared';
import { getPermissionState, requestPermissionFromUserAction } from '../lib/notifications/permissions';
import { onPermissionDecision } from '../lib/notifications/permissionSync';
import { registerPushTokenIfPermitted } from '../lib/notifications/registerPush';

/**
 * Fix 5 — the SECOND sanctioned automatic call site for the native
 * notification-permission box. lib/notifications/permissions.ts documents
 * the first (useFirstLoginPushPermission, over Home, gated on the
 * brand-new-account-only `push_permission_prompt_pending` server flag,
 * mounted in (tabs)/_layout.tsx). This one fires over the Members
 * sub-channels screen, immediately after a successful installed — or
 * Android post-install — invitation redemption, for ANY account, new or
 * existing, because /chat/[chatId] is a sibling stack route outside
 * (tabs): the first hook's effect never runs on this screen at all.
 *
 * Deliberately gated on the OS-level permission status being `undetermined`
 * (Notifications.getPermissionsAsync()), NOT the new-account-only DB flag —
 * an existing account that never answered the prompt is exactly who this
 * exists for. An account that already answered (granted or denied) reads a
 * non-undetermined state and this is a no-op; `requestPermissionsAsync`
 * itself is additionally a no-op once the OS has recorded a decision, so
 * this stays safe even across a remount.
 */
export function useInvitePushPermission(active: boolean): void {
  const { session } = useAuthStore();
  const userId = session?.user?.id;
  const attempted = useRef(false);

  useEffect(() => {
    if (!active || !userId || attempted.current) return;
    attempted.current = true;
    void (async () => {
      const state = await getPermissionState();
      if (state !== 'undetermined') return;
      const result = await requestPermissionFromUserAction();
      void onPermissionDecision(userId, result);
      if (result === 'granted') {
        void registerPushTokenIfPermitted();
      }
    })();
  }, [active, userId]);
}
