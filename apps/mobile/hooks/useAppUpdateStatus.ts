/**
 * Native "Update" badge status — the ONE place that decides whether a newer,
 * actually publicly downloadable App Store/Play Store version exists.
 *
 * Installed version comes from `expo-application`'s native fields, which
 * read the compiled binary's Info.plist/AndroidManifest directly — these can
 * never be moved by an OTA/EAS Update push, unlike `Constants.expoConfig`
 * (baked into the JS bundle). That distinction matters here specifically:
 * an OTA must never be able to fake or clear this badge.
 *
 * Backend (migration 090): the `app_releases` table has one row per
 * platform+version; a row only counts once `is_public` is true, which is
 * only ever set by publish_app_release() — a manual, deliberate action
 * (never inferred from a store-API poll), so this can never light up for a
 * TestFlight/internal-testing/in-review build or a staged rollout still in
 * progress. Missing row / any query error all resolve to "no update
 * available" — a failed check must never produce a false-positive badge.
 *
 * Refetches on every app-foreground transition ("after returning/
 * relaunching, verify the installed version"), and ONLY then — opening the
 * sidebar, tapping Update, or opening the store must never affect this on
 * their own.
 */
import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppState, Platform } from 'react-native';
import * as Application from 'expo-application';
import { supabase } from '../lib/supabase';

export type AppUpdateStatus = {
  updateAvailable: boolean;
  latestVersion: string | null;
  installedVersion: string | null;
};

const QUERY_KEY = ['appUpdateStatus'] as const;

// Dotted-numeric compare ("1.0.10" > "1.0.3") — a plain string compare would
// rank "1.0.10" below "1.0.3".
function isNewer(latest: string, installed: string): boolean {
  const a = latest.split('.').map((n) => parseInt(n, 10) || 0);
  const b = installed.split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

async function fetchAppUpdateStatus(): Promise<AppUpdateStatus> {
  const installedVersion = Application.nativeApplicationVersion;
  const platform = Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : null;

  if (!installedVersion || !platform) {
    return { updateAvailable: false, latestVersion: null, installedVersion };
  }

  const { data, error } = await supabase
    .from('app_releases')
    .select('version')
    .eq('platform', platform)
    .eq('is_public', true)
    .order('released_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data?.version) {
    return { updateAvailable: false, latestVersion: null, installedVersion };
  }

  return {
    updateAvailable: isNewer(data.version, installedVersion),
    latestVersion: data.version,
    installedVersion,
  };
}

export function useAppUpdateStatus(): AppUpdateStatus & {
  isLoading: boolean;
  refetch: () => void;
} {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchAppUpdateStatus,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  useEffect(() => {
    const sub = AppState.addEventListener('change', (status) => {
      if (status === 'active' && Platform.OS !== 'web') {
        void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      }
    });
    return () => sub.remove();
  }, [queryClient]);

  return {
    updateAvailable: query.data?.updateAvailable ?? false,
    latestVersion: query.data?.latestVersion ?? null,
    installedVersion: query.data?.installedVersion ?? Application.nativeApplicationVersion,
    isLoading: query.isLoading,
    refetch: () => void query.refetch(),
  };
}
