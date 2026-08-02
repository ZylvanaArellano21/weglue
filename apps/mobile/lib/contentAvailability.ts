// ─── Content availability copy (ONE source for iOS and Android) ─────────────
//
// Day 10C gives posts, comments and events a lifecycle: active, removed,
// purge_pending, purge_failed, purged. Students are never told WHICH of those a
// piece of content is in, who acted, or why. They see exactly one thing:
//
//     "This content is no longer available."
//
// THE RULE THIS FILE ENFORCES BY CONSTRUCTION: the unavailable state is
// IDENTICAL for content an administrator removed, content the author deleted,
// content that was purged, and content that never existed. If the wording
// differed by cause, the message itself would disclose the moderation outcome —
// which is the one thing removal must not leak. Same reasoning as
// `blockPrompts.ts`, applied to content instead of accounts.
//
// There is no Platform.OS branch anywhere in this file: App Store and Play
// Store builds show the same text.

/** The only sentence a student ever sees for unavailable content. */
export const CONTENT_UNAVAILABLE = 'This content is no longer available.';

/**
 * Composer/action replacement when the parent content cannot be interacted
 * with. Deliberately says nothing about why.
 */
export const CONTENT_UNAVAILABLE_ACTION = 'You can’t interact with this content.';

/**
 * TRUE when a Supabase error means "the database refused because this content
 * is not available to you" rather than a transport failure.
 *
 * Row Level Security is the enforcement point (migration 061), so a write
 * against removed content comes back as a policy violation, and a read comes
 * back as zero rows. Both must be presented as the same neutral state — a
 * student must never see a raw Postgres string, and must never be able to tell
 * a removal apart from a deletion by reading an error message.
 */
export function isContentUnavailableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string') {
    // 42501 = insufficient_privilege (RLS refused the write)
    // PGRST116 = no rows returned where exactly one was expected
    if (code === '42501' || code === 'PGRST116') return true;
  }
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' && message.includes('row-level security');
}
