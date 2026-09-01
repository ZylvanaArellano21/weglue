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
}

interface PhotoCarouselProps {
  images: CarouselImage[];
  /** Width of the viewport the carousel lives in (usually the card content width). */
  width: number;
  /** height / width of each photo. Posts use 4/5, events 3/2. Default 4/5. */
  aspectRatio?: number;
  /** Open the full-screen viewer on this index. */
  onImagePress?: (index: number) => void;
  /** Rounded corners on each photo. Default true. */
  rounded?: boolean;
  /** Extra style for the outer container. */
  style?: StyleProp<ViewStyle>;
}

const GAP = 8;
/** Fraction of the viewport the next photo peeks in from the right. */
const PEEK_RATIO = 0.13;
const RADIUS = 16;

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
  onImagePress,
  rounded = true,
  style,
}: PhotoCarouselProps) {
  const [index, setIndex] = useState(0);
  const scrollRef = useRef<ScrollView>(null);

  const height = Math.round(width / aspectRatio);
  const count = images.length;
  const multi = count > 1;

  // Each slide leaves room for the next photo to peek in from the right.
  const slideWidth = multi ? Math.round(width * (1 - PEEK_RATIO)) : width;
  const snapInterval = slideWidth + GAP;

  const radius = rounded ? RADIUS : 0;

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(e.nativeEvent.contentOffset.x / snapInterval);
    if (next !== index && next >= 0 && next < count) setIndex(next);
  };

  const renderPhoto = (img: CarouselImage, i: number) => {
    const resized = getResizedImageUrl(img.uri, slideWidth * 2, height * 2) ?? img.uri;
    const photo = (
      <Image
        source={{ uri: resized }}
        style={{ width: '100%', height: '100%', borderRadius: radius }}
        resizeMode="cover"
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
