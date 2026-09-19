// Cold-start routing decision for app/index.tsx (WelcomeScreen).
//
// WelcomeScreen is the root stack's anchor route. On a cold start it decides
// where a launched user lands (Welcome / verify-email / onboarding / Home).
// But when the app is launched by a Universal Link (iOS) / App Link (Android)
// that targets an in-app content screen, expo-router routes to that screen on
// its own and WelcomeScreen stays mounted *underneath* it. Running the
// redirect-to-Home in that case clobbers the deep-link destination — the
// content screen flashes, then bounces to Home. (An iOS-only cold-start timing
// race; Android's App Link handling lands after WelcomeScreen has settled.)
//
// `isContentDeepLinkUrl` identifies those launches from the value of
// `Linking.getInitialURL()` so WelcomeScreen can defer to expo-router.

// Content routes that are shareable (see lib/share.ts) AND declared in the
// app's associated-domains / intent-filter path list (app.json) AND backed by
// a real dynamic route file. `/invite/*` is deliberately NOT here: invite
// tokens have their own capture + deferred-navigation controller
// (lib/inviteController.ts) that WelcomeScreen already consults. `/checkin/*`
// has the analogous pendingCheckin capture + resume controller for the
// signed-out case, but a signed-IN cold launch must still land on the
// checkin screen itself, exactly like /club and /post.
const CONTENT_DEEP_LINK_PATH = /\/(?:club|post|checkin)\//;

/**
 * True when `url` (the app's cold-start URL) points at an in-app content screen
 * that expo-router routes to itself, so WelcomeScreen must not redirect.
 * Matches both the Universal/App Link form (`https://weglue.app/club/<id>`) and
 * the custom-scheme form (`weglue://club/<id>`); the `?source=qr` marker and
 * any other query string are ignored.
 */
export function isContentDeepLinkUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return CONTENT_DEEP_LINK_PATH.test(url);
}
