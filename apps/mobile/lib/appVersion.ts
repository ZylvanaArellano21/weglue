// Pure marketing-version comparison for the native "Update" check.
// No react-native / expo imports here on purpose, so it stays unit-testable.

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
