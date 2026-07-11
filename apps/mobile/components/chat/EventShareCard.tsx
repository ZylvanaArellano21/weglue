import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { getEventDetail } from '../../services/eventService';
import { chatColors, chatFonts, chatShadow } from './chatTheme';

interface Props {
  /** null = the event was deleted (messages.shared_event_id is SET NULL);
   * the message survives and renders the unavailable card. */
  eventId: string | null;
  viewerUserId: string;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatTime(timeStr: string): string {
  const [h, m] = timeStr.split(':').map(Number);
  const ampm = h >= 12 ? 'pm' : 'am';
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${ampm}`;
}

export function EventShareCard({ eventId, viewerUserId }: Props) {
  const router = useRouter();
  const { data: event, isLoading } = useQuery({
    queryKey: ['eventDetail', eventId, viewerUserId],
    queryFn: () => getEventDetail(eventId!, viewerUserId),
    enabled: !!eventId,
    staleTime: 60 * 1000,
  });

  if (isLoading && eventId) {
    return (
      <View style={styles.card}>
        <View style={styles.loadingRow}>
          <Ionicons name="calendar-outline" size={18} color={chatColors.teal} />
          <Text style={styles.loadingText}>Loading event…</Text>
        </View>
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
      <View style={styles.content}>
        <View style={styles.badgeRow}>
          <Ionicons name="calendar" size={12} color={chatColors.teal} />
          <Text style={styles.badgeText}>EVENT</Text>
        </View>
        {event.cover_image_url ? (
          <Image source={{ uri: event.cover_image_url }} style={styles.heroImage} resizeMode="cover" />
        ) : (
          <View style={[styles.heroImage, styles.imagePlaceholder]}>
            <Ionicons name="image-outline" size={28} color={chatColors.textMuted} />
          </View>
        )}
        <Text style={styles.title} numberOfLines={2}>
          {event.emoji ? `${event.emoji} ` : ''}{event.title}
        </Text>
        <View style={styles.metaRow}>
          <Ionicons name="time-outline" size={12} color={chatColors.textMuted} />
          <Text style={styles.meta} numberOfLines={1}>
            {formatDate(event.event_date)} · {formatTime(event.start_time)}
          </Text>
        </View>
        <View style={styles.metaRow}>
          <Ionicons name="people-outline" size={12} color={chatColors.teal} />
          <Text style={styles.clubMeta} numberOfLines={1}>
            {event.club.name}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 260,
    backgroundColor: chatColors.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: chatColors.border,
    overflow: 'hidden',
    flexDirection: 'row',
    ...chatShadow,
  },
  content: {
    flex: 1,
    padding: 10,
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
  heroImage: {
    width: '100%',
    height: 88,
    borderRadius: 10,
    marginBottom: 8,
  },
  imagePlaceholder: {
    backgroundColor: chatColors.tagBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontFamily: chatFonts.semiBold,
    fontSize: 14,
    color: chatColors.text,
    marginBottom: 6,
    lineHeight: 18,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 2,
  },
  meta: {
    fontFamily: chatFonts.regular,
    fontSize: 11,
    color: chatColors.textMuted,
    flex: 1,
  },
  clubMeta: {
    fontFamily: chatFonts.medium,
    fontSize: 11,
    color: chatColors.teal,
    flex: 1,
  },
  loadingRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 14,
  },
  loadingText: {
    fontFamily: chatFonts.regular,
    fontSize: 12,
    color: chatColors.textMuted,
  },
  unavailableRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 14,
  },
  unavailableText: {
    fontFamily: chatFonts.regular,
    fontSize: 12,
    color: chatColors.textMuted,
    flexShrink: 1,
  },
});
