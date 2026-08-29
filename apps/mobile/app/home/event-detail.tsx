import { useEffect, useState } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@weglue/shared';
import { useEventDetail, useRsvpMutation, useSaveEventMutation } from '../../hooks/useEventDetail';
import { useJoinClubMutation } from '../../hooks/useClubMembership';
import { Avatar } from '../../components/shared/Avatar';
import { AvatarStack } from '../../components/shared/AvatarStack';
import { Skeleton } from '../../components/shared/SkeletonLoader';
import { useToast } from '../../components/Toast';
import { requestLeaveClub } from '../../store/leaveClubStore';
import { openReportFlow } from '../../components/shared/ReportButton';
import { formatEventLocation, isEventPastAt } from '../../lib/eventDisplay';
import { EventAudienceBadge } from '../../components/events/EventAudienceBadge';
import { setActiveDestination, clearActiveDestination } from '../../lib/notifications/activeDestination';

function formatDate(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function formatTime(timeStr: string): string {
  const [h, m] = timeStr.split(':').map(Number);
  const ampm = h >= 12 ? 'pm' : 'am';
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${ampm}`;
}

export default function EventDetailScreen() {
  const { eventId } = useLocalSearchParams<{ eventId: string }>();
  const { session } = useAuthStore();
  const userId = session?.user.id;
  const router = useRouter();
  const { show, ToastComponent } = useToast();

  // While THIS event is on screen, a reminder/update/canceled banner for it
  // never duplicates what's already visible; leaving re-enables it.
  useEffect(() => {
    if (!eventId) return;
    setActiveDestination('event', eventId);
    return () => clearActiveDestination('event', eventId);
  }, [eventId]);

  const { data: event, isLoading } = useEventDetail(eventId, userId);
  const { mutate: rsvp, isPending: isRsvping } = useRsvpMutation(userId, eventId);
  const { mutate: toggleSave, isPending: isSaving } = useSaveEventMutation(userId, eventId);
  const { mutate: joinClubMutate, isPending: joiningClub } = useJoinClubMutation(userId);
  // Shared officer-aware leave flow: shows exactly one modal (normal /
  // officer / sole-officer "blocked" note) and never lets a sole officer
  // leave — same behavior as Home cards and Club Profile.


  const handleRsvp = (tapped: 'going' | 'cant') => {
    // Explicit end-state: tapping the active choice again clears the RSVP.
    const desired = event?.user_rsvp_status === tapped ? null : tapped;
    rsvp(desired, {
      onSuccess: () =>
        show(
          desired === 'going'
            ? "You're going! 🎉"
            : desired === 'cant'
              ? "Got it, maybe next time!"
              : 'RSVP removed',
        ),
      onError: () => show('Failed to RSVP. Try again.', 'error'),
    });
  };

  const handleToggleSave = () => {
    if (!event) return;
    const desired = !event.is_saved;
    toggleSave(desired, {
      onSuccess: () => show(desired ? 'Event saved!' : 'Removed from saved'),
      onError: () => show('Failed to save event.', 'error'),
    });
  };

  const handleJoinLeaveClub = () => {
    if (!event) return;
    if (event.user_has_joined_club) {
      requestLeaveClub({ clubId: event.club_id, clubName: event.club.name });
    } else {
      joinClubMutate(event.club_id, {
        onSuccess: () => show('Joined club! 🎉'),
        onError: () => show('Failed to join club.', 'error'),
      });
    }
  };

  const handlePressClub = () => {
    if (event?.club_id) {
      router.push({ pathname: '/club/[clubId]', params: { clubId: event.club_id } });
    }
  };

  const handlePressAttendees = () => {
    if (event?.id) {
      router.push({ pathname: '/home/attendees', params: { eventId: event.id } });
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#FEFCF0' }} edges={['top']}>
      {ToastComponent}

      {/* Back Arrow */}
      <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
        <TouchableOpacity onPress={() => router.back()} activeOpacity={0.7} hitSlop={{ top: 10, left: 10, right: 10, bottom: 10 }}>
          <Ionicons name="chevron-back" size={26} color="#111827" />
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <ScrollView showsVerticalScrollIndicator={false}>
          <View style={{ gap: 12, padding: 16 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Skeleton width={36} height={36} borderRadius={18} />
              <Skeleton width={160} height={16} />
              <View style={{ flex: 1 }} />
              <Skeleton width={72} height={32} borderRadius={16} />
            </View>
            <Skeleton width="100%" height={220} borderRadius={12} />
            <Skeleton width="80%" height={24} />
            <Skeleton width="60%" height={16} />
            <Skeleton width="50%" height={16} />
          </View>
        </ScrollView>
      ) : !event ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: '#6B7280', fontSize: 15 }}>This event is no longer available.</Text>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
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
            {joiningClub ? (
              <View
                style={{
                  paddingHorizontal: 16,
                  paddingVertical: 7,
                  borderRadius: 20,
                  backgroundColor: event.user_has_joined_club ? 'rgba(15,166,166,0.1)' : '#0FA6A6',
                  borderWidth: event.user_has_joined_club ? 1.5 : 0,
                  borderColor: '#0FA6A6',
                  opacity: 0.65,
                }}
              >
                <Text
                  style={{
                    fontSize: 13,
                    fontWeight: '600',
                    color: event.user_has_joined_club ? '#0FA6A6' : '#fff',
                    fontFamily: 'Inter_600SemiBold',
                  }}
                >
                  {event.user_has_joined_club ? 'Joined ✓' : 'Join'}
                </Text>
              </View>
            ) : (
              <TouchableOpacity
                onPress={handleJoinLeaveClub}
                activeOpacity={0.8}
                style={{
                  paddingHorizontal: 16,
                  paddingVertical: 7,
                  borderRadius: 20,
                  backgroundColor: event.user_has_joined_club ? 'rgba(15,166,166,0.1)' : '#0FA6A6',
                  borderWidth: event.user_has_joined_club ? 1.5 : 0,
                  borderColor: '#0FA6A6',
                }}
              >
                <Text
                  style={{
                    fontSize: 13,
                    fontWeight: '600',
                    color: event.user_has_joined_club ? '#0FA6A6' : '#fff',
                    fontFamily: 'Inter_600SemiBold',
                  }}
                >
                  {event.user_has_joined_club ? 'Joined ✓' : 'Join'}
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Hero Image */}
          <View style={{ paddingHorizontal: 16 }}>
            <EventAudienceBadge visibility={event.visibility} />
            {event.cover_image_url ? (
              <Image
                source={{ uri: event.cover_image_url }}
                style={{ width: '100%', height: 220, borderRadius: 14 }}
                resizeMode="cover"
              />
            ) : (
              <View
                style={{
                  width: '100%',
                  height: 220,
                  borderRadius: 14,
                  backgroundColor: '#E5E7EB',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="image-outline" size={50} color="#9CA3AF" />
              </View>
            )}
          </View>

          <View style={{ paddingHorizontal: 16, paddingTop: 18 }}>
            {/* Title + report menu — the ⋯ sits beside the title, never over
                the hero image or action buttons */}
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 18 }}>
              <Text
                style={{
                  flex: 1,
                  fontSize: 24,
                  fontWeight: '800',
                  color: '#111827',
                  fontFamily: 'Zain_800ExtraBold',
                  lineHeight: 30,
                }}
              >
                {event.emoji ? `${event.emoji} ` : ''}{event.title}
              </Text>
              {!event.is_creator && (
                <TouchableOpacity
                  onPress={() =>
                    openReportFlow({
                      entityType: 'event',
                      entityId: event.id,
                      entityName: event.title,
                      clubId: event.club_id,
                    })
                  }
                  activeOpacity={0.7}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={{ paddingTop: 6 }}
                  accessibilityRole="button"
                  accessibilityLabel="Report this event"
                >
                  <Ionicons name="ellipsis-horizontal" size={20} color="#6B7280" />
                </TouchableOpacity>
              )}
            </View>

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
            <TouchableOpacity
              onPress={handlePressAttendees}
              activeOpacity={0.7}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                marginBottom: 20,
                backgroundColor: '#FFFFFF',
                borderRadius: 14,
                padding: 14,
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 1 },
                shadowOpacity: 0.05,
                shadowRadius: 6,
                elevation: 2,
              }}
            >
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
            </TouchableOpacity>

            {/* About Section */}
            {event.description ? (
              <>
                <Text
                  style={{
                    fontSize: 16,
                    fontWeight: '700',
                    color: '#111827',
                    fontFamily: 'Zain_700Bold',
                    marginBottom: 8,
                  }}
                >
                  About this event
                </Text>
                <Text
                  style={{
                    fontSize: 14,
                    color: '#374151',
                    lineHeight: 22,
                    fontFamily: 'Inter_400Regular',
                    marginBottom: 20,
                  }}
                >
                  {event.description}
                </Text>
              </>
            ) : null}

            {/* Share + Bookmark row */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 24 }}>
              <TouchableOpacity
                onPress={() => router.push({ pathname: '/share', params: { contentType: 'event', contentId: eventId } })}
                activeOpacity={0.7}
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 22,
                  backgroundColor: 'rgba(15,166,166,0.1)',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="paper-plane-outline" size={22} color="#0FA6A6" />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleToggleSave}
                disabled={isSaving}
                activeOpacity={0.7}
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 22,
                  backgroundColor: 'rgba(15,166,166,0.1)',
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: isSaving ? 0.6 : 1,
                }}
              >
                <Ionicons
                  name={event.is_saved ? 'bookmark' : 'bookmark-outline'}
                  size={22}
                  color="#0FA6A6"
                />
              </TouchableOpacity>
            </View>

            {/* RSVP Section — ended events are view-only: attendee count stays
                visible above, but attendance can no longer be changed */}
            {isEventPastAt(event.event_end_at) ? (
              <Text
                style={{
                  fontSize: 13,
                  color: '#9CA3AF',
                  fontFamily: 'Inter_400Regular',
                  textAlign: 'center',
                }}
              >
                This event has ended
              </Text>
            ) : (
            <>
            <Text
              style={{
                fontSize: 16,
                fontWeight: '700',
                color: '#111827',
                fontFamily: 'Zain_700Bold',
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
                  paddingVertical: 14,
                  borderRadius: 14,
                  backgroundColor: event.user_rsvp_status === 'going' ? '#0FA6A6' : '#FFFFFF',
                  borderWidth: 1.5,
                  borderColor: event.user_rsvp_status === 'going' ? '#0FA6A6' : '#D1D5DB',
                  alignItems: 'center',
                  opacity: isRsvping ? 0.7 : 1,
                }}
              >
                <Text
                  style={{
                    fontSize: 15,
                    fontWeight: '600',
                    color: event.user_rsvp_status === 'going' ? '#FFFFFF' : '#0FA6A6',
                    fontFamily: 'Inter_600SemiBold',
                  }}
                >
                  {event.user_rsvp_status === 'going' ? 'Going ✓' : 'Going'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => handleRsvp('cant')}
                disabled={isRsvping}
                activeOpacity={0.8}
                style={{
                  flex: 1,
                  paddingVertical: 14,
                  borderRadius: 14,
                  backgroundColor:
                    event.user_rsvp_status === 'cant' ? '#F02719' : '#FFFFFF',
                  borderWidth: 1.5,
                  borderColor:
                    event.user_rsvp_status === 'cant' ? '#F02719' : '#D1D5DB',
                  alignItems: 'center',
                  opacity: isRsvping ? 0.7 : 1,
                }}
              >
                <Text
                  style={{
                    fontSize: 15,
                    fontWeight: '600',
                    color: event.user_rsvp_status === 'cant' ? '#FFFFFF' : '#374151',
                    fontFamily: 'Inter_600SemiBold',
                  }}
                >
                  {event.user_rsvp_status === 'cant' ? "Can't ✓" : "Can't"}
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
