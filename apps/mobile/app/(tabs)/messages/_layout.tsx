import { Stack } from 'expo-router';

// The Messages tab now owns only the inbox root. Every conversation and compose
// screen moved to the root-level `/chat/*` stack (app/chat/**) so opening a chat
// renders above the tab navigator, hides the tab bar, and Back returns to
// whatever journey opened it — not always the Messages tab.
export default function MessagesLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
