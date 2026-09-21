import { memo, useRef, useState } from 'react';
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
import { postMediaDisplayRatioDetail, shouldLoadCarouselImage } from '@weglue/shared';
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
  /** Show the whole image inside a fixed-ratio frame when dimensions are unknown. */
  fit?: 'cover' | 'contain';
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
// One transform per displayed ratio, independent of small layout-width changes.
const FEED_IMAGE_WIDTH = 960;

function SlideImage({ uri, radius, resizeMode }: { uri: string; radius: number; resizeMode: 'cover' | 'contain' }) {
  const [failedUri, setFailedUri] = useState<string | null>(null);
  if (failedUri === uri) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E5E7EB' }}>
        <Ionicons name="image-outline" size={40} color="#9CA3AF" />
      </View>
    );
  }
  return (
    <Image
      source={{ uri }}
      style={{ width: '100%', height: '100%', borderRadius: radius }}
      resizeMode={resizeMode}
      fadeDuration={0}
      onError={() => setFailedUri(uri)}
    />
  );
}

/** Resolve the first image's ratio synchronously from stored dimensions. */
function singleImageRatio(
  image: CarouselImage | undefined,
  enabled: boolean,
): { ratio: number; isReal: boolean } {
  if (!enabled) return { ratio: NaN, isReal: false }; // caller falls back to the fixed aspectRatio
  const detail = postMediaDisplayRatioDetail([
    image ? { width: image.width ?? null, height: image.height ?? null } : null,
  ]);
  return { ratio: detail.ratio, isReal: detail.fromStoredDimensions };
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
  fit,
  onImagePress,
  onIndexChange,
  rounded = true,
  style,
}: PhotoCarouselProps) {
  const [index, setIndex] = useState(0);
  const scrollRef = useRef<ScrollView>(null);

  const count = images.length;
  const multi = count > 1;

  // When requested, use the first image's stored ratio for the shared frame;
  // otherwise use the caller's fixed aspectRatio.
  const { ratio: sharedRatio, isReal: sharedRatioIsReal } = singleImageRatio(
    images[0],
    naturalRatio && count >= 1,
  );
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
    // Keep every slide's geometry, but only request the current image and its
    // immediate neighbors. On first mount this loads at most two images.
    const shouldLoad = shouldLoadCarouselImage(i, index);
    // A lone image whose real ratio is known is shown whole (contain-fit): the
    // box already IS its ratio, so there is nothing to crop. When the ratio is
    // only the fallback (no stored dimensions) we cover-crop into that box,
    // unless the caller needs the whole image visible. Carousel slides cover.
    const wholeImage =
      !multi && (fit === 'contain' || (naturalRatio && Number.isFinite(sharedRatio) && sharedRatioIsReal));
    const resized = shouldLoad
      ? getResizedImageUrl(
          img.uri,
          FEED_IMAGE_WIDTH,
          Math.round(FEED_IMAGE_WIDTH / effectiveRatio),
          wholeImage ? 'contain' : 'cover',
        ) ?? img.uri
      : null;
    const photo = shouldLoad ? (
      <SlideImage uri={resized ?? img.uri} radius={radius} resizeMode={wholeImage ? 'contain' : 'cover'} />
    ) : null;
    return (
      <View
        key={i}
        style={{
          width: slideWidth,
          height,
          marginRight: i < count - 1 ? GAP : 0,
          borderRadius: radius,
          overflow: 'hidden',
          backgroundColor: shouldLoad ? undefined : '#E5E7EB',
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
