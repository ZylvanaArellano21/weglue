// Unambiguous alias for the Welcome screen. The root URL "/" is owned by BOTH
// app/index.tsx and app/(tabs)/index.tsx (groups don't add URL segments), so a
// <Redirect href="/"> fired from inside (tabs) — e.g. right after signing out —
// resolved back to (tabs)/index, never unmounted the tabs, and re-rendered the
// redirect in an infinite loop ("Maximum update depth exceeded" = the logout
// freeze). Redirecting to "/welcome" always leaves the (tabs) navigator.
export { default } from './index';
