import { router } from 'expo-router';

// Module-level flag: CTA caller sets this; Search tab consumes it on focus.
// Normal tab-switching does NOT set this, so state is preserved on tab return.
let _pendingReset = false;

export function markSearchReset(): void {
  _pendingReset = true;
}

export function consumeSearchReset(): boolean {
  if (_pendingReset) {
    _pendingReset = false;
    return true;
  }
  return false;
}

/**
 * Shared CTA navigation to the Search/Discover tab.
 * Sets a reset flag so the tab resets to default state (All categories, no search).
 * Normal tab-switching does NOT call this, preserving whatever state was active.
 */
export function navigateToDiscover(): void {
  markSearchReset();
  router.push('/(tabs)/search' as any);
}
