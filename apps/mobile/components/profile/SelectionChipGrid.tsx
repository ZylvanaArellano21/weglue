import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { profileColors, profileFonts } from './profileTheme';

interface SelectionChipGridProps {
  items: readonly string[];
  selected: string[];
  onToggle: (item: string) => void;
}

export function SelectionChipGrid({ items, selected, onToggle }: SelectionChipGridProps) {
  return (
    <View style={styles.chips}>
      {items.map((item) => {
        const isSelected = selected.includes(item);
        return (
          <TouchableOpacity
            key={item}
            onPress={() => onToggle(item)}
            activeOpacity={0.75}
            style={[styles.chip, isSelected ? styles.chipSelected : styles.chipDefault]}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected }}
          >
            <Text style={[styles.chipText, isSelected ? styles.chipTextSelected : styles.chipTextDefault]}>
              {item}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  chip: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 40,
    borderWidth: 1,
  },
  chipDefault: {
    backgroundColor: profileColors.chipBg,
    borderColor: profileColors.chipBorder,
  },
  chipSelected: {
    backgroundColor: profileColors.teal,
    borderColor: profileColors.teal,
  },
  chipText: {
    fontSize: 14,
    fontFamily: profileFonts.medium,
  },
  chipTextDefault: {
    color: profileColors.text,
  },
  chipTextSelected: {
    color: profileColors.bg,
  },
});
