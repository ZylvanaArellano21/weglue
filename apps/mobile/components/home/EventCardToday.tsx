import { memo, useState } from 'react';
import { View, Text, Image, TouchableOpacity, Pressable, Dimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from '../shared/Avatar';
import { AvatarStack } from '../shared/AvatarStack';
import { Pill } from '../shared/Pill';
import type { HomeFeedEvent } from '../../services/eventService';
import { getResizedImageUrl } from '../../lib/imageResize';

const SCREEN_WIDTH = Dimensions.get('window').width;

interface EventCardTodayProps {
  event: HomeFeedEvent;
  onRsvp: (eventId: string) => void;
  onToggleSave: (eventId: string) => void;
  onJoinClub?: (clubId: string) => void;
  onRequestLeaveClub?: (clubId: string, clubName: string) => void;
}

function formatTime(timeStr: string): string {
  const [h, m] = timeStr.split(':').map(Number);
  const ampm = h >= 12 ? 'pm' : 'am';
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${ampm}`;
}


export const EventCardToday = memo(function EventCardToday({ event, onRsvp, onToggleSave, onJoinClub, onRequestLeaveClub }: EventCardTodayProps) {
  const router = useRouter();
  const [imageError, setImageError] = useState(false);

  const handlePressEvent = () => {
    router.push({ pathname: '/home/event-detail', params: { eventId: event.id } });
  };

  const handlePressClub = () => {
    router.push({ pathname: '/club/[clubId]', params: { clubId: event.club_id } });
  };

  const handlePressAttendees = () => {
    router.push({ pathname: '/home/attendees', params: { eventId: event.id } });
  };

  return (
    // Two layers because a single view can't do both: `overflow: 'hidden'`
    // (needed to clip the cover image to the rounded corners) sets
    // masksToBounds on iOS, which silently clips the shadow away — that's why
    // the today glow never rendered. The OUTER view carries the teal glow
    // (iOS shadow / Android colored elevation on API 28+), the INNER view
    // keeps the border and clips its content.
    <View
      style={{
        backgroundColor: '#FEFFF8',
        borderRadius: 12,
        marginHorizontal: 20,
        marginBottom: 20,
        shadowColor: '#0FA6A6',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.6,
        shadowRadius: 10,
        elevation: 10,
      }}
    >
    <View
      style={{
        backgroundColor: '#FEFFF8',
        borderRadius: 12,
        overflow: 'hidden',
        borderWidth: 2.5,
        borderColor: '#0FA6A6',
      }}
    >
      {/* Club Row */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 12,
          paddingTop: 10,
          paddingBottom: 8,
          gap: 8,
        }}
      >
        <TouchableOpacity onPress={handlePressClub} activeOpacity={0.7}>
          <Avatar uri={event.club.logo_url} size={32} username={event.club.name} />
        </TouchableOpacity>
        <TouchableOpacity onPress={handlePressClub} style={{ flex: 1 }} activeOpacity={0.7}>
          <Text
            style={{
              fontSize: 15,
              fontWeight: '600',
              color: '#5F5D5D',
              fontFamily: 'Inter_600SemiBold',
            }}
            numberOfLines={1}
          >
            {event.club.name}
          </Text>
        </TouchableOpacity>
        <Pill
          variant={event.user_has_joined_club ? 'joined' : 'join'}
          onPress={() =>
            event.user_has_joined_club
              ? onRequestLeaveClub?.(event.club_id, event.club.name)
              : onJoinClub?.(event.club_id)
          }
        />
      </View>

      {/* Event Image */}
      <Pressable onPress={handlePressEvent}>
        <View style={{ position: 'relative' }}>
          {event.cover_image_url && !imageError ? (
            <Image
              source={{ uri: getResizedImageUrl(event.cover_image_url, SCREEN_WIDTH * 2, (SCREEN_WIDTH * 2 * 2) / 3) ?? undefined }}
              style={{ width: '100%', aspectRatio: 3 / 2 }}
              resizeMode="cover"
              fadeDuration={0}
              onError={(e) => {
                console.warn('[EventCardToday] Image failed to load:', event.cover_image_url, e.nativeEvent.error);
                setImageError(true);
              }}
            />
          ) : (
            <View
              style={{
                width: '100%',
                aspectRatio: 3 / 2,
                backgroundColor: '#E5E7EB',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name="image-outline" size={40} color="#9CA3AF" />
            </View>
          )}
          {/* Bookmark */}
          <TouchableOpacity
            onPress={() => onToggleSave(event.id)}
            activeOpacity={0.8}
            style={{
              position: 'absolute',
              top: 10,
              right: 10,
              backgroundColor: 'rgba(254,255,248,0.92)',
              borderRadius: 999,
              padding: 4,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 1 },
              shadowOpacity: 0.15,
              shadowRadius: 4,
            }}
          >
            <Ionicons
              name={event.is_saved ? 'bookmark' : 'bookmark-outline'}
              size={18}
              color={event.is_saved ? '#0FA6A6' : '#374151'}
            />
          </TouchableOpacity>
        </View>
      </Pressable>

      {/* Event Info */}
      <View style={{ paddingHorizontal: 12, paddingTop: 10, paddingBottom: 12 }}>
        {/* Title */}
        <TouchableOpacity onPress={handlePressEvent} activeOpacity={0.8}>
          <Text
            style={{
              fontSize: 18,
              fontWeight: '600',
              color: '#000000',
              fontFamily: 'Inter_600SemiBold',
              marginBottom: 4,
            }}
            numberOfLines={2}
          >
            {event.title}
          </Text>
        </TouchableOpacity>

        {/* Description */}
        {event.description ? (
          <Text
            style={{
              fontSize: 12,
              color: '#5F5D5D',
              fontFamily: 'Inter_400Regular',
              marginBottom: 8,
            }}
            numberOfLines={1}
          >
            {event.description}
          </Text>
        ) : null}

        {/* "Today!" date row — in red */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginBottom: 6 }}>
          <Ionicons name="calendar-outline" size={17} color="#F02719" style={{ marginTop: 1 }} />
          <Text
            style={{
              fontSize: 12,
              fontWeight: '700',
              color: '#F02719',
              fontFamily: 'Inter_700Bold',
              lineHeight: 18,
            }}
          >
            {'Today!\n'}{formatTime(event.start_time)} - {formatTime(event.end_time)}
          </Text>
        </View>

        {/* Location in red */}
        {(event.location || event.building) ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 }}>
            <Ionicons name="location-outline" size={16} color="#F02719" />
            <Text
              style={{
                fontSize: 12,
                color: '#F02719',
                fontFamily: 'Inter_500Medium',
              }}
              numberOfLines={1}
            >
              {event.location ?? `Building ${event.building}, Room ${event.room}`}
            </Text>
          </View>
        ) : null}

        {/* Attendees Row */}
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {event.attendee_preview.length > 0 ? (
            <TouchableOpacity onPress={handlePressAttendees} activeOpacity={0.7} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <AvatarStack avatars={event.attendee_preview} size={26} overlap={8} />
              <Text style={{ fontSize: 12, color: '#000000', fontFamily: 'Inter_400Regular' }}>
                {event.attendee_count} going
              </Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={handlePressAttendees} activeOpacity={0.7}>
              <Text style={{ fontSize: 12, color: '#000000', fontFamily: 'Inter_400Regular' }}>
                {event.attendee_count} going
              </Text>
            </TouchableOpacity>
          )}
          <View style={{ flex: 1 }} />
          <TouchableOpacity
            onPress={() => onRsvp(event.id)}
            activeOpacity={0.8}
            style={{
              backgroundColor:
                event.user_rsvp_status === 'going'
                  ? '#0FA6A6'
                  : event.user_rsvp_status === 'cant'
                    ? 'rgba(240,39,25,0.1)'
                    : '#0FA6A6',
              borderWidth: event.user_rsvp_status === 'cant' ? 1.5 : 0,
              borderColor: event.user_rsvp_status === 'cant' ? '#F02719' : 'transparent',
              borderRadius: 15,
              paddingHorizontal: 20,
              paddingVertical: 7,
            }}
          >
            <Text
              style={{
                color:
                  event.user_rsvp_status === 'going'
                    ? '#FFFFFF'
                    : event.user_rsvp_status === 'cant'
                      ? '#F02719'
                      : '#FFFFFF',
                fontSize: 12,
                fontWeight: '600',
                fontFamily: 'Inter_600SemiBold',
              }}
            >
              {event.user_rsvp_status === 'going'
                ? 'Going ✓'
                : event.user_rsvp_status === 'cant'
                  ? "Can't"
                  : 'RSVP'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
    </View>
  );
});
