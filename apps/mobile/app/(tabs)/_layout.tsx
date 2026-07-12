import { Tabs, Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuthStore } from "@weglue/shared";
import { useRealtimeNotifications } from "../../hooks/useNotifications";
import { useClubRealtimeSync } from "../../hooks/useClubRealtimeSync";

export default function TabsLayout() {
  const { session, isLoading, profile } = useAuthStore();
  const insets = useSafeAreaInsets();

  // App-wide live notifications: keeps the notification list fresh and flips
  // profile relationship state (Requested → Following) in under a second
  // when a follow request is accepted, on whatever screen is open.
  useRealtimeNotifications(session?.user.id);

  // App-wide club/role/channel sync (Bug 19): officer promote/demote, member
  // add/remove, club renames and channel changes propagate live to every
  // screen and device without a manual refresh.
  useClubRealtimeSync(session?.user.id);

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
    <Tabs
      screenOptions={{
        headerShown: false,
        // Shorter teal bar with larger icons, matching the We Glue design
        // (previously 67pt with default ~24pt icons — too tall, icons too
        // small). Height 54 + safe-area inset keeps the home-indicator clear
        // on iPhone and honours Android navigation-bar insets, so equivalent
        // devices render at the same visible height.
        tabBarStyle: {
          backgroundColor: "#0FA6A6",
          borderTopWidth: 0,
          height: 54 + insets.bottom,
          paddingBottom: insets.bottom,
          paddingTop: 6,
        },
        // Dark icons on teal, per the design references. Active is solid
        // black; inactive keeps a clearly-visible darker tint (not the old
        // washed-out white) so the selected tab stays obvious.
        tabBarActiveTintColor: "#111111",
        tabBarInactiveTintColor: "rgba(0,0,0,0.45)",
        tabBarShowLabel: false,
        tabBarIconStyle: { marginTop: 2 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "home" : "home-outline"} size={28} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="clubs"
        options={{
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "people" : "people-outline"} size={30} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          tabBarIcon: ({ color }) => (
            <Ionicons name="search" size={28} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "chatbubble" : "chatbubble-outline"} size={27} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="calendar"
        options={{
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "calendar" : "calendar-outline"} size={27} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
