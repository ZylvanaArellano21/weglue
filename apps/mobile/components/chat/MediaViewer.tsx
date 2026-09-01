import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Modal,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Animated,
  PanResponder,
  Share,
  Alert,
  ActivityIndicator,
  Image,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system/legacy';
import { VideoView, useVideoPlayer } from 'expo-video';
import { resolveAttachmentUrl } from '../../lib/chatAttachments';
import { ShareSheetContent } from '../shared/ShareSheet';
import { useToast } from '../Toast';
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
  /** Enables the internal We Glue share sheet from the viewer's Share button.
   * When absent, Share falls back to the OS file share. */
  currentUserId?: string;
}

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
// new native module is required. Dimensions come from the live window (props)
// so rotation and every device size are handled — never a fixed capture.
function ZoomableImage({
  url,
  width,
  height,
  onSingleTap,
}: {
  url: string;
  width: number;
  height: number;
  onSingleTap: () => void;
}) {
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
      const maxTx = (width * (s - 1)) / 2;
      const maxTy = (height * (s - 1)) / 2;
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
    [scale, translateX, translateY, state, width, height],
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
    <View style={[styles.page, { width, height }]} {...responder.panHandlers}>
      <Animated.Image
        source={{ uri: url }}
        style={[
          { width, height },
          { transform: [{ translateX }, { translateY }, { scale }] },
        ]}
        resizeMode="contain"
      />
    </View>
  );
}

function VideoPage({ url, width, height }: { url: string; width: number; height: number }) {
  const player = useVideoPlayer(url, (p) => {
    p.loop = false;
  });
  return (
    <View style={[styles.page, { width, height }]}>
      <VideoView
        player={player}
        style={{ width, height }}
        contentFit="contain"
        allowsFullscreen={false}
        nativeControls
      />
    </View>
  );
}

function ViewerPage({
  item,
  width,
  height,
  onSingleTap,
}: {
  item: ViewerMediaItem;
  width: number;
  height: number;
  onSingleTap: () => void;
}) {
  const url = useResolvedUrl(item.source);
  if (!url) {
    return (
      <View style={[styles.page, { width, height }]}>
        <ActivityIndicator color="#fff" />
      </View>
    );
  }
  if (item.kind === 'video') return <VideoPage url={url} width={width} height={height} />;
  return <ZoomableImage url={url} width={width} height={height} onSingleTap={onSingleTap} />;
}

export function MediaViewer({ visible, items, initialIndex, onClose, currentUserId }: Props) {
  // Live window size (rotation-safe) + safe-area insets computed here rather
  // than from a module-level Dimensions snapshot, so the viewer and its chrome
  // always fit the actual device — notch, Dynamic Island, Android status bar,
  // gesture bar and 3-button nav all accounted for.
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(initialIndex);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [saving, setSaving] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const toast = useToast();
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

  function handleShare() {
    // Bug 3: open the We Glue share sheet (internal destinations + secure
    // external file share) — never dump the raw signed URL into a native share.
    if (currentUserId && current) {
      setShareOpen(true);
      return;
    }
    // No user context (shouldn't happen in-app) → OS file share of the file.
    void (async () => {
      const url = await resolveCurrent();
      if (!url) return;
      try {
        await Share.share(Platform.OS === 'ios' ? { url } : { message: url });
      } catch {
        // dismissed
      }
    })();
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
          // key forces a clean re-layout on rotation so getItemLayout / paging
          // math always match the current width.
          key={`w${Math.round(width)}`}
          data={items}
          horizontal
          pagingEnabled
          initialScrollIndex={Math.max(0, Math.min(initialIndex, items.length - 1))}
          getItemLayout={(_d, i) => ({ length: width, offset: width * i, index: i })}
          keyExtractor={(item, index) => `${item.messageId}:${index}`}
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(e) => {
            setIndex(Math.round(e.nativeEvent.contentOffset.x / width));
          }}
          renderItem={({ item }) => (
            <ViewerPage
              item={item}
              width={width}
              height={height}
              onSingleTap={() => setChromeVisible((v) => !v)}
            />
          )}
        />

        {chromeVisible && (
          <>
            <View
              style={[styles.topBar, { paddingTop: Math.max(insets.top, 12) + 4 }]}
              pointerEvents="box-none"
            >
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
            </View>

            <View
              style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 12) + 4 }]}
              pointerEvents="box-none"
            >
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
            </View>
          </>
        )}

        {/* MediaViewer is itself a full-screen Modal, so a pushed /share route
            would render underneath it. Here the Share body is rendered as an
            in-modal overlay instead — it doesn't navigate away, so it needs no
            route. Every other Share entry point uses the /share route. */}
        {current && shareOpen && (
          <View style={StyleSheet.absoluteFill}>
            <ShareSheetContent
              onDone={() => setShareOpen(false)}
              userId={currentUserId}
              contentType="media"
              contentId={current.source}
              // Internal copy needs a private storage path; if this row is a
              // legacy http/local source, only external file share applies.
              media={{
                sourcePath: current.source,
                kind: current.kind,
                mime: null,
                name: null,
              }}
              onShowToast={(m, t) => toast.show(m, t)}
            />
          </View>
        )}
        {toast.ToastComponent}
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
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
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
