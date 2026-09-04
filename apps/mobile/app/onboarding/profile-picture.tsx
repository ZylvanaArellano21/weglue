import { useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
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
import { Ionicons } from "@expo/vector-icons";
import { pickImageForFeature } from "../../lib/media/pickMedia";
import { uploadImageToBucket } from "../../lib/imageUpload";
import {
  useOnboardingStore,
  generatePendingAvatarToken,
  PRESET_AVATARS,
  presetAvatarValue,
  type PresetAvatarId,
} from "@weglue/shared";
import { Avatar } from "../../components/shared/Avatar";
import { useToast } from "../../components/Toast";

const TEXT_MAX = 4;

export default function OnboardingProfilePictureScreen() {
  const router = useRouter();
  const { avatarChoice, setAvatarChoice } = useOnboardingStore();
  const { show, ToastComponent } = useToast();

  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [pendingUriType, setPendingUriType] = useState<"photo" | "camera" | null>(null);
  const [previewPreset, setPreviewPreset] = useState<PresetAvatarId | null>(
    avatarChoice?.kind === "preset" ? (avatarChoice.id as PresetAvatarId) : null
  );
  const [textInput, setTextInput] = useState(avatarChoice?.kind === "text" ? avatarChoice.value : "");
  const [showTextInput, setShowTextInput] = useState(avatarChoice?.kind === "text");
  const [cameraDenied, setCameraDenied] = useState(false);
  const [photoDenied, setPhotoDenied] = useState(false);
  const [uploading, setUploading] = useState(false);
  const saveInFlight = useRef(false);

  const hasSelection = !!previewUri || !!previewPreset || (showTextInput && !!textInput.trim());

  const applyPickedAvatar = (uri: string, source: "photo" | "camera") => {
    setPreviewUri(uri);
    setPendingUriType(source);
    setPreviewPreset(null);
    setTextInput("");
    setShowTextInput(false);
  };

  const onPickFromLibrary = async () => {
    setPhotoDenied(false);
    const picked = await pickImageForFeature({
      source: "library",
      aspect: [1, 1],
      quality: 0.8,
      onDenied: () => {
        setPhotoDenied(true);
        setCameraDenied(false);
      },
    });
    if (picked?.uri) applyPickedAvatar(picked.uri, "photo");
  };

  const onPickFromCamera = async () => {
    setCameraDenied(false);
    const picked = await pickImageForFeature({
      source: "camera",
      aspect: [1, 1],
      quality: 0.8,
      onDenied: () => {
        setCameraDenied(true);
        setPhotoDenied(false);
      },
    });
    if (picked?.uri) applyPickedAvatar(picked.uri, "camera");
  };

  const onSelectPreset = (id: PresetAvatarId) => {
    setPreviewPreset(id);
    setPreviewUri(null);
    setPendingUriType(null);
    setTextInput("");
    setShowTextInput(false);
  };

  const activateTextInput = () => {
    setShowTextInput(true);
    setPreviewUri(null);
    setPendingUriType(null);
    setPreviewPreset(null);
    setTextInput("");
  };

  const onDone = async () => {
    if (!hasSelection || uploading || saveInFlight.current) return;
    saveInFlight.current = true;
    setUploading(true);
    try {
      if (previewUri && pendingUriType) {
        const token = generatePendingAvatarToken();
        await uploadImageToBucket("pending-avatars", `${token}.jpg`, previewUri, 800);
        setAvatarChoice({ kind: pendingUriType, token });
      } else if (previewPreset) {
        setAvatarChoice({ kind: "preset", id: previewPreset });
      } else if (showTextInput && textInput.trim()) {
        setAvatarChoice({ kind: "text", value: textInput.trim().slice(0, TEXT_MAX).toUpperCase() });
      }
      router.push("/onboarding/signup");
    } catch {
      show("Could not save your picture. Please try again.", "error");
    } finally {
      setUploading(false);
      saveInFlight.current = false;
    }
  };

  const displayAvatarValue = previewPreset
    ? presetAvatarValue(previewPreset)
    : showTextInput && textInput
      ? `text:${textInput}`
      : null;

  return (
    <SafeAreaView style={styles.container}>
      {ToastComponent}
      {/* Back arrow — lands on Activities via the onboarding stack */}
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backArrow}>‹</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.heading}>Add a profile picture</Text>
        <Text style={styles.subheading}>
          Choose a photo, your initials, or a We Glue avatar so people recognize you.
        </Text>

        <View style={styles.avatarWrap}>
          <View style={[styles.avatarCircle, displayAvatarValue && styles.avatarCircleFilled]}>
            {previewUri ? (
              <Image source={{ uri: previewUri }} style={styles.avatarImage} />
            ) : displayAvatarValue ? (
              <Avatar uri={displayAvatarValue} size={120} />
            ) : null}
          </View>
        </View>

        <Text style={styles.addLabel}>You can add:</Text>
        <View style={styles.addRow}>
          <TouchableOpacity style={styles.addOption} onPress={onPickFromCamera} activeOpacity={0.8}>
            <View style={styles.addIcon}>
              <Ionicons name="camera-outline" size={24} color="#fff" />
            </View>
            <Text style={styles.addOptionLabel}>Camera</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.addOption} onPress={onPickFromLibrary} activeOpacity={0.8}>
            <View style={styles.addIcon}>
              <Ionicons name="image-outline" size={24} color="#fff" />
            </View>
            <Text style={styles.addOptionLabel}>Photo</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.addOption} onPress={activateTextInput} activeOpacity={0.8}>
            <View style={styles.addIcon}>
              <Text style={styles.addIconText}>A+</Text>
            </View>
            <Text style={styles.addOptionLabel}>Text</Text>
          </TouchableOpacity>
        </View>

        {showTextInput && (
          <TextInput
            style={styles.textInput}
            placeholder="e.g. ZA"
            placeholderTextColor="rgba(0,0,0,0.3)"
            value={textInput}
            onChangeText={(v) => setTextInput(v.slice(0, TEXT_MAX).toUpperCase())}
            maxLength={TEXT_MAX}
            autoFocus
            autoCapitalize="characters"
          />
        )}

        {(cameraDenied || photoDenied) && (
          <View style={styles.permissionError}>
            <Text style={styles.permissionErrorText}>
              {cameraDenied ? "Camera access denied." : "Photo library access denied."}
            </Text>
            <TouchableOpacity onPress={() => Linking.openSettings()}>
              <Text style={styles.openSettings}>Open Settings</Text>
            </TouchableOpacity>
          </View>
        )}

        <Text style={styles.presetLabel}>
          Or choose a <Text style={styles.presetLabelStrong}>We Glue</Text> avatar
        </Text>
        <FlatList
          data={PRESET_AVATARS}
          keyExtractor={(avatar) => avatar.id}
          numColumns={4}
          style={styles.presetList}
          contentContainerStyle={styles.presetListContent}
          columnWrapperStyle={styles.presetRow}
          scrollEnabled={false}
          renderItem={({ item }) => {
            const selected = previewPreset === item.id;
            return (
              <TouchableOpacity
                onPress={() => onSelectPreset(item.id)}
                accessibilityRole="button"
                accessibilityLabel={`Select ${item.label}`}
                accessibilityState={{ selected }}
                style={[styles.presetOption, selected && styles.presetOptionSelected]}
                activeOpacity={0.8}
              >
                <Avatar uri={presetAvatarValue(item.id)} size={52} />
                {selected && (
                  <View pointerEvents="none" style={styles.presetCheck}>
                    <Ionicons name="checkmark" size={14} color="#FEFCF0" />
                  </View>
                )}
              </TouchableOpacity>
            );
          }}
        />

        <View style={{ height: 120 }} />
      </ScrollView>

      {/* Fixed Done button — mandatory, disabled until a selection is made */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.primaryBtn, (!hasSelection || uploading) && styles.primaryBtnDisabled]}
          onPress={onDone}
          disabled={!hasSelection || uploading}
          activeOpacity={0.85}
        >
          {uploading ? (
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
  scroll: { paddingHorizontal: 24, paddingTop: 8, alignItems: "center", width: "100%", maxWidth: 700, alignSelf: "center" },
  heading: { fontSize: 28, fontWeight: "700", color: "#000", marginBottom: 8, lineHeight: 34, textAlign: "center" },
  subheading: { fontSize: 14, color: "#5F5D5D", marginBottom: 24, lineHeight: 20, textAlign: "center" },
  avatarWrap: { marginBottom: 24 },
  avatarCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 2,
    borderColor: "rgba(0,0,0,0.2)",
    borderStyle: "dashed",
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarCircleFilled: { borderStyle: "solid", borderColor: "#0FA6A6" },
  avatarImage: { width: "100%", height: "100%" },
  addLabel: { fontSize: 14, fontWeight: "500", color: "#5F5D5D", marginBottom: 12 },
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
  addOptionLabel: { fontSize: 12, fontWeight: "500", color: "#5F5D5D" },
  textInput: {
    width: 140,
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
    marginBottom: 12,
  },
  permissionError: { alignItems: "center", marginBottom: 12 },
  permissionErrorText: { fontSize: 12, color: "#F02719" },
  openSettings: { fontSize: 12, fontWeight: "600", color: "#0FA6A6", marginTop: 4 },
  presetLabel: { fontSize: 14, fontWeight: "500", color: "#000", marginTop: 16, marginBottom: 14 },
  presetLabelStrong: { fontWeight: "700", fontStyle: "italic" },
  presetList: {
    width: 276,
    maxWidth: "100%",
    marginBottom: 16,
    flexGrow: 0,
    borderRadius: 12,
    backgroundColor: "rgba(15,166,166,0.04)",
  },
  presetListContent: { paddingVertical: 6, paddingHorizontal: 8 },
  presetRow: { justifyContent: "space-between", marginBottom: 12 },
  presetOption: {
    position: "relative",
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 2,
    borderColor: "transparent",
  },
  presetOptionSelected: {
    borderColor: "#0FA6A6",
    shadowColor: "#0FA6A6",
    shadowOpacity: 0.32,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  presetCheck: {
    position: "absolute",
    right: -3,
    bottom: -3,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#0FA6A6",
    borderWidth: 2,
    borderColor: "#FEFCF0",
    alignItems: "center",
    justifyContent: "center",
  },
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
    width: "100%",
    maxWidth: 700,
    alignSelf: "center",
  },
  primaryBtnDisabled: { backgroundColor: "#CCCCCC", shadowOpacity: 0, elevation: 0 },
  primaryBtnText: { color: "#FEFCF0", fontSize: 16, fontWeight: "600" },
});
