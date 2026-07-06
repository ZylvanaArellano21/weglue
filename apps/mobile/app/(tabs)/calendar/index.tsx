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
import { useAuthStore } from '@weglue/shared';
import { CalendarGrid } from '../../../components/calendar/CalendarGrid';
import { CalendarEventCard } from '../../../components/calendar/CalendarEventCard';
import { LinkCalendarButton } from '../../../components/calendar/LinkCalendarButton';
import { SearchEventsPill } from '../../../components/calendar/SearchEventsPill';
import { calendarColors, calendarTypography } from '../../../components/calendar/calendarTheme';
import {
  useCalendarSections,
  useCalendarMonthMarkers,
} from '../../../hooks/useCalendar';
import type { CalendarEvent, CalendarSection } from '../../../services/calendarService';

export default function CalendarScreen() {
  const router = useRouter();
  const { session } = useAuthStore();
  const userId = session?.user.id;

  const now = new Date();
  const [displayYear, setDisplayYear] = useState(now.getFullYear());
  const [displayMonth, setDisplayMonth] = useState(now.getMonth() + 1);

  const {
    data: sections = [],
    isLoading,
    isError,
    refetch,
  } = useCalendarSections(userId);

  // Pull-to-refresh state kept separate from background refetches so the
  // spinner only shows for a real pull.
  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  }, [refetch]);

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

  const handleDayPress = useCallback(
    (date: string) => {
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
    router.push('/(tabs)');
  }, [router]);

  const isEmpty = !isLoading && sections.length === 0;

  const listFooter = <LinkCalendarButton />;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <CalendarGrid
        markedDates={markedDates}
        today={today}
        year={displayYear}
        month={displayMonth}
        onDayPress={handleDayPress}
        onPrevMonth={handlePrevMonth}
        onNextMonth={handleNextMonth}
      />

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={calendarColors.teal} />
        </View>
      ) : isError ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>Something went wrong loading your events.</Text>
          <TouchableOpacity onPress={() => refetch()} style={styles.retryBtn}>
            <Text style={styles.retryText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : isEmpty ? (
        <View style={styles.emptyWrap}>
          <SearchEventsPill onPress={handleSearchPress} />
        </View>
      ) : (
        <SectionList<CalendarEvent, CalendarSection>
          sections={sections}
          keyExtractor={(item) => item.id}
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeader}>
              <Text style={calendarTypography.sectionHeader}>
                {section.label.toUpperCase()}
              </Text>
            </View>
          )}
          renderItem={({ item, section }) => (
            <CalendarEventCard
              event={item}
              isToday={section.key === 'today'}
              onPress={() => handleEventPress(item)}
            />
          )}
          ListFooterComponent={listFooter}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          stickySectionHeadersEnabled={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={calendarColors.teal}
              colors={[calendarColors.teal]}
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: calendarColors.bg,
  },
  sectionHeader: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
    backgroundColor: calendarColors.bg,
  },
  listContent: {
    paddingBottom: 8,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  errorText: {
    fontSize: 15,
    color: calendarColors.metaLight,
    textAlign: 'center',
    fontFamily: calendarTypography.eventMetaDefault.fontFamily,
    marginBottom: 12,
  },
  retryBtn: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: calendarColors.teal,
  },
  retryText: {
    color: calendarColors.white,
    fontSize: 14,
    fontFamily: calendarTypography.eventTitle.fontFamily,
  },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 24,
  },
});
