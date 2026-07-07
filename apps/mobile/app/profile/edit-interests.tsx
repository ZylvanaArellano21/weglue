import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useAuthStore } from '@weglue/shared';
import { useOwnProfile, useUpdateInterests } from '../../hooks/useOwnProfile';
import { ProfileScreenHeader } from '../../components/profile/ProfileScreenHeader';
import { SelectionChipGrid } from '../../components/profile/SelectionChipGrid';
import { profileColors, profileFonts, profileShadow } from '../../components/profile/profileTheme';

// Must stay in sync with the onboarding survey (app/onboarding/interests.tsx)
// and the user_interests CHECK constraint — other values are rejected by the DB.
const ALL_INTERESTS = [
  'Finance & Business',
  'Social Events',
  'Music',
  'Art & Culture',
  'Social Justice & Activism',
  'Numbers & Economics',
  'Sports & Athletics',
  'Gaming',
  'Health & Wellness',
  'Environment',
  'Community Service',
  'Crafts',
  'Religion',
  'Technology and Computer',
  'Film & Media',
  'Photography',
  'Strategy and Critical Thinking',
  'Writing',
  'Fashion',
  'Debate & Politics',
  'Theater',
  'Travel & Languages',
] as const;

export default function EditInterestsScreen() {
  const { session } = useAuthStore();
  const userId = session?.user.id;
  const router = useRouter();
  const { continueTo } = useLocalSearchParams<{ continueTo?: string }>();

  const { data: profile } = useOwnProfile(userId);
  const [selected, setSelected] = useState<string[]>(profile?.interests ?? []);
  // Once the user has toggled anything, background profile refetches must not
  // reset the selection out from under them (it silently wiped choices).
  const dirtyRef = useRef(false);

  useEffect(() => {
    if (profile?.interests && !dirtyRef.current) setSelected(profile.interests);
  }, [profile?.interests]);

  const updateInterests = useUpdateInterests(userId);

  const onToggle = (interest: string) => {
    dirtyRef.current = true;
    setSelected((prev) =>
      prev.includes(interest) ? prev.filter((i) => i !== interest) : [...prev, interest],
    );
  };

  const onSave = async () => {
    await updateInterests.mutateAsync(selected);
    if (continueTo === 'activities') {
      router.replace('/profile/edit-activities' as any);
    } else {
      router.back();
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ProfileScreenHeader title="Edit Interests" onBack={() => router.back()} />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.heading}>What are your interests?</Text>
        <Text style={styles.subheading}>
          Select everything that excites you. Changes update your personalized feed.
        </Text>

        <SelectionChipGrid items={ALL_INTERESTS} selected={selected} onToggle={onToggle} />

        {updateInterests.error && (
          <Text style={styles.error}>Could not save interests. Please try again.</Text>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.saveBtn, updateInterests.isPending && styles.saveBtnDisabled]}
          onPress={onSave}
          disabled={updateInterests.isPending}
          activeOpacity={0.85}
        >
          {updateInterests.isPending ? (
            <ActivityIndicator color={profileColors.bg} />
          ) : (
            <Text style={styles.saveBtnText}>
              {continueTo === 'activities' ? 'Next' : 'Save'}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: profileColors.bg },
  scroll: { paddingHorizontal: 24, paddingTop: 16 },
  heading: {
    fontFamily: profileFonts.displayBold,
    fontSize: 24,
    color: profileColors.textDark,
    marginBottom: 8,
  },
  subheading: {
    fontFamily: profileFonts.regular,
    fontSize: 14,
    color: profileColors.textMuted,
    marginBottom: 24,
    lineHeight: 20,
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
    paddingHorizontal: 24,
    paddingBottom: 36,
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
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: {
    fontFamily: profileFonts.semiBold,
    fontSize: 16,
    color: profileColors.bg,
  },
});
