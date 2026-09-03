import { useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Image,
  Animated,
  PanResponder,
  TouchableOpacity,
  ActivityIndicator,
  useWindowDimensions,
  StyleSheet,
  type GestureResponderEvent,
  type PanResponderGestureState,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImageManipulator from 'expo-image-manipulator';
import { mediaColors, mediaFonts, HIT_SLOP, TOUCH_TARGET } from './mediaTheme';

export interface CropResult {
  uri: string;
  width: number;
  height: number;
}

interface Props {
  uri: string;
  /** Natural pixel size of `uri`. */
  sourceWidth: number;
  sourceHeight: number;
  /** Target frame ratio as [w, h] (avatar [1,1], event [4,5], carousel [4,5]). */
  aspect: [number, number];
  /** 'Retake' (camera) or 'Choose Another' (library) — shown as the left action. */
  redoLabel?: string;
  onRedo?: () => void;
  onCancel: () => void;
  onConfirm: (result: CropResult) => void;
}

const MAX_ZOOM = 4;

/**
 * Move / zoom / reposition an image into a fixed-ratio frame, then confirm.
 *
 * Everything outside the frame is dimmed — what stays bright is exactly what is
 * kept. Drag to reposition, pinch to zoom. The image can never be dragged so
 * far that a gap shows inside the frame. Nothing is written until "Use Photo";
 * Cancel returns without changing the caller's current image.
 */
export function ImageCropper({
  uri,
  sourceWidth,
  sourceHeight,
  aspect,
  redoLabel,
  onRedo,
  onCancel,
  onConfirm,
}: Props) {
  const insets = useSafeAreaInsets();
  const { width: winW, height: winH } = useWindowDimensions();
  const [busy, setBusy] = useState(false);
  const usedRef = useRef(false);

  // The crop frame: as wide as the screen allows, height from the target ratio,
  // capped to the vertical space between the top and bottom bars.
  const frame = useMemo(() => {
    const availH = winH - insets.top - insets.bottom - 220;
    let w = winW - 32;
    let h = (w * aspect[1]) / aspect[0];
    if (h > availH) {
      h = availH;
      w = (h * aspect[0]) / aspect[1];
    }
    return { w, h };
  }, [winW, winH, insets.top, insets.bottom, aspect]);

  // Cover-fit the source into the frame at zoom 1 (no gaps possible).
  const baseScale = Math.max(frame.w / sourceWidth, frame.h / sourceHeight);
  const fittedW = sourceWidth * baseScale;
  const fittedH = sourceHeight * baseScale;

  // Live transform, committed on gesture end.
  const scaleRef = useRef(1);
  const txRef = useRef(0);
  const tyRef = useRef(0);
  const [, force] = useState(0);

  const gestureStart = useRef({ scale: 1, tx: 0, ty: 0, dist: 0 });

  const clamp = (scale: number, tx: number, ty: number) => {
    const s = Math.min(MAX_ZOOM, Math.max(1, scale));
    const maxX = Math.max(0, (fittedW * s - frame.w) / 2);
    const maxY = Math.max(0, (fittedH * s - frame.h) / 2);
    return {
      scale: s,
      tx: Math.min(maxX, Math.max(-maxX, tx)),
      ty: Math.min(maxY, Math.max(-maxY, ty)),
    };
  };

  const touchDistance = (e: GestureResponderEvent) => {
    const [a, b] = e.nativeEvent.touches;
    if (!a || !b) return 0;
    return Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
  };

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        gestureStart.current = {
          scale: scaleRef.current,
          tx: txRef.current,
          ty: tyRef.current,
          dist: touchDistance(e),
        };
      },
      onPanResponderMove: (e: GestureResponderEvent, g: PanResponderGestureState) => {
        const start = gestureStart.current;
        if (e.nativeEvent.touches.length >= 2 && start.dist > 0) {
          const ratio = touchDistance(e) / start.dist;
          const next = clamp(start.scale * ratio, start.tx, start.ty);
          scaleRef.current = next.scale;
          txRef.current = next.tx;
          tyRef.current = next.ty;
        } else {
          const next = clamp(
            scaleRef.current,
            start.tx + g.dx,
            start.ty + g.dy,
          );
          txRef.current = next.tx;
          tyRef.current = next.ty;
        }
        force((n) => n + 1);
      },
      onPanResponderRelease: () => {
        const next = clamp(scaleRef.current, txRef.current, tyRef.current);
        scaleRef.current = next.scale;
        txRef.current = next.tx;
        tyRef.current = next.ty;
        force((n) => n + 1);
      },
    }),
  ).current;

  const handleUse = async () => {
    if (usedRef.current) return;
    usedRef.current = true;
    setBusy(true);
    try {
      const s = scaleRef.current;
      const effScale = baseScale * s;
      // Frame's top-left, expressed in source pixels.
      const originX = (-frame.w / 2 - txRef.current) / effScale + sourceWidth / 2;
      const originY = (-frame.h / 2 - tyRef.current) / effScale + sourceHeight / 2;
      const cropW = frame.w / effScale;
      const cropH = frame.h / effScale;

      const rect = {
        originX: Math.max(0, Math.round(originX)),
        originY: Math.max(0, Math.round(originY)),
        width: Math.min(sourceWidth, Math.round(cropW)),
        height: Math.min(sourceHeight, Math.round(cropH)),
      };
      // A rect even one pixel outside the bitmap makes the native crop throw.
      rect.width = Math.min(rect.width, sourceWidth - rect.originX);
      rect.height = Math.min(rect.height, sourceHeight - rect.originY);

      const result = await ImageManipulator.manipulateAsync(
        uri,
        [{ crop: rect }],
        { compress: 0.92, format: ImageManipulator.SaveFormat.JPEG },
      );
      onConfirm({ uri: result.uri, width: result.width, height: result.height });
    } catch {
      // Degrade to the untouched image rather than losing the pick.
      onConfirm({ uri, width: sourceWidth, height: sourceHeight });
    }
  };

  return (
    <View style={styles.root}>
      <View style={styles.stage} {...responder.panHandlers}>
        <Animated.Image
          source={{ uri }}
          style={{
            position: 'absolute',
            width: fittedW,
            height: fittedH,
            left: (winW - fittedW) / 2,
            top: (winH - fittedH) / 2,
            transform: [
              { translateX: txRef.current },
              { translateY: tyRef.current },
              { scale: scaleRef.current },
            ],
          }}
          resizeMode="cover"
        />

        {/* Dim mask — four bands around the bright crop window. */}
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <View style={[styles.dim, { height: (winH - frame.h) / 2 }]} />
          <View style={{ flexDirection: 'row', height: frame.h }}>
            <View style={[styles.dim, { width: (winW - frame.w) / 2 }]} />
            <View style={[styles.window, { width: frame.w, height: frame.h }]} />
            <View style={[styles.dim, { width: (winW - frame.w) / 2 }]} />
          </View>
          <View style={[styles.dim, { flex: 1 }]} />
        </View>
      </View>

      <View style={[styles.topBar, { top: insets.top + 12 }]}>
        <TouchableOpacity
          style={styles.circleBtn}
          onPress={onCancel}
          hitSlop={HIT_SLOP}
          accessibilityRole="button"
          accessibilityLabel="Cancel"
        >
          <Ionicons name="close" size={26} color={mediaColors.onDark} />
        </TouchableOpacity>
        <Text style={styles.hint}>Drag to reposition · pinch to zoom</Text>
      </View>

      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 24 }]}>
        {onRedo ? (
          <TouchableOpacity
            style={styles.redoBtn}
            onPress={onRedo}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={redoLabel ?? 'Choose another'}
          >
            <Ionicons name="images-outline" size={20} color={mediaColors.onDark} />
            <Text style={styles.redoLabel}>{redoLabel ?? 'Choose Another'}</Text>
          </TouchableOpacity>
        ) : (
          <View style={{ flex: 0 }} />
        )}
        <TouchableOpacity
          style={[styles.useBtn, busy && styles.useBtnBusy]}
          onPress={handleUse}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Use photo"
          accessibilityState={{ busy }}
        >
          {busy ? (
            <ActivityIndicator color={mediaColors.onDark} />
          ) : (
            <>
              <Ionicons name="checkmark" size={20} color={mediaColors.onDark} />
              <Text style={styles.useLabel}>Use Photo</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: mediaColors.dark },
  stage: { flex: 1 },
  dim: { backgroundColor: 'rgba(0,0,0,0.6)' },
  window: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.7)',
  },
  topBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  circleBtn: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    borderRadius: TOUCH_TARGET / 2,
    backgroundColor: mediaColors.scrim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hint: {
    flex: 1,
    fontFamily: mediaFonts.regular,
    fontSize: 12,
    color: mediaColors.onDarkMuted,
  },
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 16,
    backgroundColor: mediaColors.scrim,
  },
  redoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: TOUCH_TARGET,
    paddingHorizontal: 18,
    borderRadius: TOUCH_TARGET / 2,
    borderWidth: 1.5,
    borderColor: mediaColors.onDarkMuted,
  },
  redoLabel: { fontFamily: mediaFonts.semiBold, fontSize: 15, color: mediaColors.onDark },
  useBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    flex: 1,
    minHeight: TOUCH_TARGET,
    paddingHorizontal: 20,
    borderRadius: TOUCH_TARGET / 2,
    backgroundColor: mediaColors.teal,
  },
  useBtnBusy: { opacity: 0.8 },
  useLabel: { fontFamily: mediaFonts.semiBold, fontSize: 15, color: mediaColors.onDark },
});
