import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { calendarColors, calendarFonts } from './calendarTheme';

/**
 * Shown when a user taps a calendar date that has no events on it.
 *
 * Deliberately inline and quiet — no popup, no tutorial. It answers the only
 * question an empty day raises ("why is nothing here / how does anything get
 * here?") and offers a way to go find events.
 */
export function CalendarDayEmptyNotice({
  label,
  onFindEvents,
}: {
  /** Human-readable date already formatted by the caller, e.g. "Friday, August 14". */
  label: string;
  onFindEvents: () => void;
}) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.date}>{label}</Text>
      <Text style={styles.title}>No events on this day.</Text>
      <Text style={styles.body}>
        RSVP or tap Going on an event to add it to your calendar.
      </Text>

      <TouchableOpacity
        onPress={onFindEvents}
        activeOpacity={0.7}
        style={styles.action}
        accessibilityRole="button"
        accessibilityLabel="Find events"
      >
        <Text style={styles.actionText}>Find events</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 4,
  },
  date: {
    fontFamily: calendarFonts.semiBold,
    fontSize: 14,
    color: calendarColors.textDark,
    marginBottom: 6,
  },
  title: {
    fontFamily: calendarFonts.regular,
    fontSize: 14,
    color: calendarColors.metaLight,
  },
  body: {
    fontFamily: calendarFonts.regular,
    fontSize: 13,
    lineHeight: 18,
    color: calendarColors.metaLight,
    marginTop: 4,
  },
  action: {
    alignSelf: 'flex-start',
    marginTop: 10,
    paddingVertical: 4,
  },
  actionText: {
    fontFamily: calendarFonts.semiBold,
    fontSize: 14,
    color: calendarColors.teal,
  },
});
