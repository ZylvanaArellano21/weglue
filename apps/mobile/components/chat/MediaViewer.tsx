import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Modal,
  StyleSheet,
  Dimensions,
  FlatList,
  TouchableOpacity,
  Animated,
  PanResponder,
  Share,
  Alert,
  ActivityIndicator,
  Image,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system/legacy';
import { VideoView, useVideoPlayer } from 'expo-video';
import { resolveAttachmentUrl } from '../../lib/chatAttachments';
import { chatFonts } from './chatTheme';

// ─── Reusable full-screen media viewer ───────────────────────────────────────
// One implementation for every conversation type and for Chat Information →
// Media. Supports swipe-between-items, pinch + double-tap zoom (PanResponder —
// no native gesture dependency), save, native share, and video playback.

export interface ViewerMediaItem {
  messageId: string;
  /** storage path or full/local URL (resolved through signed URLs). */
  source: string;
  kind: 'image' | 'video';
  senderName: string;
  sentAt: string;
}

interface Props {
  visible: boolean;
  items: ViewerMediaItem[];
  initialIndex: number;
  onClose: () => void;
}

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

function formatViewerTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ' · ' +
    d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function useResolvedUrl(source: string): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void resolveAttachmentUrl(source).then((u) => {
      if (alive) setUrl(u);
    });
    return () => {
      alive = false;
    };
  }, [source]);
  return url;
}

// Pinch-to-zoom + double-tap + pan, implemented with core PanResponder so no
// new native module is required.
function ZoomableImage({ url, onSingleTap }: { url: string; onSingleTap: () => void }) {
  const scale = useRef(new Animated.Value(1)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;

  const state = useRef({
    scale: 1,
    tx: 0,
    ty: 0,
    startDistance: 0,
    startScale: 1,
    startTx: 0,
    startTy: 0,
    lastTapAt: 0,
    singleTapTimer: null as ReturnType<typeof setTimeout> | null,
  }).current;

  const clampAndApply = useCallback(
    (nextScale: number, nextTx: number, nextTy: number, animated = false) => {
      const s = Math.max(1, Math.min(4, nextScale));
      const maxTx = (SCREEN_W * (s - 1)) / 2;
      const maxTy = (SCREEN_H * (s - 1)) / 2;
      const tx = Math.max(-maxTx, Math.min(maxTx, nextTx));
      const ty = Math.max(-maxTy, Math.min(maxTy, nextTy));
      state.scale = s;
      state.tx = tx;
      state.ty = ty;
      if (animated) {
        Animated.parallel([
          Animated.spring(scale, { toValue: s, useNativeDriver: true }),
          Animated.spring(translateX, { toValue: tx, useNativeDriver: true }),
          Animated.spring(translateY, { toValue: ty, useNativeDriver: true }),
        ]).start();
      } else {
        scale.setValue(s);
        translateX.setValue(tx);
        translateY.setValue(ty);
      }
    },
    [scale, translateX, translateY, state],
  );

  const responder = useRef(
    PanResponder.create({
      // Claim the gesture for pinch (2 touches) or pan while zoomed; leave
      // single-finger swipes to the pager when not zoomed.
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_e, g) =>
        g.numberActiveTouches === 2 || state.scale > 1.01,
      onPanResponderGrant: (e) => {
        const touches = e.nativeEvent.touches;
        state.startScale = state.scale;
        state.startTx = state.tx;
        state.startTy = state.ty;
        if (touches.length >= 2) {
          const [a, b] = touches;
          state.startDistance = Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
        } else {
          state.startDistance = 0;
        }
      },
      onPanResponderMove: (e, g) => {
        const touches = e.nativeEvent.touches;
        if (touches.length >= 2) {
          const [a, b] = touches;
          const dist = Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
          if (state.startDistance === 0) {
            state.startDistance = dist;
            state.startScale = state.scale;
            return;
          }
          clampAndApply(state.startScale * (dist / state.startDistance), state.tx, state.ty);
        } else if (state.scale > 1.01) {
          clampAndApply(state.scale, state.startTx + g.dx, state.startTy + g.dy);
        }
      },
      onPanResponderRelease: (_e, g) => {
        const now = Date.now();
        const isTap = Math.abs(g.dx) < 8 && Math.abs(g.dy) < 8 && g.numberActiveTouches === 0;
        if (isTap) {
          if (now - state.lastTapAt < 280) {
            // Double tap: toggle zoom.
            if (state.singleTapTimer) clearTimeout(state.singleTapTimer);
            state.singleTapTimer = null;
            state.lastTapAt = 0;
            clampAndApply(state.scale > 1.01 ? 1 : 2.2, 0, 0, true);
          } else {
            state.lastTapAt = now;
            state.singleTapTimer = setTimeout(() => {
              onSingleTap();
              state.singleTapTimer = null;
            }, 290);
          }
        }
        if (state.scale <= 1.02) clampAndApply(1, 0, 0, true);
      },
      onPanResponderTerminationRequest: () => state.scale <= 1.01,
    }),
  ).current;

  return (
    <View style={styles.page} {...responder.panHandlers}>
      <Animated.Image
        source={{ uri: url }}
        style={[
          styles.media,
          { transform: [{ translateX }, { translateY }, { scale }] },
        ]}
        resizeMode="contain"
      />
    </View>
  );
}

function VideoPage({ url }: { url: string }) {
  const player = useVideoPlayer(url, (p) => {
    p.loop = false;
  });
  return (
    <View style={styles.page}>
      <VideoView
        player={player}
        style={styles.media}
        contentFit="contain"
        allowsFullscreen={false}
        nativeControls
      />
    </View>
  );
}

function ViewerPage({
  item,
  onSingleTap,
}: {
  item: ViewerMediaItem;
  onSingleTap: () => void;
}) {
  const url = useResolvedUrl(item.source);
  if (!url) {
    return (
      <View style={styles.page}>
        <ActivityIndicator color="#fff" />
      </View>
    );
  }
  if (item.kind === 'video') return <VideoPage url={url} />;
  return <ZoomableImage url={url} onSingleTap={onSingleTap} />;
}

export function MediaViewer({ visible, items, initialIndex, onClose }: Props) {
  const [index, setIndex] = useState(initialIndex);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [saving, setSaving] = useState(false);
  const listRef = useRef<FlatList>(null);

  useEffect(() => {
    if (visible) {
      setIndex(Math.max(0, Math.min(initialIndex, items.length - 1)));
      setChromeVisible(true);
    }
  }, [visible, initialIndex, items.length]);

  const current = items[index];

  async function resolveCurrent(): Promise<string | null> {
    if (!current) return null;
    return resolveAttachmentUrl(current.source);
  }

  async function handleShare() {
    const url = await resolveCurrent();
    if (!url) return;
    try {
      await Share.share(Platform.OS === 'ios' ? { url } : { message: url });
    } catch {
      // User dismissed the share sheet — nothing to do.
    }
  }

  async function handleSave() {
    if (saving || !current) return;
    setSaving(true);
    try {
      const perm = await MediaLibrary.requestPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Photos access needed', 'Allow photo access for We Glue in Settings to save media.');
        return;
      }
      const url = await resolveCurrent();
      if (!url) throw new Error('no url');
      let localUri = url;
      if (url.startsWith('http')) {
        const ext = current.kind === 'video' ? 'mp4' : 'jpg';
        const target = `${FileSystem.cacheDirectory}weglue-save-${Date.now()}.${ext}`;
        const dl = await FileSystem.downloadAsync(url, target);
        localUri = dl.uri;
      }
      await MediaLibrary.saveToLibraryAsync(localUri);
      Alert.alert('Saved', current.kind === 'video' ? 'Video saved to your library.' : 'Photo saved to your library.');
    } catch {
      Alert.alert('Could not save', 'Something went wrong while saving. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  if (!visible || items.length === 0) return null;

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.container}>
        <FlatList
          ref={listRef}
          data={items}
          horizontal
          pagingEnabled
          initialScrollIndex={Math.max(0, Math.min(initialIndex, items.length - 1))}
          getItemLayout={(_d, i) => ({ length: SCREEN_W, offset: SCREEN_W * i, index: i })}
          keyExtractor={(item) => item.messageId}
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(e) => {
            setIndex(Math.round(e.nativeEvent.contentOffset.x / SCREEN_W));
          }}
          renderItem={({ item }) => (
            <ViewerPage item={item} onSingleTap={() => setChromeVisible((v) => !v)} />
          )}
        />

        {chromeVisible && (
          <>
            <SafeAreaView style={styles.topBar} edges={['top']} pointerEvents="box-none">
              <TouchableOpacity onPress={onClose} style={styles.chromeBtn} accessibilityLabel="Close">
                <Ionicons name="close" size={26} color="#fff" />
              </TouchableOpacity>
              <View style={styles.senderBlock}>
                <Text style={styles.senderName} numberOfLines={1}>
                  {current?.senderName ?? ''}
                </Text>
                <Text style={styles.sentAt}>{current ? formatViewerTime(current.sentAt) : ''}</Text>
              </View>
              <View style={{ width: 42 }} />
            </SafeAreaView>

            <SafeAreaView style={styles.bottomBar} edges={['bottom']} pointerEvents="box-none">
              <TouchableOpacity onPress={handleSave} style={styles.chromeBtn} accessibilityLabel="Save">
                {saving ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Ionicons name="download-outline" size={24} color="#fff" />
                )}
              </TouchableOpacity>
              {items.length > 1 && (
                <Text style={styles.counter}>
                  {index + 1} / {items.length}
                </Text>
              )}
              <TouchableOpacity onPress={handleShare} style={styles.chromeBtn} accessibilityLabel="Share">
                <Ionicons name="share-outline" size={24} color="#fff" />
              </TouchableOpacity>
            </SafeAreaView>
          </>
        )}
      </View>
    </Modal>
  );
}

// Small helper used by thumbnails elsewhere: keeps aspect ratio of remote
// images (Image.getSize) with a max width.
export function useImageAspect(url: string | null): number {
  const [aspect, setAspect] = useState(4 / 3);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    Image.getSize(
      url,
      (w, h) => {
        if (alive && w > 0 && h > 0) setAspect(w / h);
      },
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [url]);
  return aspect;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  page: {
    width: SCREEN_W,
    height: SCREEN_H,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  media: {
    width: SCREEN_W,
    height: SCREEN_H,
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingBottom: 8,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 10,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  chromeBtn: {
    padding: 8,
    minWidth: 42,
    alignItems: 'center',
  },
  senderBlock: {
    flex: 1,
    alignItems: 'center',
  },
  senderName: {
    fontFamily: chatFonts.semiBold,
    fontSize: 15,
    color: '#fff',
  },
  sentAt: {
    fontFamily: chatFonts.regular,
    fontSize: 11,
    color: 'rgba(255,255,255,0.75)',
    marginTop: 2,
  },
  counter: {
    fontFamily: chatFonts.semiBold,
    fontSize: 12,
    color: 'rgba(255,255,255,0.85)',
  },
});
