import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { CalendarEvent } from '../../services/calendarService';
import { EventAudienceBadge } from '../events/EventAudienceBadge';
import {
  calendarColors,
  calendarSizes,
  calendarCardShadow,
  calendarTypography,
} from './calendarTheme';

function formatTime(timeStr: string): string {
  const [h, m] = timeStr.split(':').map(Number);
  const ampm = h >= 12 ? 'pm' : 'am';
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${ampm}`;
}

function formatCardDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });
}

export interface CalendarEventCardProps {
  event: CalendarEvent;
  isToday: boolean;
  onPress: () => void;
}

export function CalendarEventCard({ event, isToday, onPress }: CalendarEventCardProps) {
  const metaStyle = isToday
    ? calendarTypography.eventMetaToday
    : calendarTypography.eventMetaDefault;

  const locationText = event.location
    ?? `${event.building ?? ''} ${event.room ?? ''}`.trim();

  return (
    <View style={styles.cardOuter}>
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={styles.card}
      accessibilityRole="button"
      accessibilityLabel={`${event.title}, ${formatCardDate(event.event_date)}`}
    >
      <View style={styles.redStrip} />
      <View style={styles.cardBody}>
        <Text style={calendarTypography.eventTitle} numberOfLines={2}>
          {event.emoji ? `${event.emoji} ` : ''}{event.title}
        </Text>
        <Text style={calendarTypography.eventClub} numberOfLines={1}>
          {event.club.name}
        </Text>
        <EventAudienceBadge visibility={event.visibility} />
        <Text style={metaStyle} numberOfLines={1}>
          {formatCardDate(event.event_date)}
        </Text>
        <Text style={metaStyle} numberOfLines={1}>
          {formatTime(event.start_time)} - {formatTime(event.end_time)}
        </Text>
        {locationText ? (
          <Text style={metaStyle} numberOfLines={1}>
            {locationText}
          </Text>
        ) : null}
      </View>
      <Ionicons
        name="chevron-forward"
        size={18}
        color={calendarColors.metaLight}
        style={styles.chevron}
      />
    </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  // Depth on the outer view (no clipping); inner card clips the red strip
  // to the rounded corners.
  cardOuter: {
    marginHorizontal: calendarSizes.screenPaddingH,
    marginBottom: 10,
    borderRadius: calendarSizes.eventCardRadius,
    ...calendarCardShadow,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: calendarColors.white,
    borderRadius: calendarSizes.eventCardRadius,
    overflow: 'hidden',
  },
  redStrip: {
    width: calendarSizes.eventCardBorderWidth,
    alignSelf: 'stretch',
    backgroundColor: calendarColors.alertRed,
  },
  cardBody: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 12,
    gap: 2,
  },
  chevron: {
    marginRight: 12,
  },
});
