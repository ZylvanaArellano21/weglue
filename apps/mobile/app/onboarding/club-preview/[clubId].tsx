import { useState } from "react";
import {
  Dimensions,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { MOCK_CLUBS } from "../../../data/mockClubs";

const SCREEN_WIDTH = Dimensions.get("window").width;
const PHOTO_SIZE = (SCREEN_WIDTH - 32 - 16) / 3;

// Static calendar data for display
const CALENDAR_DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const CALENDAR_WEEKS = [
  [null, null, 1, 2, 3, 4, 5],
  [6, 7, 8, 9, 10, 11, 12],
  [13, 14, 15, 16, 17, 18, 19],
  [20, 21, 22, 23, 24, 25, 26],
  [27, 28, 29, 30, 31, null, null],
];
const CALENDAR_HIGHLIGHT = 15;

export default function ClubPreviewScreen() {
  const router = useRouter();
  const { clubId } = useLocalSearchParams<{ clubId: string }>();
  const club = MOCK_CLUBS.find((c) => c.id === clubId) ?? MOCK_CLUBS[0];

  const [joined, setJoined] = useState(false);

  const gluemates = club.members.filter((m) => m.isGluemate).slice(0, 4);

  return (
    <View style={styles.root}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 60 }}>
        {/* Header image */}
        <View style={styles.headerImageWrap}>
          <Image source={{ uri: club.headerImageUrl }} style={styles.headerImage} />
          {/* Back button */}
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Text style={styles.backArrow}>‹</Text>
          </TouchableOpacity>
          {/* Club avatar */}
          <View style={styles.avatarWrap}>
            <Image source={{ uri: club.avatarUrl }} style={styles.avatar} />
          </View>
        </View>

        <View style={styles.body}>
          {/* Club name + member count */}
          <Text style={styles.clubName}>{club.name}</Text>
          <Text style={styles.memberCount}>{club.memberCount} Members</Text>

          {/* Join + Chat buttons */}
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={[styles.joinBtn, joined && styles.joinBtnJoined]}
              onPress={() => setJoined((v) => !v)}
              activeOpacity={0.85}
            >
              <Text style={[styles.joinBtnText, joined && styles.joinBtnTextJoined]}>
                {joined ? "Joined ✓" : "Join"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.chatBtn}
              onPress={() =>
                router.push({
                  pathname: "/onboarding/club-preview/chat",
                  params: { clubId: club.id },
                })
              }
              activeOpacity={0.85}
            >
              <Text style={styles.chatBtnText}>💬  Chat</Text>
            </TouchableOpacity>
          </View>

          {/* Gluemates */}
          {gluemates.length > 0 && (
            <View style={styles.gluematesRow}>
              <View style={styles.avatarStack}>
                {gluemates.map((m, i) => (
                  <Image
                    key={m.id}
                    source={{ uri: m.avatarUrl }}
                    style={[styles.stackAvatar, { marginLeft: i === 0 ? 0 : -10 }]}
                  />
                ))}
              </View>
              <Text style={styles.gluematesText}>{club.gluemates} Gluemates</Text>
            </View>
          )}

          {/* About */}
          <Text style={styles.sectionTitle}>About</Text>
          <Text style={styles.aboutText}>{club.about}</Text>
          {club.keyBenefits.map((b, i) => (
            <View key={i} style={styles.benefitRow}>
              <View style={styles.benefitCheckWrap}>
                <Text style={styles.benefitCheck}>✓</Text>
              </View>
              <Text style={styles.benefitText}>{b}</Text>
            </View>
          ))}

          {/* Meeting Schedule */}
          <Text style={styles.sectionTitle}>Meeting Schedule</Text>
          <View style={styles.scheduleCard}>
            <View style={styles.scheduleRow}>
              <Text style={styles.scheduleIcon}>📅</Text>
              <Text style={styles.scheduleText}>
                {club.meetingSchedule.day} {club.meetingSchedule.time}
              </Text>
            </View>
            <View style={styles.scheduleRow}>
              <Text style={styles.scheduleIcon}>📍</Text>
              <Text style={styles.scheduleText}>{club.meetingSchedule.location}</Text>
            </View>
          </View>

          {/* Upcoming Events */}
          <Text style={styles.sectionTitle}>Upcoming Events</Text>
          {club.upcomingEvents.map((event) => (
            <TouchableOpacity
              key={event.id}
              style={styles.eventCard}
              onPress={() =>
                router.push({
                  pathname: "/onboarding/club-preview/event/[eventId]",
                  params: { eventId: event.id, clubId: club.id },
                })
              }
              activeOpacity={0.85}
            >
              <Image source={{ uri: event.headerImageUrl }} style={styles.eventImage} />
              <View style={styles.eventBody}>
                <Text style={styles.eventTitle}>
                  {event.emoji} {event.title}
                </Text>
                <View style={styles.eventMetaRow}>
                  <Text style={styles.eventMetaIcon}>📅</Text>
                  <Text style={styles.eventMeta}>
                    {event.date} · {event.time}
                  </Text>
                </View>
                <View style={styles.eventMetaRow}>
                  <Text style={styles.eventMetaIcon}>📍</Text>
                  <Text style={styles.eventMeta}>{event.location}</Text>
                </View>
              </View>
              <Text style={styles.eventChevron}>›</Text>
            </TouchableOpacity>
          ))}

          {/* Photos that Glue */}
          <Text style={styles.sectionTitle}>Photos that Glue</Text>
          <View style={styles.photoGrid}>
            {club.photos.map((url, i) => (
              <TouchableOpacity
                key={i}
                onPress={() =>
                  router.push({
                    pathname: "/onboarding/club-preview/photo/[photoIndex]",
                    params: { photoIndex: String(i), clubId: club.id },
                  })
                }
                activeOpacity={0.85}
              >
                <Image source={{ uri: url }} style={[styles.gridPhoto, { width: PHOTO_SIZE, height: PHOTO_SIZE }]} />
              </TouchableOpacity>
            ))}
          </View>

          {/* Calendar */}
          <Text style={styles.sectionTitle}>Calendar</Text>
          <View style={styles.calendarCard}>
            <View style={styles.calendarHeader}>
              <TouchableOpacity style={styles.calendarArrow}>
                <Text style={styles.calendarArrowText}>‹</Text>
              </TouchableOpacity>
              <Text style={styles.calendarMonth}>May 2023</Text>
              <TouchableOpacity style={styles.calendarArrow}>
                <Text style={styles.calendarArrowText}>›</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.calendarDaysRow}>
              {CALENDAR_DAYS.map((d) => (
                <Text key={d} style={styles.calendarDayLabel}>{d}</Text>
              ))}
            </View>
            {CALENDAR_WEEKS.map((week, wi) => (
              <View key={wi} style={styles.calendarWeekRow}>
                {week.map((day, di) => (
                  <View
                    key={di}
                    style={[
                      styles.calendarCell,
                      day === CALENDAR_HIGHLIGHT && styles.calendarCellHighlight,
                    ]}
                  >
                    {day !== null && (
                      <Text
                        style={[
                          styles.calendarDayNum,
                          day === CALENDAR_HIGHLIGHT && styles.calendarDayNumHighlight,
                        ]}
                      >
                        {day}
                      </Text>
                    )}
                  </View>
                ))}
              </View>
            ))}
          </View>

          {/* Officers */}
          <Text style={styles.sectionTitle}>Officers</Text>
          {club.officers.map((officer) => (
            <View key={officer.id} style={styles.officerCard}>
              <Image source={{ uri: officer.avatarUrl }} style={styles.officerAvatar} />
              <View style={styles.officerInfo}>
                <Text style={styles.officerName}>{officer.name}</Text>
                <Text style={styles.officerRole}>{officer.role}</Text>
              </View>
              <TouchableOpacity style={styles.messageBtn} activeOpacity={0.85}>
                <Text style={styles.messageBtnText}>Message</Text>
              </TouchableOpacity>
            </View>
          ))}

          {/* Members link */}
          <TouchableOpacity
            style={styles.viewMembersBtn}
            onPress={() =>
              router.push({
                pathname: "/onboarding/club-preview/members",
                params: { clubId: club.id },
              })
            }
            activeOpacity={0.85}
          >
            <Text style={styles.viewMembersText}>View All Members ({club.memberCount})</Text>
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
  headerImageWrap: { position: "relative" },
  headerImage: { width: "100%", height: 200 },
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
  avatarWrap: {
    position: "absolute",
    bottom: -36,
    left: 16,
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 3,
    borderColor: CREAM,
    overflow: "hidden",
    backgroundColor: "#E0F7F7",
  },
  avatar: { width: "100%", height: "100%" },
  body: { paddingHorizontal: 16, paddingTop: 48 },
  clubName: { fontSize: 22, fontWeight: "700", color: INK, marginBottom: 2 },
  memberCount: { fontSize: 13, color: MUTED, marginBottom: 16 },
  actionRow: { flexDirection: "row", gap: 10, marginBottom: 16 },
  joinBtn: {
    flex: 1,
    height: 44,
    backgroundColor: TEAL,
    borderRadius: 30,
    alignItems: "center",
    justifyContent: "center",
  },
  joinBtnJoined: { backgroundColor: "#E0F7F7" },
  joinBtnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  joinBtnTextJoined: { color: TEAL },
  chatBtn: {
    height: 44,
    paddingHorizontal: 20,
    borderRadius: 30,
    borderWidth: 1.5,
    borderColor: TEAL,
    alignItems: "center",
    justifyContent: "center",
  },
  chatBtnText: { color: TEAL, fontWeight: "600", fontSize: 14 },
  gluematesRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 20 },
  avatarStack: { flexDirection: "row" },
  stackAvatar: { width: 28, height: 28, borderRadius: 14, borderWidth: 1.5, borderColor: CREAM },
  gluematesText: { fontSize: 13, color: MUTED, fontWeight: "500" },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: INK,
    marginBottom: 10,
    marginTop: 20,
  },
  aboutText: { fontSize: 14, color: MUTED, lineHeight: 20, marginBottom: 10 },
  benefitRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginBottom: 6 },
  benefitCheckWrap: {
    width: 18,
    height: 18,
    borderRadius: 3,
    backgroundColor: TEAL,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  benefitCheck: { fontSize: 11, color: "#fff", fontWeight: "700" },
  benefitText: { flex: 1, fontSize: 13, color: INK, lineHeight: 18 },
  scheduleCard: {
    backgroundColor: "#fff",
    borderRadius: 10,
    padding: 12,
    gap: 6,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  scheduleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  scheduleIcon: { fontSize: 16 },
  scheduleText: { fontSize: 13, color: INK, fontWeight: "500" },
  eventCard: {
    flexDirection: "row",
    backgroundColor: "#fff",
    borderRadius: 10,
    marginBottom: 10,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
    alignItems: "center",
  },
  eventImage: { width: 80, height: 70 },
  eventBody: { flex: 1, padding: 10 },
  eventTitle: { fontSize: 13, fontWeight: "700", color: INK, marginBottom: 4 },
  eventMetaRow: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 2 },
  eventMetaIcon: { fontSize: 11 },
  eventMeta: { fontSize: 11, color: MUTED },
  eventChevron: { fontSize: 22, color: MUTED, paddingRight: 10 },
  photoGrid: { flexDirection: "row", gap: 8, marginBottom: 8 },
  gridPhoto: { borderRadius: 8 },
  calendarCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  calendarHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  calendarArrow: { padding: 4 },
  calendarArrowText: { fontSize: 20, color: MUTED },
  calendarMonth: { fontSize: 13, fontWeight: "700", color: INK },
  calendarDaysRow: {
    flexDirection: "row",
    marginBottom: 4,
  },
  calendarDayLabel: {
    flex: 1,
    textAlign: "center",
    fontSize: 11,
    color: MUTED,
    fontWeight: "600",
  },
  calendarWeekRow: {
    flexDirection: "row",
    marginBottom: 2,
  },
  calendarCell: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    height: 28,
    borderRadius: 14,
  },
  calendarCellHighlight: {
    backgroundColor: TEAL,
  },
  calendarDayNum: {
    fontSize: 12,
    color: INK,
  },
  calendarDayNumHighlight: {
    color: "#fff",
    fontWeight: "700",
  },
  officerCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  officerAvatar: { width: 44, height: 44, borderRadius: 22, marginRight: 10 },
  officerInfo: { flex: 1 },
  officerName: { fontSize: 14, fontWeight: "700", color: INK },
  officerRole: { fontSize: 12, color: TEAL, fontWeight: "500" },
  messageBtn: {
    borderWidth: 1,
    borderColor: TEAL,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  messageBtnText: { color: TEAL, fontSize: 12, fontWeight: "600" },
  viewMembersBtn: {
    alignSelf: "center",
    marginTop: 16,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 30,
    borderWidth: 1.5,
    borderColor: TEAL,
  },
  viewMembersText: { color: TEAL, fontSize: 14, fontWeight: "600" },
});
