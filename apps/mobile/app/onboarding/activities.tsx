import { useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useOnboardingStore } from "@weglue/shared";
import { supabase } from "../../lib/supabase";

const ACTIVITIES = [
  "Projects",
  "Volunteering",
  "Trips",
  "Workshops",
  "Social Events",
  "Campus Tours",
  "Tournaments",
  "Networking",
  "Study Groups",
  "Campus Fairs",
] as const;

export default function ActivitiesScreen() {
  const router = useRouter();
  const { selectedActivities, toggleActivity, selectedInterests, setMatchCount } =
    useOnboardingStore();
  const [loading, setLoading] = useState(false);

  async function handleFindMatches() {
    setLoading(true);
    try {
      // The count comes from the SAME server-side ranking that will persist the
      // user's recommendation batch at signup, so the number shown here is the
      // number of clubs they actually get. It can never be 0 or 1 while the
      // campus has at least two eligible clubs — the server tops the batch up
      // with the best-ranked active clubs.
      const { data, error } = await supabase.rpc("preview_club_match_count", {
        p_interests: selectedInterests,
      });
      if (error) throw error;
      setMatchCount(typeof data === "number" ? data : 0);
    } catch {
      // Never strand the user on a network blip — the real batch is built
      // server-side at signup regardless of what we managed to preview here.
      setMatchCount(0);
    } finally {
      setLoading(false);
      router.push("/onboarding/signup");
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Back arrow */}
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backArrow}>‹</Text>
        </TouchableOpacity>
      </View>

      {/* Progress bar — both halves filled */}
      <View style={styles.progressWrap}>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: "100%" }]} />
        </View>
        <Text style={styles.stepLabel}>Step 2 of 2</Text>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.heading}>What do you enjoy doing?</Text>
        <Text style={styles.subheading}>
          Pick all the activities you love. This helps us personalize your feed.
        </Text>

        {/* Chip grid */}
        <View style={styles.chips}>
          {ACTIVITIES.map((item) => {
            const selected = selectedActivities.includes(item);
            return (
              <TouchableOpacity
                key={item}
                onPress={() => toggleActivity(item)}
                style={[styles.chip, selected ? styles.chipSelected : styles.chipDefault]}
                activeOpacity={0.75}
              >
                <Text
                  style={[
                    styles.chipText,
                    selected ? styles.chipTextSelected : styles.chipTextDefault,
                  ]}
                >
                  {item}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Fixed Find my matches button */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={[
            styles.primaryBtn,
            (loading || selectedActivities.length === 0) && styles.primaryBtnDisabled,
          ]}
          onPress={handleFindMatches}
          disabled={loading || selectedActivities.length === 0}
          activeOpacity={0.85}
        >
          {loading ? (
            <ActivityIndicator color="#FEFCF0" />
          ) : (
            <Text style={styles.primaryBtnText}>Find my matches</Text>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#FEFCF0" },
  topBar: { paddingHorizontal: 20, paddingTop: 8 },
  backBtn: { width: 40, height: 40, justifyContent: "center" },
  backArrow: { fontSize: 30, color: "#000", lineHeight: 36 },
  progressWrap: { paddingHorizontal: 24, marginTop: 8, marginBottom: 4 },
  progressTrack: {
    height: 6,
    backgroundColor: "#E0E0E0",
    borderRadius: 3,
    overflow: "hidden",
  },
  progressFill: { height: 6, backgroundColor: "#0FA6A6", borderRadius: 3 },
  stepLabel: { marginTop: 6, fontSize: 12, fontWeight: "500", color: "#5F5D5D" },
  scroll: { paddingHorizontal: 24, paddingTop: 16 },
  heading: { fontSize: 28, fontWeight: "700", color: "#000", marginBottom: 8, lineHeight: 34 },
  subheading: { fontSize: 14, color: "#5F5D5D", marginBottom: 24, lineHeight: 20 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  chip: { paddingVertical: 10, paddingHorizontal: 18, borderRadius: 40, borderWidth: 1 },
  chipDefault: { backgroundColor: "#fff", borderColor: "rgba(0,0,0,0.2)" },
  chipSelected: { backgroundColor: "#0FA6A6", borderColor: "#0FA6A6" },
  chipText: { fontSize: 14, fontWeight: "500" },
  chipTextDefault: { color: "#000" },
  chipTextSelected: { color: "#fff" },
  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 24,
    paddingBottom: 40,
    paddingTop: 12,
    backgroundColor: "#FEFCF0",
  },
  primaryBtn: {
    height: 52,
    backgroundColor: "#0FA6A6",
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },
  primaryBtnDisabled: {
    backgroundColor: "#CCCCCC",
    shadowOpacity: 0,
    elevation: 0,
  },
  primaryBtnText: { color: "#FEFCF0", fontSize: 16, fontWeight: "600" },
});
