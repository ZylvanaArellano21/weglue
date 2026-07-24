/*
 * SearchBottomSheet — Standard search modal for ALL search interactions in We Glue.
 *
 * KEYBOARD HANDLING: Uses native Keyboard event listeners instead of KeyboardAvoidingView.
 * KAV is unreliable inside React Native Modal on both iOS and Android. The sheet
 * animates its marginBottom to stay above the keyboard at all times.
 *
 * USE THIS component for any modal that contains a search input:
 *   Select Club, Add People, Tag a Club, and any future search modal.
 *   Never roll a plain Modal with a TextInput — the keyboard will cover the sheet.
 *
 * SINGLE-SELECT: call onClose() inside your onSelect handler to dismiss the sheet.
 * MULTI-SELECT:  set multiSelect=true; a Done button appears that calls onClose.
 *                onSelect is called per tap without dismissing the sheet.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Keyboard,
  ListRenderItemInfo,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAndroidKeyboardHeight } from '../../lib/useAndroidKeyboardHeight';

export interface SearchBottomSheetProps<T> {
  visible: boolean;
  title: string;
  searchPlaceholder: string;
  data: T[];
  keyExtractor: (item: T) => string;
  onSearch: (query: string) => void;
  onSelect: (item: T) => void;
  onClose: () => void;
  renderItem: (item: T, isSelected: boolean) => React.ReactElement;
  multiSelect?: boolean;
  selectedItems?: T[];
  onDone?: () => void;
  loading?: boolean;
  emptyText?: string;
  /** Optional: provide to render selected chips above the list in multiSelect mode */
  chipLabelExtractor?: (item: T) => string;
}

export function SearchBottomSheet<T>({
  visible,
  title,
  searchPlaceholder,
  data,
  keyExtractor,
  onSearch,
  onSelect,
  onClose,
  renderItem,
  multiSelect = false,
  selectedItems = [],
  onDone,
  loading = false,
  emptyText = 'No results found.',
  chipLabelExtractor,
}: SearchBottomSheetProps<T>) {
  const [query, setQuery] = useState('');
  const [inputFocused, setInputFocused] = useState(false);
  const keyboardOffset = useRef(new Animated.Value(0)).current;
  // Android-only: expand the sheet to fill the space above the keyboard so the
  // results list has room (matches the Instagram search behavior). iOS keeps
  // the content-sized sheet driven purely by the Animated marginBottom below.
  const { height: androidKbHeight, visible: androidKbVisible } = useAndroidKeyboardHeight();
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const androidSheetHeight = windowHeight - androidKbHeight - insets.top - 12;

  // Reset search query each time sheet opens
  useEffect(() => {
    if (visible) {
      setQuery('');
      onSearch('');
    }
  }, [visible]);

  // Animate sheet above keyboard — works in Modal on both iOS and Android
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const onShow = (e: any) => {
      Animated.timing(keyboardOffset, {
        toValue: e.endCoordinates.height,
        duration: Platform.OS === 'ios' ? (e.duration ?? 250) : 0,
        useNativeDriver: false,
      }).start();
    };
    const onHide = (e: any) => {
      Animated.timing(keyboardOffset, {
        toValue: 0,
        duration: Platform.OS === 'ios' ? (e.duration ?? 250) : 0,
        useNativeDriver: false,
      }).start();
    };

    const showSub = Keyboard.addListener(showEvt, onShow);
    const hideSub = Keyboard.addListener(hideEvt, onHide);
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [keyboardOffset]);

  const handleChange = useCallback(
    (text: string) => {
      setQuery(text);
      onSearch(text);
    },
    [onSearch],
  );

  const handleDone = useCallback(() => {
    Keyboard.dismiss();
    if (onDone) onDone();
    else onClose();
  }, [onDone, onClose]);

  const listRender = useCallback(
    ({ item }: ListRenderItemInfo<T>) => {
      const isSelected = selectedItems.some(
        (s) => keyExtractor(s) === keyExtractor(item),
      );
      return (
        <TouchableOpacity onPress={() => onSelect(item)} activeOpacity={0.7}>
          {renderItem(item, isSelected)}
        </TouchableOpacity>
      );
    },
    [selectedItems, keyExtractor, onSelect, renderItem],
  );

  const showChips = multiSelect && selectedItems.length > 0 && !!chipLabelExtractor;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
        {/* Backdrop — tapping closes the sheet */}
        <Pressable
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          onPress={() => {
            Keyboard.dismiss();
            onClose();
          }}
        />

        {/* Sheet rises above keyboard */}
        <Animated.View
          style={{
            marginBottom: keyboardOffset,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: -4 },
            shadowOpacity: 0.12,
            shadowRadius: 16,
            elevation: 24,
          }}
        >
          <SafeAreaView
            style={[
              {
                backgroundColor: '#FEFCF0',
                borderTopLeftRadius: 20,
                borderTopRightRadius: 20,
                maxHeight: '85%',
              },
              // Android: fill the space above the keyboard so results are visible.
              androidKbVisible ? { height: androidSheetHeight, maxHeight: androidSheetHeight } : null,
            ]}
            // Drop the bottom inset while lifted above the Android keyboard.
            edges={androidKbVisible ? [] : ['bottom']}
          >
            {/* Drag handle */}
            <View style={{ alignItems: 'center', paddingTop: 8, marginBottom: 2 }}>
              <View
                style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: '#D1D5DB' }}
              />
            </View>

            {/* Title */}
            <Text
              style={{
                fontSize: 16,
                fontWeight: '700',
                color: '#111827',
                fontFamily: 'Inter_700Bold',
                textAlign: 'center',
                marginTop: 10,
                marginBottom: 14,
                paddingHorizontal: 20,
              }}
            >
              {title}
            </Text>

            {/* Search input */}
            <View style={{ paddingHorizontal: 16, marginBottom: 12 }}>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  backgroundColor: '#fff',
                  borderRadius: 24,
                  borderWidth: 1,
                  borderColor: inputFocused ? '#0FA6A6' : '#E5E7EB',
                  paddingHorizontal: 14,
                  gap: 8,
                }}
              >
                <Ionicons name="search-outline" size={18} color="#9CA3AF" />
                <TextInput
                  value={query}
                  onChangeText={handleChange}
                  placeholder={searchPlaceholder}
                  placeholderTextColor="#9CA3AF"
                  autoFocus
                  onFocus={() => setInputFocused(true)}
                  onBlur={() => setInputFocused(false)}
                  style={{
                    flex: 1,
                    paddingVertical: 12,
                    fontSize: 14,
                    color: '#111827',
                    fontFamily: 'Inter_400Regular',
                  }}
                />
                {query.length > 0 && (
                  <TouchableOpacity
                    onPress={() => handleChange('')}
                    hitSlop={{ top: 6, left: 6, right: 6, bottom: 6 }}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="close-circle" size={18} color="#9CA3AF" />
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {/* Selected chips — horizontal scrollable row, multiSelect only */}
            {showChips && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{
                  paddingHorizontal: 16,
                  paddingBottom: 10,
                  gap: 8,
                  flexDirection: 'row',
                  alignItems: 'center',
                }}
                style={{ flexShrink: 0 }}
              >
                {selectedItems.map((item) => (
                  <View
                    key={keyExtractor(item)}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      backgroundColor: '#0FA6A6',
                      borderRadius: 9999,
                      paddingHorizontal: 10,
                      paddingVertical: 6,
                      gap: 4,
                    }}
                  >
                    <Text
                      style={{
                        color: '#fff',
                        fontSize: 13,
                        fontFamily: 'Inter_500Medium',
                      }}
                      numberOfLines={1}
                    >
                      {chipLabelExtractor!(item)}
                    </Text>
                    <TouchableOpacity
                      onPress={() => onSelect(item)}
                      hitSlop={{ top: 4, left: 4, right: 4, bottom: 4 }}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="close" size={12} color="#fff" />
                    </TouchableOpacity>
                  </View>
                ))}
              </ScrollView>
            )}

            {/* Results list — scrollable, independent of keyboard */}
            {loading ? (
              <View style={{ padding: 24, alignItems: 'center' }}>
                <ActivityIndicator color="#0FA6A6" />
              </View>
            ) : (
              <FlatList
                data={data}
                keyExtractor={keyExtractor}
                renderItem={listRender}
                keyboardShouldPersistTaps="handled"
                style={androidKbVisible ? { flex: 1 } : undefined}
                contentContainerStyle={{ paddingBottom: 12 }}
                ItemSeparatorComponent={() => (
                  <View style={{ height: 1, backgroundColor: '#F3F4F6', marginHorizontal: 16 }} />
                )}
                ListEmptyComponent={
                  <Text
                    style={{
                      color: '#9CA3AF',
                      textAlign: 'center',
                      fontFamily: 'Inter_400Regular',
                      paddingVertical: 20,
                    }}
                  >
                    {emptyText}
                  </Text>
                }
              />
            )}

            {/* Done button — only for multi-select */}
            {multiSelect && (
              <View
                style={{
                  paddingHorizontal: 16,
                  paddingBottom: 16,
                  paddingTop: 8,
                  borderTopWidth: 1,
                  borderTopColor: '#E5E7EB',
                }}
              >
                <TouchableOpacity
                  onPress={handleDone}
                  activeOpacity={0.85}
                  style={{
                    backgroundColor: '#0FA6A6',
                    borderRadius: 9999,
                    height: 52,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text
                    style={{
                      color: '#fff',
                      fontSize: 16,
                      fontWeight: '700',
                      fontFamily: 'Inter_700Bold',
                    }}
                  >
                    Done{selectedItems.length > 0 ? ` (${selectedItems.length})` : ''}
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </SafeAreaView>
        </Animated.View>
      </View>
    </Modal>
  );
}
