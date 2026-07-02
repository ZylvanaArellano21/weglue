import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { chatColors, chatShadow, chatSizes, chatTypography } from './chatTheme';

export type ChatFilter = 'single' | 'group';

interface Props {
  value: ChatFilter;
  onChange: (value: ChatFilter) => void;
}

export function FilterPills({ value, onChange }: Props) {
  return (
    <View style={styles.row}>
      {(['single', 'group'] as ChatFilter[]).map((filter) => {
        const active = value === filter;
        return (
          <TouchableOpacity
            key={filter}
            style={[styles.pill, active ? styles.pillActive : styles.pillInactive]}
            onPress={() => onChange(filter)}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
          >
            <Text
              style={[
                chatTypography.filterPill,
                { color: active ? chatColors.cream : chatColors.teal },
              ]}
            >
              {filter === 'single' ? 'Single' : 'Group'}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginLeft: 23,
  },
  pill: {
    width: chatSizes.filterPillWidth,
    height: chatSizes.filterPillHeight,
    borderRadius: chatSizes.filterPillRadius,
    alignItems: 'center',
    justifyContent: 'center',
    ...chatShadow,
  },
  pillActive: {
    backgroundColor: chatColors.teal,
  },
  pillInactive: {
    backgroundColor: chatColors.bg,
  },
});
