import { useState, useCallback } from 'react';
import {
  View,
  Text,
  SectionList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@weglue/shared';
import { Avatar } from '../../../components/shared/Avatar';
import { AvatarStack } from '../../../components/shared/AvatarStack';
import {
  useCalendarSections,
  useCalendarMonthMarkers,
} from '../../../hooks/useCalendar';
import type { CalendarEvent, CalendarSection } from '../../../services/calendarService';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(timeStr: string): string {
  const [h, m] = timeStr.split(':').map(Number);
  const ampm = h >= 12 ? 'pm' : 'am';
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${ampm}`;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// ─── Calendar section event card ──────────────────────────────────────────────
// Visual styling only — no grid, no dots (Cursor's Step 2 scope).

function CalendarEventCard({
  event,
  onPress,
}: {
  event: CalendarEvent;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={styles.card}
    >
      <View style={styles.cardLeft}>
        <Avatar uri={event.club.avatar_url} size={32} username={event.club.name} />
      </View>
      <View style={styles.cardBody}>
        <Text style={styles.cardTitle} numberOfLines={1}>
          {event.emoji ? `${event.emoji} ` : ''}{event.title}
        </Text>
        <Text style={styles.cardMeta} numberOfLines={1}>
          {formatDate(event.event_date)} · {formatTime(event.start_time)}
        </Text>
        {(event.location || event.building) ? (
          <Text style={styles.cardMeta} numberOfLines={1}>
            <Ionicons name="location-outline" size={11} color="#9CA3AF" />
            {' '}{event.location ?? `${event.building} ${event.room ?? ''}`.trim()}
          </Text>
        ) : null}
        {event.attendee_count > 0 ? (
          <View style={styles.attendeeRow}>
            {event.attendee_preview.length > 0 && (
              <AvatarStack avatars={event.attendee_preview} size={18} overlap={5} />
            )}
            <Text style={styles.attendeeText}>{event.attendee_count} going</Text>
          </View>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={16} color="#9CA3AF" style={styles.chevron} />
    </TouchableOpacity>
  );
}

// ─── Main screen ─────────────────────────────────────────────────────────────

export default function CalendarScreen() {
  const router = useRouter();
  const { session } = useAuthStore();
  const userId = session?.user.id;

  const now = new Date();
  const [displayYear, setDisplayYear] = useState(now.getFullYear());
  const [displayMonth, setDisplayMonth] = useState(now.getMonth() + 1); // 1-indexed

  const {
    data: sections = [],
    isLoading,
    isError,
    refetch,
    isRefetching,
  } = useCalendarSections(userId);

  const { data: markedDates = [] } = useCalendarMonthMarkers(
    userId,
    displayYear,
    displayMonth,
  );

  const today = new Date().toISOString().split('T')[0];

  const handlePrevMonth = useCallback(() => {
    if (displayMonth === 1) {
      setDisplayYear((y) => y - 1);
      setDisplayMonth(12);
    } else {
      setDisplayMonth((m) => m - 1);
    }
  }, [displayMonth]);

  const handleNextMonth = useCallback(() => {
    if (displayMonth === 12) {
      setDisplayYear((y) => y + 1);
      setDisplayMonth(1);
    } else {
      setDisplayMonth((m) => m + 1);
    }
  }, [displayMonth]);

  // Called when user taps a marked day in the grid.
  // Finds that day's events (already sorted by start_time from the service),
  // then navigates to the calendar event-detail with the earliest event.
  const handleDayPress = useCallback(
    (date: string) => {
      // Tapping an unmarked day → no-op (caller enforces this)
      const dayEvents = sections
        .flatMap((s) => s.data)
        .filter((e) => e.event_date === date)
        .sort((a, b) => a.start_time.localeCompare(b.start_time));

      if (dayEvents.length === 0) return;

      const isPast = date < today;

      router.push({
        pathname: '/(tabs)/calendar/event-detail',
        params: {
          date,
          initialEventId: dayEvents[0].id,
          isPast: isPast ? 'true' : 'false',
        },
      });
    },
    [sections, today, router],
  );

  const handleEventPress = useCallback(
    (event: CalendarEvent) => {
      const isPast = event.event_date < today;
      router.push({
        pathname: '/(tabs)/calendar/event-detail',
        params: {
          date: event.event_date,
          initialEventId: event.id,
          isPast: isPast ? 'true' : 'false',
        },
      });
    },
    [today, router],
  );

  const handleSearchPress = useCallback(() => {
    // "Search for upcoming events" → Home tab
    router.push('/(tabs)');
  }, [router]);

  const isEmpty = !isLoading && sections.length === 0;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Month header with navigation */}
      <View style={styles.monthHeader}>
        <TouchableOpacity onPress={handlePrevMonth} activeOpacity={0.7} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="chevron-back" size={22} color="#111827" />
        </TouchableOpacity>
        <Text style={styles.monthTitle}>
          {MONTH_NAMES[displayMonth - 1]} {displayYear}
        </Text>
        <TouchableOpacity onPress={handleNextMonth} activeOpacity={0.7} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="chevron-forward" size={22} color="#111827" />
        </TouchableOpacity>
      </View>

      {/* ─────────────────────────────────────────────────────────────────────
          CALENDAR GRID PLACEHOLDER — CURSOR SCOPE (Step 2)
          ─────────────────────────────────────────────────────────────────────
          Replace the View below with a <CalendarGrid> component that receives:

          Props:
            markedDates:  string[]         — YYYY-MM-DD dates with 'going' RSVPs
            today:        string           — today's date (YYYY-MM-DD), rendered
                                            as a filled circle per design spec
            year:         number           — currently displayed year
            month:        number           — currently displayed month (1-indexed)
            onDayPress:   (date: string) => void
                          Called ONLY for marked days. Unmarked-day taps must
                          produce no navigation call, no state change. The
                          handler above (handleDayPress) enforces this for the
                          section-list side; the grid component itself should
                          also guard before calling onDayPress.

          See calendarService.ts for the full data contract and prop interface
          documentation for DotNavigatorProps (used inside event-detail).
          ──────────────────────────────────────────────────────────────────── */}
      <View style={styles.gridPlaceholder}>
        <Text style={styles.gridPlaceholderText}>
          {/* Grid renders here (Cursor Step 2) */}
        </Text>
      </View>

      {/* "Link y calendar" button — intentionally inert per founder instruction */}
      <TouchableOpacity
        activeOpacity={0.8}
        style={styles.linkCalendarBtn}
        // No onPress — Google Calendar OAuth is scoped separately
      >
        <Ionicons name="logo-google" size={16} color="#0FA6A6" />
        <Text style={styles.linkCalendarText}>Link y calendar</Text>
      </TouchableOpacity>

      {/* Section list */}
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color="#0FA6A6" />
        </View>
      ) : isError ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>Something went wrong loading your events.</Text>
          <TouchableOpacity onPress={() => refetch()} style={styles.retryBtn}>
            <Text style={styles.retryText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : isEmpty ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyEmoji}>📅</Text>
          <Text style={styles.emptyTitle}>No upcoming events</Text>
          <Text style={styles.emptySubtitle}>
            RSVP to events and they'll show up here.
          </Text>
          <TouchableOpacity
            onPress={handleSearchPress}
            activeOpacity={0.8}
            style={styles.searchEventsBtn}
          >
            <Text style={styles.searchEventsBtnText}>Search for upcoming events</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <SectionList<CalendarEvent, CalendarSection>
          sections={sections}
          keyExtractor={(item) => item.id}
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionHeaderText}>{section.label}</Text>
            </View>
          )}
          renderItem={({ item }) => (
            <CalendarEventCard
              event={item}
              onPress={() => handleEventPress(item)}
            />
          )}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          stickySectionHeadersEnabled={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor="#0FA6A6"
              colors={['#0FA6A6']}
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FEFCF0',
  },
  monthHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  monthTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    fontFamily: 'Inter_700Bold',
  },
  gridPlaceholder: {
    // Cursor Step 2 replaces this with the actual calendar grid.
    // Adjust height to match the grid component's natural size.
    minHeight: 4,
  },
  gridPlaceholderText: {
    // intentionally empty
  },
  linkCalendarBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: '#0FA6A6',
    marginBottom: 12,
  },
  linkCalendarText: {
    fontSize: 13,
    color: '#0FA6A6',
    fontFamily: 'Inter_500Medium',
  },
  sectionHeader: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 8,
    backgroundColor: '#FEFCF0',
  },
  sectionHeaderText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
    fontFamily: 'Inter_600SemiBold',
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 12,
    padding: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  cardLeft: {
    marginRight: 10,
  },
  cardBody: {
    flex: 1,
    gap: 2,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
    fontFamily: 'Inter_600SemiBold',
  },
  cardMeta: {
    fontSize: 12,
    color: '#6B7280',
    fontFamily: 'Inter_400Regular',
  },
  attendeeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 4,
  },
  attendeeText: {
    fontSize: 11,
    color: '#9CA3AF',
    fontFamily: 'Inter_400Regular',
  },
  chevron: {
    marginLeft: 8,
  },
  listContent: {
    paddingBottom: 32,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  errorText: {
    fontSize: 15,
    color: '#6B7280',
    textAlign: 'center',
    fontFamily: 'Inter_400Regular',
    marginBottom: 12,
  },
  retryBtn: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#0FA6A6',
  },
  retryText: {
    color: '#fff',
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  emptyEmoji: {
    fontSize: 44,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    fontFamily: 'Zain_700Bold',
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#9CA3AF',
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    marginBottom: 24,
  },
  searchEventsBtn: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
    backgroundColor: '#0FA6A6',
  },
  searchEventsBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
    fontFamily: 'Inter_600SemiBold',
  },
});
