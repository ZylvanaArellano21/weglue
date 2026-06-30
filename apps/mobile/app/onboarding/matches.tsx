import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  FlatList,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { supabase } from "../../lib/supabase";
import { useAuthStore, useOnboardingStore } from "@weglue/shared";
import { useToast } from "../../components/Toast";
import { MOCK_CLUBS } from "../../data/mockClubs";

interface Club {
  id: string;
  name: string;
  description: string;
  meeting_day: string | null;
  meeting_time_start: string | null;
  meeting_time_end: string | null;
  meeting_building: string | null;
  meeting_room: string | null;
  cover_image_url: string | null;
  member_count: number;
  matchScore: number;
  joined: boolean;
}

interface ClubInterestRow {
  club_id: string;
  interest: string;
}

function formatTime(t: string | null): string {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const period = h >= 12 ? "pm" : "am";
  const hour = h > 12 ? h - 12 : h || 12;
  return `${hour}:${String(m).padStart(2, "0")} ${period}`;
}

function ClubCard({
  club,
  onJoin,
  onPress,
}: {
  club: Club;
  onJoin: () => void;
  onPress: () => void;
}) {
  const location =
    club.meeting_building && club.meeting_room
      ? `Building ${club.meeting_building}, Room ${club.meeting_room}`
      : null;

  const timeStr =
    club.meeting_time_start && club.meeting_time_end
      ? `${formatTime(club.meeting_time_start)} - ${formatTime(club.meeting_time_end)}`
      : null;

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.85}>
      {/* Cover image placeholder */}
      <View style={styles.cardImage}>
        <Text style={styles.cardImageText}>{club.name.charAt(0)}</Text>
      </View>
      <View style={styles.cardBody}>
        <Text style={styles.cardName} numberOfLines={1}>{club.name}</Text>
        {club.meeting_day && <Text style={styles.cardMeta}>{club.meeting_day}</Text>}
        {timeStr && <Text style={styles.cardMeta}>{timeStr}</Text>}
        {location && <Text style={styles.cardMeta}>{location}</Text>}
        <TouchableOpacity
          style={[styles.joinBtn, club.joined && styles.joinBtnJoined]}
          onPress={onJoin}
          activeOpacity={0.85}
        >
          <Text style={[styles.joinBtnText, club.joined && styles.joinBtnTextJoined]}>
            {club.joined ? "Joined ✓" : "Join"}
          </Text>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

export default function MatchesScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const { selectedInterests } = useOnboardingStore();
  const { show, ToastComponent } = useToast();
  const { viewAll: viewAllParam } = useLocalSearchParams<{ viewAll?: string }>();

  const [clubs, setClubs] = useState<Club[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);

  // Block Android hardware back — navigation is explicit only (Done button or back arrow).
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => sub.remove();
  }, []);

  // Restore "view all" state when returning from interests-reroute.
  useEffect(() => {
    if (viewAllParam === "1") setShowAll(true);
  }, [viewAllParam]);

  // Reload clubs on every focus so match scores reflect any interest changes
  // made on the interests-reroute screen.
  useFocusEffect(
    useCallback(() => {
      loadClubs();
    }, [])
  );

  async function loadClubs() {
    setLoading(true);
    try {
      // Load all clubs
      const { data: clubsData, error } = await supabase
        .from("clubs")
        .select("id, name, description, meeting_day, meeting_time_start, meeting_time_end, meeting_building, meeting_room, cover_image_url, member_count")
        .order("name");

      if (error || !clubsData) throw error;

      // Load club interests to compute match scores
      const { data: ciData } = await supabase
        .from("club_interests")
        .select("club_id, interest");

      // Load current memberships
      const { data: memberData } = user
        ? await supabase
            .from("club_members")
            .select("club_id")
            .eq("user_id", user.id)
        : { data: [] };

      const joinedSet = new Set((memberData ?? []).map((m: { club_id: string }) => m.club_id));

      const interestsByClub: Record<string, string[]> = {};
      (ciData as ClubInterestRow[] ?? []).forEach(({ club_id, interest }) => {
        if (!interestsByClub[club_id]) interestsByClub[club_id] = [];
        interestsByClub[club_id].push(interest);
      });

      const enriched: Club[] = clubsData.map((c: Omit<Club, "matchScore" | "joined">) => {
        const clubInterests = interestsByClub[c.id] ?? [];
        const matches = clubInterests.filter((i) => selectedInterests.includes(i)).length;
        const matchScore = clubInterests.length > 0 ? matches / clubInterests.length : 0;
        return { ...c, matchScore, joined: joinedSet.has(c.id) };
      });

      enriched.sort((a, b) => b.matchScore - a.matchScore);
      setClubs(enriched);
    } catch {
      // Silently fail, show empty state
    } finally {
      setLoading(false);
    }
  }

  async function handleJoin(club: Club) {
    if (!user) {
      show("Please log in to join clubs.", "error");
      return;
    }

    if (club.joined) {
      const { error } = await supabase
        .from("club_members")
        .delete()
        .eq("club_id", club.id)
        .eq("user_id", user.id);
      if (error) {
        show("Could not leave club. Try again.", "error");
        return;
      }
      setClubs((prev) =>
        prev.map((c) =>
          c.id === club.id
            ? { ...c, joined: false, member_count: Math.max(0, c.member_count - 1) }
            : c
        )
      );
    } else {
      const { error } = await supabase.from("club_members").insert({
        club_id: club.id,
        user_id: user.id,
        role: "member",
      });
      if (error) {
        show("Could not join club. Try again.", "error");
        return;
      }
      setClubs((prev) =>
        prev.map((c) =>
          c.id === club.id
            ? { ...c, joined: true, member_count: c.member_count + 1 }
            : c
        )
      );
    }
  }

  const filtered = clubs.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  const matchedClubs = filtered.filter((c) => c.matchScore > 0);
  const otherClubs = filtered.filter((c) => c.matchScore === 0);
  const displayMatched = showAll ? matchedClubs : matchedClubs.slice(0, 6);
  const displayOther = showAll ? otherClubs : otherClubs.slice(0, 4);

  return (
    <SafeAreaView style={styles.container}>
      {ToastComponent}

      {/* Header row */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.replace("/onboarding/profile-pic")} style={styles.backBtn}>
          <Text style={styles.backArrow}>‹</Text>
        </TouchableOpacity>
        <View style={styles.headerRight}>
          <TouchableOpacity
            style={styles.doneBtn}
            onPress={() => router.replace("/(tabs)")}
          >
            <Text style={styles.doneBtnText}>Done</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.viewAllBtn}
            onPress={() => setShowAll((v) => !v)}
          >
            <Text style={styles.viewAllText}>{showAll ? "Less" : "View All"}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Search bar */}
      <View style={styles.searchWrap}>
        <Text style={styles.searchIcon}>🔍</Text>
        <TextInput
          style={styles.searchInput}
          placeholder="Search clubs..."
          placeholderTextColor="rgba(0,0,0,0.35)"
          value={search}
          onChangeText={setSearch}
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch("")}>
            <Text style={styles.clearSearch}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color="#0FA6A6" />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
          {/* Matched clubs */}
          {matchedClubs.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Clubs matched for you</Text>
              <Text style={styles.sectionSub}>
                Based on your interests, we think you'd love these clubs. Tap to join now. You can
                leave anytime.
              </Text>
              <View style={styles.grid}>
                {displayMatched.map((club) => (
                  <View style={styles.gridItem} key={club.id}>
                    <ClubCard
                      club={club}
                      onJoin={() => handleJoin(club)}
                      onPress={() => {
                    const mockIndex = clubs.indexOf(club) % MOCK_CLUBS.length;
                    router.push(`/onboarding/club-preview/${MOCK_CLUBS[mockIndex].id}`);
                  }}
                    />
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Other clubs */}
          {otherClubs.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Other clubs you might like</Text>
              <View style={styles.grid}>
                {displayOther.map((club) => (
                  <View style={styles.gridItem} key={club.id}>
                    <ClubCard
                      club={club}
                      onJoin={() => handleJoin(club)}
                      onPress={() => {
                    const mockIndex = clubs.indexOf(club) % MOCK_CLUBS.length;
                    router.push(`/onboarding/club-preview/${MOCK_CLUBS[mockIndex].id}`);
                  }}
                    />
                  </View>
                ))}
              </View>
            </View>
          )}

          {filtered.length === 0 && (
            <Text style={styles.emptyText}>No clubs found matching "{search}"</Text>
          )}

          {/* Footer link */}
          <TouchableOpacity
            style={{ alignSelf: "center", marginTop: 16 }}
            onPress={() =>
              router.push({
                pathname: "/onboarding/interests-reroute",
                params: { returnTo: showAll ? "matches-view-all" : "matches" },
              })
            }
            activeOpacity={0.7}
          >
            <Text>
              <Text style={styles.doesntMatchLabel}>Doesn't match your interests? </Text>
              <Text style={styles.clickHere}>Click here</Text>
            </Text>
          </TouchableOpacity>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#FEFCF0" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 8,
  },
  backBtn: { width: 40, height: 40, justifyContent: "center" },
  backArrow: { fontSize: 30, color: "#000", lineHeight: 36 },
  headerRight: { flexDirection: "column", alignItems: "flex-end", gap: 6 },
  doneBtn: {
    backgroundColor: "#0FA6A6",
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 6,
  },
  doneBtnText: { color: "#fff", fontWeight: "600", fontSize: 14 },
  viewAllBtn: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.25)",
    paddingHorizontal: 16,
    paddingVertical: 5,
  },
  viewAllText: { color: "#000", fontSize: 13, fontWeight: "500" },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 30,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.15)",
    marginHorizontal: 20,
    marginBottom: 16,
    paddingHorizontal: 16,
    height: 46,
  },
  searchIcon: { fontSize: 16, marginRight: 8 },
  searchInput: { flex: 1, fontSize: 14, color: "#000" },
  clearSearch: { fontSize: 14, color: "#5F5D5D" },
  section: { paddingHorizontal: 20, marginBottom: 24 },
  sectionTitle: { fontSize: 22, fontWeight: "700", color: "#000", marginBottom: 4 },
  sectionSub: { fontSize: 13, color: "#5F5D5D", marginBottom: 16, lineHeight: 18 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  gridItem: { width: "47%" },
  card: {
    backgroundColor: "#fff",
    borderRadius: 10,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 3,
    elevation: 4,
  },
  cardImage: {
    height: 90,
    backgroundColor: "#E0F7F7",
    alignItems: "center",
    justifyContent: "center",
  },
  cardImageText: { fontSize: 36, color: "#0FA6A6", fontWeight: "700" },
  cardBody: { padding: 8, alignItems: "center" },
  cardName: { fontSize: 14, fontWeight: "600", color: "#000", marginBottom: 2, textAlign: "center" },
  cardMeta: { fontSize: 10, color: "#5F5D5D", textAlign: "center", lineHeight: 14 },
  joinBtn: {
    marginTop: 8,
    backgroundColor: "#0FA6A6",
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 5,
  },
  joinBtnJoined: { backgroundColor: "#E0F7F7" },
  joinBtnText: { color: "#fff", fontSize: 12, fontWeight: "600" },
  joinBtnTextJoined: { color: "#0FA6A6" },
  emptyText: { textAlign: "center", color: "#5F5D5D", marginTop: 40, fontSize: 14 },
  doesntMatchLabel: { fontSize: 13, color: "#000", fontWeight: "500" },
  clickHere: { fontSize: 13, color: "#0FA6A6", fontWeight: "500", textDecorationLine: "underline" },
});
