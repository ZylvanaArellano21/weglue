import { Stack } from "expo-router";

export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, animation: "slide_from_right" }}>
      <Stack.Screen name="login" options={{ gestureEnabled: false }} />
      <Stack.Screen name="verify-email" options={{ gestureEnabled: false }} />
      <Stack.Screen name="confirm-email" options={{ animation: "none" }} />
      <Stack.Screen name="confirmed" options={{ animation: "none" }} />
      <Stack.Screen name="avatar" />
      <Stack.Screen name="survey" />
      <Stack.Screen name="signup" options={{ gestureEnabled: false }} />
      <Stack.Screen name="forgot-password" options={{ gestureEnabled: false }} />
      <Stack.Screen name="forgot-password-success" options={{ gestureEnabled: false }} />
    </Stack>
  );
}
