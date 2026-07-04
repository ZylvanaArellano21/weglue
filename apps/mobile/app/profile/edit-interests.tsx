import { useEffect, useState } from 'react';
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

const ALL_INTERESTS = [
  'Art & Culture',
  'Community Service',
  'Crafts',
  'Environment',
  'Finance & Business',
  'Health & Wellness',
  'Numbers & Economics',
  'Science & Technology',
  'Social & Nightlife',
  'Sports & Athletics',
  'Strategy and Critical Thinking',
  'Travel & Adventure',
] as const;

export default function EditInterestsScreen() {
  const { session } = useAuthStore();
  const userId = session?.user.id;
  const router = useRouter();
  const { continueTo } = useLocalSearchParams<{ continueTo?: string }>();

  const { data: profile } = useOwnProfile(userId);
  const [selected, setSelected] = useState<string[]>(profile?.interests ?? []);

  useEffect(() => {
    if (profile?.interests) setSelected(profile.interests);
  }, [profile?.interests]);

  const updateInterests = useUpdateInterests(userId);

  const onToggle = (interest: string) => {
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
