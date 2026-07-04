/**
 * Own Profile Screen
 *
 * DATA LAYER — Cursor (Step 2) renders the UI. Do not change the hooks or props below.
 *
 * Props received from data layer:
 *   profile         OwnProfile | null        — display_name, username, avatar_url, avatar_type, interests[], activities[], officer_roles[]
 *   clubsCount      number                   — total clubs the user belongs to
 *   gluematesCount  number                   — total accepted follows (both directions)
 *   thisWeekEvents  BucketedCalendarEvents   — RSVP'd events bucketed by calendar buckets (today/this_week/next_week/this_month/next_month)
 *   posts           OwnPost[][]              — paginated post pages (infinite query .data.pages)
 *   isLoading       boolean
 *
 * Navigation callbacks (must keep):
 *   onEditProfile       () => void  → navigates to /profile/edit-profile
 *   onEditInterests     () => void  → navigates to /profile/edit-interests
 *   onEditActivities    () => void  → navigates to /profile/edit-activities
 *   onEditProfilePic    () => void  → navigates to /profile/edit-profile-pic
 *   onDeletePost        (postId: string) => void
 *   onRemoveRsvp        (eventId: string) => void  — swipe-delete an RSVP'd event
 *   onFetchMorePosts    () => void  — call when scroll reaches end of posts list
 */

import { ActivityIndicator, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuthStore } from '@weglue/shared';
import { useOwnProfile, useOwnClubsList, useOwnGluematesList, useOwnThisWeekEvents, useOwnPosts, useDeleteOwnPost, useRemoveEventRsvp } from '../../hooks/useOwnProfile';

export default function OwnProfileScreen() {
  const { session } = useAuthStore();
  const userId = session?.user.id;
  const router = useRouter();

  const { data: profile, isLoading: profileLoading } = useOwnProfile(userId);
  const { data: clubs }     = useOwnClubsList(userId, true);
  const { data: gluemates } = useOwnGluematesList(userId, true);
  const { data: thisWeek }  = useOwnThisWeekEvents(userId);
  const { data: postsData, fetchNextPage } = useOwnPosts(userId);
  const deletePost  = useDeleteOwnPost(userId);
  const removeRsvp  = useRemoveEventRsvp(userId);

  const onEditProfile    = () => router.push('/profile/edit-profile' as any);
  const onEditInterests  = () => router.push('/profile/edit-interests' as any);
  const onEditActivities = () => router.push('/profile/edit-activities' as any);
  const onEditProfilePic = () => router.push('/profile/edit-profile-pic' as any);

  if (profileLoading) {
    return (
      <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FDFBEF' }}>
        <ActivityIndicator size="large" color="#0FA6A6" />
      </SafeAreaView>
    );
  }

  // ─── Cursor: render full Own Profile UI here ──────────────────────────────
  // Variables available: profile, clubs?.length, gluemates?.length, thisWeek,
  //   postsData?.pages, onEditProfile, onEditInterests, onEditActivities,
  //   onEditProfilePic, deletePost.mutate, removeRsvp.mutate, fetchNextPage
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#FDFBEF' }}>
      <Text style={{ padding: 20, fontSize: 16, color: '#111' }}>
        {profile?.full_name ?? profile?.username ?? 'Your Profile'}
      </Text>
    </SafeAreaView>
  );
}
