import { Pressable, Text, StyleSheet } from 'react-native';
import { searchColors, searchShadow, searchSizes, searchTypography } from './searchTheme';

interface Props {
  label: string;
  active: boolean;
  onPress: () => void;
}

export function CategoryPill({ label, active, onPress }: Props) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.pill,
        active ? styles.pillActive : styles.pillInactive,
        pressed && styles.pillPressed,
      ]}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
    >
      <Text
        style={[
          searchTypography.categoryPill,
          active ? styles.labelActive : styles.labelInactive,
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    height: searchSizes.categoryPillHeight,
    paddingHorizontal: searchSizes.categoryPillPaddingH,
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
  pillPressed: {
    opacity: 0.85,
  },
  labelActive: {
    color: searchColors.cream,
  },
  labelInactive: {
    color: searchColors.teal,
  },
});
