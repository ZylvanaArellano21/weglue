import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { profileColors, profileFonts } from './profileTheme';

interface ProfileScreenHeaderProps {
  title: string;
  onBack: () => void;
  rightAction?: React.ReactNode;
}

export function ProfileScreenHeader({ title, onBack, rightAction }: ProfileScreenHeaderProps) {
  return (
    <View style={styles.row}>
      <TouchableOpacity
        onPress={onBack}
        activeOpacity={0.7}
        hitSlop={{ top: 10, left: 10, right: 10, bottom: 10 }}
        accessibilityRole="button"
        accessibilityLabel="Go back"
      >
        <Ionicons name="chevron-back" size={26} color={profileColors.textDark} />
      </TouchableOpacity>
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      <View style={styles.right}>{rightAction ?? null}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  title: {
    flex: 1,
    fontSize: 18,
    fontFamily: profileFonts.displayBold,
    color: profileColors.textDark,
    marginLeft: 8,
  },
  right: {
    minWidth: 32,
    alignItems: 'flex-end',
  },
});
