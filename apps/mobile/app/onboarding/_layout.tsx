import { Stack } from "expo-router";

// Onboarding is Interests → Activities → Profile Picture → account creation.
// The old club-catalog, club-selection and match-results screens are gone
// along with their routes, so nothing can navigate — or resume — into them.
// Profile Picture is mandatory (098): a preset/text choice is stored in
// signup metadata like interests/activities; a Camera/Photo choice is
// uploaded pre-auth to the `pending-avatars` bucket and only its token
// travels in metadata.
export default function OnboardingLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, animation: "slide_from_right" }}>
      <Stack.Screen name="interests" />
      <Stack.Screen name="activities" />
      <Stack.Screen name="profile-picture" />
      <Stack.Screen name="signup" />
    </Stack>
  );
}
