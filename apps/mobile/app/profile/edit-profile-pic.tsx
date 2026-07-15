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
import { pickMedia, useWeGlueMediaFlow } from '../../lib/media/pickMedia';
import { useAuthStore } from '@weglue/shared';
import { useOwnProfile, useUpdateProfileAvatar } from '../../hooks/useOwnProfile';
import { uploadImageToBucket } from '../../lib/imageUpload';
import { ProfileScreenHeader } from '../../components/profile/ProfileScreenHeader';
import { parsePresetColor, parseTextAvatar } from '../../components/shared/Avatar';
import { profileColors, profileFonts, profileShadow } from '../../components/profile/profileTheme';
import { useToast } from '../../components/Toast';

const PRESET_COLORS = ['#0FA6A6', '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7'];
const TEXT_MAX = 4;

export default function EditProfilePicScreen() {
  const { session } = useAuthStore();
  const userId = session?.user.id;
  const router = useRouter();

  const { data: profile } = useOwnProfile(userId);
  const updateAvatar = useUpdateProfileAvatar(userId);
  const { show, ToastComponent } = useToast();

  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [pendingUriType, setPendingUriType] = useState<'photo' | 'camera' | null>(null);
  const [previewPreset, setPreviewPreset] = useState<string | null>(null);
  const [textInput, setTextInput] = useState('');
  const [showTextInput, setShowTextInput] = useState(false);
  const [cameraDenied, setCameraDenied] = useState(false);
  const [photoDenied, setPhotoDenied] = useState(false);
  const [saved, setSaved] = useState(false);

  const existingPreset = parsePresetColor(profile?.avatar_url);
  const existingText = parseTextAvatar(profile?.avatar_url);

  const hasUnsavedSelection =
    !!previewUri || !!previewPreset || (showTextInput && !!textInput.trim());
  const hasPendingChange = hasUnsavedSelection && !saved;

  // Android routes through the shared We Glue flow (custom camera + confirm
  // preview); iOS keeps its existing expo-image-picker path unchanged.
  const applyPickedAvatar = (uri: string, source: 'photo' | 'camera') => {
    setPreviewUri(uri);
    setPendingUriType(source);
    setPreviewPreset(null);
    setTextInput('');
    setShowTextInput(false);
    setSaved(false);
  };

  const onPickFromLibrary = async () => {
    if (useWeGlueMediaFlow) {
      setPhotoDenied(false);
      const picked = await pickMedia({ source: 'library', aspect: [1, 1], allowsEditing: true, quality: 0.8 });
      if (picked) applyPickedAvatar(picked.uri, 'photo');
      return;
    }
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
      setPendingUriType('photo');
      setPreviewPreset(null);
      setTextInput('');
      setShowTextInput(false);
      setSaved(false);
    }
  };

  const onPickFromCamera = async () => {
    if (useWeGlueMediaFlow) {
      setCameraDenied(false);
      const picked = await pickMedia({ source: 'camera', aspect: [1, 1], quality: 0.8 });
      if (picked) applyPickedAvatar(picked.uri, 'camera');
      return;
    }
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
      setPendingUriType('camera');
      setPreviewPreset(null);
      setTextInput('');
      setShowTextInput(false);
      setSaved(false);
    }
  };

  const onSelectPreset = (colorHex: string) => {
    setPreviewPreset(colorHex);
    setPreviewUri(null);
    setPendingUriType(null);
    setTextInput('');
    setShowTextInput(false);
    setSaved(false);
  };

  const activateTextInput = () => {
    setShowTextInput(true);
    setPreviewUri(null);
    setPendingUriType(null);
    setPreviewPreset(null);
    setTextInput('');
    setSaved(false);
  };

  const onSave = async () => {
    if (!userId || !hasPendingChange) return;
    try {
      if (previewUri && pendingUriType) {
        const publicUrl = await uploadImageToBucket('avatars', `${userId}/avatar.jpg`, previewUri, 800);
        await updateAvatar.mutateAsync({ avatarUrl: publicUrl, avatarType: pendingUriType });
      } else if (previewPreset) {
        await updateAvatar.mutateAsync({ avatarUrl: `preset:${previewPreset}`, avatarType: 'text' });
      } else if (showTextInput && textInput.trim()) {
        await updateAvatar.mutateAsync({ avatarUrl: `text:${textInput.trim()}`, avatarType: 'text' });
      }
      setSaved(true);
      show('Profile picture updated!', 'success');
    } catch {
      Alert.alert('Save failed', 'Could not save your profile picture. Please try again.');
    }
  };

  const displayPreset = previewPreset ?? existingPreset;
  const displayText = showTextInput || textInput ? textInput : existingText;
  const displayUri = previewUri ?? (
    profile?.avatar_url && !displayPreset && !displayText ? profile.avatar_url : null
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {ToastComponent}
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
          <TextInput
            style={styles.textInput}
            placeholder="e.g. ZA"
            placeholderTextColor="rgba(0,0,0,0.3)"
            value={textInput}
            onChangeText={(v) => {
              setTextInput(v.slice(0, TEXT_MAX).toUpperCase());
              setSaved(false);
            }}
            maxLength={TEXT_MAX}
            autoFocus
            autoCapitalize="characters"
          />
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

        {hasPendingChange && (
          <TouchableOpacity
            style={[styles.textSaveBtn, updateAvatar.isPending && { opacity: 0.7 }]}
            onPress={onSave}
            disabled={updateAvatar.isPending}
            activeOpacity={0.85}
          >
            {updateAvatar.isPending ? (
              <ActivityIndicator color={profileColors.bg} />
            ) : (
              <Text style={styles.textSaveBtnLabel}>Save</Text>
            )}
          </TouchableOpacity>
        )}

        {saved && !hasPendingChange && (
          <View style={styles.savingRow}>
            <Ionicons name="checkmark-circle" size={16} color={profileColors.teal} />
            <Text style={styles.savingText}>Saved</Text>
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
