/**
 * Saved Events Screen
 *
 * DATA LAYER — Cursor (Step 2) renders the UI. Do not change the hooks or props below.
 *
 * Props from data layer:
 *   upcomingBuckets  BucketedCalendarEvents      — bucketed upcoming saved events (today/this_week/…)
 *   pastEvents       SavedEvent[][]              — paginated past saved events (infinite query .data.pages)
 *   isLoadingUpcoming boolean
 *   isLoadingPast     boolean
 *   onUnsave          (eventId: string) => void  — removes event from saved_events; zero interaction with event_rsvps
 *   onFetchMorePast   () => void                 — load next page of past events
 *   onEventPress      (eventId: string) => void  — navigate to event detail
 *
 * Note: save/unsave state is independent of RSVP state.
 * A user can save an event without RSVPing and vice versa.
 */

import { ActivityIndicator, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuthStore } from '@weglue/shared';
import { useSavedEventsUpcoming, useSavedEventsPast, useUnsaveEvent } from '../../hooks/useSavedEvents';

export default function SavedEventsScreen() {
  const { session } = useAuthStore();
  const userId = session?.user.id;
  const router = useRouter();

  const { data: upcoming, isLoading: loadingUpcoming } = useSavedEventsUpcoming(userId);
  const { data: pastData, fetchNextPage, isLoading: loadingPast } = useSavedEventsPast(userId);
  const unsave = useUnsaveEvent(userId);

  const onUnsave     = (eventId: string) => unsave.mutate(eventId);
  const onFetchMorePast = () => fetchNextPage();
  const onEventPress = (eventId: string) =>
    router.push({ pathname: '/calendar/event-detail', params: { eventId } } as any);

  if (loadingUpcoming && loadingPast) {
    return (
      <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FDFBEF' }}>
        <ActivityIndicator size="large" color="#0FA6A6" />
      </SafeAreaView>
    );
  }

  // ─── Cursor: render full Saved Events UI here ─────────────────────────────
  // Variables available: upcoming (BucketedCalendarEvents), pastData?.pages,
  //   onUnsave, onFetchMorePast, onEventPress, loadingUpcoming, loadingPast
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#FDFBEF' }}>
      <Text style={{ padding: 20, fontSize: 16, color: '#111' }}>Saved Events</Text>
    </SafeAreaView>
  );
}
