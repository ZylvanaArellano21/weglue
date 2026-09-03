"use client";

import { useEffect, useRef, useState } from "react";
import { clampPostImageRatio, POST_IMAGE_FALLBACK_RATIO } from "@weglue/shared";

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
   * width / height of each photo. Posts/events pass a fixed value (4/5, 3/2).
   * Ignored for a SINGLE image when `naturalSingle` is set. Default 4/5.
   */
  aspectRatio?: number;
  /**
   * Single-image posts only: render the lone image at its natural aspect
   * (clamped to the feed-safe range) instead of the fixed `aspectRatio`, so a
   * portrait stays portrait and a landscape stays landscape and nothing is
   * arbitrarily cropped. A multi-image carousel always uses one shared ratio.
   */
  naturalSingle?: boolean;
  onImageClick?: (index: number) => void;
  rounded?: boolean;
  className?: string;
}

const PEEK = "13%";
const GAP = 8;

/** Resolves the display ratio (w/h) for a lone image: its known dimensions,
 *  else a measured size, else the stable fallback — all clamped. */
function useSingleImageRatio(image: CarouselImage | undefined, enabled: boolean): number | null {
  const known =
    image?.width && image?.height && image.height > 0 ? image.width / image.height : null;
  const [measured, setMeasured] = useState<number | null>(null);

  useEffect(() => {
    setMeasured(null);
    if (!enabled || known || !image?.uri || typeof window === "undefined") return;
    let alive = true;
    const probe = new window.Image();
    probe.onload = () => {
      if (alive && probe.naturalWidth > 0 && probe.naturalHeight > 0) {
        setMeasured(probe.naturalWidth / probe.naturalHeight);
      }
    };
    probe.src = image.uri;
    return () => {
      alive = false;
      probe.onload = null;
    };
  }, [enabled, known, image?.uri]);

  if (!enabled) return null; // caller falls back to the fixed aspectRatio
  return clampPostImageRatio(known ?? measured ?? POST_IMAGE_FALLBACK_RATIO);
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
  naturalSingle = false,
  onImageClick,
  rounded = true,
  className = "",
}: PhotoCarouselProps) {
  const [index, setIndex] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);

  const count = images.length;
  const multi = count > 1;
  const radius = rounded ? "rounded-2xl" : "";

  const singleRatio = useSingleImageRatio(images[0], naturalSingle && count === 1);
  const effectiveRatio = !multi && singleRatio ? singleRatio : aspectRatio;
  const paddingTop = `${(1 / effectiveRatio) * 100}%`;
  // A lone natural-aspect image is shown whole (contain-fit): the box already
  // IS its ratio, so there is nothing to crop.
  const fit = !multi && naturalSingle && singleRatio ? "bg-contain bg-no-repeat" : "bg-cover";

  const onScroll = () => {
    const el = trackRef.current;
    if (!el) return;
    const slide = el.scrollWidth / count;
    const next = Math.round(el.scrollLeft / slide);
    if (next !== index && next >= 0 && next < count) setIndex(next);
  };

  const Photo = ({ img, i }: { img: CarouselImage; i: number }) => {
    const inner = (
      <span
        className={`block h-full w-full bg-center bg-gray-200 ${fit} ${radius}`}
        style={{ backgroundImage: `url(${img.uri})` }}
        role="img"
        aria-label={`Photo ${i + 1} of ${count}`}
      />
    );
    return (
      <div
        className="relative shrink-0"
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
            <Photo img={only} i={0} />
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
        {images.map((img, i) => (
          <Photo key={i} img={img} i={i} />
        ))}
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
