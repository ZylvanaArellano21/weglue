import { Stack } from "expo-router";

export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, animation: "slide_from_right" }}>
      <Stack.Screen name="login" />
      <Stack.Screen name="verify-email" />
      <Stack.Screen name="callback" options={{ animation: "none" }} />
      <Stack.Screen name="confirmed" options={{ animation: "none" }} />
      <Stack.Screen name="avatar" />
      <Stack.Screen name="survey" />
    </Stack>
  );
}
