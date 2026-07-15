import { useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, AppState, Linking, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { mediaColors, mediaFonts, TOUCH_TARGET } from './mediaTheme';

interface Props {
  /**
   * 'explain' — denied, but Android will still show the system dialog again.
   * 'blocked' — permanently denied; only Settings can grant it now.
   */
  variant: 'explain' | 'blocked';
  onRetry: () => void;
  onCancel: () => void;
  /** Re-checked when the user comes back from Settings. */
  onReturnFromSettings: () => void;
}

/**
 * Why We Glue wants the camera, in plain language, at the moment it is refused.
 *
 * Camera permission is never requested at launch — this screen only ever
 * appears because the user just tapped Camera, so the reason is in front of
 * them while the ask is still meaningful.
 */
export function CameraPermissionScreen({
  variant,
  onRetry,
  onCancel,
  onReturnFromSettings,
}: Props) {
  const blocked = variant === 'blocked';

  // Coming back from Settings is the only way out of 'blocked'. Recheck on
  // resume so a user who granted access lands in the camera instead of being
  // told again that they denied it. Only the blocked screen listens: the
  // 'explain' variant retries through the system dialog, not Settings.
  const leftForSettings = useRef(false);
  useEffect(() => {
    if (!blocked) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && leftForSettings.current) {
        leftForSettings.current = false;
        onReturnFromSettings();
      }
    });
    return () => sub.remove();
  }, [blocked, onReturnFromSettings]);

  const openSettings = () => {
    leftForSettings.current = true;
    void Linking.openSettings();
  };

  return (
    <View style={styles.root}>
      <View style={styles.iconWrap}>
        <Ionicons name="camera-outline" size={38} color={mediaColors.teal} />
      </View>

      <Text style={styles.title}>Camera access needed</Text>

      <Text style={styles.body}>
        {blocked
          ? 'We Glue needs your camera to take photos for your profile, posts, events, clubs and chats. Camera access is currently turned off for We Glue, so you’ll need to turn it on in Settings.'
          : 'We Glue needs your camera to take photos for your profile, posts, events, clubs and chats. Your photos are only uploaded after you tap Use Photo.'}
      </Text>

      <TouchableOpacity
        style={styles.primary}
        onPress={blocked ? openSettings : onRetry}
        accessibilityRole="button"
        accessibilityLabel={blocked ? 'Open Settings' : 'Allow camera access'}
      >
        <Text style={styles.primaryLabel}>{blocked ? 'Open Settings' : 'Allow camera access'}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.secondary}
        onPress={onCancel}
        accessibilityRole="button"
        accessibilityLabel="Cancel"
      >
        <Text style={styles.secondaryLabel}>Cancel</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: mediaColors.cream,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  iconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(15,166,166,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  title: {
    fontFamily: mediaFonts.bold,
    fontSize: 20,
    color: '#000000',
    textAlign: 'center',
    marginBottom: 10,
  },
  body: {
    fontFamily: mediaFonts.regular,
    fontSize: 14,
    lineHeight: 21,
    color: '#878784',
    textAlign: 'center',
    marginBottom: 28,
  },
  primary: {
    minHeight: TOUCH_TARGET,
    paddingHorizontal: 28,
    borderRadius: TOUCH_TARGET / 2,
    backgroundColor: mediaColors.teal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryLabel: {
    fontFamily: mediaFonts.semiBold,
    fontSize: 15,
    color: mediaColors.cream,
  },
  secondary: {
    marginTop: 10,
    minHeight: TOUCH_TARGET,
    paddingHorizontal: 24,
    justifyContent: 'center',
  },
  secondaryLabel: {
    fontFamily: mediaFonts.semiBold,
    fontSize: 14,
    color: '#878784',
  },
});
