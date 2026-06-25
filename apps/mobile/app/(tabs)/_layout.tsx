import { Tabs, Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useAuthStore } from "@weglue/shared";

export default function TabsLayout() {
  const { session, isLoading, profile } = useAuthStore();

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-cream">
        <ActivityIndicator size="large" color="#0FA6A6" />
      </View>
    );
  }

  // No session → Welcome screen
  if (!session) return <Redirect href="/" />;

  // Email not confirmed → verification waiting screen
  if (!session.user.email_confirmed_at) {
    return (
      <Redirect
        href={{
          pathname: "/auth/verify-email",
          params: { email: session.user.email ?? "", from: "signup" },
        }}
      />
    );
  }

  // Profile picture not set → must complete that step before accessing the main app
  if (!profile?.avatar_url) return <Redirect href="/onboarding/profile-pic" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: "#FEFCF0", borderTopColor: "#E5E7EB" },
        tabBarActiveTintColor: "#0FA6A6",
        tabBarInactiveTintColor: "#9CA3AF",
      }}
    >
      <Tabs.Screen
        name="home"
        options={{ title: "Home", tabBarLabel: "Home" }}
      />
    </Tabs>
  );
}
