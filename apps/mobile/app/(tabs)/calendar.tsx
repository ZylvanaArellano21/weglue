import { View, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function CalendarTab() {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#FEFCF0" }}>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ fontSize: 18, color: "#9CA3AF", fontFamily: "Zain_700Bold" }}>
          Calendar — Coming Soon
        </Text>
      </View>
    </SafeAreaView>
  );
}
