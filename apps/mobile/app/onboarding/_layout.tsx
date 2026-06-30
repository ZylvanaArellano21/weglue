import { Stack } from "expo-router";

export default function OnboardingLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, animation: "slide_from_right" }}>
      <Stack.Screen name="interests" />
      <Stack.Screen name="activities" />
      <Stack.Screen name="signup" />
      <Stack.Screen name="profile-pic" options={{ gestureEnabled: false }} />
      <Stack.Screen name="matches" options={{ gestureEnabled: false }} />
      <Stack.Screen name="interests-reroute" options={{ gestureEnabled: false }} />
      <Stack.Screen name="club-preview" />
    </Stack>
  );
}
