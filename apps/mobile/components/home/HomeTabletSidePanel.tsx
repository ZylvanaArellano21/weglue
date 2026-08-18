import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuthStore } from '@weglue/shared';
import { useCalendarSections } from '../../hooks/useCalendar';

// Tablet-only Home side column (iPad / Android tablet, native app) — the
// desktop-web equivalent content (apps/web/components/home/RightColumn.tsx:
// Upcoming Events + calendar access) that phone Home has no room for. Reuses
// the SAME useCalendarSections data hook the Calendar tab and web's Upcoming
// Events both read, so the three surfaces can never disagree. Deliberately a
// simple list + "Open full calendar" link to the existing Calendar tab rather
// than re-embedding the full CalendarGrid here — that grid is Calendar tab's
// own component, not duplicated in this panel.
export function HomeTabletSidePanel() {
  const { session } = useAuthStore();
  const userId = session?.user.id;
  const router = useRouter();
  const { data: sections, isLoading } = useCalendarSections(userId);

  const upcoming = (sections ?? []).flatMap((s) => s.data).slice(0, 6);

  const openEvent = (eventId: string, date: string) => {
    router.push({
      pathname: '/event/event-detail',
      params: { date, initialEventId: eventId, isPast: 'false' },
    });
  };

  return (
    <View style={{ flex: 1, paddingHorizontal: 16, paddingTop: 8 }}>
      <Text
        style={{
          fontSize: 17,
          fontWeight: '700',
          color: '#000',
          fontFamily: 'Inter_700Bold',
          marginBottom: 12,
        }}
      >
        Upcoming Events
      </Text>

      {isLoading ? (
        <ActivityIndicator color="#0FA6A6" style={{ marginTop: 12 }} />
      ) : upcoming.length === 0 ? (
        <Text
          style={{
            fontSize: 13,
            color: '#9CA3AF',
            fontFamily: 'Inter_400Regular',
            paddingVertical: 12,
          }}
        >
          No upcoming events yet. RSVP to an event and it&apos;ll show up here.
        </Text>
      ) : (
        upcoming.map((event) => (
          <TouchableOpacity
            key={event.id}
            onPress={() => openEvent(event.id, event.event_date)}
            activeOpacity={0.75}
            style={{
              borderLeftWidth: 3,
              borderLeftColor: '#0FA6A6',
              borderWidth: 1,
              borderColor: 'rgba(0,0,0,0.06)',
              borderRadius: 10,
              padding: 10,
              marginBottom: 8,
            }}
          >
            <Text
              numberOfLines={1}
              style={{ fontSize: 14, fontWeight: '600', color: '#111827', fontFamily: 'Inter_600SemiBold' }}
            >
              {event.title}
            </Text>
            <Text style={{ fontSize: 12, color: '#6B7280', marginTop: 2, fontFamily: 'Inter_400Regular' }}>
              {event.event_date} · {event.start_time}
            </Text>
          </TouchableOpacity>
        ))
      )}

      <TouchableOpacity
        onPress={() => router.push('/(tabs)/calendar')}
        activeOpacity={0.85}
        style={{
          marginTop: 8,
          borderWidth: 1,
          borderColor: '#0FA6A6',
          borderRadius: 999,
          paddingVertical: 10,
          alignItems: 'center',
        }}
      >
        <Text style={{ fontSize: 13, fontWeight: '600', color: '#0FA6A6', fontFamily: 'Inter_600SemiBold' }}>
          Open full calendar
        </Text>
      </TouchableOpacity>
    </View>
  );
}
