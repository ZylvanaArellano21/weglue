import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  calendarColors,
  calendarSizes,
  calendarCardShadow,
  calendarTypography,
} from './calendarTheme';

/** Google-branded "Link to my calendar" button — visual only, no onPress handler. */
export function LinkCalendarButton() {
  return (
    <TouchableOpacity
      activeOpacity={0.8}
      style={styles.button}
      accessibilityRole="button"
      accessibilityLabel="Link to my calendar"
      // Intentionally inert — Google Calendar OAuth scoped separately
    >
      <View style={styles.iconWrap}>
        <Ionicons name="logo-google" size={18} color="#4285F4" />
      </View>
      <Text style={calendarTypography.linkBtn}>Link to my calendar</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    gap: 10,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: calendarSizes.linkBtnRadius,
    backgroundColor: calendarColors.white,
    borderWidth: 1,
    borderColor: calendarColors.linkBtnBorder,
    marginTop: 8,
    marginBottom: 24,
    minWidth: 260,
    ...calendarCardShadow,
  },
  iconWrap: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
