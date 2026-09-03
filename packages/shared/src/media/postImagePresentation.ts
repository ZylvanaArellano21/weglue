/**
 * The ONE presentation contract for post / club-post images, shared by web and
 * mobile — the sibling of `messaging/attachmentPresentation.ts` for chat.
 *
 * Ratio here is width / height:
 *   0.8  = 4:5 portrait
 *   1.0  = square
 *   1.91 = ~1.91:1 landscape
 *
 * Rules:
 *  - A SINGLE-image post shows its NATURAL ratio, clamped to a feed-safe range
 *    so neither a skyscraper panorama nor a hairline strip can take over the
 *    feed. Inside the range nothing is cropped.
 *  - A MULTI-image carousel uses ONE shared ratio for every slide, so its
 *    height never jumps while the user swipes. Each image is framed into that
 *    shared ratio by the user at compose time.
 *  - Before an image's real dimensions are known, `POST_IMAGE_FALLBACK_RATIO`
 *    is the box reserved for it (a stable box, never a zero-height one).
 */

/** Tallest a single post image is shown (4:5 portrait). */
export const POST_IMAGE_MIN_RATIO = 0.8;
/** Widest a single post image is shown (~1.91:1 landscape). */
export const POST_IMAGE_MAX_RATIO = 1.91;
/** Reserved box before real dimensions are known, and the multi-image default. */
export const POST_IMAGE_FALLBACK_RATIO = 0.8;
/** The shared ratio every slide of a multi-image carousel uses. */
export const POST_CAROUSEL_RATIO = 0.8;

/** Hard cap on images per post / carousel (matches the compose + DB limit). */
export const MAX_POST_IMAGES = 5;

/**
 * Clamp a width/height ratio into the feed-safe display range. A missing or
 * malformed ratio falls back to {@link POST_IMAGE_FALLBACK_RATIO}.
 */
export function clampPostImageRatio(ratio: number | null | undefined): number {
  if (!ratio || !Number.isFinite(ratio) || ratio <= 0) {
    return POST_IMAGE_FALLBACK_RATIO;
  }
  return Math.max(POST_IMAGE_MIN_RATIO, Math.min(POST_IMAGE_MAX_RATIO, ratio));
}

/**
 * The width/height ratio to display a post's media at.
 *
 * `dimensions` is the per-image intrinsic size in `position` order (entries may
 * be null when a dimension is not known yet — e.g. a legacy row, or a fresh
 * compose preview). Single image → its clamped natural ratio (or the fallback
 * until known). Multiple images → the shared carousel ratio.
 */
export function postMediaDisplayRatio(
  dimensions: Array<{ width: number | null; height: number | null } | null | undefined>,
): number {
  if (dimensions.length <= 1) {
    const only = dimensions[0];
    if (only?.width && only?.height && only.height > 0) {
      return clampPostImageRatio(only.width / only.height);
    }
    return POST_IMAGE_FALLBACK_RATIO;
  }
  return POST_CAROUSEL_RATIO;
}
