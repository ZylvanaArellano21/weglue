import { Tabs, Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useAuthStore } from "@weglue/shared";

export default function TabsLayout() {
  const { session, isLoading, isOnboarded } = useAuthStore();

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-cream">
        <ActivityIndicator size="large" color="#0FA6A6" />
      </View>
    );
  }

  if (!session) return <Redirect href="/" />;
  if (!isOnboarded) return <Redirect href="/auth/survey" />;

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
