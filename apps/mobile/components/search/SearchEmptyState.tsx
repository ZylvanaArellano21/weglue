import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { searchColors, searchTypography } from './searchTheme';

interface Props {
  variant: 'no-search-results' | 'no-clubs-in-category' | 'no-clubs';
  query?: string;
  category?: string | null;
}

export function SearchEmptyState({ variant, query, category }: Props) {
  if (variant === 'no-search-results') {
    return (
      <View style={styles.wrap}>
        <Ionicons name="search-outline" size={40} color={searchColors.meta} style={styles.icon} />
        <Text style={styles.title}>No results found</Text>
        {query ? (
          <Text style={styles.body}>Nothing matched "{query}"</Text>
        ) : null}
      </View>
    );
  }

  if (variant === 'no-clubs-in-category') {
    return (
      <View style={styles.wrap}>
        <Ionicons name="grid-outline" size={40} color={searchColors.meta} style={styles.icon} />
        <Text style={styles.title}>No clubs in this category</Text>
        {category ? (
          <Text style={styles.body}>Try another category or browse all clubs.</Text>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Ionicons name="people-outline" size={40} color={searchColors.meta} style={styles.icon} />
      <Text style={styles.title}>No clubs yet</Text>
      <Text style={styles.body}>Check back soon for new clubs to discover.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingVertical: 40,
  },
  icon: {
    marginBottom: 12,
    opacity: 0.6,
  },
  title: {
    ...searchTypography.emptyTitle,
    textAlign: 'center',
    marginBottom: 6,
  },
  body: {
    ...searchTypography.emptyBody,
    textAlign: 'center',
  },
});
