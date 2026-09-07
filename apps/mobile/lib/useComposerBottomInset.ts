import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Bottom spacing for any surface that pins a composer to the bottom of the
 * screen (chat threads, the Comments sheet).
 *
 * WHY THIS EXISTS:
 * Composers were sitting flush against the physical bottom edge with the
 * keyboard closed (the home indicator ran straight through them), and flush
 * against the keyboard with it open. Both states now get a deliberate,
 * SHARED amount of breathing room so every conversation surface matches.
 *
 * The returned value is padding applied INSIDE the opaque surface — never as
 * margin outside it. That is what keeps the gap painted in the surface colour
 * instead of exposing the screen behind (the Comments-sheet transparent-strip
 * bug).
 *
 * `useAndroidKeyboardHeight` stays the only source of the Android IME HEIGHT
 * used to lift a surface; this hook only reports VISIBILITY and the resulting
 * padding, and is safe on both platforms.
 */

/**
 * Gap between the composer and the top of the open keyboard.
 * Measured off the Instagram reference screenshots: ~8pt in DMs, ~11pt in the
 * comments sheet, so 10 sits on both.
 */
export const COMPOSER_KEYBOARD_GAP = 10;

/**
 * Extra gap above the home indicator when the keyboard is closed. Instagram
 * leaves ~41pt total below the composer, i.e. the 34pt inset plus ~7.
 */
export const COMPOSER_EDGE_GAP = 8;

/** Cross-platform keyboard visibility. iOS uses the `will` events so layout
 *  changes ride along with the keyboard animation instead of snapping after. */
export function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvt, () => setVisible(true));
    const hide = Keyboard.addListener(hideEvt, () => setVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return visible;
}

/**
 * Bottom padding for the composer row.
 * - keyboard closed → safe-area inset + a small gap, so the composer never
 *   sits on the home indicator.
 * - keyboard open   → a fixed gap only; the safe area is behind the keyboard
 *   and adding it there would leave an oversized hole.
 */
export function useComposerBottomInset(): number {
  const insets = useSafeAreaInsets();
  const keyboardVisible = useKeyboardVisible();
  if (!keyboardVisible) return insets.bottom + COMPOSER_EDGE_GAP;
  // Android edge-to-edge: the IME height reported by `keyboardDidShow`
  // (useAndroidKeyboardHeight) omits Gboard's persistent toolbar / suggestion
  // strip, so a composer lifted by that height alone sits ~a strip-height
  // behind it. Fall back to the system bottom inset (the gesture / nav-bar
  // area, comparable to that strip) as the compensating buffer. iOS keeps the
  // tight WhatsApp-style gap unchanged.
  return Platform.OS === 'android' ? insets.bottom + COMPOSER_KEYBOARD_GAP : COMPOSER_KEYBOARD_GAP;
}
