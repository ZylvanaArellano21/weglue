// Single source of truth for We Glue's permanent, canonical public URLs for
// posts and events. Both platforms already agree on the path shape
// (`/post/{id}`, `/event/{id}`) — this only centralizes it so mobile, web,
// the Instagram Story link sticker, and any future public-preview UI never
// drift out of sync on the string.
//
// The id alone is the identity: editing a post/event never changes this URL.

export type ShareableContentType = "post" | "event";

// The real production origin. Mobile (a native app on a real device) always
// means this literal domain — there is no "preview" or "localhost" mobile
// build. Web callers that need dev/preview-safe URLs should build from
// `contentPath()` and their own `window.location.origin` instead of this
// constant; see apps/web/components/shared/UnifiedShareSheet.tsx.
export const WEGLUE_WEB_ORIGIN = "https://weglue.app";

/** The path segment alone, e.g. "/post/abc123". Same on every platform. */
export function contentPath(type: ShareableContentType, id: string): string {
  return `/${type}/${id}`;
}

/** Full canonical URL. Defaults to the real production origin (mobile's only
 *  correct choice); web callers may pass their own origin for dev/preview. */
export function canonicalContentUrl(
  type: ShareableContentType,
  id: string,
  origin: string = WEGLUE_WEB_ORIGIN,
): string {
  return `${origin}${contentPath(type, id)}`;
}

export function getEventShareUrl(eventId: string): string {
  return canonicalContentUrl("event", eventId);
}

export function getPostShareUrl(postId: string): string {
  return canonicalContentUrl("post", postId);
}
