import { Stack } from "expo-router";

// Onboarding is now exactly three screens: Interests → Activities → account
// creation. The old mandatory profile-picture, club-catalog, club-selection
// and match-results screens are gone along with their routes, so nothing can
// navigate — or resume — into them.
export default function OnboardingLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, animation: "slide_from_right" }}>
      <Stack.Screen name="interests" />
      <Stack.Screen name="activities" />
      <Stack.Screen name="signup" />
    </Stack>
  );
}
