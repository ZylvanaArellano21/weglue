import { View, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { chatColors, chatFonts, chatShadow, chatSizes, chatTypography } from './chatTheme';

interface Props {
  value: string;
  onChangeText: (text: string) => void;
  onClear?: () => void;
  placeholder?: string;
}

export function ChatSearchBar({
  value,
  onChangeText,
  onClear,
  placeholder = 'Search',
}: Props) {
  return (
    <View style={styles.wrap}>
      <Ionicons name="search" size={16} color={chatColors.text} style={styles.searchIcon} />
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={chatColors.text}
        returnKeyType="search"
        clearButtonMode="never"
      />
      {value.length > 0 && onClear && (
        <TouchableOpacity onPress={onClear} hitSlop={8} accessibilityLabel="Clear search">
          <Ionicons name="close-circle" size={18} color={chatColors.textMuted} />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    height: chatSizes.searchBarHeight,
    marginHorizontal: 23,
    paddingHorizontal: 14,
    backgroundColor: chatColors.bg,
    borderRadius: chatSizes.searchBarRadius,
    borderWidth: 1,
    borderColor: chatColors.borderSearch,
    ...chatShadow,
  },
  searchIcon: {
    marginRight: 8,
  },
  input: {
    flex: 1,
    fontFamily: chatFonts.regular,
    fontSize: 12,
    fontStyle: 'italic',
    letterSpacing: 0.38,
    color: chatColors.text,
    paddingVertical: 0,
  },
});
