import { useState } from "react";
import {
  FlatList,
  Image,
  StyleSheet,
  Text,
  TextInput,
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

  const [searchQuery, setSearchQuery] = useState("");

  const filtered = club.members.filter((m) =>
    m.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backArrow}>‹</Text>
        </TouchableOpacity>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle}>{club.name}</Text>
          <Text style={styles.headerSub}>{club.memberCount} Members</Text>
        </View>
      </View>

      {/* Search bar */}
      <View style={styles.searchWrap}>
        <Text style={styles.searchIcon}>🔍</Text>
        <TextInput
          style={styles.searchInput}
          placeholder="Search members"
          placeholderTextColor="rgba(0,0,0,0.3)"
          value={searchQuery}
          onChangeText={setSearchQuery}
          autoCapitalize="none"
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery("")} style={styles.clearBtn}>
            <Text style={styles.clearIcon}>⊗</Text>
          </TouchableOpacity>
        )}
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => (
          <View style={styles.memberRow}>
            <Image source={{ uri: item.avatarUrl }} style={styles.avatar} />
            <Text style={styles.memberName}>{item.name}</Text>
            <TouchableOpacity style={styles.chatIconBtn} activeOpacity={0.6}>
              <Text style={styles.chatIconText}>💬</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={item.isGluemate ? styles.gluemateBtn : styles.followBtn}
              activeOpacity={0.85}
            >
              <Text style={item.isGluemate ? styles.gluemateBtnText : styles.followBtnText}>
                {item.isGluemate ? "Gluemate" : "Follow"}
              </Text>
            </TouchableOpacity>
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
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(0,0,0,0.08)",
  },
  backBtn: { width: 40, height: 40, justifyContent: "center", marginRight: 4 },
  backArrow: { fontSize: 30, color: INK, lineHeight: 36 },
  headerTitleWrap: { flex: 1, alignItems: "center", paddingRight: 44 },
  headerTitle: { fontSize: 18, fontWeight: "700", color: INK },
  headerSub: { fontSize: 13, color: MUTED, marginTop: 2 },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.15)",
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 44,
  },
  searchIcon: { fontSize: 16, marginRight: 8 },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: INK,
  },
  clearBtn: { padding: 4 },
  clearIcon: { fontSize: 18, color: MUTED },
  list: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 40 },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
  },
  avatar: { width: 44, height: 44, borderRadius: 22, marginRight: 10 },
  memberName: { flex: 1, fontSize: 14, fontWeight: "500", color: INK },
  chatIconBtn: { marginRight: 8 },
  chatIconText: { fontSize: 16, color: MUTED },
  followBtn: {
    backgroundColor: TEAL,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  followBtnText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  gluemateBtn: {
    borderWidth: 1.5,
    borderColor: TEAL,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 6,
    backgroundColor: "#fff",
  },
  gluemateBtnText: { color: TEAL, fontSize: 13, fontWeight: "700" },
  separator: { height: 1, backgroundColor: "rgba(0,0,0,0.06)" },
});
