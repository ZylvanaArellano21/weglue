import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { supabase } from "../../lib/supabase";
import { useAuthStore, useOnboardingStore } from "@weglue/shared";
import { useToast } from "../../components/Toast";

const PRESET_COLORS = [
  "#4CAF50", "#9C27B0", "#E91E63", "#2196F3", "#FF9800",
  "#F44336", "#FFEB3B", "#000000", "#00BCD4", "#795548",
];

export default function ProfilePicScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const { pendingUsername, selectedInterests, selectedActivities } = useOnboardingStore();
  const { show, ToastComponent } = useToast();

  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [avatarType, setAvatarType] = useState<"photo" | "camera" | "preset" | null>(null);
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function pickFromCamera() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Camera access is required to take a profile photo.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      setAvatarUri(result.assets[0].uri);
      setAvatarType("camera");
      setSelectedPreset(null);
    }
  }

  async function pickFromLibrary() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Photo library access is required.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      setAvatarUri(result.assets[0].uri);
      setAvatarType("photo");
      setSelectedPreset(null);
    }
  }

  function selectPreset(color: string) {
    setSelectedPreset(color);
    setAvatarUri(null);
    setAvatarType("preset");
  }

  function clearAvatar() {
    setAvatarUri(null);
    setAvatarType(null);
    setSelectedPreset(null);
  }

  async function handleDone() {
    if (!user) return;
    setLoading(true);

    try {
      let avatarUrl: string | null = null;

      // Upload photo to Supabase storage if selected
      if (avatarUri && (avatarType === "photo" || avatarType === "camera")) {
        const ext = avatarUri.split(".").pop() ?? "jpg";
        const fileName = `${user.id}/avatar.${ext}`;
        const response = await fetch(avatarUri);
        const blob = await response.blob();
        const arrayBuffer = await new Response(blob).arrayBuffer();

        const { error: uploadError } = await supabase.storage
          .from("avatars")
          .upload(fileName, arrayBuffer, {
            contentType: `image/${ext}`,
            upsert: true,
          });

        if (!uploadError) {
          const { data } = supabase.storage.from("avatars").getPublicUrl(fileName);
          avatarUrl = data.publicUrl;
        }
      } else if (avatarType === "preset" && selectedPreset) {
        avatarUrl = `preset:${selectedPreset}`;
      }

      // Update profile
      await supabase.from("profiles").update({
        avatar_url: avatarUrl,
        avatar_type: avatarType,
        username: pendingUsername || (user.email?.split("@")[0] ?? "user"),
      }).eq("id", user.id);

      // Save interests
      if (selectedInterests.length > 0) {
        const interestRows = selectedInterests.map((interest) => ({
          user_id: user.id,
          interest,
        }));
        await supabase.from("user_interests").upsert(interestRows, { onConflict: "user_id,interest" });
      }

      // Save activities
      if (selectedActivities.length > 0) {
        const activityRows = selectedActivities.map((activity) => ({
          user_id: user.id,
          activity,
        }));
        await supabase.from("user_activities").upsert(activityRows, { onConflict: "user_id,activity" });
      }

      router.replace("/onboarding/matches");
    } catch (err) {
      show("Something went wrong. Please try again.", "error");
    } finally {
      setLoading(false);
    }
  }

  const displayName = pendingUsername || user?.email?.split("@")[0] || "there";

  return (
    <SafeAreaView style={styles.container}>
      {ToastComponent}

      {/* Back arrow */}
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backArrow}>‹</Text>
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <Text style={styles.heading}>One last step</Text>
        <Text style={styles.subheading}>
          Add a profile picture so your friends can recognize your
        </Text>

        {/* Avatar preview circle */}
        <View style={styles.avatarWrap}>
          <View
            style={[
              styles.avatarCircle,
              selectedPreset ? { backgroundColor: selectedPreset, borderStyle: "solid" } : {},
            ]}
          >
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={styles.avatarImage} />
            ) : !selectedPreset ? (
              <View style={{ opacity: 0 }} />
            ) : null}
          </View>
          {(avatarUri || selectedPreset) && (
            <TouchableOpacity style={styles.clearBtn} onPress={clearAvatar}>
              <Text style={styles.clearBtnText}>✕</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Add options */}
        <Text style={styles.addLabel}>You can add:</Text>
        <View style={styles.addRow}>
          <TouchableOpacity style={styles.addOption} onPress={pickFromCamera}>
            <View style={styles.addIcon}>
              <Text style={styles.addIconText}>📷</Text>
            </View>
            <Text style={styles.addOptionLabel}>Camera</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.addOption} onPress={pickFromLibrary}>
            <View style={styles.addIcon}>
              <Text style={styles.addIconText}>🖼️</Text>
            </View>
            <Text style={styles.addOptionLabel}>Photo</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.addOption}
            onPress={() => show("Text avatar coming soon!", "info")}
          >
            <View style={styles.addIcon}>
              <Text style={styles.addIconText}>A+</Text>
            </View>
            <Text style={styles.addOptionLabel}>Text</Text>
          </TouchableOpacity>
        </View>

        {/* Preset avatars */}
        <Text style={styles.presetLabel}>Or choose a We Glue avatar</Text>
        <View style={styles.presets}>
          {PRESET_COLORS.slice(0, 5).map((color) => (
            <TouchableOpacity
              key={color}
              onPress={() => selectPreset(color)}
              style={[
                styles.presetCircle,
                { backgroundColor: color },
                selectedPreset === color && styles.presetSelected,
              ]}
            />
          ))}
        </View>
        <View style={[styles.presets, { marginTop: 12 }]}>
          {PRESET_COLORS.slice(5).map((color) => (
            <TouchableOpacity
              key={color}
              onPress={() => selectPreset(color)}
              style={[
                styles.presetCircle,
                { backgroundColor: color },
                selectedPreset === color && styles.presetSelected,
              ]}
            />
          ))}
        </View>

        {/* Welcome banner */}
        <View style={styles.welcomeBanner}>
          <Text style={styles.welcomeTitle}>Welcome to We Glue, {displayName}!</Text>
          <Text style={styles.welcomeBody}>
            Your clubs are ready. Events are waiting. Your campus is calling.
          </Text>
        </View>

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Done button */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.primaryBtn, loading && { opacity: 0.7 }]}
          onPress={handleDone}
          disabled={loading}
          activeOpacity={0.85}
        >
          {loading ? (
            <ActivityIndicator color="#FEFCF0" />
          ) : (
            <Text style={styles.primaryBtnText}>Done</Text>
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
  scroll: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 40, alignItems: "center" },
  heading: { fontSize: 24, fontWeight: "700", color: "#000", textAlign: "center", marginBottom: 8 },
  subheading: { fontSize: 14, color: "#5F5D5D", textAlign: "center", marginBottom: 24, lineHeight: 20 },
  avatarWrap: { position: "relative", marginBottom: 24 },
  avatarCircle: {
    width: 160,
    height: 160,
    borderRadius: 80,
    borderWidth: 2,
    borderColor: "rgba(0,0,0,0.25)",
    borderStyle: "dashed",
    overflow: "hidden",
  },
  avatarImage: { width: "100%", height: "100%" },
  clearBtn: {
    position: "absolute",
    top: 0,
    right: -4,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
  },
  clearBtnText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  addLabel: { fontSize: 14, fontWeight: "600", color: "#000", marginBottom: 16, textAlign: "center" },
  addRow: { flexDirection: "row", gap: 32, marginBottom: 24 },
  addOption: { alignItems: "center", gap: 6 },
  addIcon: {
    width: 56,
    height: 56,
    borderRadius: 12,
    backgroundColor: "#0FA6A6",
    alignItems: "center",
    justifyContent: "center",
  },
  addIconText: { fontSize: 22 },
  addOptionLabel: { fontSize: 12, color: "#000", fontWeight: "500" },
  presetLabel: { fontSize: 14, fontWeight: "600", color: "#000", marginBottom: 16, textAlign: "center" },
  presets: { flexDirection: "row", gap: 12 },
  presetCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  presetSelected: {
    borderWidth: 3,
    borderColor: "#0FA6A6",
  },
  welcomeBanner: {
    marginTop: 28,
    backgroundColor: "#0FA6A6",
    borderRadius: 12,
    padding: 16,
    width: "100%",
  },
  welcomeTitle: { fontSize: 15, fontWeight: "700", color: "#fff", marginBottom: 4 },
  welcomeBody: { fontSize: 13, color: "#fff", lineHeight: 18 },
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
  primaryBtnText: { color: "#FEFCF0", fontSize: 16, fontWeight: "600" },
});
