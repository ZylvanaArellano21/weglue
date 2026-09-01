"use client";

import { useRef, useState } from "react";

export interface CarouselImage {
  uri: string;
}

interface PhotoCarouselProps {
  images: CarouselImage[];
  /** height / width of each photo. Posts use 4/5, events 3/2. Default 4/5. */
  aspectRatio?: number;
  onImageClick?: (index: number) => void;
  rounded?: boolean;
  className?: string;
}

const PEEK = "13%";
const GAP = 8;

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
  onImageClick,
  rounded = true,
  className = "",
}: PhotoCarouselProps) {
  const [index, setIndex] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);

  const count = images.length;
  const multi = count > 1;
  const radius = rounded ? "rounded-2xl" : "";
  const paddingTop = `${(1 / aspectRatio) * 100}%`;

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
        className={`block h-full w-full bg-gray-200 bg-cover bg-center ${radius}`}
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
