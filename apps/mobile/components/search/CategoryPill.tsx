import { Pressable, Text, StyleSheet } from 'react-native';
import { searchColors, searchTypography } from './searchTheme';

// NOTE: box styles are applied inline (not via StyleSheet.create). The pill's
// height/background/border would not paint when supplied through a
// function-form `style={({pressed}) => [styles.pill, …]}` on this Pressable —
// only the text rendered — which is what made every category pill invisible.
// Inline object styles render reliably, so they are used here deliberately.

interface Props {
  label: string;
  active: boolean;
  onPress: () => void;
}

export function CategoryPill({ label, active, onPress }: Props) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        height: 32,
        paddingHorizontal: 16,
        borderRadius: 40,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: active ? searchColors.teal : '#FFFFFF',
        borderWidth: active ? 0 : 1,
        borderColor: 'rgba(15,166,166,0.25)',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.16,
        shadowRadius: 4,
        elevation: 3,
      }}
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
  labelActive: {
    color: searchColors.white,
  },
  labelInactive: {
    color: searchColors.teal,
  },
});
