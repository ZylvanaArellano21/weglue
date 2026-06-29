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
import { MOCK_CLUBS } from "../../../data/mockClubs";

interface MockMessage {
  id: string;
  text: string;
  time: string;
  isOwn: boolean;
  senderAvatar?: string;
  dateLabel?: string;
}

const MOCK_MESSAGES: MockMessage[] = [
  { id: "1", text: "When is it?", time: "3:50 PM", isOwn: true },
  {
    id: "2",
    text: "Tomorrow at noon",
    time: "3:51 PM",
    isOwn: false,
    senderAvatar: "https://picsum.photos/seed/chat-s1/40/40",
  },
  {
    id: "3",
    text: "I though it was until next week",
    time: "3:51 PM",
    isOwn: false,
    senderAvatar: "https://picsum.photos/seed/chat-s2/40/40",
  },
  {
    id: "4",
    text: "Okay. I will do the closing",
    time: "3:51 PM",
    isOwn: false,
    senderAvatar: "https://picsum.photos/seed/chat-s3/40/40",
  },
  {
    id: "5",
    text: "Hey! I am running late",
    time: "3:50 PM",
    isOwn: true,
    dateLabel: "TUESDAY NOV 3",
  },
  {
    id: "6",
    text: "That is okay!",
    time: "3:51 PM",
    isOwn: false,
    senderAvatar: "https://picsum.photos/seed/chat-s1/40/40",
  },
  {
    id: "7",
    text: "Me too. Get there in 5",
    time: "3:51 PM",
    isOwn: false,
    senderAvatar: "https://picsum.photos/seed/chat-s2/40/40",
  },
];

export default function ChatPreviewScreen() {
  const router = useRouter();
  const { clubId } = useLocalSearchParams<{ clubId: string }>();
  const club = MOCK_CLUBS.find((c) => c.id === clubId) ?? MOCK_CLUBS[0];

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backArrow}>‹</Text>
        </TouchableOpacity>
        <Image source={{ uri: club.avatarUrl }} style={styles.headerAvatar} />
        <Text style={styles.headerTitle}>{club.name} Officers</Text>
        <TouchableOpacity style={styles.headerChevronBtn}>
          <Text style={styles.headerChevron}>›</Text>
        </TouchableOpacity>
      </View>

      {/* Channel tab */}
      <View style={styles.channelRow}>
        <Text style={styles.channelTab}>≡ #announcements</Text>
      </View>

      {/* Messages */}
      <ScrollView
        style={styles.messagesArea}
        contentContainerStyle={styles.messagesContent}
        showsVerticalScrollIndicator={false}
      >
        {MOCK_MESSAGES.map((msg) => (
          <View key={msg.id}>
            {msg.dateLabel && (
              <View style={styles.dateLabelRow}>
                <View style={styles.dateLabelLine} />
                <Text style={styles.dateLabelText}>{msg.dateLabel}</Text>
                <View style={styles.dateLabelLine} />
              </View>
            )}
            {msg.isOwn ? (
              <View style={styles.ownMsgRow}>
                <View style={styles.ownBubble}>
                  <Text style={styles.ownBubbleText}>{msg.text}</Text>
                </View>
                <Text style={styles.timeOwn}>{msg.time}</Text>
              </View>
            ) : (
              <View style={styles.otherMsgRow}>
                <Image
                  source={{ uri: msg.senderAvatar }}
                  style={styles.senderAvatar}
                />
                <View>
                  <View style={styles.otherBubble}>
                    <Text style={styles.otherBubbleText}>{msg.text}</Text>
                  </View>
                  <Text style={styles.timeOther}>{msg.time}</Text>
                </View>
              </View>
            )}
          </View>
        ))}
      </ScrollView>

      {/* Join CTA */}
      <View style={styles.joinCta}>
        <Text style={styles.joinCtaQuestion}>Do you want to chat?</Text>
        <TouchableOpacity
          style={styles.joinClubBtn}
          onPress={() => router.back()}
          activeOpacity={0.85}
        >
          <Text style={styles.joinClubBtnText}>Join the club</Text>
        </TouchableOpacity>
      </View>
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
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(0,0,0,0.08)",
    gap: 8,
  },
  backBtn: { width: 36, height: 36, justifyContent: "center" },
  backArrow: { fontSize: 28, color: INK, lineHeight: 32 },
  headerAvatar: { width: 34, height: 34, borderRadius: 17 },
  headerTitle: { flex: 1, fontSize: 15, fontWeight: "700", color: INK },
  headerChevronBtn: { padding: 4 },
  headerChevron: { fontSize: 22, color: MUTED },
  channelRow: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(0,0,0,0.06)",
  },
  channelTab: { fontSize: 13, color: MUTED, fontWeight: "500" },
  messagesArea: { flex: 1 },
  messagesContent: { paddingHorizontal: 12, paddingVertical: 12, gap: 4 },
  dateLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginVertical: 12,
  },
  dateLabelLine: { flex: 1, height: 1, backgroundColor: "rgba(0,0,0,0.1)" },
  dateLabelText: { fontSize: 11, color: MUTED, fontWeight: "600", letterSpacing: 0.5 },
  ownMsgRow: { alignItems: "flex-end", marginVertical: 3 },
  ownBubble: {
    backgroundColor: TEAL,
    borderRadius: 18,
    borderBottomRightRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 9,
    maxWidth: "72%",
  },
  ownBubbleText: { color: "#fff", fontSize: 14, lineHeight: 19 },
  timeOwn: { fontSize: 10, color: MUTED, marginTop: 2, marginRight: 4 },
  otherMsgRow: { flexDirection: "row", alignItems: "flex-end", gap: 6, marginVertical: 3 },
  senderAvatar: { width: 30, height: 30, borderRadius: 15, marginBottom: 14 },
  otherBubble: {
    backgroundColor: "#fff",
    borderRadius: 18,
    borderBottomLeftRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 9,
    maxWidth: "72%",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
  },
  otherBubbleText: { color: INK, fontSize: 14, lineHeight: 19 },
  timeOther: { fontSize: 10, color: MUTED, marginTop: 2, marginLeft: 4 },
  joinCta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderTopWidth: 1,
    borderTopColor: "rgba(0,0,0,0.08)",
    backgroundColor: CREAM,
  },
  joinCtaQuestion: { fontSize: 13, color: MUTED, fontWeight: "500" },
  joinClubBtn: {
    backgroundColor: TEAL,
    borderRadius: 30,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  joinClubBtnText: { color: "#fff", fontSize: 13, fontWeight: "700" },
});
