import { useEffect, useState } from 'react';
import {
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuthStore } from '@weglue/shared';
import { useOwnProfile, useUpdateActivities } from '../../hooks/useOwnProfile';
import { ProfileScreenHeader } from '../../components/profile/ProfileScreenHeader';
import { SelectionChipGrid } from '../../components/profile/SelectionChipGrid';
import { profileColors, profileFonts, profileShadow } from '../../components/profile/profileTheme';

const ALL_ACTIVITIES = [
  'Basketball', 'Cooking', 'Cycling', 'Dancing', 'Debate',
  'Film & Photography', 'Gaming', 'Hiking', 'Music', 'Painting',
  'Reading', 'Running', 'Soccer', 'Swimming', 'Tennis', 'Yoga',
] as const;

export default function EditActivitiesScreen() {
  const { session } = useAuthStore();
  const userId = session?.user.id;
  const router = useRouter();

  const { data: profile } = useOwnProfile(userId);
  const [selected, setSelected] = useState<string[]>(profile?.activities ?? []);

  useEffect(() => {
    if (profile?.activities) setSelected(profile.activities);
  }, [profile?.activities]);

  const updateActivities = useUpdateActivities(userId);

  const onToggle = (activity: string) => {
    setSelected((prev) =>
      prev.includes(activity) ? prev.filter((a) => a !== activity) : [...prev, activity],
    );
  };

  const onSave = async () => {
    await updateActivities.mutateAsync(selected);
    router.back();
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ProfileScreenHeader title="Edit Activities" onBack={() => router.back()} />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.heading}>What do you enjoy doing?</Text>
        <Text style={styles.subheading}>
          Pick all the activities you love. This helps personalize your feed.
        </Text>

        <SelectionChipGrid items={ALL_ACTIVITIES} selected={selected} onToggle={onToggle} />

        {updateActivities.error && (
          <Text style={styles.error}>Could not save activities. Please try again.</Text>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.saveBtn, updateActivities.isPending && styles.saveBtnDisabled]}
          onPress={onSave}
          disabled={updateActivities.isPending}
          activeOpacity={0.85}
        >
          {updateActivities.isPending ? (
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
