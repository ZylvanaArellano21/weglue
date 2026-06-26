import { View, Text, Image, TouchableOpacity, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from '../shared/Avatar';
import { AvatarStack } from '../shared/AvatarStack';
import { Pill } from '../shared/Pill';
import type { HomeFeedEvent } from '../../services/eventService';

interface EventCardTodayProps {
  event: HomeFeedEvent;
  onRsvp: (eventId: string) => void;
  onToggleSave: (eventId: string) => void;
  onJoinClub?: (clubId: string) => void;
}

function formatTime(timeStr: string): string {
  const [h, m] = timeStr.split(':').map(Number);
  const ampm = h >= 12 ? 'pm' : 'am';
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${ampm}`;
}

export function EventCardToday({ event, onRsvp, onToggleSave, onJoinClub }: EventCardTodayProps) {
  const router = useRouter();

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
    <View
      style={{
        backgroundColor: '#fff',
        borderRadius: 16,
        marginHorizontal: 16,
        marginBottom: 16,
        overflow: 'hidden',
        // Teal glow border
        borderWidth: 2,
        borderColor: '#0FA6A6',
        shadowColor: '#0FA6A6',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.45,
        shadowRadius: 12,
        elevation: 8,
      }}
    >
      {/* Club Row */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 12,
          paddingVertical: 10,
          gap: 8,
        }}
      >
        <TouchableOpacity onPress={handlePressClub} activeOpacity={0.7}>
          <Avatar uri={event.club.logo_url} size={32} username={event.club.name} />
        </TouchableOpacity>
        <TouchableOpacity onPress={handlePressClub} style={{ flex: 1 }} activeOpacity={0.7}>
          <Text
            style={{
              fontSize: 14,
              fontWeight: '600',
              color: '#111827',
              fontFamily: 'Inter_600SemiBold',
            }}
            numberOfLines={1}
          >
            {event.club.name}
          </Text>
        </TouchableOpacity>
        <Pill
          variant={event.user_has_joined_club ? 'joined' : 'join'}
          onPress={() => !event.user_has_joined_club && onJoinClub?.(event.club_id)}
        />
      </View>

      {/* Event Image */}
      <Pressable onPress={handlePressEvent}>
        <View style={{ position: 'relative' }}>
          {event.cover_image_url ? (
            <Image
              source={{ uri: event.cover_image_url }}
              style={{ width: '100%', height: 180 }}
              resizeMode="cover"
            />
          ) : (
            <View
              style={{
                width: '100%',
                height: 180,
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
              backgroundColor: 'rgba(255,255,255,0.9)',
              borderRadius: 8,
              padding: 6,
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
              fontSize: 16,
              fontWeight: '700',
              color: '#111827',
              fontFamily: 'Zain_700Bold',
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
              fontSize: 13,
              color: '#6B7280',
              fontFamily: 'Inter_400Regular',
              marginBottom: 8,
            }}
            numberOfLines={1}
          >
            {event.description}
          </Text>
        ) : null}

        {/* "Today!" date row — in red */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <Ionicons name="calendar-outline" size={14} color="#F02719" />
          <Text
            style={{
              fontSize: 13,
              fontWeight: '700',
              color: '#F02719',
              fontFamily: 'Inter_700Bold',
            }}
          >
            Today!
          </Text>
        </View>
        {/* Time in red */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6, paddingLeft: 20 }}>
          <Text
            style={{
              fontSize: 13,
              color: '#F02719',
              fontFamily: 'Inter_400Regular',
            }}
          >
            {formatTime(event.start_time)} - {formatTime(event.end_time)}
          </Text>
        </View>

        {/* Location in red */}
        {event.location ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 }}>
            <Ionicons name="location-outline" size={14} color="#F02719" />
            <Text
              style={{
                fontSize: 13,
                color: '#F02719',
                fontFamily: 'Inter_400Regular',
              }}
              numberOfLines={1}
            >
              {event.location}
            </Text>
          </View>
        ) : null}

        {/* Attendees Row */}
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {event.attendee_preview.length > 0 ? (
            <TouchableOpacity onPress={handlePressAttendees} activeOpacity={0.7} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <AvatarStack avatars={event.attendee_preview} size={26} overlap={8} />
              <Text style={{ fontSize: 13, color: '#374151', fontFamily: 'Inter_400Regular' }}>
                {event.attendee_count} going
              </Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={handlePressAttendees} activeOpacity={0.7}>
              <Text style={{ fontSize: 13, color: '#374151', fontFamily: 'Inter_400Regular' }}>
                {event.attendee_count} going
              </Text>
            </TouchableOpacity>
          )}
          <View style={{ flex: 1 }} />
          <TouchableOpacity
            onPress={() => onRsvp(event.id)}
            activeOpacity={0.8}
            style={{
              backgroundColor: '#0FA6A6',
              borderRadius: 20,
              paddingHorizontal: 18,
              paddingVertical: 8,
            }}
          >
            <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600', fontFamily: 'Inter_600SemiBold' }}>
              RSVP
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}
