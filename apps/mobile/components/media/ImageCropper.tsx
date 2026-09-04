import { useEffect, useMemo, useRef, useState } from 'react';
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

/** One selectable framing in the ratio picker (posts only). */
export interface CropAspectOption {
  key: string;
  label: string;
  ratio: [number, number];
}

interface Props {
  uri: string;
  /** Natural pixel size of `uri`. */
  sourceWidth: number;
  sourceHeight: number;
  /** Target frame ratio as [w, h] (avatar [1,1], event [4,5], carousel [4,5]).
   *  Also the initial selection when `aspectOptions` is provided. */
  aspect: [number, number];
  /**
   * Post compose only: when given (2+ entries), a ratio picker is shown —
   * "Original", "1:1", "4:5". The frame re-fits and the image re-centres on
   * every change, fully reversible until "Use Photo". Omit for the
   * ratio-locked flows (avatar, club banner, club icon, event), which keep the
   * single fixed `aspect`.
   */
  aspectOptions?: CropAspectOption[];
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
 *
 * With `aspectOptions` a small ratio picker appears (Instagram-style): the user
 * chooses "Original" (the image's own ratio — landscape stays landscape), "1:1"
 * or "4:5", and re-frames within it. Without it the frame is the single fixed
 * `aspect`.
 */
export function ImageCropper({
  uri,
  sourceWidth,
  sourceHeight,
  aspect,
  aspectOptions,
  redoLabel,
  onRedo,
  onCancel,
  onConfirm,
}: Props) {
  const insets = useSafeAreaInsets();
  const { width: winW, height: winH } = useWindowDimensions();
  const [busy, setBusy] = useState(false);
  const usedRef = useRef(false);

  const showPicker = !!aspectOptions && aspectOptions.length > 1;
  // Which framing is active. Starts on the option matching `aspect`, else the
  // first option, else the fixed `aspect`.
  const [activeKey, setActiveKey] = useState<string | null>(() => {
    if (!showPicker) return null;
    const match = aspectOptions!.find(
      (o) => o.ratio[0] / o.ratio[1] === aspect[0] / aspect[1],
    );
    return (match ?? aspectOptions![0]!).key;
  });
  const activeAspect: [number, number] = useMemo(() => {
    if (!showPicker) return aspect;
    return (aspectOptions!.find((o) => o.key === activeKey) ?? aspectOptions![0]!).ratio;
  }, [showPicker, aspect, aspectOptions, activeKey]);

  // The crop frame: as wide as the screen allows, height from the target ratio,
  // capped to the vertical space between the top and bottom bars.
  const frame = useMemo(() => {
    const chrome = showPicker ? 288 : 220;
    const availH = winH - insets.top - insets.bottom - chrome;
    let w = winW - 32;
    let h = (w * activeAspect[1]) / activeAspect[0];
    if (h > availH) {
      h = availH;
      w = (h * activeAspect[0]) / activeAspect[1];
    }
    return { w, h };
  }, [winW, winH, insets.top, insets.bottom, activeAspect, showPicker]);

  // Cover-fit the source into the frame at zoom 1 (no gaps possible).
  const baseScale = Math.max(frame.w / sourceWidth, frame.h / sourceHeight);
  const fittedW = sourceWidth * baseScale;
  const fittedH = sourceHeight * baseScale;

  // Live transform, committed on gesture end.
  const scaleRef = useRef(1);
  const txRef = useRef(0);
  const tyRef = useRef(0);
  const [, force] = useState(0);

  // A ratio change re-fits the frame; re-centre the image so it can never be
  // left showing a gap inside the new frame. The picture itself is untouched.
  useEffect(() => {
    scaleRef.current = 1;
    txRef.current = 0;
    tyRef.current = 0;
    force((n) => n + 1);
  }, [activeKey]);

  const gestureStart = useRef({ scale: 1, tx: 0, ty: 0, dist: 0, panDx: 0, panDy: 0, touches: 0 });

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
      onPanResponderGrant: (e, g) => {
        gestureStart.current = {
          scale: scaleRef.current,
          tx: txRef.current,
          ty: tyRef.current,
          dist: touchDistance(e),
          panDx: g.dx,
          panDy: g.dy,
          touches: e.nativeEvent.touches.length,
        };
      },
      onPanResponderMove: (e: GestureResponderEvent, g: PanResponderGestureState) => {
        const count = e.nativeEvent.touches.length;
        let start = gestureStart.current;
        // Re-seed whenever the number of fingers changes, so adding or lifting a
        // finger never makes the image jump.
        if (count !== start.touches) {
          start = {
            scale: scaleRef.current,
            tx: txRef.current,
            ty: tyRef.current,
            dist: touchDistance(e),
            panDx: g.dx,
            panDy: g.dy,
            touches: count,
          };
          gestureStart.current = start;
        }
        if (count >= 2 && start.dist > 0) {
          const ratio = touchDistance(e) / start.dist;
          const next = clamp(start.scale * ratio, start.tx, start.ty);
          scaleRef.current = next.scale;
          txRef.current = next.tx;
          tyRef.current = next.ty;
        } else {
          const next = clamp(
            scaleRef.current,
            start.tx + (g.dx - start.panDx),
            start.ty + (g.dy - start.panDy),
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
        {showPicker ? (
          <View style={styles.pickerRow}>
            {aspectOptions!.map((opt) => {
              const on = opt.key === activeKey;
              return (
                <TouchableOpacity
                  key={opt.key}
                  style={[styles.chip, on && styles.chipOn]}
                  onPress={() => setActiveKey(opt.key)}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`Frame as ${opt.label}`}
                >
                  <Text style={[styles.chipLabel, on && styles.chipLabelOn]}>{opt.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ) : null}

        <View style={styles.actionRow}>
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
    gap: 14,
    paddingHorizontal: 20,
    paddingTop: 16,
    backgroundColor: mediaColors.scrim,
  },
  pickerRow: {
    flexDirection: 'row',
    alignSelf: 'center',
    gap: 8,
  },
  chip: {
    minWidth: 74,
    minHeight: 38,
    paddingHorizontal: 16,
    borderRadius: 19,
    borderWidth: 1.5,
    borderColor: mediaColors.onDarkMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipOn: {
    backgroundColor: mediaColors.onDark,
    borderColor: mediaColors.onDark,
  },
  chipLabel: { fontFamily: mediaFonts.semiBold, fontSize: 14, color: mediaColors.onDark },
  chipLabelOn: { color: mediaColors.dark },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
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
