/**
 * Single source of truth for the bottom tab-bar height, shared by the tab
 * navigator (app/(tabs)/_layout.tsx) and every scrollable tab screen so their
 * content never hides behind the bar.
 *
 * The visible bar is TAB_BAR_BASE_HEIGHT plus the device's bottom safe-area
 * inset (home indicator on iPhone, gesture/nav bar on Android). Screens use
 * `useTabBarBottomPadding()` to reserve exactly that much space beneath their
 * last row, with a little extra breathing room.
 */
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export const TAB_BAR_BASE_HEIGHT = 54;

/** Bottom content padding that clears the tab bar on the current device. */
export function useTabBarBottomPadding(extra = 16): number {
  const insets = useSafeAreaInsets();
  return TAB_BAR_BASE_HEIGHT + insets.bottom + extra;
}
