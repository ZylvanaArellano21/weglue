import { Tabs, Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuthStore } from "@weglue/shared";
import { useRealtimeNotifications } from "../../hooks/useNotifications";
import { useClubRealtimeSync } from "../../hooks/useClubRealtimeSync";
import { useFirstLoginPushPermission } from "../../hooks/useFirstLoginPushPermission";
import { messageBadgeCounts, useUnreadSummaryValue } from "../../hooks/useUnreadSummary";
import { CountBadge } from "../../components/shared/CountBadge";

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

  // Correction 1: the ONE sanctioned automatic OS permission-box trigger —
  // fires once, the first time a brand-new account's session reaches Home.
  useFirstLoginPushPermission();

  // Messages tab badge: unread MESSAGES, split Single + Groups by the same RPC
  // that feeds the two controls on the Message tab, so this number always
  // equals Single + Groups. Kept live by PushNotificationsHost's subscription.
  const { data: unreadSummary } = useUnreadSummaryValue(session?.user.id);
  const unreadMessages = messageBadgeCounts(unreadSummary).total;
  // Correction 6: Home tab badge — same cache read, same authoritative
  // unread_notifications total the Home screen's own header bell already
  // shows ((tabs)/index.tsx), so the two can never disagree.
  const unreadNotifications = unreadSummary?.unread_notifications ?? 0;

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

  // Email confirmation is the ONLY gate into the tabs. A missing profile
  // picture or an unfinished old onboarding flag must never block Home.

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
          // Badge stays INSIDE the wrapper bounds (Android clips overhang) —
          // same pattern as the Messages tab below.
          tabBarIcon: ({ color, focused }) => (
            <View style={{ width: 38, height: 32, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name={focused ? "home" : "home-outline"} size={28} color={color} />
              <CountBadge
                count={unreadNotifications}
                style={{ position: "absolute", top: 0, right: 0 }}
              />
            </View>
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
          // Badge stays INSIDE the wrapper bounds (Android clips overhang).
          tabBarIcon: ({ color, focused }) => (
            <View style={{ width: 38, height: 32, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name={focused ? "chatbubble" : "chatbubble-outline"} size={27} color={color} />
              <CountBadge
                count={unreadMessages}
                style={{ position: "absolute", top: 0, right: 0 }}
              />
            </View>
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
