"use client";

import { useRef, useState } from "react";
import { postMediaDisplayRatioDetail, shouldLoadCarouselImage } from "@weglue/shared";
import { getResizedImageUrl } from "../../lib/imageResize";

export interface CarouselImage {
  uri: string;
  /** Intrinsic pixel size, when known — lets a single image render at its
   *  natural aspect with zero layout shift. */
  width?: number | null;
  height?: number | null;
}

interface PhotoCarouselProps {
  images: CarouselImage[];
  /**
   * width / height of each photo. Events pass a fixed value (3/2). Ignored for
   * posts when `naturalRatio` is set. Default 4/5.
   */
  aspectRatio?: number;
  /**
   * Posts: derive the display ratio from the FIRST image's natural size
   * (clamped to the feed-safe range) instead of the fixed `aspectRatio`. A
   * single portrait stays portrait, a single landscape stays landscape; a
   * carousel uses the first image's ratio as the one shared slide ratio so its
   * height never jumps while swiping.
   */
  naturalRatio?: boolean;
  /** Show the whole image inside a fixed-ratio frame when dimensions are unknown. */
  fit?: "cover" | "contain";
  onImageClick?: (index: number) => void;
  /** Fires with the slide index as the user swipes the carousel. */
  onIndexChange?: (index: number) => void;
  rounded?: boolean;
  className?: string;
}

const PEEK = "13%";
const GAP = 8;
const FEED_IMAGE_WIDTH = 960;

function feedImageUrl(uri: string, ratio: number, fit: 'cover' | 'contain'): string {
  return getResizedImageUrl(uri, FEED_IMAGE_WIDTH, Math.round(FEED_IMAGE_WIDTH / ratio), fit) ?? uri;
}

function SlideImage({ uri, fit, label }: { uri: string; fit: 'cover' | 'contain'; label: string }) {
  const [failedUri, setFailedUri] = useState<string | null>(null);
  if (failedUri === uri) {
    return <span className="flex h-full w-full items-center justify-center bg-gray-200 text-sm text-gray-500" role="img" aria-label={label}>Image unavailable</span>;
  }
  // The browser can report load failure for <img>; CSS backgrounds cannot.
  return <img src={uri} alt={label} className="block h-full w-full bg-gray-200" style={{ objectFit: fit }} onError={() => setFailedUri(uri)} />;
}

/** Resolve the first image's ratio synchronously from stored dimensions. */
function singleImageRatio(image: CarouselImage | undefined, enabled: boolean) {
  if (!enabled) return null;
  return postMediaDisplayRatioDetail([
    image ? { width: image.width ?? null, height: image.height ?? null } : null,
  ]);
}

/**
 * We Glue photo carousel (web).
 *
 * Photos sit side-by-side horizontally. The current photo is large and clean;
 * the next real photo peeks in from the right with rounded corners, showing an
 * actual cropped slice of that image. CSS scroll-snap lands a swipe/drag
 * cleanly on one photo. A subtle "n/total" count shows while viewing.
 * Single-image posts render as a plain photo with none of this.
 */
export function PhotoCarousel({
  images,
  aspectRatio = 4 / 5,
  naturalRatio = false,
  fit,
  onImageClick,
  onIndexChange,
  rounded = true,
  className = "",
}: PhotoCarouselProps) {
  const [index, setIndex] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);

  const count = images.length;
  const multi = count > 1;
  const radius = rounded ? "rounded-2xl" : "";

  // When requested, use the first image's stored ratio for the shared frame;
  // otherwise use the caller's fixed aspectRatio.
  const sharedRatio = singleImageRatio(images[0], naturalRatio && count >= 1);
  const effectiveRatio = sharedRatio?.ratio ?? aspectRatio;
  const paddingTop = `${(1 / effectiveRatio) * 100}%`;
  // A lone natural-aspect image is shown whole (contain-fit): the box already
  // IS its ratio, so there is nothing to crop. A carousel slide stays cover.
  const imageFit = !multi && (fit === "contain" || sharedRatio?.fromStoredDimensions) ? "contain" : "cover";

  const onScroll = () => {
    const el = trackRef.current;
    if (!el) return;
    const slide = el.scrollWidth / count;
    const next = Math.round(el.scrollLeft / slide);
    if (next !== index && next >= 0 && next < count) {
      setIndex(next);
      onIndexChange?.(next);
    }
  };

  const renderPhoto = (img: CarouselImage, i: number) => {
    // Keep every slide in the scroll track, but leave distant slides without
    // a background URL so the browser cannot request their images yet.
    const shouldLoad = shouldLoadCarouselImage(i, index);
    const inner = shouldLoad ? (
      <SlideImage uri={feedImageUrl(img.uri, effectiveRatio, imageFit)} fit={imageFit} label={`Photo ${i + 1} of ${count}`} />
    ) : <span className="block h-full w-full bg-gray-200" />;
    return (
      <div
        key={i}
        className={`relative shrink-0 overflow-hidden ${radius}`}
        style={{
          width: multi ? `calc(100% - ${PEEK})` : "100%",
          marginRight: i < count - 1 ? GAP : 0,
          scrollSnapAlign: "start",
        }}
      >
        <div style={{ paddingTop }} />
        <div className="absolute inset-0">
          {onImageClick ? (
            <button
              type="button"
              onClick={() => onImageClick(i)}
              className="block h-full w-full"
              aria-label={`Open photo ${i + 1}`}
            >
              {inner}
            </button>
          ) : (
            inner
          )}
        </div>
      </div>
    );
  };

  if (!multi) {
    const only = images[0];
    return (
      <div className={`relative w-full ${className}`}>
        <div style={{ paddingTop }} />
        {only ? (
          <div className="absolute inset-0">
            {renderPhoto(only, 0)}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className={`relative w-full ${className}`}>
      <div
        ref={trackRef}
        onScroll={onScroll}
        className="flex w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ scrollSnapType: "x mandatory" }}
      >
        {images.map(renderPhoto)}
      </div>
      <span className="pointer-events-none absolute right-2 top-2 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-semibold text-white">
        {index + 1}/{count}
      </span>
    </div>
  );
}

/**
 * The Instagram-style overlapping-squares carousel marker for static
 * grid/thumbnails (first image + this icon only, never a +N badge).
 */
export function CarouselBadge({ size = 16 }: { size?: number }) {
  return (
    <span className="absolute right-1.5 top-1.5 rounded-full bg-black/45 p-1 text-white">
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
        <rect x="8" y="3" width="13" height="13" rx="3" stroke="currentColor" strokeWidth="2" />
        <rect
          x="3"
          y="8"
          width="13"
          height="13"
          rx="3"
          stroke="currentColor"
          strokeWidth="2"
          fill="currentColor"
          fillOpacity="0.15"
        />
      </svg>
    </span>
  );
}
