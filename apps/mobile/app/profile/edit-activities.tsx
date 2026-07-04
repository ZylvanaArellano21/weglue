/**
 * Edit Activities Screen
 *
 * DATA LAYER — Cursor (Step 2) renders the UI. Do not change the hooks below.
 *
 * This is a NEW screen instance, NOT the onboarding/activities.tsx screen.
 * Onboarding is tightly coupled to useOnboardingStore — do NOT reuse it here.
 *
 * Props:
 *   selectedActivities  string[]           — controlled selection (starts pre-filled from profile)
 *   allActivities       string[]           — full canonical activities list (see below)
 *   onToggle            (activity: string) => void
 *   onSave              () => void         — calls UPDATE (DELETE all + INSERT new), NOT UPSERT-append
 *   isSaving            boolean
 *   saveError           Error | null
 *
 * Canonical activities list (these are stored in user_activities.activity):
 *   "Basketball", "Cooking", "Cycling", "Dancing", "Debate",
 *   "Film & Photography", "Gaming", "Hiking", "Music", "Painting",
 *   "Reading", "Running", "Soccer", "Swimming", "Tennis", "Yoga"
 *
 * On save success: pop navigation back to own profile.
 */

import { useState } from 'react';
import { Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuthStore } from '@weglue/shared';
import { useOwnProfile, useUpdateActivities } from '../../hooks/useOwnProfile';

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

  // ─── Cursor: render activities selection grid UI here ─────────────────────
  // Variables: selected, ALL_ACTIVITIES, onToggle, onSave, updateActivities.isPending
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#FDFBEF' }}>
      <Text style={{ padding: 20, fontSize: 16, color: '#111' }}>Edit Activities</Text>
    </SafeAreaView>
  );
}
