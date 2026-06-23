import { Text, View } from "react-native";

export default function HomeScreen() {
  return (
    <View className="flex-1 items-center justify-center gap-4 bg-white dark:bg-gray-950">
      <Text className="text-4xl font-bold text-brand-600">We Glue</Text>
      <Text className="text-center text-base text-gray-500">
        Your monorepo is ready. Start building.
      </Text>
    </View>
  );
}
