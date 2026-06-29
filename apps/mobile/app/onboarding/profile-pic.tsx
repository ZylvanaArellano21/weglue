import { useState } from "react";
import {
  ActivityIndicator,
  Image,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
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
  const { user, profile, setProfile } = useAuthStore();
  const { pendingUsername, selectedInterests, selectedActivities } = useOnboardingStore();
  const { show, ToastComponent } = useToast();

  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [avatarType, setAvatarType] = useState<"photo" | "camera" | "preset" | "text" | null>(null);
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  const [textInput, setTextInput] = useState("");
  const [showTextInput, setShowTextInput] = useState(false);
  const [cameraPermissionDenied, setCameraPermissionDenied] = useState(false);
  const [photoPermissionDenied, setPhotoPermissionDenied] = useState(false);
  const [loading, setLoading] = useState(false);

  async function pickFromCamera() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();

    if (status === "denied") {
      setCameraPermissionDenied(true);
      setPhotoPermissionDenied(false);
      return;
    }
    if (status !== "granted") return;

    setCameraPermissionDenied(false);
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      setAvatarUri(result.assets[0].uri);
      setAvatarType("camera");
      setSelectedPreset(null);
      setTextInput("");
      setShowTextInput(false);
    }
  }

  async function pickFromLibrary() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (status === "denied") {
      setPhotoPermissionDenied(true);
      setCameraPermissionDenied(false);
      return;
    }
    // status "granted" covers both full access and iOS limited access
    // (limited = accessPrivileges: "limited" — picker shows only granted photos)
    if (status !== "granted") return;

    setPhotoPermissionDenied(false);
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
      setTextInput("");
      setShowTextInput(false);
    }
  }

  function selectPreset(color: string) {
    setSelectedPreset(color);
    setAvatarUri(null);
    setAvatarType("preset");
    setTextInput("");
    setShowTextInput(false);
  }

  function activateTextInput() {
    setShowTextInput(true);
    setAvatarType("text");
    setAvatarUri(null);
    setSelectedPreset(null);
  }

  function clearAvatar() {
    setAvatarUri(null);
    setAvatarType(null);
    setSelectedPreset(null);
    setTextInput("");
    setShowTextInput(false);
  }

  async function handleDone() {
    if (!user) return;
    setLoading(true);

    try {
      let avatarUrl: string | null = null;

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
      } else if (avatarType === "text" && textInput.trim()) {
        avatarUrl = `text:${textInput.trim().toUpperCase()}`;
      }

      await supabase
        .from("profiles")
        .update({
          avatar_url: avatarUrl,
          avatar_type: avatarType,
          username: pendingUsername || (user.email?.split("@")[0] ?? "user"),
        })
        .eq("id", user.id);

      if (profile) {
        setProfile({ ...profile, avatar_url: avatarUrl });
      }

      if (selectedInterests.length > 0) {
        const interestRows = selectedInterests.map((interest) => ({
          user_id: user.id,
          interest,
        }));
        await supabase
          .from("user_interests")
          .upsert(interestRows, { onConflict: "user_id,interest" });
      }

      if (selectedActivities.length > 0) {
        const activityRows = selectedActivities.map((activity) => ({
          user_id: user.id,
          activity,
        }));
        await supabase
          .from("user_activities")
          .upsert(activityRows, { onConflict: "user_id,activity" });
      }

      router.replace("/onboarding/matches");
    } catch {
      show("Something went wrong. Please try again.", "error");
    } finally {
      setLoading(false);
    }
  }

  const displayName = pendingUsername || user?.email?.split("@")[0] || "there";

  const showingText = avatarType === "text" && textInput.trim().length > 0;
  const hasSelection = !!(avatarUri || selectedPreset || showingText);

  return (
    <SafeAreaView style={styles.container}>
      {ToastComponent}

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <Text style={styles.heading}>One last step</Text>
        <Text style={styles.subheading}>
          Add a profile picture so your friends can recognize you
        </Text>

        {/* Avatar preview circle */}
        <View style={styles.avatarWrap}>
          <View
            style={[
              styles.avatarCircle,
              selectedPreset
                ? { backgroundColor: selectedPreset, borderStyle: "solid" }
                : showingText
                ? { backgroundColor: "#0FA6A6", borderStyle: "solid" }
                : {},
            ]}
          >
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={styles.avatarImage} />
            ) : showingText ? (
              <View style={styles.textAvatarContent}>
                <Text style={styles.textAvatarPreview}>
                  {textInput.trim().toUpperCase()}
                </Text>
              </View>
            ) : !selectedPreset ? (
              <View style={{ opacity: 0 }} />
            ) : null}
          </View>
          {hasSelection && (
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

          <TouchableOpacity style={styles.addOption} onPress={activateTextInput}>
            <View style={styles.addIcon}>
              <Text style={styles.addIconText}>A+</Text>
            </View>
            <Text style={styles.addOptionLabel}>Text</Text>
          </TouchableOpacity>
        </View>

        {/* Text input — revealed when user taps Text */}
        {showTextInput && (
          <TextInput
            style={styles.textAvatarInput}
            placeholder="ABC"
            placeholderTextColor="rgba(0,0,0,0.3)"
            value={textInput}
            onChangeText={(v) => setTextInput(v.slice(0, 3).toUpperCase())}
            maxLength={3}
            autoFocus
            autoCapitalize="characters"
            returnKeyType="done"
          />
        )}

        {/* Permission denied inline errors */}
        {(cameraPermissionDenied || photoPermissionDenied) && (
          <View style={styles.permissionError}>
            <Text style={styles.permissionErrorText}>
              {cameraPermissionDenied
                ? "Camera access denied."
                : "Photo library access denied."}{" "}
            </Text>
            <TouchableOpacity onPress={() => Linking.openSettings()}>
              <Text style={styles.openSettingsLink}>Open Settings</Text>
            </TouchableOpacity>
          </View>
        )}

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
  scroll: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 40, alignItems: "center" },
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
  textAvatarContent: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  textAvatarPreview: {
    color: "#fff",
    fontSize: 44,
    fontWeight: "700",
    letterSpacing: 2,
  },
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
  addRow: { flexDirection: "row", gap: 32, marginBottom: 16 },
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
  textAvatarInput: {
    width: 120,
    height: 48,
    borderWidth: 1.5,
    borderColor: "#0FA6A6",
    borderRadius: 10,
    textAlign: "center",
    fontSize: 22,
    fontWeight: "700",
    color: "#000",
    letterSpacing: 4,
    backgroundColor: "#fff",
    marginBottom: 16,
  },
  permissionError: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    justifyContent: "center",
    marginBottom: 12,
    paddingHorizontal: 16,
  },
  permissionErrorText: { fontSize: 12, color: "#F02719" },
  openSettingsLink: {
    fontSize: 12,
    color: "#0FA6A6",
    fontWeight: "600",
    textDecorationLine: "underline",
  },
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
