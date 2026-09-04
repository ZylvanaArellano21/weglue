// Pure version logic for the native "Update" check.
// No react-native / expo imports here on purpose, so it stays unit-testable.

export interface StoreReleaseRow {
  version: string | null;
  build_number: number | null;
}

export interface InstalledInfo {
  platform: 'ios' | 'android';
  /** marketing version, e.g. "1.0.6" (Application.nativeApplicationVersion) */
  version: string;
  /** Android versionCode as reported by Application.nativeBuildVersion */
  build: string | null | undefined;
}

export interface UpdateDecision {
  updateAvailable: boolean;
  checkFailed: boolean;
  latestVersion: string | null;
}

/**
 * Decide whether a newer public store release exists, given the latest public
 * `app_releases` row and what is installed.
 *
 *  - Android + the row carries a Google Play versionCode → compare integers
 *    (Play releases do not always have a dotted marketing name). An installed
 *    versionCode we cannot parse is a FAILED check, never "up to date".
 *  - Everything else (iOS, or a manually-published Android row) → compare the
 *    marketing version.
 *  - A row with neither a version nor a build number → nothing to update to.
 */
export function resolveUpdateDecision(
  row: StoreReleaseRow | null,
  installed: InstalledInfo,
): UpdateDecision {
  const buildNumber = typeof row?.build_number === 'number' ? row.build_number : null;

  if (!row || (!row.version && buildNumber === null)) {
    return { updateAvailable: false, checkFailed: false, latestVersion: null };
  }

  if (installed.platform === 'android' && buildNumber !== null) {
    const installedBuild = Number.parseInt(installed.build ?? '', 10);
    if (!Number.isFinite(installedBuild)) {
      return { updateAvailable: false, checkFailed: true, latestVersion: row.version ?? null };
    }
    return {
      updateAvailable: installedBuild < buildNumber,
      checkFailed: false,
      latestVersion: row.version ?? null,
    };
  }

  return {
    updateAvailable: row.version ? isVersionNewer(row.version, installed.version) : false,
    checkFailed: false,
    latestVersion: row.version ?? null,
  };
}

/**
 * True when `latest` is a strictly higher marketing version than `installed`.
 *
 * Compared segment-by-segment as integers ("1.4.10" > "1.4.9"); missing
 * trailing segments count as 0 ("1.4" === "1.4.0"). Any build / OTA / prerelease
 * suffix (`-`, `+`, or a space and anything after) is dropped before comparing,
 * and a value that still will not parse yields `false` — a malformed version
 * must never produce a false update prompt.
 */
export function isVersionNewer(latest: string, installed: string): boolean {
  const parse = (value: string): number[] | null => {
    const core = value.trim().split(/[-+ ]/)[0] ?? '';
    if (!core) return null;
    const parts = core.split('.').map((segment) => Number(segment));
    if (parts.length === 0 || parts.some((n) => !Number.isFinite(n) || n < 0)) {
      return null;
    }
    return parts;
  };

  const a = parse(latest);
  const b = parse(installed);
  if (!a || !b) return false;

  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}
