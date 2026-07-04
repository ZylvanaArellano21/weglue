import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { searchColors, searchShadow, searchSizes, searchTypography } from './searchTheme';

interface Props {
  label: string;
  active: boolean;
  onPress: () => void;
}

export function CategoryPill({ label, active, onPress }: Props) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={[styles.pill, active ? styles.pillActive : styles.pillInactive]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      <Text
        style={[
          searchTypography.categoryPill,
          { color: active ? searchColors.cream : searchColors.teal },
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  pill: {
    height: searchSizes.categoryPillHeight,
    paddingHorizontal: 12,
    borderRadius: searchSizes.categoryPillRadius,
    alignItems: 'center',
    justifyContent: 'center',
    ...searchShadow,
  },
  pillActive: {
    backgroundColor: searchColors.teal,
  },
  pillInactive: {
    backgroundColor: searchColors.cream,
  },
});
