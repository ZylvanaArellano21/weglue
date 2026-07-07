/**
 * Route target for https://weglue.app/auth/confirm when Android App Links
 * open the app instead of the browser. Behaves exactly like /auth/confirmed:
 * useAuthDeepLink parses the URL fragment and sets the session; this screen
 * waits for it and routes by onboarding state.
 */
export { default } from "./confirmed";
