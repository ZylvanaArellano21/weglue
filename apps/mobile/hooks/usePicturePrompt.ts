import { useCallback } from 'react';
import { useAuthStore } from '@weglue/shared';
import { supabase } from '../lib/supabase';
import { writeCachedProfile } from '../lib/profileCache';

/**
 * Permanently hides the Home "Personalize your picture!" prompt.
 *
 * The state is server-side (profiles.picture_prompt_status) so it holds across
 * logout/login, reinstalls, and other devices — a device-local flag would let
 * the prompt reappear on a second phone. The local profile + its disk cache are
 * updated straight away so the prompt disappears on this device instantly
 * rather than after the next profile sync.
 */
export function useDismissPicturePrompt() {
  const { profile, setProfile } = useAuthStore();

  return useCallback(async () => {
    if (!profile || profile.picture_prompt_status !== 'pending') return;

    // Hide it on this device immediately so the tap feels instant.
    const hidden = { ...profile, picture_prompt_status: 'hidden' as const };
    setProfile(hidden);
    void writeCachedProfile(profile.id, { profile: hidden, isOnboarded: true });

    // Then persist. supabase-js query builders are LAZY thenables — they only
    // issue the request when awaited, so a bare `void supabase.rpc(...)` sends
    // nothing at all and the prompt silently returns on the next profile sync.
    const { error } = await supabase.rpc('dismiss_picture_prompt');

    if (error) {
      // Couldn't persist — restore the prompt rather than leave the device
      // showing it as dismissed while the server still says 'pending'.
      setProfile(profile);
      void writeCachedProfile(profile.id, { profile, isOnboarded: true });
    }
  }, [profile, setProfile]);
}
