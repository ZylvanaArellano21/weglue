/**
 * Edit Profile Picture Screen
 *
 * DATA LAYER — Cursor (Step 2) renders the UI. Do not change the hooks below.
 *
 * Three avatar source options (same as onboarding/profile-pic):
 *   1. Camera — capture via expo-image-picker (launchCameraAsync)
 *   2. Photo library — pick via expo-image-picker (launchImageLibraryAsync)
 *   3. Preset color — choose from 6 preset color swatches; stored as "preset:#HEXCOLOR"
 *
 * Props:
 *   currentAvatarUrl   string | null        — pre-fill with existing avatar
 *   onPickFromLibrary  () => Promise<void>
 *   onPickFromCamera   () => Promise<void>
 *   onSelectPreset     (colorHex: string) => Promise<void>
 *   isSaving           boolean
 *   saveError          Error | null
 *
 * Storage: uploads to 'avatars' bucket at path `{userId}/avatar.jpg`.
 * On save success: pop navigation back to own profile.
 *
 * Preset color storage format: "preset:#HEXCOLOR"  (e.g. "preset:#0FA6A6")
 * parsePresetColor() utility in components/shared/Avatar.tsx can decode this.
 *
 * Preset color options: #0FA6A6, #FF6B6B, #4ECDC4, #45B7D1, #96CEB4, #FFEAA7
 */

import { Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useAuthStore } from '@weglue/shared';
import { useOwnProfile, useUpdateProfileAvatar } from '../../hooks/useOwnProfile';
import { supabase } from '../../lib/supabase';

const PRESET_COLORS = ['#0FA6A6', '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7'];

export default function EditProfilePicScreen() {
  const { session } = useAuthStore();
  const userId = session?.user.id;
  const router = useRouter();

  const { data: profile } = useOwnProfile(userId);
  const updateAvatar = useUpdateProfileAvatar(userId);

  async function uploadAndSave(uri: string, type: 'photo' | 'camera') {
    if (!userId) return;
    const ext = uri.split('.').pop() ?? 'jpg';
    const path = `${userId}/avatar.${ext}`;
    const response = await fetch(uri);
    const blob = await response.blob();
    const arrayBuffer = await blob.arrayBuffer();
    await supabase.storage.from('avatars').upload(path, arrayBuffer, {
      contentType: `image/${ext}`,
      upsert: true,
    });
    const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path);
    await updateAvatar.mutateAsync({ avatarUrl: publicUrl, avatarType: type });
    router.back();
  }

  const onPickFromLibrary = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      await uploadAndSave(result.assets[0].uri, 'photo');
    }
  };

  const onPickFromCamera = async () => {
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      await uploadAndSave(result.assets[0].uri, 'camera');
    }
  };

  const onSelectPreset = async (colorHex: string) => {
    await updateAvatar.mutateAsync({
      avatarUrl: `preset:${colorHex}`,
      avatarType: 'text',
    });
    router.back();
  };

  // ─── Cursor: render avatar picker UI here ─────────────────────────────────
  // Variables: profile?.avatar_url, PRESET_COLORS, onPickFromLibrary,
  //   onPickFromCamera, onSelectPreset, updateAvatar.isPending
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#FDFBEF' }}>
      <Text style={{ padding: 20, fontSize: 16, color: '#111' }}>Edit Profile Picture</Text>
    </SafeAreaView>
  );
}
