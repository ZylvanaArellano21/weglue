/**
 * Native "Update" status — the ONE place that decides whether a newer,
 * actually publicly downloadable App Store / Play Store version exists, and
 * whether that decision could even be reached.
 *
 * Installed version comes from `expo-application`'s native fields, which read
 * the compiled binary's Info.plist / AndroidManifest directly — an OTA/EAS
 * Update can never move them, unlike `Constants.expoConfig` (baked into the JS
 * bundle). So an OTA can never fake or clear this state.
 *
 * Backend truth is the `app_releases` table: one row per platform+version, and
 * a row only counts once `is_public` is true. That flag is set either by a
 * deliberate manual publish (`publish_app_release()`), or by the automated
 * store-version sync (source = 'store'), which reads ONLY the live public
 * store listing — never a TestFlight / internal-testing / in-review build, and
 * never a staged rollout still in progress.
 *
 * A failed check (network error, RLS error) resolves to `checkFailed: true`
 * and `updateAvailable: false` — it must NEVER read as "you're up to date",
 * and it must never light up the red badge.
 *
 * Refetches on every app-foreground transition ("after returning / relaunching,
 * verify the installed version"), and ONLY then — opening the sidebar, tapping
 * Update, or opening the store must never affect this on their own. Once the
 * newer version is actually installed, the next foreground reads the higher
 * native version and the badge clears itself.
 */
import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppState, Platform } from 'react-native';
import * as Application from 'expo-application';
import { isTransientError } from '@weglue/shared';
import { supabase } from '../lib/supabase';
import { isVersionNewer } from '../lib/appVersion';

export { isVersionNewer };

export type AppUpdateStatus = {
  /** A newer public store version exists AND the check succeeded. */
  updateAvailable: boolean;
  /** The check could not complete — do NOT show "up to date", offer retry. */
  checkFailed: boolean;
  latestVersion: string | null;
  installedVersion: string | null;
  /** Exact store listing URL from the backend row, or null (caller falls back). */
  storeUrl: string | null;
};

const QUERY_KEY = ['appUpdateStatus'] as const;

type UpdatePlatform = 'ios' | 'android';

function currentPlatform(): UpdatePlatform | null {
  return Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : null;
}

async function fetchAppUpdateStatus(): Promise<AppUpdateStatus> {
  const installedVersion = Application.nativeApplicationVersion;
  const platform = currentPlatform();

  // Not a native iOS/Android context — the store-update concept does not apply.
  if (!platform) {
    return {
      updateAvailable: false,
      checkFailed: false,
      latestVersion: null,
      installedVersion,
      storeUrl: null,
    };
  }

  // The native version should always be present on a real build. If it is not,
  // we genuinely cannot decide — surface that as a failed check, never as
  // "up to date".
  if (!installedVersion) {
    return {
      updateAvailable: false,
      checkFailed: true,
      latestVersion: null,
      installedVersion: null,
      storeUrl: null,
    };
  }

  const { data, error } = await supabase
    .from('app_releases')
    .select('version, released_at, store_url')
    .eq('platform', platform)
    .eq('is_public', true)
    .order('released_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // A real error (network, RLS, 5xx) is a FAILED CHECK — rethrow so React
  // Query can retry transient cases, and so the hook reports checkFailed.
  if (error) throw error;

  // No public release row yet is a valid answer, not a failure: nothing to
  // update to.
  if (!data?.version) {
    return {
      updateAvailable: false,
      checkFailed: false,
      latestVersion: null,
      installedVersion,
      storeUrl: null,
    };
  }

  return {
    updateAvailable: isVersionNewer(data.version, installedVersion),
    checkFailed: false,
    latestVersion: data.version,
    installedVersion,
    // `store_url` is the exact listing URL the backend recorded (Apple's
    // trackViewUrl for a store-detected iOS release); null on manually
    // published rows, where the caller falls back to the hard-coded link.
    storeUrl: (data as { store_url?: string | null }).store_url ?? null,
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
    // Retry only genuinely transient failures (never an RLS/4xx), matching the
    // app-wide query policy.
    retry: (failureCount, error) => failureCount < 2 && isTransientError(error),
  });

  useEffect(() => {
    const sub = AppState.addEventListener('change', (status) => {
      if (status === 'active' && Platform.OS !== 'web') {
        void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      }
    });
    return () => sub.remove();
  }, [queryClient]);

  const data = query.data;

  return {
    updateAvailable: data?.updateAvailable ?? false,
    // A hard query error OR an in-band failure both mean "could not check".
    checkFailed: query.isError || (data?.checkFailed ?? false),
    latestVersion: data?.latestVersion ?? null,
    installedVersion:
      data?.installedVersion ?? Application.nativeApplicationVersion ?? null,
    storeUrl: data?.storeUrl ?? null,
    isLoading: query.isLoading,
    refetch: () => void query.refetch(),
  };
}
