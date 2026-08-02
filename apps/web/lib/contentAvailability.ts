// ─── Content availability copy (student web) ────────────────────────────────
//
// The web mirror of `apps/mobile/lib/contentAvailability.ts`. The two files are
// kept deliberately identical in wording so a student who opens the same post
// on the web and on their phone sees the same sentence.
//
// Day 10C gives posts, comments and events a lifecycle: active, removed,
// purge_pending, purge_failed, purged. Students are never told WHICH of those a
// piece of content is in, who acted, or why. They see exactly one thing:
//
//     "This content is no longer available."
//
// THE RULE THIS FILE ENFORCES BY CONSTRUCTION: the unavailable state is
// IDENTICAL for content an administrator removed, content the author deleted,
// content that was purged, and content that never existed.

/** The only sentence a student ever sees for unavailable content. */
export const CONTENT_UNAVAILABLE = "This content is no longer available.";

/** Composer/action replacement when the parent content cannot be interacted with. */
export const CONTENT_UNAVAILABLE_ACTION = "You can’t interact with this content.";

/**
 * TRUE when a Supabase error means "the database refused because this content
 * is not available to you" rather than a transport failure.
 *
 * Row Level Security is the enforcement point (migration 061): writes against
 * removed content come back as a policy violation, reads come back as zero
 * rows. Both are presented as the same neutral state.
 */
export function isContentUnavailableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string") {
    // 42501 = insufficient_privilege (RLS refused the write)
    // PGRST116 = no rows returned where exactly one was expected
    if (code === "42501" || code === "PGRST116") return true;
  }
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" && message.includes("row-level security");
}
