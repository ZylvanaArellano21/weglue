import { useRef, useState } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { PickedMedia } from '../../lib/media/types';
import { mediaColors, mediaFonts, HIT_SLOP, TOUCH_TARGET } from './mediaTheme';

interface Props {
  picked: PickedMedia;
  /** 'camera' offers Retake; 'library' offers Choose Another. */
  mode: 'camera' | 'library';
  aspect?: [number, number];
  onCancel: () => void;
  /** Retake (camera) or Choose Another (library). */
  onRedo: () => void;
  onUse: () => void;
}

/**
 * The confirm step that stands between the shutter and an upload.
 *
 * Nothing reaches Supabase because a shutter button was tapped — a feature only
 * ever sees an image after Use Photo is pressed here.
 */
export function AndroidPreviewScreen({ picked, mode, aspect, onCancel, onRedo, onUse }: Props) {
  const insets = useSafeAreaInsets();
  const [unreadable, setUnreadable] = useState(false);

  // Use Photo is the one control that can cost a duplicate post / message /
  // upload if it fires twice. The ref is read synchronously so a double tap
  // inside one frame cannot pass, and it never resets: this screen is done.
  const usedRef = useRef(false);
  const [using, setUsing] = useState(false);
  const handleUse = () => {
    if (usedRef.current) return;
    usedRef.current = true;
    setUsing(true);
    onUse();
  };

  const redoLabel = mode === 'camera' ? 'Retake' : 'Choose Another';
  const redoIcon = mode === 'camera' ? 'camera-outline' : 'images-outline';

  if (unreadable) {
    return (
      <View style={[styles.root, styles.centered]}>
        <Ionicons name="image-outline" size={44} color={mediaColors.onDarkMuted} />
        <Text style={styles.errorTitle}>This photo can’t be opened</Text>
        <Text style={styles.errorBody}>
          It may have been moved or removed by the app that provided it. Choose another photo to
          continue.
        </Text>
        <TouchableOpacity
          style={styles.errorPrimary}
          onPress={onRedo}
          accessibilityRole="button"
          accessibilityLabel={redoLabel}
        >
          <Text style={styles.errorPrimaryLabel}>{redoLabel}</Text>
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
      <View style={styles.imageArea}>
        {/* With a feature ratio, the image is shown in a box of exactly that
            ratio with resizeMode="cover" — so what is on screen IS the centered
            crop that applyFeatureCrop will produce. The user confirms the real
            result, not an approximation of it. */}
        <Image
          source={{ uri: picked.uri }}
          style={
            aspect
              ? [styles.imageCropped, { aspectRatio: aspect[0] / aspect[1] }]
              : styles.imageFull
          }
          resizeMode={aspect ? 'cover' : 'contain'}
          onError={() => setUnreadable(true)}
          accessibilityLabel="Photo preview"
        />
      </View>

      <View style={[styles.topBar, { top: insets.top + 12 }]}>
        <TouchableOpacity
          style={styles.circleBtn}
          onPress={onCancel}
          hitSlop={HIT_SLOP}
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          accessibilityHint={
            mode === 'camera'
              ? 'Discards this photo and returns without changing anything'
              : 'Returns without changing anything'
          }
        >
          <Ionicons name="close" size={26} color={mediaColors.onDark} />
        </TouchableOpacity>
      </View>

      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 24 }]}>
        <TouchableOpacity
          style={styles.redoBtn}
          onPress={onRedo}
          disabled={using}
          accessibilityRole="button"
          accessibilityLabel={redoLabel}
          accessibilityState={{ disabled: using }}
        >
          <Ionicons name={redoIcon} size={20} color={mediaColors.onDark} />
          <Text style={styles.redoLabel}>{redoLabel}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.useBtn, using && styles.useBtnBusy]}
          onPress={handleUse}
          disabled={using}
          accessibilityRole="button"
          accessibilityLabel="Use photo"
          accessibilityState={{ disabled: using, busy: using }}
        >
          {using ? (
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
  centered: { alignItems: 'center', justifyContent: 'center' },

  imageArea: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  imageFull: { width: '100%', height: '100%' },
  imageCropped: { width: '100%' },

  topBar: { position: 'absolute', left: 16, right: 16, flexDirection: 'row' },
  circleBtn: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    borderRadius: TOUCH_TARGET / 2,
    backgroundColor: mediaColors.scrim,
    alignItems: 'center',
    justifyContent: 'center',
  },

  bottomBar: {
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
    paddingHorizontal: 20,
    borderRadius: TOUCH_TARGET / 2,
    borderWidth: 1.5,
    borderColor: mediaColors.onDarkMuted,
  },
  redoLabel: {
    fontFamily: mediaFonts.semiBold,
    fontSize: 15,
    color: mediaColors.onDark,
  },
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
  useLabel: {
    fontFamily: mediaFonts.semiBold,
    fontSize: 15,
    color: mediaColors.onDark,
  },

  errorTitle: {
    fontFamily: mediaFonts.bold,
    fontSize: 18,
    color: mediaColors.onDark,
    marginTop: 14,
    textAlign: 'center',
    marginHorizontal: 32,
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
    minHeight: TOUCH_TARGET,
    paddingHorizontal: 26,
    borderRadius: TOUCH_TARGET / 2,
    backgroundColor: mediaColors.teal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorPrimaryLabel: {
    fontFamily: mediaFonts.semiBold,
    fontSize: 15,
    color: mediaColors.onDark,
  },
  errorSecondary: {
    marginTop: 8,
    minHeight: TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  errorSecondaryLabel: {
    fontFamily: mediaFonts.semiBold,
    fontSize: 14,
    color: mediaColors.onDarkMuted,
  },
});
