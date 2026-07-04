import { View, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { searchColors, searchShadow, searchSizes, searchTypography } from './searchTheme';

interface Props {
  value: string;
  onChange: (v: string) => void;
  onClear: () => void;
}

export function SearchBar({ value, onChange, onClear }: Props) {
  return (
    <View style={styles.wrap}>
      <Ionicons name="search" size={16} color={searchColors.text} style={styles.searchIcon} />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder="Search people & clubs"
        placeholderTextColor={searchColors.text}
        style={styles.input}
        returnKeyType="search"
        autoCorrect={false}
        autoCapitalize="none"
        clearButtonMode="never"
      />
      {value.length > 0 && (
        <TouchableOpacity
          onPress={onClear}
          activeOpacity={0.7}
          hitSlop={{ top: 8, left: 8, right: 8, bottom: 8 }}
          accessibilityLabel="Clear search"
        >
          <Ionicons name="close-circle" size={15} color={searchColors.text} />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    height: searchSizes.searchBarHeight,
    paddingHorizontal: 14,
    backgroundColor: searchColors.cream,
    borderRadius: searchSizes.searchBarRadius,
    borderWidth: 1,
    borderColor: searchColors.borderSearch,
    ...searchShadow,
  },
  searchIcon: {
    marginRight: 8,
  },
  input: {
    flex: 1,
    paddingVertical: 0,
    ...searchTypography.searchPlaceholder,
  },
});
