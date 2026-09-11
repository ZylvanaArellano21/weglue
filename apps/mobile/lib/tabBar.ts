/**
 * Single source of truth for the bottom tab-bar height, shared by the tab
 * navigator (app/(tabs)/_layout.tsx) and every scrollable tab screen so their
 * content has a little breathing room above the bar.
 *
 * The tab navigator lays the teal bar out BELOW the screen container (it is not
 * absolutely positioned), and the bar's own height already includes the bottom
 * safe-area inset. So screen content already stops exactly at the top of the
 * bar — it never scrolls underneath it. Screens therefore only need a small
 * bottom padding for visual spacing, NOT the full bar height. Reserving the
 * whole bar height here is what produced the cream strip between the last row
 * and the teal bar.
 */

export const TAB_BAR_BASE_HEIGHT = 54;

/** Bottom content padding for a tab screen's scroll view: just breathing room
 *  above the (non-overlapping) tab bar. */
export function useTabBarBottomPadding(extra = 16): number {
  return extra;
}
