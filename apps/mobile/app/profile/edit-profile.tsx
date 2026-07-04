import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@weglue/shared';
import { useOwnProfile, useUpdateDisplayName } from '../../hooks/useOwnProfile';
import { ProfileScreenHeader } from '../../components/profile/ProfileScreenHeader';
import { profileColors, profileFonts, profileShadow } from '../../components/profile/profileTheme';

export default function EditProfileScreen() {
  const { session } = useAuthStore();
  const userId = session?.user.id;
  const router = useRouter();

  const { data: profile } = useOwnProfile(userId);
  const [nameInput, setNameInput] = useState(profile?.full_name ?? '');

  useEffect(() => {
    if (profile?.full_name) setNameInput(profile.full_name);
  }, [profile?.full_name]);

  const updateName = useUpdateDisplayName(userId);

  const onSave = async () => {
    const trimmed = nameInput.trim();
    if (!trimmed || trimmed.length > 60) return;
    await updateName.mutateAsync(trimmed);
    router.back();
  };

  const trimmed = nameInput.trim();
  const canSave = trimmed.length > 0 && trimmed.length <= 60 && !updateName.isPending;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ProfileScreenHeader title="Edit Profile" onBack={() => router.back()} />

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>Display Name</Text>
        <TextInput
          value={nameInput}
          onChangeText={(t) => setNameInput(t.slice(0, 60))}
          placeholder="Your name"
          placeholderTextColor={profileColors.textLight}
          style={styles.input}
          maxLength={60}
          autoCapitalize="words"
        />
        <Text style={styles.hint}>{nameInput.length}/60</Text>

        <View style={styles.sectionDivider} />

        <Text style={styles.sectionTitle}>Interests & Activities</Text>
        <Text style={styles.sectionDesc}>
          Update what you are into so we can personalize your feed and club matches.
        </Text>

        <TouchableOpacity
          style={styles.linkRow}
          onPress={() =>
            router.push({
              pathname: '/profile/edit-interests',
              params: { continueTo: 'activities' },
            } as any)
          }
          activeOpacity={0.7}
        >
          <View>
            <Text style={styles.linkTitle}>Edit Interests & Activities</Text>
            <Text style={styles.linkSub}>
              {(profile?.interests?.length ?? 0)} interests · {(profile?.activities?.length ?? 0)} activities
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={profileColors.textLight} />
        </TouchableOpacity>

        <View style={styles.sectionDivider} />

        <Text style={styles.sectionTitle}>Profile Picture</Text>
        <TouchableOpacity
          style={styles.linkRow}
          onPress={() => router.push('/profile/edit-profile-pic' as any)}
          activeOpacity={0.7}
        >
          <Text style={styles.linkTitle}>Change Profile Picture</Text>
          <Ionicons name="chevron-forward" size={20} color={profileColors.textLight} />
        </TouchableOpacity>

        {updateName.error && (
          <Text style={styles.error}>Could not save. Please try again.</Text>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.saveBtn, !canSave && styles.saveBtnDisabled]}
          onPress={onSave}
          disabled={!canSave}
          activeOpacity={0.85}
        >
          {updateName.isPending ? (
            <ActivityIndicator color={profileColors.bg} />
          ) : (
            <Text style={styles.saveBtnText}>Save</Text>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: profileColors.bg },
  scroll: { padding: 20, paddingBottom: 100 },
  label: {
    fontFamily: profileFonts.semiBold,
    fontSize: 13,
    color: profileColors.textMuted,
    marginBottom: 8,
  },
  input: {
    backgroundColor: profileColors.white,
    borderWidth: 1,
    borderColor: profileColors.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontFamily: profileFonts.regular,
    fontSize: 16,
    color: profileColors.textDark,
  },
  hint: {
    fontFamily: profileFonts.regular,
    fontSize: 12,
    color: profileColors.textLight,
    marginTop: 6,
    textAlign: 'right',
  },
  sectionDivider: {
    height: 1,
    backgroundColor: profileColors.border,
    marginVertical: 24,
  },
  sectionTitle: {
    fontFamily: profileFonts.bold,
    fontSize: 16,
    color: profileColors.textDark,
    marginBottom: 6,
  },
  sectionDesc: {
    fontFamily: profileFonts.regular,
    fontSize: 13,
    color: profileColors.textMuted,
    lineHeight: 19,
    marginBottom: 14,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: profileColors.white,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: profileColors.border,
  },
  linkTitle: {
    fontFamily: profileFonts.semiBold,
    fontSize: 15,
    color: profileColors.textDark,
  },
  linkSub: {
    fontFamily: profileFonts.regular,
    fontSize: 12,
    color: profileColors.textMuted,
    marginTop: 2,
  },
  error: {
    fontFamily: profileFonts.regular,
    fontSize: 13,
    color: profileColors.alertRed,
    marginTop: 16,
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingBottom: 32,
    paddingTop: 12,
    backgroundColor: profileColors.bg,
  },
  saveBtn: {
    height: 52,
    backgroundColor: profileColors.teal,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    ...profileShadow,
  },
  saveBtnDisabled: { opacity: 0.45 },
  saveBtnText: {
    fontFamily: profileFonts.semiBold,
    fontSize: 16,
    color: profileColors.bg,
  },
});
