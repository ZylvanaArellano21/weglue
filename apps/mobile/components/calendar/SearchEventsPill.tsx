import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import {
  calendarColors,
  calendarSizes,
  calendarCardShadow,
  calendarTypography,
} from './calendarTheme';

export interface SearchEventsPillProps {
  onPress: () => void;
}

export function SearchEventsPill({ onPress }: SearchEventsPillProps) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={styles.pill}
      accessibilityRole="button"
      accessibilityLabel="Search for upcoming events"
    >
      <Text style={calendarTypography.searchPill}>Search for upcoming events</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'center',
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: calendarSizes.searchPillRadius,
    backgroundColor: calendarColors.white,
    ...calendarCardShadow,
  },
});
