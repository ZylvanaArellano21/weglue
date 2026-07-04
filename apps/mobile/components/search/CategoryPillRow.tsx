import { ScrollView, StyleSheet } from 'react-native';
import { CategoryPill } from './CategoryPill';
import { searchSizes } from './searchTheme';

interface Props {
  categories: string[];
  selected: string | null;
  onSelect: (cat: string | null) => void;
}

export function CategoryPillRow({ categories, selected, onSelect }: Props) {
  const pills: { key: string; label: string; value: string | null }[] = [
    { key: '__all__', label: 'All categories', value: null },
    ...categories.map((cat) => ({ key: cat, label: cat, value: cat })),
  ];

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      keyboardShouldPersistTaps="handled"
      accessibilityRole="tablist"
    >
      {pills.map(({ key, label, value }) => (
        <CategoryPill
          key={key}
          label={label}
          active={selected === value}
          onPress={() => onSelect(value)}
        />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: searchSizes.categoryPillGap,
    minHeight: searchSizes.categoryPillHeight,
    paddingVertical: 2,
  },
});
