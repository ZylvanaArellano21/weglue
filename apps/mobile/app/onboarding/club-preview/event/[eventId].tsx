import {
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { MOCK_CLUBS } from "../../../../data/mockClubs";

export default function EventPreviewScreen() {
  const router = useRouter();
  const { eventId, clubId } = useLocalSearchParams<{ eventId: string; clubId: string }>();

  const club = MOCK_CLUBS.find((c) => c.id === clubId) ?? MOCK_CLUBS[0];
  const event = club.upcomingEvents.find((e) => e.id === eventId) ?? club.upcomingEvents[0];

  return (
    <View style={styles.root}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Header image */}
        <View style={styles.headerWrap}>
          <Image source={{ uri: event.headerImageUrl }} style={styles.headerImage} />
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Text style={styles.backArrow}>‹</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.body}>
          <Text style={styles.emoji}>{event.emoji}</Text>
          <Text style={styles.title}>{event.title}</Text>

          <View style={styles.metaCard}>
            <View style={styles.metaRow}>
              <Text style={styles.metaIcon}>📅</Text>
              <View>
                <Text style={styles.metaLabel}>{event.date}</Text>
                <Text style={styles.metaValue}>{event.time}</Text>
              </View>
            </View>
            <View style={styles.divider} />
            <View style={styles.metaRow}>
              <Text style={styles.metaIcon}>📍</Text>
              <View>
                <Text style={styles.metaLabel}>Location</Text>
                <Text style={styles.metaValue}>{event.location}</Text>
              </View>
            </View>
            <View style={styles.divider} />
            <View style={styles.metaRow}>
              <Text style={styles.metaIcon}>✅</Text>
              <View>
                <Text style={styles.metaLabel}>Going</Text>
                <Text style={styles.metaValue}>{event.going} people</Text>
              </View>
            </View>
          </View>

          <Text style={styles.sectionTitle}>About this event</Text>
          <Text style={styles.description}>{event.description}</Text>

          <Text style={styles.sectionTitle}>Hosted by</Text>
          <View style={styles.hostRow}>
            <Image source={{ uri: club.avatarUrl }} style={styles.hostAvatar} />
            <Text style={styles.hostName}>{club.name}</Text>
          </View>

          <TouchableOpacity
            style={styles.joinEventBtn}
            activeOpacity={0.85}
          >
            <Text style={styles.joinEventBtnText}>Join this event</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const TEAL = "#0FA6A6";
const CREAM = "#FEFCF0";
const INK = "#1a1a1a";
const MUTED = "#5F5D5D";

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: CREAM },
  headerWrap: { position: "relative" },
  headerImage: { width: "100%", height: 240 },
  backBtn: {
    position: "absolute",
    top: 48,
    left: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.85)",
    alignItems: "center",
    justifyContent: "center",
  },
  backArrow: { fontSize: 26, color: INK, lineHeight: 30 },
  body: { paddingHorizontal: 20, paddingTop: 16 },
  emoji: { fontSize: 32, marginBottom: 6 },
  title: { fontSize: 22, fontWeight: "700", color: INK, marginBottom: 16 },
  metaCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 },
  metaIcon: { fontSize: 22 },
  metaLabel: { fontSize: 11, color: MUTED, fontWeight: "500", marginBottom: 2 },
  metaValue: { fontSize: 14, color: INK, fontWeight: "600" },
  divider: { height: 1, backgroundColor: "rgba(0,0,0,0.06)", marginVertical: 2 },
  sectionTitle: { fontSize: 16, fontWeight: "700", color: INK, marginBottom: 8, marginTop: 4 },
  description: { fontSize: 14, color: MUTED, lineHeight: 22, marginBottom: 20 },
  hostRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 28 },
  hostAvatar: { width: 36, height: 36, borderRadius: 18 },
  hostName: { fontSize: 14, fontWeight: "600", color: INK },
  joinEventBtn: {
    height: 52,
    backgroundColor: TEAL,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  joinEventBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
});
