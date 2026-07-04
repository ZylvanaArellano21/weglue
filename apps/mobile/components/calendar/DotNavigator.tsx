import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { calendarColors, calendarSizes } from './calendarTheme';

export interface DotNavigatorProps {
  currentIndex: number;
  totalEvents: number;
  onDotPress: (index: number) => void;
}

/** Stories-style dot navigator for multi-event days. Returns null when totalEvents < 2. */
export function DotNavigator({ currentIndex, totalEvents, onDotPress }: DotNavigatorProps) {
  if (totalEvents < 2) return null;

  return (
    <View style={styles.container} accessibilityRole="tablist">
      {Array.from({ length: totalEvents }, (_, index) => {
        const isActive = index === currentIndex;
        return (
          <TouchableOpacity
            key={index}
            onPress={() => onDotPress(index)}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={`Event ${index + 1} of ${totalEvents}`}
            style={[
              styles.dot,
              isActive ? styles.dotFilled : styles.dotHollow,
            ]}
          />
        );
      })}
    </View>
  );
}

const dotSize = calendarSizes.dotSize;

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: calendarSizes.dotGap,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  dot: {
    width: dotSize,
    height: dotSize,
    borderRadius: dotSize / 2,
  },
  dotFilled: {
    backgroundColor: calendarColors.teal,
  },
  dotHollow: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: calendarColors.teal,
  },
});
