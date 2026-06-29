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

  const rsvpAvatars = club.members.slice(0, 3);

  return (
    <View style={styles.root}>
      {/* Mini top header */}
      <SafeAreaView style={styles.miniHeader} edges={["top"]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backArrow}>‹</Text>
        </TouchableOpacity>
        <View style={styles.miniHeaderCenter}>
          <Image source={{ uri: club.avatarUrl }} style={styles.miniClubAvatar} />
          <Text style={styles.miniClubName}>{club.name}</Text>
        </View>
        <TouchableOpacity style={styles.joinPill} activeOpacity={0.85}>
          <Text style={styles.joinPillText}>Join</Text>
        </TouchableOpacity>
      </SafeAreaView>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Event image */}
        <Image source={{ uri: event.headerImageUrl }} style={styles.headerImage} resizeMode="cover" />

        <View style={styles.body}>
          {/* Title */}
          <Text style={styles.title}>{event.emoji} {event.title}</Text>

          {/* Info card */}
          <View style={styles.infoCard}>
            <View style={styles.infoRow}>
              <Text style={styles.infoIcon}>📅</Text>
              <View>
                <Text style={styles.infoLabel}>Date & Time</Text>
                <Text style={styles.infoValue}>{event.date}</Text>
                <Text style={styles.infoValue}>{event.time}</Text>
              </View>
            </View>
            <View style={styles.infoDivider} />
            <View style={styles.infoRow}>
              <Text style={styles.infoIcon}>📍</Text>
              <View>
                <Text style={styles.infoLabel}>Location</Text>
                <Text style={styles.infoValue}>{event.location}</Text>
              </View>
            </View>
          </View>

          {/* RSVP row */}
          <View style={styles.rsvpRow}>
            <View style={styles.rsvpAvatarStack}>
              {rsvpAvatars.map((m, i) => (
                <Image
                  key={m.id}
                  source={{ uri: m.avatarUrl }}
                  style={[styles.rsvpAvatar, { marginLeft: i === 0 ? 0 : -10 }]}
                />
              ))}
            </View>
            <View style={styles.rsvpTextWrap}>
              <Text style={styles.rsvpGoing}>{event.going} going</Text>
              <Text style={styles.rsvpSub}>Be part of the community</Text>
            </View>
          </View>

          {/* About */}
          <Text style={styles.sectionTitle}>About this event</Text>
          <Text style={styles.description}>{event.description}</Text>

          {/* Share + bookmark row */}
          <View style={styles.actionsRow}>
            <TouchableOpacity style={styles.actionIconBtn} activeOpacity={0.75}>
              <Text style={styles.actionIconText}>▷</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionIconBtn} activeOpacity={0.75}>
              <Text style={styles.actionIconText}>🔖</Text>
            </TouchableOpacity>
          </View>

          {/* Are you coming */}
          <Text style={styles.comingQuestion}>Are you coming?</Text>
          <View style={styles.rsvpBtnsRow}>
            <TouchableOpacity style={styles.rsvpBtn} activeOpacity={0.85}>
              <Text style={styles.rsvpBtnText}>Going</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.rsvpBtn} activeOpacity={0.85}>
              <Text style={styles.rsvpBtnText}>Can't</Text>
            </TouchableOpacity>
          </View>
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
  miniHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: CREAM,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(0,0,0,0.06)",
  },
  backBtn: { width: 36, height: 36, justifyContent: "center" },
  backArrow: { fontSize: 26, color: INK, lineHeight: 30 },
  miniHeaderCenter: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  miniClubAvatar: { width: 28, height: 28, borderRadius: 14 },
  miniClubName: { fontSize: 14, fontWeight: "700", color: INK },
  joinPill: {
    backgroundColor: TEAL,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  joinPillText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  headerImage: { width: "100%", height: 220 },
  body: { paddingHorizontal: 16, paddingTop: 16 },
  title: { fontSize: 20, fontWeight: "700", color: INK, marginBottom: 16 },
  infoCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  infoRow: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingVertical: 6 },
  infoIcon: { fontSize: 20, marginTop: 2 },
  infoLabel: { fontSize: 11, color: MUTED, fontWeight: "500", marginBottom: 3 },
  infoValue: { fontSize: 14, color: INK, fontWeight: "600" },
  infoDivider: { height: 1, backgroundColor: "rgba(0,0,0,0.06)", marginVertical: 4 },
  rsvpRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 20,
  },
  rsvpAvatarStack: { flexDirection: "row" },
  rsvpAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: CREAM,
  },
  rsvpTextWrap: { flex: 1 },
  rsvpGoing: { fontSize: 14, fontWeight: "700", color: INK },
  rsvpSub: { fontSize: 11, color: MUTED, marginTop: 1 },
  sectionTitle: { fontSize: 16, fontWeight: "700", color: INK, marginBottom: 8 },
  description: { fontSize: 14, color: MUTED, lineHeight: 22, marginBottom: 16 },
  actionsRow: {
    flexDirection: "row",
    gap: 16,
    marginBottom: 20,
  },
  actionIconBtn: { padding: 2 },
  actionIconText: { fontSize: 20, color: TEAL },
  comingQuestion: {
    fontSize: 15,
    fontWeight: "700",
    color: INK,
    marginBottom: 12,
  },
  rsvpBtnsRow: {
    flexDirection: "row",
    gap: 12,
  },
  rsvpBtn: {
    flex: 1,
    height: 46,
    borderWidth: 1.5,
    borderColor: TEAL,
    borderRadius: 30,
    alignItems: "center",
    justifyContent: "center",
  },
  rsvpBtnText: { color: TEAL, fontSize: 15, fontWeight: "700" },
});
