import { useRef, useState } from 'react';
import {
  View,
  Text,
  Image,
  TextInput,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Linking,
  StyleSheet,
  Alert,
  useWindowDimensions,
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
import { Avatar, parsePresetColor, parseTextAvatar } from '../../components/shared/Avatar';
import { profileColors, profileFonts, profileShadow } from '../../components/profile/profileTheme';
import { useToast } from '../../components/Toast';
import {
  PRESET_AVATARS,
  parsePresetAvatarId,
  presetAvatarValue,
  type PresetAvatarId,
} from '@weglue/shared';

const TEXT_MAX = 4;

export default function EditProfilePicScreen() {
  const { session } = useAuthStore();
  const userId = session?.user.id;
  const router = useRouter();
  const { height: windowHeight } = useWindowDimensions();

  const { data: profile } = useOwnProfile(userId);
  const updateAvatar = useUpdateProfileAvatar(userId);
  const { show, ToastComponent } = useToast();

  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [pendingUriType, setPendingUriType] = useState<'photo' | 'camera' | null>(null);
  const [previewPreset, setPreviewPreset] = useState<PresetAvatarId | null>(null);
  const [textInput, setTextInput] = useState('');
  const [showTextInput, setShowTextInput] = useState(false);
  const [cameraDenied, setCameraDenied] = useState(false);
  const [photoDenied, setPhotoDenied] = useState(false);
  const [saved, setSaved] = useState(false);
  const saveInFlight = useRef(false);

  const existingPresetId = parsePresetAvatarId(profile?.avatar_url);
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

  const onSelectPreset = (id: PresetAvatarId) => {
    setPreviewPreset(id);
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
    if (!userId || !hasPendingChange || updateAvatar.isPending || saveInFlight.current) return;
    saveInFlight.current = true;
    try {
      if (previewUri && pendingUriType) {
        const publicUrl = await uploadImageToBucket('avatars', `${userId}/avatar.jpg`, previewUri, 800);
        await updateAvatar.mutateAsync({ avatarUrl: publicUrl, avatarType: pendingUriType });
      } else if (previewPreset) {
        await updateAvatar.mutateAsync({ avatarUrl: presetAvatarValue(previewPreset), avatarType: 'preset' });
      } else if (showTextInput && textInput.trim()) {
        await updateAvatar.mutateAsync({ avatarUrl: `text:${textInput.trim()}`, avatarType: 'text' });
      }
      setSaved(true);
      show('Profile picture updated!', 'success');
    } catch {
      Alert.alert('Save failed', 'Could not save your profile picture. Please try again.');
    } finally {
      saveInFlight.current = false;
    }
  };

  const displayText = showTextInput || textInput ? textInput : existingText;
  const displayAvatarValue = previewPreset
    ? presetAvatarValue(previewPreset)
    : existingPresetId
      ? presetAvatarValue(existingPresetId)
      : displayText
        ? `text:${displayText}`
        : existingPreset
          ? `preset:${existingPreset}`
          : null;
  const displayUri = previewUri ?? (
    profile?.avatar_url && !displayAvatarValue ? profile.avatar_url : null
  );
  // Three 52px rows on normal phones. The grid is the only vertically
  // scrollable region and shrinks before the fixed preview/controls/save button
  // can be pushed behind a small device's safe area or keyboard.
  const presetGridHeight = Math.max(112, Math.min(204, windowHeight - 520));

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {ToastComponent}
      <ProfileScreenHeader title="Profile Picture" onBack={() => router.back()} />

      <View style={styles.content}>
        <Text style={styles.heading}>Update your photo</Text>
        <Text style={styles.subheading}>
          Choose a photo, initials, or a We Glue avatar.
        </Text>

        <View style={styles.avatarWrap}>
          <View
            style={[
              styles.avatarCircle,
              displayAvatarValue && {
                backgroundColor: displayText || existingPreset ? existingPreset ?? profileColors.teal : undefined,
                borderStyle: 'solid',
                borderColor: profileColors.teal,
              },
            ]}
          >
            {displayUri ? (
              <Image source={{ uri: displayUri }} style={styles.avatarImage} />
            ) : displayAvatarValue ? (
              <Avatar uri={displayAvatarValue} size={120} username={profile?.username} />
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

        <Text style={styles.presetLabel}>Or choose a <Text style={styles.presetLabelStrong}>We Glue</Text> avatar</Text>
        <FlatList
          data={PRESET_AVATARS}
          keyExtractor={(avatar) => avatar.id}
          numColumns={4}
          style={[styles.presetList, { height: presetGridHeight }]}
          contentContainerStyle={styles.presetListContent}
          columnWrapperStyle={styles.presetRow}
          showsVerticalScrollIndicator
          persistentScrollbar
          nestedScrollEnabled
          renderItem={({ item }) => {
            const selected = displayAvatarValue === presetAvatarValue(item.id);
            return (
              <TouchableOpacity
                onPress={() => onSelectPreset(item.id)}
                accessibilityRole="button"
                accessibilityLabel={`Select ${item.label}`}
                accessibilityState={{ selected }}
                style={[styles.presetOption, selected && styles.presetOptionSelected]}
                activeOpacity={0.8}
              >
                <Avatar uri={presetAvatarValue(item.id)} size={52} username={profile?.username} />
                {selected && (
                  <View pointerEvents="none" style={styles.presetCheck}>
                    <Ionicons name="checkmark" size={14} color={profileColors.white} />
                  </View>
                )}
              </TouchableOpacity>
            );
          }}
        />

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

      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: profileColors.bg },
  content: { flex: 1, paddingHorizontal: 24, paddingTop: 8, alignItems: 'center' },
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
  presetLabelStrong: { fontFamily: profileFonts.bold, fontStyle: 'italic' },
  presetList: {
    width: 276,
    maxWidth: '100%',
    marginBottom: 16,
    flexGrow: 0,
    borderRadius: 12,
    backgroundColor: 'rgba(15,166,166,0.04)',
  },
  presetListContent: { paddingVertical: 6, paddingHorizontal: 8 },
  presetRow: { justifyContent: 'space-between', marginBottom: 12 },
  presetOption: {
    position: 'relative',
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  presetOptionSelected: {
    borderColor: profileColors.teal,
    shadowColor: profileColors.teal,
    shadowOpacity: 0.32,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  presetCheck: {
    position: 'absolute',
    right: -3,
    bottom: -3,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: profileColors.teal,
    borderWidth: 2,
    borderColor: profileColors.bg,
    alignItems: 'center',
    justifyContent: 'center',
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
