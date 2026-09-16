import { Stack } from "expo-router";

// Onboarding is Choose University → Interests → Activities → Profile Picture →
// account creation. The campus step comes first so the match preview, the email
// rule applied to the address, and the membership created at signup are all
// campus-correct; an existing account resuming onboarding skips it, because its
// campus is already set.
// The old club-catalog, club-selection and match-results screens are gone
// along with their routes, so nothing can navigate — or resume — into them.
// Profile Picture is mandatory (098): a preset/text choice is stored in
// signup metadata like interests/activities; a Camera/Photo choice is
// uploaded pre-auth to the `pending-avatars` bucket and only its token
// travels in metadata.
export default function OnboardingLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, animation: "slide_from_right" }}>
      <Stack.Screen name="choose-university" />
      <Stack.Screen name="interests" />
      <Stack.Screen name="activities" />
      <Stack.Screen name="profile-picture" />
      <Stack.Screen name="signup" />
    </Stack>
  );
}
