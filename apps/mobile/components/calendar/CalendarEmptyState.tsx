import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import {
  calendarColors,
  calendarSizes,
  calendarCardShadow,
  calendarFonts,
  calendarTypography,
} from './calendarTheme';

/**
 * Onboarding for a calendar with nothing in it yet.
 *
 * A new user has no way to know the calendar is filled by RSVP/Going rather
 * than by adding events by hand, so the empty calendar says so outright and
 * points at event discovery. It disappears the moment the user has events —
 * this only ever renders on the empty branch.
 */
export function CalendarEmptyState({ onFindEvents }: { onFindEvents: () => void }) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.heading}>Build your calendar</Text>
      <Text style={styles.body}>
        RSVP or tap Going on events you want to attend. They’ll appear here automatically.
      </Text>

      <TouchableOpacity
        onPress={onFindEvents}
        activeOpacity={0.8}
        style={styles.pill}
        accessibilityRole="button"
        accessibilityLabel="Find upcoming events"
      >
        <Text style={calendarTypography.searchPill}>Find upcoming events</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    paddingTop: 32,
    paddingHorizontal: 32,
  },
  heading: {
    fontFamily: calendarFonts.semiBold,
    fontSize: 18,
    color: calendarColors.textDark,
    textAlign: 'center',
  },
  body: {
    fontFamily: calendarFonts.regular,
    fontSize: 14,
    lineHeight: 20,
    color: calendarColors.metaLight,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 20,
  },
  pill: {
    alignSelf: 'center',
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: calendarSizes.searchPillRadius,
    backgroundColor: calendarColors.white,
    ...calendarCardShadow,
  },
});
