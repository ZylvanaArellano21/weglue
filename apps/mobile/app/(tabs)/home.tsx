import { Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuthStore } from "@weglue/shared";

export default function HomeScreen() {
  const { profile } = useAuthStore();

  return (
    <SafeAreaView className="flex-1 bg-cream">
      <View className="flex-1 items-center justify-center gap-4 px-8">
        <Text className="text-teal text-5xl" style={{ fontFamily: "Zain_700Bold" }}>
          We Glue
        </Text>
        <Text className="text-xl text-gray-700 text-center" style={{ fontFamily: "Zain_400Regular" }}>
          Welcome{profile?.full_name ? `, ${profile.full_name}` : ""}! 🎉
        </Text>
        <Text className="text-base text-gray-400 text-center">
          Your campus community is coming soon.
        </Text>
      </View>
    </SafeAreaView>
  );
}
