/**
 * Calendar Event Detail Screen
 *
 * Reached by tapping a marked day on the calendar grid OR a card in the
 * section list. Always navigates back to the Calendar tab — never a generic
 * stack pop that could land elsewhere depending on entry point.
 *
 * ─── Navigation params ───────────────────────────────────────────────────────
 *   date:           YYYY-MM-DD  — the calendar day that was tapped
 *   initialEventId: UUID        — event to display first (earliest start_time)
 *   isPast:         'true'|'false' — date < today (date-only, ignore time);
 *                   when true the screen is read-only (no Going/Can't buttons)
 *
 * ─── Multi-event prop interface (Cursor Step 2 contract) ─────────────────────
 *   Replace the dot-navigator placeholder below with a <DotNavigator> component
 *   that accepts:
 *
 *   interface DotNavigatorProps {
 *     currentIndex: number;                  // 0-based, which event is visible
 *     totalEvents:  number;                  // total events for this day
 *     onDotPress:   (index: number) => void; // jump to event at index
 *   }
 *
 *   Swipe-down gesture should call handleSwipeDown() (defined below),
 *   which increments currentIndex, capped at totalEvents-1 (no wraparound).
 *
 * ─── Data shape (CalendarEvent type from calendarService.ts) ─────────────────
 *   id, title, emoji, event_date, start_time, end_time,
 *   location, building, room, cover_image_url,
 *   club: { id, name, avatar_url },
 *   attendee_count, attendee_preview, user_rsvp_status, is_saved
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@weglue/shared';
import {
  useCalendarDayEvents,
  useCalendarRsvp,
} from '../../hooks/useCalendar';
import { useSaveEventMutation } from '../../hooks/useEventDetail';
import { Avatar } from '../../components/shared/Avatar';
import { AvatarStack } from '../../components/shared/AvatarStack';
import { Skeleton } from '../../components/shared/SkeletonLoader';
import { DotNavigator } from '../../components/calendar/DotNavigator';
import { useToast } from '../../components/Toast';
import { formatEventLocation, isEventPastAt } from '../../lib/eventDisplay';
import { EventAudienceBadge } from '../../components/events/EventAudienceBadge';
import { PhotoCarousel } from '../../components/shared/PhotoCarousel';

const SCREEN_WIDTH = Dimensions.get('window').width;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function formatTime(timeStr: string): string {
  const [h, m] = timeStr.split(':').map(Number);
  const ampm = h >= 12 ? 'pm' : 'am';
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${ampm}`;
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function CalendarEventDetailScreen() {
  const router = useRouter();
  const { session } = useAuthStore();
  const userId = session?.user.id;
  const { show, ToastComponent } = useToast();

  const params = useLocalSearchParams<{
    date: string;
    initialEventId: string;
    isPast: string;
  }>();

  const date = params.date;
  const initialEventId = params.initialEventId;

  // Fetch all events for this day (sorted by start_time)
  const { data: dayEvents = [], isLoading } = useCalendarDayEvents(userId, date);

  // Multi-event navigation state
  const [currentIndex, setCurrentIndex] = useState(0);

  // Sync currentIndex to initialEventId once dayEvents loads
  useEffect(() => {
    if (!dayEvents.length || !initialEventId) return;
    const idx = dayEvents.findIndex((e) => e.id === initialEventId);
    setCurrentIndex(idx >= 0 ? idx : 0);
  }, [dayEvents.length, initialEventId]);

  const event = dayEvents[currentIndex] ?? null;
  const totalEvents = dayEvents.length;

  // Read-only once the event's REAL end datetime has passed — not the
  // date-only param, which would lock today's still-running events. The param
  // remains the fallback while event data loads.
  const isPast = event
    ? isEventPastAt(event.event_end_at)
    : params.isPast === 'true';

  // ─── Swipe-down handler: advance to next event, cap at last ───────────────
  // No wraparound — swiping past the last event does nothing.
  const handleSwipeDown = useCallback(() => {
    setCurrentIndex((prev) => Math.min(prev + 1, totalEvents - 1));
  }, [totalEvents]);

  // ─── Dot press: jump directly to any event by index ─────────────────────
  const handleDotPress = useCallback((index: number) => {
    setCurrentIndex(index);
  }, []);

  // ─── RSVP ────────────────────────────────────────────────────────────────
  const { mutate: rsvp, isPending: isRsvping } = useCalendarRsvp(userId);

  const handleRsvp = useCallback(
    (tapped: 'going' | 'cant') => {
      if (!event) return;
      const desired = event.user_rsvp_status === tapped ? null : tapped;
      rsvp(
        { eventId: event.id, desired },
        {
          onSuccess: () =>
            show(
              desired === 'going'
                ? "You're going! 🎉"
                : desired === 'cant'
                  ? "Got it, maybe next time!"
                  : 'RSVP removed',
            ),
          onError: () => show('Failed to RSVP. Try again.', 'error'),
        },
      );
    },
    [event, rsvp, show],
  );

  // ─── Save event ───────────────────────────────────────────────────────────
  const { mutate: toggleSave, isPending: isSaving } = useSaveEventMutation(
    userId,
    event?.id,
  );

  const handleToggleSave = useCallback(() => {
    if (!event) return;
    const desired = !event.is_saved;
    toggleSave(desired, {
      onSuccess: () => show(desired ? 'Event saved!' : 'Removed from saved'),
      onError: () => show('Failed to save event.', 'error'),
    });
  }, [event, toggleSave, show]);

  // ─── Share ────────────────────────────────────────────────────────────────

  // ─── Back arrow — return to wherever the user came from ──────────────────
  // Fall back to the Calendar tab only when there is no navigation history.
  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.push('/(tabs)/calendar');
    }
  }, [router]);

  // ─── Club press ───────────────────────────────────────────────────────────
  const handlePressClub = useCallback(() => {
    if (event?.club.id) {
      router.push({ pathname: '/club/[clubId]', params: { clubId: event.club.id } });
    }
  }, [event, router]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#FEFCF0' }} edges={['top']}>
      {ToastComponent}

      <DotNavigator
        currentIndex={currentIndex}
        totalEvents={totalEvents}
        onDotPress={handleDotPress}
      />

      {/* Back arrow — always goes to Calendar tab */}
      <View style={{ paddingHorizontal: 16, paddingVertical: 4, flexDirection: 'row', alignItems: 'center' }}>
        <TouchableOpacity
          onPress={handleBack}
          activeOpacity={0.7}
          hitSlop={{ top: 10, left: 10, right: 10, bottom: 10 }}
          accessibilityLabel="Back to calendar"
        >
          <Ionicons name="chevron-back" size={26} color="#111827" />
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <ScrollView showsVerticalScrollIndicator={false}>
          <View style={{ gap: 12, padding: 16 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Skeleton width={36} height={36} borderRadius={18} />
              <Skeleton width={160} height={16} />
            </View>
            <Skeleton width="100%" height={220} borderRadius={12} />
            <Skeleton width="80%" height={24} />
            <Skeleton width="60%" height={16} />
            <Skeleton width="50%" height={16} />
          </View>
        </ScrollView>
      ) : !event ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: '#6B7280', fontSize: 15, fontFamily: 'Inter_400Regular' }}>
            This event is no longer available.
          </Text>
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 40 }}
          // Swipe-down gesture handler goes here (Cursor Step 2)
          // Wire PanResponder/Gesture onEnd with downward direction to handleSwipeDown()
        >
          {/* Club Row */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: 16,
              paddingBottom: 10,
              gap: 10,
            }}
          >
            <TouchableOpacity onPress={handlePressClub} activeOpacity={0.7}>
              <Avatar uri={event.club.avatar_url} size={36} username={event.club.name} />
            </TouchableOpacity>
            <TouchableOpacity onPress={handlePressClub} style={{ flex: 1 }} activeOpacity={0.7}>
              <Text style={{ fontSize: 15, fontWeight: '600', color: '#111827', fontFamily: 'Inter_600SemiBold' }}>
                {event.club.name}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Hero Image */}
          <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
            <EventAudienceBadge visibility={event.visibility} />
          </View>
          {event.images.length > 0 ? (
            <PhotoCarousel
              images={event.images.map((img) => ({ uri: img.path, width: img.width, height: img.height }))}
              width={SCREEN_WIDTH}
              aspectRatio={3 / 2}
              rounded={false}
            />
          ) : (
            <View
              style={{
                width: '100%',
                height: 220,
                backgroundColor: '#E5E7EB',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name="image-outline" size={50} color="#9CA3AF" />
            </View>
          )}

          <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
            {/* Past badge */}
            {isPast && (
              <View
                style={{
                  alignSelf: 'flex-start',
                  backgroundColor: '#F3F4F6',
                  borderRadius: 8,
                  paddingHorizontal: 10,
                  paddingVertical: 4,
                  marginBottom: 8,
                }}
              >
                <Text style={{ fontSize: 12, color: '#6B7280', fontFamily: 'Inter_500Medium' }}>
                  Past event
                </Text>
              </View>
            )}

            {/* Title */}
            <Text
              style={{
                fontSize: 22,
                fontWeight: '800',
                color: '#111827',
                fontFamily: 'Zain_800ExtraBold',
                marginBottom: 16,
              }}
            >
              {event.emoji ? `${event.emoji} ` : ''}{event.title}
            </Text>

            {/* Date & Time + Location card */}
            <View
              style={{
                backgroundColor: '#fff',
                borderRadius: 14,
                padding: 14,
                marginBottom: 16,
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 1 },
                shadowOpacity: 0.05,
                shadowRadius: 6,
                elevation: 2,
              }}
            >
              <Text style={{ fontSize: 11, color: '#9CA3AF', fontFamily: 'Inter_400Regular', marginBottom: 4 }}>
                Date &amp; Time
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                <Ionicons name="calendar-outline" size={18} color="#374151" />
                <Text style={{ fontSize: 15, fontWeight: '700', color: '#111827', fontFamily: 'Inter_700Bold' }}>
                  {formatDate(event.event_date)}
                </Text>
              </View>
              <Text
                style={{
                  fontSize: 14,
                  color: '#374151',
                  fontFamily: 'Inter_400Regular',
                  marginLeft: 26,
                  marginBottom: formatEventLocation(event.building, event.room, event.location) ? 12 : 0,
                }}
              >
                {formatTime(event.start_time)} - {formatTime(event.end_time)}
              </Text>

              {formatEventLocation(event.building, event.room, event.location) ? (
                <>
                  <Text style={{ fontSize: 11, color: '#9CA3AF', fontFamily: 'Inter_400Regular', marginBottom: 4 }}>
                    Location
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Ionicons name="location-outline" size={18} color="#374151" />
                    <Text style={{ fontSize: 14, color: '#111827', fontFamily: 'Inter_400Regular' }}>
                      {formatEventLocation(event.building, event.room, event.location)}
                    </Text>
                  </View>
                </>
              ) : null}
            </View>

            {/* Attendees Row */}
            {event.attendee_count > 0 ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 }}>
                {event.attendee_preview.length > 0 && (
                  <AvatarStack avatars={event.attendee_preview} size={30} overlap={8} />
                )}
                <View>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: '#111827', fontFamily: 'Inter_700Bold' }}>
                    {event.attendee_count} going
                  </Text>
                  <Text style={{ fontSize: 12, color: '#9CA3AF', fontFamily: 'Inter_400Regular' }}>
                    Be part of the community
                  </Text>
                </View>
              </View>
            ) : null}

            {/* Share + Bookmark row */}
            <View style={{ flexDirection: 'row', gap: 16, marginBottom: 20 }}>
              <TouchableOpacity onPress={() => event && router.push({ pathname: '/share', params: { contentType: 'event', contentId: event.id } })} activeOpacity={0.7}>
                <Ionicons name="paper-plane-outline" size={26} color="#0FA6A6" />
              </TouchableOpacity>
              <TouchableOpacity onPress={handleToggleSave} disabled={isSaving} activeOpacity={0.7}>
                <Ionicons
                  name={event.is_saved ? 'bookmark' : 'bookmark-outline'}
                  size={26}
                  color="#0FA6A6"
                />
              </TouchableOpacity>
            </View>

            {/* RSVP Section — hidden for past events */}
            {!isPast && (
              <>
                <Text
                  style={{
                    fontSize: 14,
                    fontWeight: '600',
                    color: '#374151',
                    fontFamily: 'Inter_600SemiBold',
                    marginBottom: 12,
                  }}
                >
                  Are you coming?
                </Text>
                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <TouchableOpacity
                    onPress={() => handleRsvp('going')}
                    disabled={isRsvping}
                    activeOpacity={0.8}
                    style={{
                      flex: 1,
                      paddingVertical: 13,
                      borderRadius: 14,
                      backgroundColor:
                        event.user_rsvp_status === 'going' ? '#0FA6A6' : 'transparent',
                      borderWidth: 1.5,
                      borderColor:
                        event.user_rsvp_status === 'going' ? '#0FA6A6' : '#D1D5DB',
                      alignItems: 'center',
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 15,
                        fontWeight: '600',
                        color: event.user_rsvp_status === 'going' ? '#fff' : '#374151',
                        fontFamily: 'Inter_600SemiBold',
                      }}
                    >
                      Going
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => handleRsvp('cant')}
                    disabled={isRsvping}
                    activeOpacity={0.8}
                    style={{
                      flex: 1,
                      paddingVertical: 13,
                      borderRadius: 14,
                      backgroundColor:
                        event.user_rsvp_status === 'cant' ? '#0FA6A6' : 'transparent',
                      borderWidth: 1.5,
                      borderColor:
                        event.user_rsvp_status === 'cant' ? '#0FA6A6' : '#D1D5DB',
                      alignItems: 'center',
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 15,
                        fontWeight: '600',
                        color: event.user_rsvp_status === 'cant' ? '#fff' : '#374151',
                        fontFamily: 'Inter_600SemiBold',
                      }}
                    >
                      Can't
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </ScrollView>
      )}

    </SafeAreaView>
  );
}
