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
 *    height never jumps while the user swipes. That shared ratio is the FIRST
 *    image's natural ratio (clamped) — a landscape batch stays landscape, a
 *    portrait batch stays portrait. Every image is framed into it by the user
 *    at compose time; any the user does not touch is centre-cropped to it.
 *  - Before an image's real dimensions are known, `POST_IMAGE_FALLBACK_RATIO`
 *    is the box reserved for it (a stable box, never a zero-height one).
 */

/** Tallest a single post image is shown (4:5 portrait). */
export const POST_IMAGE_MIN_RATIO = 0.8;
/** Widest a single post image is shown (~1.91:1 landscape). */
export const POST_IMAGE_MAX_RATIO = 1.91;
/** Reserved box before real dimensions are known, and the last-resort default. */
export const POST_IMAGE_FALLBACK_RATIO = 0.8;
/**
 * Last-resort shared carousel ratio, used only until the first image's real
 * dimensions are known. The real shared ratio is the first image's natural
 * ratio (see {@link postMediaDisplayRatio}).
 */
export const POST_CAROUSEL_RATIO = 0.8;

/** Hard cap on images per post / carousel (matches the compose + DB limit). */
export const MAX_POST_IMAGES = 5;

/** Mount only the active carousel image and its immediate neighbors. */
export function shouldLoadCarouselImage(slideIndex: number, activeIndex: number): boolean {
  return Math.abs(slideIndex - activeIndex) <= 1;
}

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
 * compose preview). Single image → its clamped natural ratio. Multiple images →
 * the FIRST image's clamped natural ratio, shared by every slide. Either way,
 * the fallback box is used only until the first image's real size is known.
 */
export function postMediaDisplayRatio(
  dimensions: Array<{ width: number | null; height: number | null } | null | undefined>,
): number {
  return postMediaDisplayRatioDetail(dimensions).ratio;
}

/**
 * `postMediaDisplayRatio` plus whether that ratio came from the image's own
 * stored width/height (`fromStoredDimensions`) or is only the fallback box.
 *
 * The FEED renders each card at this ratio *synchronously at first mount and
 * never changes it* — measuring the image after layout resizes the card, which
 * shifts a FlatList's total content height and makes its true bottom
 * unreachable (Change 18). This function is pure: identical `dimensions` always
 * yield an identical result, with no `Image.getSize` round trip. When
 * `fromStoredDimensions` is false the caller cover-crops into the fallback box
 * so there is no letterboxing.
 */
export function postMediaDisplayRatioDetail(
  dimensions: Array<{ width: number | null; height: number | null } | null | undefined>,
): { ratio: number; fromStoredDimensions: boolean } {
  const first = dimensions[0];
  if (first?.width && first?.height && first.height > 0) {
    return { ratio: clampPostImageRatio(first.width / first.height), fromStoredDimensions: true };
  }
  return {
    ratio: dimensions.length > 1 ? POST_CAROUSEL_RATIO : POST_IMAGE_FALLBACK_RATIO,
    fromStoredDimensions: false,
  };
}

/**
 * The "Original" crop-frame ratio as an integer [w, h] pair for a source image
 * of the given pixel size — the image's own ratio, clamped to the feed-safe
 * range so a hairline panorama still can't hijack the feed. Landscape stays
 * landscape, portrait stays portrait. Both `ImageCropper`s use this to build
 * the "Original" option, so web and mobile agree on what "Original" means.
 */
export function naturalCropAspect(
  width: number | null | undefined,
  height: number | null | undefined,
): [number, number] {
  const ratio =
    width && height && height > 0
      ? clampPostImageRatio(width / height)
      : POST_IMAGE_FALLBACK_RATIO;
  return [Math.round(ratio * 1000), 1000];
}
