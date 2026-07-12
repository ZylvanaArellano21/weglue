import { useRef } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { CategoryPill } from './CategoryPill';
import { searchSizes } from './searchTheme';

interface Props {
  categories: string[];
  selected: string | null;
  onSelect: (cat: string | null) => void;
}

export function CategoryPillRow({ categories, selected, onSelect }: Props) {
  // Preserve horizontal scroll offset across re-renders (e.g. after selecting a
  // category or returning from a pushed screen) so the row never snaps back to
  // the start — the ScrollView keeps its own offset as long as it isn't
  // remounted, and this ref lets callers restore it if needed.
  const scrollRef = useRef<ScrollView>(null);

  const pills: { key: string; label: string; value: string | null }[] = [
    { key: '__all__', label: 'All categories', value: null },
    ...categories.map((cat) => ({ key: cat, label: cat, value: cat })),
  ];

  return (
    <ScrollView
      ref={scrollRef}
      horizontal
      showsHorizontalScrollIndicator={false}
      // Bleed to the screen edges (cancel the parent's 16pt content padding)
      // so pills can scroll off the right edge like the design, while keeping
      // 16pt leading/trailing padding on the content itself.
      style={styles.bleed}
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
  bleed: {
    marginHorizontal: -searchSizes.screenPaddingH,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: searchSizes.categoryPillGap,
    minHeight: searchSizes.categoryPillHeight,
    // Room for the pill shadow (top/bottom) and 16pt leading/trailing inset.
    paddingVertical: 6,
    paddingHorizontal: searchSizes.screenPaddingH,
  },
});
