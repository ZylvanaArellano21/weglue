import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

/**
 * Android software-keyboard height + visibility tracker.
 *
 * WHY THIS EXISTS (Android keyboard overlap fix):
 * Expo SDK 54 makes Android edge-to-edge by default. Under edge-to-edge,
 * `android:windowSoftInputMode=adjustResize` (our `softwareKeyboardLayoutMode:
 * "resize"`) no longer shrinks the React Native content view when the IME
 * opens. The historical Android pattern — `KeyboardAvoidingView` with
 * `behavior={Platform.OS === 'ios' ? 'padding' : undefined}` — therefore does
 * NOTHING on Android, so chat composers, comment inputs and bottom-sheet search
 * fields end up hidden behind the keyboard.
 *
 * The fix is to read the real IME height from native `keyboardDidShow` /
 * `keyboardDidHide` events and let each surface lift/expand itself. The reported
 * `endCoordinates.height` on edge-to-edge Android already includes the
 * navigation-bar area, so callers apply it directly (no extra bottom inset —
 * that would double-pad).
 *
 * iOS is intentionally untouched: this hook is a no-op there (returns 0 /
 * false), and every caller keeps its existing `KeyboardAvoidingView`
 * `behavior="padding"` path for iOS. Never branch iOS layout on this hook.
 */
export function useAndroidKeyboardHeight(): { height: number; visible: boolean } {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const show = Keyboard.addListener('keyboardDidShow', (e) =>
      setHeight(e.endCoordinates?.height ?? 0),
    );
    const hide = Keyboard.addListener('keyboardDidHide', () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return { height, visible: height > 0 };
}
