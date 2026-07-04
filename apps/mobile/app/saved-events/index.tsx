import { useState } from 'react';
import {
  View,
  Text,
  SectionList,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuthStore } from '@weglue/shared';
import { useSavedEventsUpcoming, useSavedEventsPast, useUnsaveEvent } from '../../hooks/useSavedEvents';
import { ProfileScreenHeader } from '../../components/profile/ProfileScreenHeader';
import { CalendarEventCard } from '../../components/calendar/CalendarEventCard';
import { calendarTypography } from '../../components/calendar/calendarTheme';
import { profileColors, profileFonts } from '../../components/profile/profileTheme';
import type { CalendarEvent, CalendarSection } from '../../services/calendarService';

export default function SavedEventsScreen() {
  const { session } = useAuthStore();
  const userId = session?.user.id;
  const router = useRouter();

  const { data: upcoming = [], isLoading: loadingUpcoming } = useSavedEventsUpcoming(userId);
  const {
    data: pastData,
    fetchNextPage,
    isLoading: loadingPast,
    hasNextPage,
    isFetchingNextPage,
  } = useSavedEventsPast(userId);
  const unsave = useUnsaveEvent(userId);

  const [showPast, setShowPast] = useState(false);

  const onUnsave = (eventId: string) => unsave.mutate(eventId);
  const onFetchMorePast = () => fetchNextPage();
  const onEventPress = (event: CalendarEvent) =>
    router.push({
      pathname: '/calendar/event-detail',
      params: { eventId: event.id },
    } as any);

  const pastEvents = pastData?.pages.flatMap((p) => p) ?? [];
  const today = new Date().toISOString().split('T')[0];

  if (loadingUpcoming && loadingPast) {
    return (
      <SafeAreaView style={styles.loading}>
        <ActivityIndicator size="large" color={profileColors.teal} />
      </SafeAreaView>
    );
  }

  if (showPast) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ProfileScreenHeader
          title="Past Events"
          onBack={() => setShowPast(false)}
        />
        <SectionList
          sections={[{ title: 'PAST', data: pastEvents }]}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.pastList}
          renderItem={({ item }) => (
            <View style={styles.pastRow}>
              <CalendarEventCard
                event={item}
                isToday={false}
                onPress={() => onEventPress(item)}
              />
              <TouchableOpacity
                onPress={() => onUnsave(item.id)}
                style={styles.unsaveBtn}
                activeOpacity={0.7}
              >
                <Text style={styles.unsaveText}>Unsave</Text>
              </TouchableOpacity>
            </View>
          )}
          ListEmptyComponent={
            <Text style={styles.empty}>No past saved events.</Text>
          }
          ListFooterComponent={
            hasNextPage ? (
              <TouchableOpacity onPress={onFetchMorePast} style={styles.loadMore}>
                {isFetchingNextPage ? (
                  <ActivityIndicator color={profileColors.teal} />
                ) : (
                  <Text style={styles.pastLink}>Load more</Text>
                )}
              </TouchableOpacity>
            ) : null
          }
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.topBar}>
        <ProfileScreenHeader title="Saved Events" onBack={() => router.back()} />
        <TouchableOpacity
          onPress={() => setShowPast(true)}
          style={styles.pastLinkBtn}
          activeOpacity={0.7}
        >
          <Text style={styles.pastLink}>Past Events</Text>
        </TouchableOpacity>
      </View>

      {loadingUpcoming ? (
        <ActivityIndicator color={profileColors.teal} style={{ marginTop: 24 }} />
      ) : upcoming.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.empty}>No upcoming saved events.</Text>
          <TouchableOpacity onPress={() => setShowPast(true)} activeOpacity={0.7}>
            <Text style={styles.pastLink}>View past events</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <SectionList<CalendarEvent, CalendarSection>
          sections={upcoming}
          keyExtractor={(item) => item.id}
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeader}>
              <Text style={calendarTypography.sectionHeader}>
                {section.label.toUpperCase()}
              </Text>
            </View>
          )}
          renderItem={({ item }) => (
            <View style={styles.eventRow}>
              <CalendarEventCard
                event={item}
                isToday={item.event_date === today}
                onPress={() => onEventPress(item)}
              />
              <TouchableOpacity
                onPress={() => onUnsave(item.id)}
                style={styles.unsaveInline}
                activeOpacity={0.7}
              >
                <Text style={styles.unsaveText}>Unsave</Text>
              </TouchableOpacity>
            </View>
          )}
          contentContainerStyle={styles.listContent}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: profileColors.bg },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: profileColors.bg,
  },
  headerRow: { position: 'relative' },
  topBar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingRight: 16,
  },
  pastLinkBtn: {
    paddingTop: 22,
  },
  pastLink: {
    fontFamily: profileFonts.medium,
    fontSize: 13,
    color: profileColors.teal,
  },
  listContent: { paddingBottom: 32 },
  sectionHeader: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
    backgroundColor: profileColors.bg,
  },
  eventRow: { marginBottom: 4 },
  unsaveInline: {
    alignSelf: 'flex-end',
    marginRight: 16,
    marginBottom: 8,
    paddingVertical: 4,
  },
  unsaveBtn: {
    alignSelf: 'center',
    marginRight: 16,
    paddingVertical: 8,
  },
  unsaveText: {
    fontFamily: profileFonts.medium,
    fontSize: 12,
    color: profileColors.alertRed,
  },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 24,
  },
  empty: {
    fontFamily: profileFonts.regular,
    fontSize: 14,
    color: profileColors.textLight,
    textAlign: 'center',
  },
  pastList: {
    paddingBottom: 32,
    backgroundColor: profileColors.mutedListBg,
  },
  pastRow: {
    marginBottom: 4,
    opacity: 0.85,
  },
  loadMore: { padding: 16, alignItems: 'center' },
});
