import { Tabs, Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuthStore } from "@weglue/shared";
import { SidebarProvider } from "../../context/SidebarContext";
import { useRealtimeNotifications } from "../../hooks/useNotifications";

export default function TabsLayout() {
  const { session, isLoading, profile } = useAuthStore();
  const insets = useSafeAreaInsets();

  // App-wide live notifications: keeps the notification list fresh and flips
  // profile relationship state (Requested → Following) in under a second
  // when a follow request is accepted, on whatever screen is open.
  useRealtimeNotifications(session?.user.id);

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-cream">
        <ActivityIndicator size="large" color="#0FA6A6" />
      </View>
    );
  }

  // "/welcome" (not "/"): the root URL is ambiguous between app/index.tsx and
  // (tabs)/index.tsx, and resolving it from inside the tabs re-entered Home in
  // an infinite redirect loop — the historical logout freeze.
  if (!session) return <Redirect href="/welcome" />;

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

  if (!profile?.avatar_url) return <Redirect href="/onboarding/profile-pic" />;

  if (profile.onboarding_completed === false) {
    return <Redirect href="/onboarding/matches" />;
  }

  return (
    <SidebarProvider>
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: "#0FA6A6",
          borderTopWidth: 0,
          height: 67 + insets.bottom,
          paddingBottom: insets.bottom,
          paddingTop: 4,
        },
        tabBarActiveTintColor: "#fff",
        tabBarInactiveTintColor: "rgba(255,255,255,0.6)",
        tabBarShowLabel: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="clubs"
        options={{
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="people" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="search" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="chatbubble-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="calendar"
        options={{
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="calendar-outline" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
    </SidebarProvider>
  );
}
