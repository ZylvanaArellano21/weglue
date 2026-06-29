import {
  FlatList,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { MOCK_CLUBS } from "../../../data/mockClubs";

export default function MembersPreviewScreen() {
  const router = useRouter();
  const { clubId } = useLocalSearchParams<{ clubId: string }>();
  const club = MOCK_CLUBS.find((c) => c.id === clubId) ?? MOCK_CLUBS[0];

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backArrow}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{club.name}</Text>
        <Text style={styles.headerSub}>{club.memberCount} Members</Text>
      </View>

      <FlatList
        data={club.members}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <View style={styles.memberRow}>
            <View style={styles.avatarWrap}>
              <Image source={{ uri: item.avatarUrl }} style={styles.avatar} />
              {item.isGluemate && <View style={styles.gluemateDot} />}
            </View>
            <View style={styles.memberInfo}>
              <Text style={styles.memberName}>{item.name}</Text>
              {item.isGluemate && (
                <Text style={styles.gluemateLabel}>Gluemate</Text>
              )}
            </View>
          </View>
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />
    </SafeAreaView>
  );
}

const TEAL = "#0FA6A6";
const CREAM = "#FEFCF0";
const INK = "#1a1a1a";
const MUTED = "#5F5D5D";

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: CREAM },
  header: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(0,0,0,0.08)",
  },
  backBtn: { width: 40, height: 40, justifyContent: "center", marginBottom: 4 },
  backArrow: { fontSize: 30, color: INK, lineHeight: 36 },
  headerTitle: { fontSize: 20, fontWeight: "700", color: INK },
  headerSub: { fontSize: 13, color: MUTED, marginTop: 2 },
  list: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 40 },
  memberRow: { flexDirection: "row", alignItems: "center", paddingVertical: 10 },
  avatarWrap: { position: "relative", marginRight: 12 },
  avatar: { width: 48, height: 48, borderRadius: 24 },
  gluemateDot: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: TEAL,
    borderWidth: 2,
    borderColor: CREAM,
  },
  memberInfo: { flex: 1 },
  memberName: { fontSize: 15, fontWeight: "600", color: INK },
  gluemateLabel: { fontSize: 11, color: TEAL, fontWeight: "600", marginTop: 2 },
  separator: { height: 1, backgroundColor: "rgba(0,0,0,0.06)" },
});
