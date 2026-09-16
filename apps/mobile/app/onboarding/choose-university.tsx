import { useCallback, useEffect, useState } from "react";
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
import {
  type Campus,
  retryIdempotent,
  toCampuses,
  useOnboardingStore,
} from "@weglue/shared";
import { supabase } from "../../lib/supabase";

/**
 * First step of signup: which campus is this account being created on.
 *
 * The campus is chosen BEFORE the interest survey so everything downstream —
 * the match preview, the email rule applied to the address, and the membership
 * the auth trigger creates — is already campus-correct. It is read from
 * `list_active_campuses()`, never hardcoded, because campus ids differ between
 * environments and a campus can be activated without shipping an app release.
 */
export default function ChooseUniversityScreen() {
  const router = useRouter();
  const { selectedCampusSlug, setSelectedCampusSlug } = useOnboardingStore();

  const [campuses, setCampuses] = useState<Campus[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [choice, setChoice] = useState<string | null>(selectedCampusSlug);

  const load = useCallback(async () => {
    setFailed(false);
    setCampuses(null);
    try {
      const rows = await retryIdempotent(async () => {
        const { data, error } = await supabase.rpc("list_active_campuses");
        if (error) throw error;
        return data;
      });
      const list = toCampuses(rows);
      setCampuses(list);
      if (list.length === 0) setFailed(true);
    } catch {
      setCampuses([]);
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // A campus kept from a previous visit is only still valid if it is still on
  // the active list — otherwise the user would carry a stale slug into signup,
  // where the backend would reject it with nothing on screen explaining why.
  useEffect(() => {
    if (!campuses || !choice) return;
    if (!campuses.some((c) => c.slug === choice)) setChoice(null);
  }, [campuses, choice]);

  function handleNext() {
    if (!choice) return;
    setSelectedCampusSlug(choice);
    router.push("/onboarding/interests");
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topBar}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backBtn}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Text style={styles.backArrow}>‹</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.header}>
          <Text style={styles.title}>Choose your university</Text>
          <Text style={styles.subtitle}>
            Your campus decides the clubs, events and people you see on We Glue.
          </Text>
        </View>

        <View style={styles.body}>
          {campuses === null ? (
            <View style={styles.center}>
              <ActivityIndicator size="large" color="#0FA6A6" />
            </View>
          ) : failed ? (
            <View style={styles.center}>
              <Text style={styles.failedText}>
                We couldn&apos;t load the list of universities. Check your
                connection and try again.
              </Text>
              <TouchableOpacity
                style={[styles.primaryBtn, styles.retryBtn]}
                onPress={() => void load()}
                activeOpacity={0.85}
              >
                <Text style={styles.primaryBtnText}>Try again</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              {campuses.map((campus) => {
                const selected = choice === campus.slug;
                return (
                  <TouchableOpacity
                    key={campus.slug}
                    style={[styles.card, selected && styles.cardSelected]}
                    onPress={() => setChoice(campus.slug)}
                    activeOpacity={0.85}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={campus.name}
                  >
                    <View
                      style={[styles.radio, selected && styles.radioSelected]}
                    >
                      {selected && <View style={styles.radioDot} />}
                    </View>
                    <Text
                      style={[
                        styles.cardText,
                        selected && styles.cardTextSelected,
                      ]}
                    >
                      {campus.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}

              <TouchableOpacity
                style={[styles.primaryBtn, !choice && styles.primaryBtnDisabled]}
                onPress={handleNext}
                disabled={!choice}
                activeOpacity={0.85}
              >
                <Text style={styles.primaryBtnText}>Next</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => router.replace("/auth/login")}
                style={styles.footerBtn}
              >
                <Text style={styles.footerText}>
                  Already have an account?{" "}
                  <Text style={styles.tealLink}>Log in</Text>
                </Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#FEFCF0" },
  topBar: { paddingHorizontal: 20, paddingTop: 8 },
  backBtn: { width: 40, height: 40, justifyContent: "center" },
  backArrow: { fontSize: 30, color: "#000", lineHeight: 36 },
  // maxWidth/alignSelf are a no-op on phone but cap and center the column on
  // iPad and Android tablets instead of stretching edge-to-edge.
  header: {
    alignItems: "center",
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 28,
    width: "100%",
    maxWidth: 480,
    alignSelf: "center",
  },
  title: {
    fontSize: 26,
    fontWeight: "700",
    color: "#0FA6A6",
    textAlign: "center",
  },
  subtitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#000",
    textAlign: "center",
    lineHeight: 22,
    marginTop: 10,
  },
  body: {
    paddingHorizontal: 24,
    paddingBottom: 40,
    width: "100%",
    maxWidth: 480,
    alignSelf: "center",
    gap: 14,
  },
  center: { alignItems: "center", paddingTop: 32, gap: 20 },
  failedText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#000",
    textAlign: "center",
    lineHeight: 20,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    minHeight: 68,
    paddingHorizontal: 18,
    paddingVertical: 16,
    backgroundColor: "#FFFEF7",
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.2)",
    borderRadius: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 3,
  },
  cardSelected: { borderColor: "#0FA6A6", borderWidth: 2 },
  cardText: { flex: 1, fontSize: 15, fontWeight: "600", color: "#000" },
  cardTextSelected: { color: "#0FA6A6" },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: "rgba(0,0,0,0.3)",
    alignItems: "center",
    justifyContent: "center",
  },
  radioSelected: { borderColor: "#0FA6A6" },
  radioDot: {
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: "#0FA6A6",
  },
  primaryBtn: {
    height: 52,
    backgroundColor: "#0FA6A6",
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },
  retryBtn: { alignSelf: "stretch" },
  primaryBtnDisabled: { opacity: 0.5 },
  primaryBtnText: { color: "#FEFCF0", fontSize: 16, fontWeight: "600" },
  footerBtn: { alignSelf: "center", marginTop: 6 },
  footerText: { fontSize: 12, color: "#5F5D5D" },
  tealLink: { fontSize: 12, color: "#0FA6A6", fontWeight: "600" },
});
