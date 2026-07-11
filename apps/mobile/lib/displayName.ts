// ─── Human display name resolution ──────────────────────────────────────────
// A profile's preferred display is its full name; failing that, its username.
// Some accounts still carry the signup-time PLACEHOLDER username (`user_<hex>`)
// and no full name — that internal-looking id must never be shown as someone's
// name (correction screenshot: the DM titled "user_6d4c4487"). Those resolve to
// a neutral "We Glue member" label instead.

const PLACEHOLDER_USERNAME = /^user_[0-9a-f]{6,}$/i;

export const MEMBER_FALLBACK = 'We Glue member';

export function isPlaceholderUsername(username: string | null | undefined): boolean {
  return !!username && PLACEHOLDER_USERNAME.test(username.trim());
}

/**
 * Best human name for a profile. Returns null only when nothing usable exists
 * (caller decides the fallback: "We Glue member", "Deleted account", …).
 */
export function resolveDisplayName(
  p: { full_name?: string | null; username?: string | null } | null | undefined,
): string | null {
  if (!p) return null;
  const full = p.full_name?.trim();
  if (full) return full;
  const username = p.username?.trim();
  if (username && !isPlaceholderUsername(username)) return username;
  return null;
}

/** Same as resolveDisplayName but always returns a renderable string. */
export function displayNameOrFallback(
  p: { full_name?: string | null; username?: string | null } | null | undefined,
  fallback: string = MEMBER_FALLBACK,
): string {
  return resolveDisplayName(p) ?? fallback;
}
