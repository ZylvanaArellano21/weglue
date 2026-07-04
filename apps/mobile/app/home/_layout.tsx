import { Stack } from "expo-router";

export default function HomeLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="event-detail" />
      <Stack.Screen name="attendees" />
      <Stack.Screen name="new-event" />
      <Stack.Screen name="new-post" />
      <Stack.Screen name="notifications" />
      <Stack.Screen name="terms" />
      <Stack.Screen name="help" />
    </Stack>
  );
}
