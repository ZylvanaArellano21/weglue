/**
 * Edit Profile Screen — Display Name
 *
 * DATA LAYER — Cursor (Step 2) renders the UI. Do not change the hooks below.
 *
 * Props:
 *   currentDisplayName  string               — pre-fill the input with the current full_name
 *   nameInput           string               — controlled input
 *   onSave              () => void           — calls updateDisplayName mutation
 *   isSaving            boolean
 *   saveError           Error | null
 *
 * On save success: pop navigation back to own profile.
 * Validation: trim whitespace, require non-empty string, max 60 chars.
 */

import { useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuthStore } from '@weglue/shared';
import { useOwnProfile, useUpdateDisplayName } from '../../hooks/useOwnProfile';

export default function EditProfileScreen() {
  const { session } = useAuthStore();
  const userId = session?.user.id;
  const router = useRouter();

  const { data: profile } = useOwnProfile(userId);
  const [nameInput, setNameInput] = useState(profile?.full_name ?? '');

  const updateName = useUpdateDisplayName(userId);

  const onSave = async () => {
    const trimmed = nameInput.trim();
    if (!trimmed) return;
    await updateName.mutateAsync(trimmed);
    router.back();
  };

  // ─── Cursor: render Edit Display Name UI here ─────────────────────────────
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#FDFBEF' }}>
      <Text style={{ padding: 20, fontSize: 16, color: '#111' }}>Edit Profile</Text>
    </SafeAreaView>
  );
}
