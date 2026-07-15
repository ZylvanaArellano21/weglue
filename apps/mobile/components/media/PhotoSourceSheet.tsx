import { View, Text, TouchableOpacity, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

interface Props {
  onCamera: () => void;
  onLibrary: () => void;
  onCancel: () => void;
}

// Cream/teal tokens shared with the chat AttachmentSheet, so the two
// media-source sheets in the app read as one design.
const CREAM = '#FEFCF0';
const TEAL = '#0FA6A6';
const INK = '#000000';
const MUTED = '#878784';

/**
 * The Android-only "Take Photo · Photo Library" chooser.
 *
 * Shown by MediaPickerHost as the first stage of a source:'choose' request —
 * the screens that used to open the photo library on a single tap (club avatar,
 * club banner, event image, group/channel avatar) and had no source buttons of
 * their own. It is never shown on iOS, where those taps keep going straight to
 * the library exactly as before.
 */
export function PhotoSourceSheet({ onCamera, onLibrary, onCancel }: Props) {
  const insets = useSafeAreaInsets();

  return (
    <Pressable style={styles.overlay} onPress={onCancel} accessibilityLabel="Dismiss">
      {/* Swallow taps on the sheet itself so only the backdrop cancels. */}
      <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + 20 }]} onPress={() => {}}>
        <View style={styles.handle} />

        <TouchableOpacity
          style={styles.row}
          onPress={onCamera}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Take Photo"
        >
          <View style={styles.iconWrap}>
            <Ionicons name="camera-outline" size={22} color={TEAL} />
          </View>
          <Text style={styles.rowLabel}>Take Photo</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.row}
          onPress={onLibrary}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Photo Library"
        >
          <View style={styles.iconWrap}>
            <Ionicons name="images-outline" size={22} color={TEAL} />
          </View>
          <Text style={styles.rowLabel}>Photo Library</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.cancelRow}
          onPress={onCancel}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Cancel"
        >
          <Text style={styles.cancelLabel}>Cancel</Text>
        </TouchableOpacity>
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    backgroundColor: CREAM,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingTop: 6,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: MUTED,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 22,
    paddingVertical: 15,
    minHeight: 48,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(15,166,166,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    color: INK,
  },
  cancelRow: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    marginTop: 4,
    minHeight: 48,
  },
  cancelLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    color: MUTED,
  },
});
