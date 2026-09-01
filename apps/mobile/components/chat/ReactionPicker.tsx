import {
  View,
  Text,
  Modal,
  Pressable,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { chatColors, chatFonts, chatShadow } from './chatTheme';

/** The five quick reactions (no 👎 here — it lives in the full picker). */
export const QUICK_REACTIONS = ['❤️', '👍', '😂', '😮', '🎉'] as const;

interface QuickBarProps {
  /** The viewer's current reaction on this message, if any. */
  current?: string | null;
  onReact: (emoji: string) => void;
  onOpenFullPicker: () => void;
}

/**
 * The quick-reaction strip shown on long-press. Tapping an emoji sets it;
 * tapping the one you already picked removes it; `+` opens the full picker.
 */
export function QuickReactionBar({ current, onReact, onOpenFullPicker }: QuickBarProps) {
  return (
    <View style={styles.bar}>
      {QUICK_REACTIONS.map((e) => {
        const active = current === e;
        return (
          <TouchableOpacity
            key={e}
            style={[styles.pill, active && styles.pillActive]}
            onPress={() => onReact(e)}
            accessibilityLabel={`React ${e}`}
          >
            <Text style={styles.emoji}>{e}</Text>
          </TouchableOpacity>
        );
      })}
      <TouchableOpacity
        style={styles.plus}
        onPress={onOpenFullPicker}
        accessibilityLabel="More reactions"
      >
        <Ionicons name="add" size={20} color={chatColors.text} />
      </TouchableOpacity>
    </View>
  );
}

// A curated "full" set — every common reaction plus 👎. Grouped for scanability.
const EMOJI_GROUPS: { label: string; emojis: string[] }[] = [
  {
    label: 'Reactions',
    emojis: ['❤️', '👍', '👎', '😂', '😮', '🎉', '🔥', '👏', '🙏', '💯', '✅', '👀'],
  },
  {
    label: 'Smileys',
    emojis: ['😀', '😅', '😊', '😍', '🥰', '😎', '🤩', '😭', '😢', '😤', '😴', '🤔', '😬', '🙃', '😇', '🤗'],
  },
  {
    label: 'Gestures',
    emojis: ['🤝', '✌️', '🤞', '🤙', '👌', '🫶', '🙌', '💪', '🫡', '👋'],
  },
  {
    label: 'Hearts & symbols',
    emojis: ['🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '💔', '⭐', '🌟', '✨', '⚡'],
  },
  {
    label: 'Life',
    emojis: ['🎊', '🥳', '🍕', '☕', '📚', '🎓', '🏀', '⚽', '🎵', '🌈', '🌸', '💐'],
  },
];

interface FullPickerProps {
  visible: boolean;
  current?: string | null;
  onPick: (emoji: string) => void;
  onClose: () => void;
}

/** The full emoji picker (a curated grid; includes 👎). */
export function EmojiPickerSheet({ visible, current, onPick, onClose }: FullPickerProps) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.pickerSheet} onPress={() => {}}>
          <View style={styles.handle} />
          <View style={styles.pickerHeader}>
            <Text style={styles.pickerTitle}>Choose a reaction</Text>
            <TouchableOpacity onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={22} color={chatColors.text} />
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.pickerScroll}>
            {EMOJI_GROUPS.map((g) => (
              <View key={g.label}>
                <Text style={styles.groupLabel}>{g.label}</Text>
                <View style={styles.grid}>
                  {g.emojis.map((e) => (
                    <TouchableOpacity
                      key={e}
                      style={[styles.gridCell, current === e && styles.gridCellActive]}
                      onPress={() => onPick(e)}
                    >
                      <Text style={styles.gridEmoji}>{e}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ))}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    alignSelf: 'center',
    backgroundColor: chatColors.white,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 6,
    marginTop: 4,
    marginBottom: 8,
    gap: 4,
    ...chatShadow,
  },
  pill: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillActive: {
    backgroundColor: 'rgba(15,166,166,0.16)',
  },
  emoji: {
    fontSize: 24,
  },
  plus: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: chatColors.bg,
  },
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  pickerSheet: {
    backgroundColor: chatColors.bg,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingBottom: 24,
    maxHeight: '72%',
    ...chatShadow,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: chatColors.textMuted,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 8,
  },
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  pickerTitle: {
    fontFamily: chatFonts.semiBold,
    fontSize: 16,
    color: chatColors.text,
  },
  pickerScroll: {
    paddingHorizontal: 14,
  },
  groupLabel: {
    fontFamily: chatFonts.semiBold,
    fontSize: 12,
    color: chatColors.textMuted,
    marginTop: 12,
    marginBottom: 6,
    marginLeft: 4,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  gridCell: {
    width: '12.5%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
  },
  gridCellActive: {
    backgroundColor: 'rgba(15,166,166,0.16)',
  },
  gridEmoji: {
    fontSize: 26,
  },
});
