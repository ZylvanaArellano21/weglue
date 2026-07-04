/**
 * Edit Interests Screen
 *
 * DATA LAYER — Cursor (Step 2) renders the UI. Do not change the hooks below.
 *
 * This is a NEW screen instance, NOT the onboarding/interests.tsx screen.
 * Onboarding is tightly coupled to useOnboardingStore — do NOT reuse it here.
 *
 * Props:
 *   selectedInterests   string[]           — controlled selection (starts pre-filled from profile)
 *   allInterests        string[]           — full canonical interest list (see below)
 *   onToggle            (interest: string) => void
 *   onSave              () => void         — calls UPDATE (DELETE all + INSERT new), NOT UPSERT-append
 *   isSaving            boolean
 *   saveError           Error | null
 *
 * Canonical interest list (exact strings — must match club_categories.category values):
 *   "Art & Culture", "Community Service", "Crafts", "Environment",
 *   "Finance & Business", "Health & Wellness", "Numbers & Economics",
 *   "Science & Technology", "Social & Nightlife", "Sports & Athletics",
 *   "Strategy and Critical Thinking", "Travel & Adventure"
 *
 * On save success: pop navigation back to own profile.
 * On save: invalidates ['discoveryClubs', userId] and ['homeEventsFeed', userId] automatically (handled by hook).
 */

import { useState } from 'react';
import { Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuthStore } from '@weglue/shared';
import { useOwnProfile, useUpdateInterests } from '../../hooks/useOwnProfile';

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

  const { data: profile } = useOwnProfile(userId);
  const [selected, setSelected] = useState<string[]>(profile?.interests ?? []);

  const updateInterests = useUpdateInterests(userId);

  const onToggle = (interest: string) => {
    setSelected((prev) =>
      prev.includes(interest) ? prev.filter((i) => i !== interest) : [...prev, interest],
    );
  };

  const onSave = async () => {
    await updateInterests.mutateAsync(selected);
    router.back();
  };

  // ─── Cursor: render interest selection grid UI here ───────────────────────
  // Variables: selected, ALL_INTERESTS, onToggle, onSave, updateInterests.isPending
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#FDFBEF' }}>
      <Text style={{ padding: 20, fontSize: 16, color: '#111' }}>Edit Interests</Text>
    </SafeAreaView>
  );
}
