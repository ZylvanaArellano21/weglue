import { View, Text, Image, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { getEventDetail } from '../../services/eventService';
import { chatColors, chatFonts, chatShadow } from './chatTheme';

interface Props {
  eventId: string;
  viewerUserId: string;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

// Renders inside MessageBubble's cardSlot, same extension point as
// PollMessage. Fetches through the same getEventDetail() used by the Event
// Details screens, so it naturally respects RLS — a members-only event
// shared with a non-member renders the "no longer available" fallback below.
export function EventShareCard({ eventId, viewerUserId }: Props) {
  const router = useRouter();
  const { data: event, isLoading } = useQuery({
    queryKey: ['eventDetail', eventId, viewerUserId],
    queryFn: () => getEventDetail(eventId, viewerUserId),
    staleTime: 60 * 1000,
  });

  if (isLoading) {
    return (
      <View style={styles.card}>
        <ActivityIndicator size="small" color={chatColors.teal} />
      </View>
    );
  }

  if (!event) {
    return (
      <View style={styles.card}>
        <View style={styles.unavailableRow}>
          <Ionicons name="calendar-outline" size={18} color={chatColors.textMuted} />
          <Text style={styles.unavailableText}>This event is no longer available.</Text>
        </View>
      </View>
    );
  }

  return (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.85}
      onPress={() => router.push({ pathname: '/home/event-detail', params: { eventId: event.id } })}
    >
      <View style={styles.badgeRow}>
        <Ionicons name="calendar" size={12} color={chatColors.teal} />
        <Text style={styles.badgeText}>EVENT</Text>
      </View>
      <View style={styles.body}>
        {event.cover_image_url ? (
          <Image source={{ uri: event.cover_image_url }} style={styles.image} resizeMode="cover" />
        ) : (
          <View style={[styles.image, styles.imagePlaceholder]}>
            <Ionicons name="image-outline" size={22} color={chatColors.textMuted} />
          </View>
        )}
        <View style={styles.info}>
          <Text style={styles.title} numberOfLines={2}>
            {event.emoji ? `${event.emoji} ` : ''}{event.title}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {formatDate(event.event_date)}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {event.club.name}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 240,
    backgroundColor: chatColors.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: chatColors.border,
    padding: 10,
    ...chatShadow,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 8,
  },
  badgeText: {
    fontFamily: chatFonts.bold,
    fontSize: 10,
    letterSpacing: 0.5,
    color: chatColors.teal,
  },
  body: {
    flexDirection: 'row',
    gap: 10,
  },
  image: {
    width: 56,
    height: 56,
    borderRadius: 10,
  },
  imagePlaceholder: {
    backgroundColor: chatColors.tagBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: {
    flex: 1,
    justifyContent: 'center',
  },
  title: {
    fontFamily: chatFonts.semiBold,
    fontSize: 13,
    color: chatColors.text,
    marginBottom: 3,
  },
  meta: {
    fontFamily: chatFonts.regular,
    fontSize: 11,
    color: chatColors.textMuted,
  },
  unavailableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  unavailableText: {
    fontFamily: chatFonts.regular,
    fontSize: 12,
    color: chatColors.textMuted,
    flexShrink: 1,
  },
});
