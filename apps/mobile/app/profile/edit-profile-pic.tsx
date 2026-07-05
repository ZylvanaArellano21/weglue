import { useState } from 'react';
import {
  View,
  Text,
  Image,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Linking,
  StyleSheet,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useAuthStore } from '@weglue/shared';
import { useOwnProfile, useUpdateProfileAvatar } from '../../hooks/useOwnProfile';
import { uploadImageToBucket } from '../../lib/imageUpload';
import { ProfileScreenHeader } from '../../components/profile/ProfileScreenHeader';
import { parsePresetColor, parseTextAvatar } from '../../components/shared/Avatar';
import { profileColors, profileFonts, profileShadow } from '../../components/profile/profileTheme';

const PRESET_COLORS = ['#0FA6A6', '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7'];
const TEXT_MAX = 4;

export default function EditProfilePicScreen() {
  const { session } = useAuthStore();
  const userId = session?.user.id;
  const router = useRouter();

  const { data: profile } = useOwnProfile(userId);
  const updateAvatar = useUpdateProfileAvatar(userId);

  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [previewPreset, setPreviewPreset] = useState<string | null>(null);
  const [textInput, setTextInput] = useState('');
  const [showTextInput, setShowTextInput] = useState(false);
  const [cameraDenied, setCameraDenied] = useState(false);
  const [photoDenied, setPhotoDenied] = useState(false);

  const existingPreset = parsePresetColor(profile?.avatar_url);
  const existingText = parseTextAvatar(profile?.avatar_url);

  async function uploadAndSave(uri: string, type: 'photo' | 'camera') {
    if (!userId) return;
    const publicUrl = await uploadImageToBucket('avatars', `${userId}/avatar.jpg`, uri, 800);
    await updateAvatar.mutateAsync({ avatarUrl: publicUrl, avatarType: type });
    router.back();
  }

  const onPickFromLibrary = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status === 'denied') {
      setPhotoDenied(true);
      setCameraDenied(false);
      return;
    }
    if (status !== 'granted') return;
    setPhotoDenied(false);

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      setPreviewUri(result.assets[0].uri);
      setPreviewPreset(null);
      setTextInput('');
      setShowTextInput(false);
      try {
        await uploadAndSave(result.assets[0].uri, 'photo');
      } catch {
        Alert.alert('Upload failed', 'Could not upload your photo. Please try again.');
      }
    }
  };

  const onPickFromCamera = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status === 'denied') {
      setCameraDenied(true);
      setPhotoDenied(false);
      return;
    }
    if (status !== 'granted') return;
    setCameraDenied(false);

    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      setPreviewUri(result.assets[0].uri);
      setPreviewPreset(null);
      setTextInput('');
      setShowTextInput(false);
      try {
        await uploadAndSave(result.assets[0].uri, 'camera');
      } catch {
        Alert.alert('Upload failed', 'Could not upload your photo. Please try again.');
      }
    }
  };

  const onSelectPreset = async (colorHex: string) => {
    setPreviewPreset(colorHex);
    setPreviewUri(null);
    setTextInput('');
    setShowTextInput(false);
    await updateAvatar.mutateAsync({
      avatarUrl: `preset:${colorHex}`,
      avatarType: 'text',
    });
    router.back();
  };

  const activateTextInput = () => {
    setShowTextInput(true);
    setPreviewUri(null);
    setPreviewPreset(null);
    setTextInput('');
  };

  const onSaveText = async () => {
    const trimmed = textInput.trim();
    if (!trimmed) return;
    await updateAvatar.mutateAsync({
      avatarUrl: `text:${trimmed}`,
      avatarType: 'text',
    });
    router.back();
  };

  const displayPreset = previewPreset ?? existingPreset;
  const displayText = showTextInput || textInput ? textInput : existingText;
  const displayUri = previewUri ?? (
    profile?.avatar_url && !displayPreset && !displayText ? profile.avatar_url : null
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ProfileScreenHeader title="Profile Picture" onBack={() => router.back()} />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.heading}>Update your photo</Text>
        <Text style={styles.subheading}>
          Choose a photo, initials, or a preset color for your avatar.
        </Text>

        <View style={styles.avatarWrap}>
          <View
            style={[
              styles.avatarCircle,
              (displayText || displayPreset) && {
                backgroundColor: displayPreset ?? profileColors.teal,
                borderStyle: 'solid',
                borderColor: displayPreset ?? profileColors.teal,
              },
            ]}
          >
            {displayUri ? (
              <Image source={{ uri: displayUri }} style={styles.avatarImage} />
            ) : displayText ? (
              <Text style={styles.textPreview}>{displayText}</Text>
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
          <>
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
            <TouchableOpacity
              style={[styles.textSaveBtn, !textInput.trim() && { opacity: 0.45 }]}
              onPress={onSaveText}
              disabled={!textInput.trim() || updateAvatar.isPending}
            >
              {updateAvatar.isPending ? (
                <ActivityIndicator color={profileColors.bg} />
              ) : (
                <Text style={styles.textSaveBtnLabel}>Save initials</Text>
              )}
            </TouchableOpacity>
          </>
        )}

        {(cameraDenied || photoDenied) && (
          <View style={styles.permissionError}>
            <Text style={styles.permissionErrorText}>
              {cameraDenied ? 'Camera access denied.' : 'Photo library access denied.'}
            </Text>
            <TouchableOpacity onPress={() => Linking.openSettings()}>
              <Text style={styles.openSettings}>Open Settings</Text>
            </TouchableOpacity>
          </View>
        )}

        <Text style={styles.presetLabel}>Or choose a preset color</Text>
        <View style={styles.presetGrid}>
          {PRESET_COLORS.map((color) => (
            <TouchableOpacity
              key={color}
              onPress={() => onSelectPreset(color)}
              style={[styles.presetSwatch, { backgroundColor: color }]}
              activeOpacity={0.8}
            />
          ))}
        </View>

        {updateAvatar.isPending && (
          <View style={styles.savingRow}>
            <ActivityIndicator color={profileColors.teal} />
            <Text style={styles.savingText}>Saving…</Text>
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: profileColors.bg },
  scroll: { paddingHorizontal: 24, paddingTop: 8, alignItems: 'center' },
  heading: {
    fontFamily: profileFonts.displayBold,
    fontSize: 22,
    color: profileColors.textDark,
    textAlign: 'center',
    marginBottom: 6,
  },
  subheading: {
    fontFamily: profileFonts.regular,
    fontSize: 14,
    color: profileColors.textMuted,
    textAlign: 'center',
    marginBottom: 28,
    lineHeight: 20,
  },
  avatarWrap: { marginBottom: 24 },
  avatarCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 2,
    borderColor: profileColors.border,
    borderStyle: 'dashed',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImage: { width: '100%', height: '100%' },
  textPreview: {
    color: profileColors.white,
    fontSize: 36,
    fontFamily: profileFonts.bold,
  },
  addLabel: {
    fontFamily: profileFonts.medium,
    fontSize: 14,
    color: profileColors.textMuted,
    marginBottom: 12,
  },
  addRow: { flexDirection: 'row', gap: 24, marginBottom: 16 },
  addOption: { alignItems: 'center', gap: 6 },
  addIcon: {
    width: 52,
    height: 52,
    borderRadius: 12,
    backgroundColor: profileColors.teal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addIconText: {
    fontSize: 18,
    fontFamily: profileFonts.bold,
    color: profileColors.white,
  },
  addOptionLabel: {
    fontFamily: profileFonts.medium,
    fontSize: 12,
    color: profileColors.textMuted,
  },
  textInput: {
    width: 140,
    height: 48,
    borderWidth: 1.5,
    borderColor: profileColors.teal,
    borderRadius: 10,
    textAlign: 'center',
    fontSize: 20,
    fontFamily: profileFonts.bold,
    color: profileColors.text,
    letterSpacing: 4,
    backgroundColor: profileColors.white,
    marginBottom: 12,
  },
  textSaveBtn: {
    height: 44,
    paddingHorizontal: 24,
    backgroundColor: profileColors.teal,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    ...profileShadow,
  },
  textSaveBtnLabel: {
    fontFamily: profileFonts.semiBold,
    fontSize: 14,
    color: profileColors.bg,
  },
  permissionError: { alignItems: 'center', marginBottom: 12 },
  permissionErrorText: {
    fontFamily: profileFonts.regular,
    fontSize: 12,
    color: profileColors.alertRed,
  },
  openSettings: {
    fontFamily: profileFonts.semiBold,
    fontSize: 12,
    color: profileColors.teal,
    marginTop: 4,
  },
  presetLabel: {
    fontFamily: profileFonts.medium,
    fontSize: 14,
    color: profileColors.textDark,
    marginTop: 16,
    marginBottom: 14,
  },
  presetGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
    justifyContent: 'center',
    maxWidth: 280,
  },
  presetSwatch: {
    width: 52,
    height: 52,
    borderRadius: 26,
  },
  savingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 16,
  },
  savingText: {
    fontFamily: profileFonts.regular,
    fontSize: 13,
    color: profileColors.textMuted,
  },
});
