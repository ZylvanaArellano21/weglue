import * as Linking from 'expo-linking';
import { supabase } from './supabase';

// ─── Help / Support email ─────────────────────────────────────────────────────

export const SUPPORT_EMAIL = 'zylvana.arellano.campos@gmail.com';

// Opens the device's email composer addressed to support. Returns false when
// no mail app is available (e.g. Mail deleted on iOS, no email client on
// Android) so the caller can show a copyable fallback instead of crashing.
export async function openSupportEmail(): Promise<boolean> {
  const url = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('We Glue Support')}`;
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}

// ─── Sign out ─────────────────────────────────────────────────────────────────

// Signs out without ever freezing the UI. The default supabase signOut() makes
// a network call to revoke the refresh token and can hang on a bad connection
// — the exact "logout gets stuck until you force-close the app" bug. Here the
// local session is cleared instantly (no network), which flips the auth store
// and routes to the welcome screen, and the server-side token revocation is
// fired in the background where a failure is harmless (the token expires on
// its own).
export async function safeSignOut(): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;

  // Instant, local-only: clears AsyncStorage session + fires SIGNED_OUT.
  await supabase.auth.signOut({ scope: 'local' });

  // Best-effort global revocation in the background — never awaited by the UI.
  if (accessToken) {
    const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL as string;
    const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY as string;
    if (supabaseUrl && anonKey) {
      void fetch(`${supabaseUrl}/auth/v1/logout?scope=global`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          apikey: anonKey,
        },
      }).catch(() => {});
    }
  }
}
