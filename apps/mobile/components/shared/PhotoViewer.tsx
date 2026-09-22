import { useEffect, useRef, useState } from 'react';
import { View, Text, Image, Modal, FlatList, TouchableOpacity, StyleSheet, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { shouldLoadCarouselImage } from '@weglue/shared';

// ─── Full-screen photo viewer for posts + events ─────────────────────────────
// Deliberately separate from components/chat/MediaViewer.tsx (which is
// chat-coupled: messageId/sentAt, resolveAttachmentUrl, save/share, pinch
// zoom). Posts/events only need: show the exact photo full-screen at its own
// aspect ratio (never cropped/stretched), a clearly tappable X, and — for a
// multi-photo carousel — swipe between the same photos with the tap landing
// on the right index. Rendered as a Modal over the caller's screen, so
// closing it never unmounts the feed underneath — scroll position is kept
// for free.

export interface PhotoViewerImage {
  uri: string;
}

function ViewerImage({ uri, width, height }: { uri: string; width: number; height: number }) {
  const [failedUri, setFailedUri] = useState<string | null>(null);
  if (failedUri === uri) {
    return <View style={{ width, height, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="image-outline" size={48} color="#9CA3AF" /></View>;
  }
  return <Image source={{ uri }} style={{ width, height }} resizeMode="contain" onError={() => setFailedUri(uri)} />;
}

interface Props {
  visible: boolean;
  images: PhotoViewerImage[];
  initialIndex: number;
  onClose: () => void;
}

export function PhotoViewer({ visible, images, initialIndex, onClose }: Props) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const clampedInitialIndex = Math.max(0, Math.min(initialIndex, Math.max(images.length - 1, 0)));
  const [index, setIndex] = useState(clampedInitialIndex);
  const [loadIndex, setLoadIndex] = useState(clampedInitialIndex);
  const loadIndexRef = useRef(clampedInitialIndex);
  const wasVisibleRef = useRef(false);
  const lastInitialIndexRef = useRef(clampedInitialIndex);

  // Use the new opening index synchronously so a retained viewer cannot render
  // one frame with the previous session's lazy-load window.
  const needsInitialSync =
    visible && (!wasVisibleRef.current || lastInitialIndexRef.current !== clampedInitialIndex);
  const effectiveIndex = needsInitialSync ? clampedInitialIndex : index;
  const effectiveLoadIndex = needsInitialSync ? clampedInitialIndex : loadIndex;

  useEffect(() => {
    const opening = visible && !wasVisibleRef.current;
    const openingIndexChanged = visible && lastInitialIndexRef.current !== clampedInitialIndex;

    if (opening || openingIndexChanged) {
      loadIndexRef.current = clampedInitialIndex;
      setIndex(clampedInitialIndex);
      setLoadIndex(clampedInitialIndex);
    }

    wasVisibleRef.current = visible;
    lastInitialIndexRef.current = clampedInitialIndex;
  }, [visible, clampedInitialIndex]);

  if (!visible || images.length === 0) return null;

  const pageIndexFromOffset = (offsetX: number): number | null => {
    if (width <= 0 || images.length === 0 || !Number.isFinite(offsetX)) return null;
    const nearestIndex = Math.round(offsetX / width);
    if (!Number.isFinite(nearestIndex)) return null;
    return Math.max(0, Math.min(nearestIndex, images.length - 1));
  };

  const updateLoadIndexDuringScroll = (offsetX: number) => {
    const nextLoadIndex = pageIndexFromOffset(offsetX);
    if (nextLoadIndex === null || nextLoadIndex === loadIndexRef.current) return;

    loadIndexRef.current = nextLoadIndex;
    setLoadIndex((current) => (current === nextLoadIndex ? current : nextLoadIndex));
  };

  const settleIndexAfterMomentum = (offsetX: number) => {
    const finalIndex = pageIndexFromOffset(offsetX);
    if (finalIndex === null) return;

    loadIndexRef.current = finalIndex;
    setIndex((current) => (current === finalIndex ? current : finalIndex));
    setLoadIndex((current) => (current === finalIndex ? current : finalIndex));
  };

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.container}>
        <FlatList
          key={`w${Math.round(width)}`}
          data={images}
          extraData={effectiveLoadIndex}
          horizontal
          pagingEnabled
          initialScrollIndex={clampedInitialIndex}
          getItemLayout={(_d, i) => ({ length: width, offset: width * i, index: i })}
          keyExtractor={(item, i) => `${item.uri}:${i}`}
          showsHorizontalScrollIndicator={false}
          onScroll={(e) => updateLoadIndexDuringScroll(e.nativeEvent.contentOffset.x)}
          scrollEventThrottle={16}
          onMomentumScrollEnd={(e) => settleIndexAfterMomentum(e.nativeEvent.contentOffset.x)}
          renderItem={({ item, index: itemIndex }) => (
            <View style={[styles.page, { width, height }]}>
              {shouldLoadCarouselImage(itemIndex, effectiveLoadIndex) ? (
                <ViewerImage uri={item.uri} width={width} height={height} />
              ) : null}
            </View>
          )}
        />

        <View style={[styles.topBar, { paddingTop: Math.max(insets.top, 12) + 4 }]} pointerEvents="box-none">
          <TouchableOpacity
            onPress={onClose}
            style={styles.closeBtn}
            accessibilityRole="button"
            accessibilityLabel="Close"
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="close" size={28} color="#fff" />
          </TouchableOpacity>
          {images.length > 1 && (
            <Text style={styles.counter}>
              {effectiveIndex + 1} / {images.length}
            </Text>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  page: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingBottom: 8,
  },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  counter: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    color: 'rgba(255,255,255,0.85)',
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
});
