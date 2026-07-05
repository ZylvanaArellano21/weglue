import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { supabase } from "../../lib/supabase";
import { uploadImageToBucket } from "../../lib/imageUpload";
import { useAuthStore } from "@weglue/shared";

const PRESET_COLORS = [
  { id: "teal", color: "#0FA6A6", label: "Teal" },
  { id: "purple", color: "#8B5CF6", label: "Purple" },
  { id: "red", color: "#EF4444", label: "Red" },
  { id: "blue", color: "#3B82F6", label: "Blue" },
  { id: "orange", color: "#F97316", label: "Orange" },
  { id: "green", color: "#22C55E", label: "Green" },
  { id: "yellow", color: "#EAB308", label: "Yellow" },
  { id: "pink", color: "#EC4899", label: "Pink" },
];

export default function AvatarScreen() {
  const router = useRouter();
  const { user, profile, setProfile } = useAuthStore();
  const [selectedUri, setSelectedUri] = useState<string | null>(null);
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function openCamera() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Permission needed", "Camera access is required.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled) {
      setSelectedUri(result.assets[0].uri);
      setSelectedPreset(null);
    }
  }

  async function openLibrary() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Permission needed", "Photo library access is required.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled) {
      setSelectedUri(result.assets[0].uri);
      setSelectedPreset(null);
    }
  }

  async function handleDone() {
    if (!user) return;
    setLoading(true);

    let avatarUrl: string | null = null;

    if (selectedUri) {
      try {
        avatarUrl = await uploadImageToBucket("avatars", `${user.id}/avatar.jpg`, selectedUri, 800);
      } catch {
        Alert.alert("Upload failed", "Could not upload your photo. Please try again.");
        setLoading(false);
        return;
      }
    } else if (selectedPreset) {
      avatarUrl = `preset:${selectedPreset}`;
    }

    if (avatarUrl) {
      const { data } = await supabase
        .from("profiles")
        .update({ avatar_url: avatarUrl })
        .eq("id", user.id)
        .select()
        .single();
      if (data) setProfile(data);
    }

    setLoading(false);
    router.push("/auth/survey");
  }

  const username = profile?.username ?? user?.user_metadata?.username ?? "you";

  return (
    <SafeAreaView className="flex-1 bg-cream">
      <ScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
      >
        <View className="px-8 pt-8 pb-10">
          {/* Title */}
          <Text
            className="text-2xl text-gray-900 mb-8 text-center"
            style={{ fontFamily: "Zain_700Bold" }}
          >
            @{username}, personalize{"\n"}your picture
          </Text>

          {/* Upload area */}
          <TouchableOpacity
            onPress={openLibrary}
            className="self-center w-36 h-36 rounded-full border-2 border-dashed border-teal items-center justify-center mb-8 bg-white"
          >
            {selectedUri ? (
              <Image
                source={{ uri: selectedUri }}
                className="w-full h-full rounded-full"
              />
            ) : selectedPreset ? (
              <View
                className="w-full h-full rounded-full items-center justify-center"
                style={{
                  backgroundColor: PRESET_COLORS.find(
                    (c) => c.id === selectedPreset
                  )?.color,
                }}
              >
                <Text className="text-white text-4xl font-bold">
                  {username[0]?.toUpperCase()}
                </Text>
              </View>
            ) : (
              <Text className="text-teal text-5xl">+</Text>
            )}
          </TouchableOpacity>

          {/* Action buttons */}
          <Text
            className="text-base text-gray-700 mb-4 font-medium"
            style={{ fontFamily: "Zain_700Bold" }}
          >
            You can add:
          </Text>
          <View className="flex-row gap-4 mb-8">
            <TouchableOpacity
              onPress={openCamera}
              className="flex-1 bg-white border border-gray-200 rounded-2xl py-4 items-center gap-1"
            >
              <Text className="text-2xl">📷</Text>
              <Text className="text-xs text-gray-600">Camera</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={openLibrary}
              className="flex-1 bg-white border border-gray-200 rounded-2xl py-4 items-center gap-1"
            >
              <Text className="text-2xl">🖼️</Text>
              <Text className="text-xs text-gray-600">Photo</Text>
            </TouchableOpacity>
            <TouchableOpacity className="flex-1 bg-white border border-gray-200 rounded-2xl py-4 items-center gap-1">
              <Text className="text-2xl">✏️</Text>
              <Text className="text-xs text-gray-600">Text</Text>
            </TouchableOpacity>
          </View>

          {/* Preset avatars */}
          <Text
            className="text-base text-gray-700 mb-4 font-medium"
            style={{ fontFamily: "Zain_700Bold" }}
          >
            Or choose a We Glue avatar:
          </Text>
          <View className="flex-row flex-wrap gap-3 mb-10">
            {PRESET_COLORS.map((preset) => (
              <TouchableOpacity
                key={preset.id}
                onPress={() => {
                  setSelectedPreset(preset.id);
                  setSelectedUri(null);
                }}
                className="relative"
              >
                <View
                  className="w-16 h-16 rounded-full items-center justify-center"
                  style={{ backgroundColor: preset.color }}
                >
                  <Text className="text-white text-xl font-bold">
                    {username[0]?.toUpperCase()}
                  </Text>
                </View>
                {selectedPreset === preset.id && (
                  <View className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-teal items-center justify-center">
                    <Text className="text-white text-xs">✓</Text>
                  </View>
                )}
              </TouchableOpacity>
            ))}
          </View>

          {/* Done button */}
          <TouchableOpacity
            onPress={handleDone}
            disabled={loading}
            className="bg-teal rounded-full py-4 items-center"
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text
                className="text-white text-lg"
                style={{ fontFamily: "Zain_700Bold" }}
              >
                Done
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
