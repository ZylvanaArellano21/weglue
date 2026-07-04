/**
 * Privacy Center Screen
 *
 * DATA LAYER — Cursor (Step 2) renders the UI. Do not change the hooks below.
 *
 * Props:
 *   settings            PrivacySettings | null  — { is_private, hide_interests, hide_events }
 *   isLoading           boolean
 *
 * Toggle callbacks (optimistic — UI updates immediately, reverts on error):
 *   onTogglePrivate         (value: boolean) => void
 *   onToggleHideInterests   (value: boolean) => void
 *   onToggleHideEvents      (value: boolean) => void
 *
 * Toggle labels:
 *   is_private:     false → "Public"  / true → "Private"
 *   hide_interests: false → "Visible" / true → "Hidden"
 *   hide_events:    false → "Visible" / true → "Hidden"
 *
 * IMPORTANT UX NOTE — Private account:
 *   Going private does NOT retroactively revoke existing Gluemates.
 *   Existing accepted follows remain. Only NEW follow requests are put in a
 *   pending state. Show a one-time info sheet the FIRST TIME the user toggles
 *   to private, explaining this behavior.
 *
 * Owner visibility rule (for reference — enforced in resolveProfileVisibility()):
 *   The profile owner always sees their own full profile regardless of these flags.
 *   These flags only affect how OTHER users see the profile.
 */

import { Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '@weglue/shared';
import {
  usePrivacySettings,
  useSetPrivateAccount,
  useSetHideInterests,
  useSetHideEvents,
} from '../../hooks/usePrivacyCenter';

export default function PrivacyCenterScreen() {
  const { session } = useAuthStore();
  const userId = session?.user.id;

  const { data: settings, isLoading } = usePrivacySettings(userId);
  const setPrivate        = useSetPrivateAccount(userId);
  const setHideInterests  = useSetHideInterests(userId);
  const setHideEvents     = useSetHideEvents(userId);

  const onTogglePrivate         = (value: boolean) => setPrivate.mutate(value);
  const onToggleHideInterests   = (value: boolean) => setHideInterests.mutate(value);
  const onToggleHideEvents      = (value: boolean) => setHideEvents.mutate(value);

  // ─── Cursor: render Privacy Center toggle list UI here ────────────────────
  // Variables: settings, isLoading, onTogglePrivate, onToggleHideInterests, onToggleHideEvents
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#FDFBEF' }}>
      <Text style={{ padding: 20, fontSize: 16, color: '#111' }}>Privacy Center</Text>
    </SafeAreaView>
  );
}
