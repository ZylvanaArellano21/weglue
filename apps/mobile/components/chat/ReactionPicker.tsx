import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import EmojiPicker, { type EmojiType, useRecentPicksPersistence } from 'rn-emoji-keyboard';
import { QUICK_REACTIONS } from '@weglue/shared';
import { chatColors, chatShadow } from './chatTheme';

export { QUICK_REACTIONS };

const RECENT_EMOJI_KEY = 'weglue-recent-reaction-emojis-v1';

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

interface FullPickerProps {
  visible: boolean;
  current?: string | null;
  onPick: (emoji: string) => void;
  onClose: () => void;
}

/**
 * The full emoji picker — the real thing, WhatsApp-style: a bottom sheet with a
 * search bar, "Recently used", and every emoji category with a category tab bar
 * at the bottom. Backed by `rn-emoji-keyboard` so the same picker is used on
 * iOS and Android. Any emoji is a valid reaction (👎 included).
 */
export function EmojiPickerSheet({ visible, current: _current, onPick, onClose }: FullPickerProps) {
  // Persist "Recently used" across sessions (WhatsApp keeps a frequently-used
  // row). AsyncStorage-backed, keyed so it never collides with other stores.
  useRecentPicksPersistence({
    initialization: async () => {
      try {
        return JSON.parse((await AsyncStorage.getItem(RECENT_EMOJI_KEY)) || '[]');
      } catch {
        return [];
      }
    },
    onStateChange: async (next) => {
      try {
        await AsyncStorage.setItem(RECENT_EMOJI_KEY, JSON.stringify(next));
      } catch {
        /* non-critical */
      }
    },
  });

  return (
    <EmojiPicker
      open={visible}
      onClose={onClose}
      onEmojiSelected={(e: EmojiType) => onPick(e.emoji)}
      enableSearchBar
      enableRecentlyUsed
      categoryPosition="bottom"
      expandable
      theme={{
        backdrop: 'rgba(0,0,0,0.35)',
        container: chatColors.bg,
        header: chatColors.text,
        skinTonesContainer: chatColors.white,
        category: {
          icon: chatColors.textMuted,
          iconActive: chatColors.teal,
          container: chatColors.white,
          containerActive: 'rgba(15,166,166,0.16)',
        },
        search: {
          text: chatColors.text,
          placeholder: chatColors.textMuted,
          icon: chatColors.textMuted,
          background: chatColors.white,
        },
      }}
    />
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
});
