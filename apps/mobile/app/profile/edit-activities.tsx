import { useEffect, useRef, useState } from 'react';
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
import { useRegenerateClubRecommendations } from '../../hooks/useClubRecommendations';
import { ProfileScreenHeader } from '../../components/profile/ProfileScreenHeader';
import { SelectionChipGrid } from '../../components/profile/SelectionChipGrid';
import { profileColors, profileFonts, profileShadow } from '../../components/profile/profileTheme';

// Must stay in sync with the onboarding survey (app/onboarding/activities.tsx)
// and the user_activities CHECK constraint — other values are rejected by the DB.
const ALL_ACTIVITIES = [
  'Projects',
  'Volunteering',
  'Trips',
  'Workshops',
  'Social Events',
  'Campus Tours',
  'Tournaments',
  'Networking',
  'Study Groups',
  'Campus Fairs',
] as const;

export default function EditActivitiesScreen() {
  const { session } = useAuthStore();
  const userId = session?.user.id;
  const router = useRouter();

  const { data: profile } = useOwnProfile(userId);
  const [selected, setSelected] = useState<string[]>(profile?.activities ?? []);
  // Once the user has toggled anything, background profile refetches must not
  // reset the selection out from under them (it silently wiped choices).
  const dirtyRef = useRef(false);

  useEffect(() => {
    if (profile?.activities && !dirtyRef.current) setSelected(profile.activities);
  }, [profile?.activities]);

  const updateActivities = useUpdateActivities(userId);
  const regenerate = useRegenerateClubRecommendations(userId);
  const saving = updateActivities.isPending || regenerate.isPending;

  const onToggle = (activity: string) => {
    dirtyRef.current = true;
    setSelected((prev) =>
      prev.includes(activity) ? prev.filter((a) => a !== activity) : [...prev, activity],
    );
  };

  const onSave = async () => {
    await updateActivities.mutateAsync(selected);

    // Saving the survey supersedes any previous batch — dismissed, completed,
    // or still active — so the matches section comes back with fresh clubs.
    // The celebratory screen shows the count from the batch we just created, so
    // it can never disagree with what Home → Events renders.
    try {
      const batch = await regenerate.mutateAsync();
      if (batch && batch.count > 0) {
        router.replace({
          pathname: '/profile/match-results',
          params: { count: String(batch.count) },
        } as never);
        return;
      }
    } catch {
      // Recommendations are a bonus — never block saving the survey on them.
    }

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
        {/* Disabled while the batch regenerates too, so repeated Save taps
            cannot race each other into duplicate batches. */}
        <TouchableOpacity
          style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
          onPress={onSave}
          disabled={saving}
          activeOpacity={0.85}
        >
          {saving ? (
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
