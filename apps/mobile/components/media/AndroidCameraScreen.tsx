import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  AppState,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, type CameraType, type FlashMode } from 'expo-camera';
import type { PickedMedia } from '../../lib/media/types';
import { mediaColors, mediaFonts, HIT_SLOP, TOUCH_TARGET } from './mediaTheme';

interface Props {
  /** Shown as a crop guide only — the capture itself is never pre-cropped. */
  aspect?: [number, number];
  onCancel: () => void;
  onCaptured: (picked: PickedMedia) => void;
  onOpenLibrary: () => void;
}

/**
 * The We Glue Android camera.
 *
 * Exists because the OEM camera app Android hands us through
 * ImagePicker.launchCameraAsync has no dependable way back: Samsung, Google and
 * others each lay their chrome out differently and some show no visible cancel
 * at all, so a user who opened the camera by accident could not get back to
 * We Glue. Everything here is ours, so an X is always in the same place.
 */
export function AndroidCameraScreen({ aspect, onCancel, onCaptured, onOpenLibrary }: Props) {
  const insets = useSafeAreaInsets();
  const cameraRef = useRef<CameraView>(null);

  const [facing, setFacing] = useState<CameraType>('back');
  const [flash, setFlash] = useState<FlashMode>('off');
  const [ready, setReady] = useState(false);
  const [mountError, setMountError] = useState(false);
  const [capturing, setCapturing] = useState(false);

  // Never leave a camera session running behind a backgrounded app: `active`
  // tears the session down and rebuilds it on resume, which is also what keeps
  // lock → unlock from coming back to a black preview.
  const [appActive, setAppActive] = useState(true);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setAppActive(s === 'active'));
    return () => sub.remove();
  }, []);

  // A capture in flight must survive neither a second shutter tap nor an
  // unmount: the ref is checked synchronously, before any await, so two taps in
  // the same frame cannot both get through.
  const capturingRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const takePhoto = useCallback(async () => {
    if (capturingRef.current || !ready || !cameraRef.current) return;
    capturingRef.current = true;
    setCapturing(true);

    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.9,
        exif: false,
        // Leave the processing pipeline ON. With skipProcessing the sensor
        // rotation is left in EXIF only, and RN's <Image> ignores EXIF — which
        // is exactly how you end up with sideways and upside-down photos on
        // Sony and Samsung hardware. Off, expo-camera bakes rotation into the
        // pixels and the width/height below describe the saved file.
        skipProcessing: false,
        shutterSound: true,
      });

      if (!mountedRef.current) return;
      if (!photo?.uri) {
        setCapturing(false);
        capturingRef.current = false;
        return;
      }

      onCaptured({
        uri: photo.uri,
        fileName: 'photo.jpg',
        mimeType: 'image/jpeg',
        width: photo.width,
        height: photo.height,
        fileSize: null,
        source: 'camera',
        kind: 'image',
      });
    } catch {
      if (!mountedRef.current) return;
      setCapturing(false);
      capturingRef.current = false;
      setMountError(true);
    }
  }, [ready, onCaptured]);

  if (mountError) {
    return (
      <View style={[styles.root, styles.centered]}>
        <Ionicons name="camera-outline" size={44} color={mediaColors.onDarkMuted} />
        <Text style={styles.errorTitle}>Camera unavailable</Text>
        <Text style={styles.errorBody}>
          We Glue couldn’t start your camera. Another app may be using it. You can choose a photo
          from your library instead.
        </Text>
        <TouchableOpacity
          style={styles.errorPrimary}
          onPress={onOpenLibrary}
          accessibilityRole="button"
          accessibilityLabel="Open photo library"
        >
          <Text style={styles.errorPrimaryLabel}>Choose from library</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.errorSecondary}
          onPress={onCancel}
          accessibilityRole="button"
          accessibilityLabel="Cancel"
        >
          <Text style={styles.errorSecondaryLabel}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing={facing}
        flash={flash}
        mode="picture"
        // This app captures photos only. `mute` guarantees the module never
        // opens an audio session, which is the runtime half of the promise the
        // manifest makes by omitting RECORD_AUDIO.
        mute
        active={appActive}
        onCameraReady={() => setReady(true)}
        onMountError={() => setMountError(true)}
      />

      {/* Crop guide: shows exactly what a ratio-constrained feature (avatar,
          banner, event) will keep, so the crop applied after Use Photo is
          something the user saw first rather than a silent surprise. */}
      {aspect ? <CropGuide aspect={aspect} /> : null}

      {!ready ? (
        <View style={[StyleSheet.absoluteFill, styles.centered]} pointerEvents="none">
          <ActivityIndicator color={mediaColors.onDark} />
        </View>
      ) : null}

      {/* Top row — X is always here, on every device, at a real touch target. */}
      <View style={[styles.topBar, { top: insets.top + 12 }]}>
        <TouchableOpacity
          style={styles.circleBtn}
          onPress={onCancel}
          hitSlop={HIT_SLOP}
          accessibilityRole="button"
          accessibilityLabel="Close camera"
          accessibilityHint="Returns without taking a photo"
        >
          <Ionicons name="close" size={26} color={mediaColors.onDark} />
        </TouchableOpacity>

        {facing === 'back' ? (
          <TouchableOpacity
            style={[styles.circleBtn, flash !== 'off' && styles.circleBtnActive]}
            onPress={() => setFlash((f) => (f === 'off' ? 'auto' : f === 'auto' ? 'on' : 'off'))}
            hitSlop={HIT_SLOP}
            accessibilityRole="button"
            accessibilityLabel={`Flash ${flash}`}
            accessibilityHint="Switches between flash off, auto and on"
            accessibilityState={{ selected: flash !== 'off' }}
          >
            <Ionicons
              name={flash === 'off' ? 'flash-off' : flash === 'auto' ? 'flash-outline' : 'flash'}
              size={22}
              color={flash !== 'off' ? mediaColors.dark : mediaColors.onDark}
            />
            {/* State is never carried by color alone (a11y): auto is labelled. */}
            {flash === 'auto' ? <Text style={styles.flashAuto}>A</Text> : null}
          </TouchableOpacity>
        ) : (
          <View style={styles.circleBtnPlaceholder} />
        )}
      </View>

      {/* Bottom row — sits above the gesture bar / 3-button nav on every device. */}
      <View style={[styles.bottomBar, { bottom: insets.bottom + 24 }]}>
        <TouchableOpacity
          style={styles.sideBtn}
          onPress={onOpenLibrary}
          hitSlop={HIT_SLOP}
          accessibilityRole="button"
          accessibilityLabel="Open photo library"
        >
          <Ionicons name="images-outline" size={24} color={mediaColors.onDark} />
        </TouchableOpacity>

        <TouchableOpacity
          onPress={takePhoto}
          disabled={!ready || capturing}
          accessibilityRole="button"
          accessibilityLabel="Take photo"
          accessibilityState={{ disabled: !ready || capturing, busy: capturing }}
        >
          <View style={[styles.shutterRing, (!ready || capturing) && styles.shutterDisabled]}>
            {capturing ? (
              <ActivityIndicator color={mediaColors.teal} />
            ) : (
              <View style={styles.shutterCore} />
            )}
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.sideBtn}
          onPress={() => setFacing((f) => (f === 'back' ? 'front' : 'back'))}
          hitSlop={HIT_SLOP}
          accessibilityRole="button"
          accessibilityLabel="Switch camera"
          accessibilityHint="Switches between the front and back camera"
        >
          <Ionicons name="camera-reverse-outline" size={26} color={mediaColors.onDark} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

/** Dims everything the feature's ratio will crop away. */
function CropGuide({ aspect }: { aspect: [number, number] }) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={styles.cropDim} />
      <View style={[styles.cropWindow, { aspectRatio: aspect[0] / aspect[1] }]} />
      <View style={styles.cropDim} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: mediaColors.dark },
  centered: { alignItems: 'center', justifyContent: 'center' },

  topBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  circleBtn: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    borderRadius: TOUCH_TARGET / 2,
    backgroundColor: mediaColors.scrim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleBtnActive: { backgroundColor: mediaColors.onDark },
  circleBtnPlaceholder: { width: TOUCH_TARGET, height: TOUCH_TARGET },
  flashAuto: {
    position: 'absolute',
    top: 6,
    right: 8,
    fontSize: 9,
    fontFamily: mediaFonts.bold,
    color: mediaColors.dark,
  },

  bottomBar: {
    position: 'absolute',
    left: 24,
    right: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sideBtn: {
    width: TOUCH_TARGET + 8,
    height: TOUCH_TARGET + 8,
    borderRadius: (TOUCH_TARGET + 8) / 2,
    backgroundColor: mediaColors.scrim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterRing: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 4,
    borderColor: mediaColors.onDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterCore: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: mediaColors.teal,
  },
  shutterDisabled: { opacity: 0.55 },

  cropDim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  cropWindow: {
    width: '100%',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: 'rgba(255,255,255,0.55)',
  },

  errorTitle: {
    fontFamily: mediaFonts.bold,
    fontSize: 18,
    color: mediaColors.onDark,
    marginTop: 14,
  },
  errorBody: {
    fontFamily: mediaFonts.regular,
    fontSize: 14,
    lineHeight: 20,
    color: mediaColors.onDarkMuted,
    textAlign: 'center',
    marginTop: 8,
    marginHorizontal: 36,
  },
  errorPrimary: {
    marginTop: 24,
    height: 46,
    paddingHorizontal: 26,
    borderRadius: 23,
    backgroundColor: mediaColors.teal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorPrimaryLabel: {
    fontFamily: mediaFonts.semiBold,
    fontSize: 15,
    color: mediaColors.onDark,
  },
  errorSecondary: { marginTop: 8, minHeight: TOUCH_TARGET, justifyContent: 'center', paddingHorizontal: 20 },
  errorSecondaryLabel: {
    fontFamily: mediaFonts.semiBold,
    fontSize: 14,
    color: mediaColors.onDarkMuted,
  },
});
