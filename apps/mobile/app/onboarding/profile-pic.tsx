import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  Image,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { supabase } from "../../lib/supabase";
import { useAuthStore, useOnboardingStore, type Profile } from "@weglue/shared";
import { useToast } from "../../components/Toast";

const AVATAR_EMOJIS = ["🦁", "🐼", "🦊", "🐸", "🐺", "🐨", "🐯", "🦄", "🐻", "🐮"];

export default function ProfilePicScreen() {
  const router = useRouter();
  const { user, profile, setProfile } = useAuthStore();
  const { pendingUsername, selectedInterests, selectedActivities } = useOnboardingStore();
  const { show, ToastComponent } = useToast();

  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [avatarType, setAvatarType] = useState<"photo" | "camera" | "preset" | "text" | null>(null);
  const [selectedAvatarEmoji, setSelectedAvatarEmoji] = useState<string | null>(null);
  const [textInput, setTextInput] = useState("");
  const [showTextInput, setShowTextInput] = useState(false);
  const [cameraPermissionDenied, setCameraPermissionDenied] = useState(false);
  const [photoPermissionDenied, setPhotoPermissionDenied] = useState(false);
  const [loading, setLoading] = useState(false);

  // Block Android hardware back — this is a one-way forward step.
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => sub.remove();
  }, []);

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
      setSelectedAvatarEmoji(null);
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
      setSelectedAvatarEmoji(null);
      setTextInput("");
      setShowTextInput(false);
    }
  }

  function selectAvatarEmoji(emoji: string) {
    setSelectedAvatarEmoji(emoji);
    setAvatarUri(null);
    setAvatarType("text");
    setTextInput(emoji);
    setShowTextInput(false);
  }

  function activateTextInput() {
    setShowTextInput(true);
    setAvatarType("text");
    setAvatarUri(null);
    setSelectedAvatarEmoji(null);
    setTextInput("");
  }

  function clearAvatar() {
    setAvatarUri(null);
    setAvatarType(null);
    setSelectedAvatarEmoji(null);
    setTextInput("");
    setShowTextInput(false);
  }

  async function handleDone() {
    // user should always be set by this point, but if a render beat the store
    // update, fall back to a direct Supabase call rather than failing silently.
    let resolvedUser = user;
    if (!resolvedUser) {
      const { data } = await supabase.auth.getUser();
      resolvedUser = data.user;
    }
    if (!resolvedUser) {
      show("Session expired. Please log in again.", "error");
      return;
    }
    setLoading(true);

    try {
      let avatarUrl: string | null = null;

      if (avatarUri && (avatarType === "photo" || avatarType === "camera")) {
        const ext = avatarUri.split(".").pop() ?? "jpg";
        const fileName = `${resolvedUser.id}/avatar.${ext}`;
        const response = await fetch(avatarUri);
        const blob = await response.blob();
        const arrayBuffer = await new Response(blob).arrayBuffer();

        const { error: uploadError } = await supabase.storage
          .from("avatars")
          .upload(fileName, arrayBuffer, {
            contentType: `image/${ext}`,
            upsert: true,
          });

        if (uploadError) {
          show("Could not upload photo. Choose a different one or pick an avatar.", "error");
          return;
        }

        const { data } = supabase.storage.from("avatars").getPublicUrl(fileName);
        avatarUrl = data.publicUrl;
      } else if (avatarType === "text" && textInput.trim()) {
        avatarUrl = `text:${textInput.trim()}`;
      }

      const { error: updateError } = await supabase
        .from("profiles")
        .update({
          avatar_url: avatarUrl,
          avatar_type: avatarType,
          username: pendingUsername || (resolvedUser.email?.split("@")[0] ?? "user"),
        })
        .eq("id", resolvedUser.id);

      if (updateError) {
        show("Could not save your profile. Please try again.", "error");
        return;
      }

      // Re-fetch so the store always reflects what's in the DB regardless of
      // whether profile was null in the store (race with syncProfile on new signup).
      const { data: freshProfile } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", resolvedUser.id)
        .single();
      if (freshProfile) setProfile(freshProfile as Profile);

      if (selectedInterests.length > 0) {
        const interestRows = selectedInterests.map((interest) => ({
          user_id: resolvedUser.id,
          interest,
        }));
        await supabase
          .from("user_interests")
          .upsert(interestRows, { onConflict: "user_id,interest" });
      }

      if (selectedActivities.length > 0) {
        const activityRows = selectedActivities.map((activity) => ({
          user_id: resolvedUser.id,
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
  const hasSelection = !!(avatarUri || showingText);

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
              showingText ? { backgroundColor: "#0FA6A6", borderStyle: "solid", borderColor: "#0FA6A6" } : {},
            ]}
          >
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={styles.avatarImage} />
            ) : showingText ? (
              <View style={styles.textAvatarContent}>
                <Text style={styles.textAvatarPreview}>{textInput.trim()}</Text>
              </View>
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
              <Ionicons name="camera-outline" size={24} color="#fff" />
            </View>
            <Text style={styles.addOptionLabel}>Camera</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.addOption} onPress={pickFromLibrary}>
            <View style={styles.addIcon}>
              <Ionicons name="image-outline" size={24} color="#fff" />
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
            placeholder="e.g. ZA"
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

        {/* We Glue avatar grid */}
        <Text style={styles.presetLabel}>Or choose a We Glue avatar</Text>
        <View style={styles.avatarGrid}>
          <View style={styles.avatarRow}>
            {AVATAR_EMOJIS.slice(0, 5).map((emoji) => (
              <TouchableOpacity
                key={emoji}
                onPress={() => selectAvatarEmoji(emoji)}
                style={[
                  styles.avatarGridCircle,
                  selectedAvatarEmoji === emoji && styles.avatarGridSelected,
                ]}
              >
                <Text style={styles.avatarGridEmoji}>{emoji}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={[styles.avatarRow, { marginTop: 12 }]}>
            {AVATAR_EMOJIS.slice(5).map((emoji) => (
              <TouchableOpacity
                key={emoji}
                onPress={() => selectAvatarEmoji(emoji)}
                style={[
                  styles.avatarGridCircle,
                  selectedAvatarEmoji === emoji && styles.avatarGridSelected,
                ]}
              >
                <Text style={styles.avatarGridEmoji}>{emoji}</Text>
              </TouchableOpacity>
            ))}
          </View>
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
          style={[styles.primaryBtn, (!hasSelection || loading) && { opacity: 0.45 }]}
          onPress={handleDone}
          disabled={!hasSelection || loading}
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
  scroll: { paddingHorizontal: 24, paddingTop: 48, paddingBottom: 40, alignItems: "center" },
  heading: { fontSize: 24, fontWeight: "700", color: "#111827", textAlign: "center", marginBottom: 6 },
  subheading: { fontSize: 14, color: "#6B7280", textAlign: "center", marginBottom: 32, lineHeight: 20 },
  avatarWrap: { position: "relative", marginBottom: 24 },
  avatarCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 2,
    borderColor: "#D1D5DB",
    borderStyle: "dashed",
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarImage: { width: "100%", height: "100%" },
  textAvatarContent: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  textAvatarPreview: {
    color: "#fff",
    fontSize: 42,
    fontWeight: "700",
  },
  clearBtn: {
    position: "absolute",
    top: -2,
    right: -8,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#9CA3AF",
    alignItems: "center",
    justifyContent: "center",
  },
  clearBtnText: { color: "#fff", fontSize: 10, fontWeight: "700" },
  addLabel: { fontSize: 14, fontWeight: "500", color: "#4B5563", marginBottom: 12, textAlign: "center" },
  addRow: { flexDirection: "row", gap: 24, marginBottom: 16 },
  addOption: { alignItems: "center", gap: 6 },
  addIcon: {
    width: 52,
    height: 52,
    borderRadius: 12,
    backgroundColor: "#0FA6A6",
    alignItems: "center",
    justifyContent: "center",
  },
  addIconText: { fontSize: 18, fontWeight: "700", color: "#fff" },
  addOptionLabel: { fontSize: 12, color: "#4B5563", fontWeight: "500" },
  textAvatarInput: {
    width: 120,
    height: 48,
    borderWidth: 1.5,
    borderColor: "#0FA6A6",
    borderRadius: 10,
    textAlign: "center",
    fontSize: 20,
    fontWeight: "700",
    color: "#000",
    letterSpacing: 4,
    backgroundColor: "#fff",
    marginBottom: 16,
  },
  permissionError: {
    flexDirection: "column",
    alignItems: "center",
    marginBottom: 12,
    paddingHorizontal: 16,
  },
  permissionErrorText: { fontSize: 12, color: "#F02719", textAlign: "center" },
  openSettingsLink: {
    fontSize: 12,
    color: "#0FA6A6",
    fontWeight: "600",
    marginTop: 4,
  },
  presetLabel: { fontSize: 14, fontWeight: "500", color: "#374151", marginBottom: 12, textAlign: "center", marginTop: 24 },
  avatarGrid: { alignItems: "center" },
  avatarRow: { flexDirection: "row", gap: 10 },
  avatarGridCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "#EEF9F9",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarGridSelected: {
    borderWidth: 2,
    borderColor: "#0FA6A6",
  },
  avatarGridEmoji: { fontSize: 28 },
  welcomeBanner: {
    marginTop: 24,
    marginHorizontal: 4,
    backgroundColor: "#EEF9F9",
    borderRadius: 12,
    padding: 16,
    width: "100%",
  },
  welcomeTitle: { fontSize: 14, fontWeight: "700", color: "#1F2937", marginBottom: 4 },
  welcomeBody: { fontSize: 12, color: "#4B5563", lineHeight: 18 },
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
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  primaryBtnText: { color: "#FEFCF0", fontSize: 16, fontWeight: "600" },
});
