import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useAuthStore, useOnboardingStore } from "@weglue/shared";
import { supabase } from "../../lib/supabase";
import { useToast } from "../../components/Toast";

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

export default function InterestsRerouteScreen() {
  const router = useRouter();
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const { user } = useAuthStore();
  const { selectedInterests, toggleInterest } = useOnboardingStore();
  const { show, ToastComponent } = useToast();
  const [saving, setSaving] = useState(false);

  // Block Android hardware back — navigation is explicit only.
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => sub.remove();
  }, []);

  async function handleNext() {
    if (!user) {
      show("Session expired. Please log in again.", "error");
      return;
    }
    setSaving(true);
    try {
      // Replace all interests in the DB with the current selection.
      await supabase.from("user_interests").delete().eq("user_id", user.id);
      if (selectedInterests.length > 0) {
        await supabase.from("user_interests").insert(
          selectedInterests.map((interest) => ({ user_id: user.id, interest }))
        );
      }
    } finally {
      setSaving(false);
    }

    if (returnTo === "matches-view-all") {
      router.replace({
        pathname: "/onboarding/matches",
        params: { viewAll: "1" },
      });
    } else {
      router.replace("/onboarding/matches");
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      {ToastComponent}

      <View style={styles.topBar}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
        >
          <Text style={styles.backArrow}>‹</Text>
        </TouchableOpacity>
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

      <View style={styles.footer}>
        <TouchableOpacity
          style={[
            styles.primaryBtn,
            (selectedInterests.length === 0 || saving) && styles.primaryBtnDisabled,
          ]}
          onPress={handleNext}
          disabled={selectedInterests.length === 0 || saving}
          activeOpacity={0.85}
        >
          {saving ? (
            <ActivityIndicator color="#FEFCF0" />
          ) : (
            <Text style={styles.primaryBtnText}>Next</Text>
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
