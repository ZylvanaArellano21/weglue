import { memo, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Image,
  Pressable,
  ScrollView,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { clampPostImageRatio, POST_IMAGE_FALLBACK_RATIO } from '@weglue/shared';
import { getResizedImageUrl } from '../../lib/imageResize';

/**
 * The familiar Instagram-style overlapping-squares carousel marker. Placed on a
 * static grid/thumbnail (club Photos-that-Glue, profile grid) to say "this post
 * has more than one photo" — first image + this icon only, never a +N badge.
 */
export function CarouselBadge({ size = 16 }: { size?: number }) {
  return (
    <View
      style={{
        position: 'absolute',
        top: 6,
        right: 6,
        borderRadius: 999,
        backgroundColor: 'rgba(0,0,0,0.45)',
        padding: 3,
      }}
    >
      <Ionicons name="copy-outline" size={size} color="#FFFFFF" />
    </View>
  );
}

export interface CarouselImage {
  uri: string;
  /** Intrinsic pixel size, when known — lets a single image render at its
   *  natural aspect with zero layout shift. */
  width?: number | null;
  height?: number | null;
}

interface PhotoCarouselProps {
  images: CarouselImage[];
  /** Width of the viewport the carousel lives in (usually the card content width). */
  width: number;
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
  /** Open the full-screen viewer on this index. */
  onImagePress?: (index: number) => void;
  /** Fires with the slide index as the user swipes the carousel. */
  onIndexChange?: (index: number) => void;
  /** Rounded corners on each photo. Default true. */
  rounded?: boolean;
  /** Extra style for the outer container. */
  style?: StyleProp<ViewStyle>;
}

const GAP = 8;
/** Fraction of the viewport the next photo peeks in from the right. */
const PEEK_RATIO = 0.13;
const RADIUS = 16;

// Legacy posts (created before dimensions were stored on post_images) have no
// known width/height, so their ratio can only be learned by measuring the
// image — an async round trip. Without this cache, every mount (including
// just leaving and reopening the Home feed) re-measures and re-triggers the
// same late height change that causes a real, reproduced bug: on a very short
// feed the list's scroll extent goes briefly stale right as that height
// changes, so the very first scroll-down attempt gets clamped against the old
// (too-small) bound and springs back to the top. Caching the measured ratio
// per URI means that only ever happens once per image per app session, not
// on every remount. Unbounded is fine at this scale — a URI string + a float
// per entry, cleared on app restart.
const measuredRatioCache = new Map<string, number>();

/** Resolves the display ratio (w/h) from an image's dimensions: known, else
 *  cached-measured, else freshly measured, else the stable fallback box — all
 *  clamped. For a carousel this is the first image and the result is the
 *  shared slide ratio. */
function useSingleImageRatio(image: CarouselImage | undefined, enabled: boolean): number {
  const known =
    image?.width && image?.height && image.height > 0 ? image.width / image.height : null;
  const cachedFor = (uri: string | undefined) => (uri ? measuredRatioCache.get(uri) ?? null : null);
  const [measured, setMeasured] = useState<number | null>(() => cachedFor(image?.uri));

  useEffect(() => {
    setMeasured(cachedFor(image?.uri));
    if (!enabled || known || !image?.uri || measuredRatioCache.has(image.uri)) return;
    let alive = true;
    Image.getSize(
      image.uri,
      (w, h) => {
        if (w <= 0 || h <= 0) return;
        measuredRatioCache.set(image.uri!, w / h);
        if (alive) setMeasured(w / h);
      },
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [enabled, known, image?.uri]);

  if (!enabled) return NaN; // caller falls back to the fixed aspectRatio
  return clampPostImageRatio(known ?? measured ?? POST_IMAGE_FALLBACK_RATIO);
}

/**
 * We Glue photo carousel.
 *
 * Photos sit side-by-side horizontally. The current photo is large and clean;
 * the next real photo peeks in from the right with rounded corners, showing an
 * actual cropped slice of that image. A horizontal-snap swipe lands cleanly on
 * one photo, the peek becomes the new main photo and the following image
 * becomes the new right-side peek. A subtle "n/total" count shows while
 * viewing. Single-image posts render as a plain photo with none of this.
 */
export const PhotoCarousel = memo(function PhotoCarousel({
  images,
  width,
  aspectRatio = 4 / 5,
  naturalRatio = false,
  onImagePress,
  onIndexChange,
  rounded = true,
  style,
}: PhotoCarouselProps) {
  const [index, setIndex] = useState(0);
  const scrollRef = useRef<ScrollView>(null);

  const count = images.length;
  const multi = count > 1;

  // For posts the ratio comes from the first image (single: that image; multi:
  // the one shared slide ratio). Events keep the fixed `aspectRatio`.
  const sharedRatio = useSingleImageRatio(images[0], naturalRatio && count >= 1);
  const effectiveRatio = Number.isFinite(sharedRatio) ? sharedRatio : aspectRatio;
  const height = Math.round(width / effectiveRatio);

  // Each slide leaves room for the next photo to peek in from the right.
  const slideWidth = multi ? Math.round(width * (1 - PEEK_RATIO)) : width;
  const snapInterval = slideWidth + GAP;

  const radius = rounded ? RADIUS : 0;

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(e.nativeEvent.contentOffset.x / snapInterval);
    if (next !== index && next >= 0 && next < count) {
      setIndex(next);
      onIndexChange?.(next);
    }
  };

  const renderPhoto = (img: CarouselImage, i: number) => {
    // A lone natural-aspect image is shown whole (contain-fit): the box already
    // IS its ratio, so there is nothing to crop. A carousel slide keeps the
    // cover crop into the shared box.
    const wholeImage = !multi && naturalRatio && Number.isFinite(sharedRatio);
    const resized =
      getResizedImageUrl(
        img.uri,
        slideWidth * 2,
        height * 2,
        wholeImage ? 'contain' : 'cover',
      ) ?? img.uri;
    const photo = (
      <Image
        source={{ uri: resized }}
        style={{ width: '100%', height: '100%', borderRadius: radius }}
        resizeMode={wholeImage ? 'contain' : 'cover'}
        fadeDuration={0}
      />
    );
    return (
      <View
        key={i}
        style={{
          width: slideWidth,
          height,
          marginRight: i < count - 1 ? GAP : 0,
          borderRadius: radius,
          overflow: 'hidden',
        }}
      >
        {onImagePress ? (
          <Pressable onPress={() => onImagePress(i)} style={{ flex: 1 }}>
            {photo}
          </Pressable>
        ) : (
          photo
        )}
      </View>
    );
  };

  if (!multi) {
    return (
      <View style={[{ width, height }, style]}>{count === 1 ? renderPhoto(images[0], 0) : null}</View>
    );
  }

  return (
    <View style={[{ width, height }, style]}>
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        snapToInterval={snapInterval}
        snapToAlignment="start"
        disableIntervalMomentum
        onScroll={onScroll}
        scrollEventThrottle={16}
      >
        {images.map(renderPhoto)}
      </ScrollView>

      {/* Subtle position count, e.g. 1/5 */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: 8,
          right: 8,
          backgroundColor: 'rgba(0,0,0,0.55)',
          borderRadius: 999,
          paddingHorizontal: 8,
          paddingVertical: 2,
        }}
      >
        <Text style={{ color: '#FFFFFF', fontSize: 11, fontFamily: 'Inter_600SemiBold' }}>
          {index + 1}/{count}
        </Text>
      </View>
    </View>
  );
});
