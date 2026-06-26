import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useOnboardingStore } from "@weglue/shared";

const INTERESTS = [
  "Finance & Business",
  "Social Events",
  "Music",
  "Art & Culture",
  "Social Justice & Activism",
  "Numbers & Economics",
  "Sports & Athletics",
  "Gaming",
  "Health & Wellness",
  "Environment",
  "Community Service",
  "Crafts",
  "Religion",
  "Technology and Computer",
  "Film & Media",
  "Photography",
  "Strategy and Critical Thinking",
  "Writing",
  "Fashion",
  "Debate & Politics",
  "Theater",
  "Travel & Languages",
] as const;

export default function InterestsScreen() {
  const router = useRouter();
  const { selectedInterests, toggleInterest } = useOnboardingStore();

  return (
    <SafeAreaView style={styles.container}>
      {/* Back arrow */}
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backArrow}>‹</Text>
        </TouchableOpacity>
      </View>

      {/* Progress bar */}
      <View style={styles.progressWrap}>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: "50%" }]} />
        </View>
        <Text style={styles.stepLabel}>Step 1 of 2</Text>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.heading}>What are your interests?</Text>
        <Text style={styles.subheading}>
          Select everything that excites you. We will match you to clubs that fit.
        </Text>

        {/* Chip grid */}
        <View style={styles.chips}>
          {INTERESTS.map((item) => {
            const selected = selectedInterests.includes(item);
            return (
              <TouchableOpacity
                key={item}
                onPress={() => toggleInterest(item)}
                style={[styles.chip, selected ? styles.chipSelected : styles.chipDefault]}
                activeOpacity={0.75}
              >
                <Text style={[styles.chipText, selected ? styles.chipTextSelected : styles.chipTextDefault]}>
                  {item}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Bottom padding for fixed button */}
        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Fixed Next button */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={[
            styles.primaryBtn,
            selectedInterests.length === 0 && styles.primaryBtnDisabled,
          ]}
          onPress={() => router.push("/onboarding/activities")}
          disabled={selectedInterests.length === 0}
          activeOpacity={0.85}
        >
          <Text style={styles.primaryBtnText}>Next</Text>
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
  progressFill: {
    height: 6,
    backgroundColor: "#0FA6A6",
    borderRadius: 3,
  },
  stepLabel: {
    marginTop: 6,
    fontSize: 12,
    fontWeight: "500",
    color: "#5F5D5D",
  },
  scroll: { paddingHorizontal: 24, paddingTop: 16 },
  heading: {
    fontSize: 28,
    fontWeight: "700",
    color: "#000",
    marginBottom: 8,
    lineHeight: 34,
  },
  subheading: {
    fontSize: 14,
    color: "#5F5D5D",
    marginBottom: 24,
    lineHeight: 20,
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  chip: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 40,
    borderWidth: 1,
  },
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
