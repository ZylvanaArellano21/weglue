import { useMemo, useState } from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  ScrollView,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Avatar } from '../shared/Avatar';
import { getMessageReactors } from '../../services/messagingService';
import { chatColors, chatFonts, chatShadow } from './chatTheme';

// ─── "Who reacted with what" ────────────────────────────────────────────────
// WhatsApp-style: a bottom sheet with an "All" tab plus one tab per emoji
// (emoji + count), and a list of every reactor showing which emoji they used.
// Tapping your own row removes your reaction.

interface Props {
  /** The message whose reactions to show; null hides the sheet. */
  messageId: string | null;
  /** The viewer, so their own row can be marked "Tap to remove". */
  currentUserId: string | undefined;
  onClose: () => void;
  /** Remove the viewer's own reaction (called with the message id). */
  onRemoveOwn?: (messageId: string) => void;
}

export function MessageReactorsSheet({ messageId, currentUserId, onClose, onRemoveOwn }: Props) {
  const [filter, setFilter] = useState<string | null>(null); // null = "All"

  const { data: reactors, isLoading } = useQuery({
    queryKey: ['messageReactors', messageId],
    queryFn: () => getMessageReactors(messageId!),
    enabled: !!messageId,
    staleTime: 5_000,
  });

  const tabs = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of reactors ?? []) counts.set(r.emoji, (counts.get(r.emoji) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [reactors]);

  const total = reactors?.length ?? 0;
  const shown = (reactors ?? []).filter((r) => !filter || r.emoji === filter);

  return (
    <Modal visible={!!messageId} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.handle} />
          <Text style={styles.title}>
            {total} {total === 1 ? 'Reaction' : 'Reactions'}
          </Text>

          {tabs.length > 1 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.tabsRow}
            >
              <TouchableOpacity
                style={[styles.tab, filter === null && styles.tabActive]}
                onPress={() => setFilter(null)}
              >
                <Text style={[styles.tabText, filter === null && styles.tabTextActive]}>
                  All {total}
                </Text>
              </TouchableOpacity>
              {tabs.map(([emoji, count]) => (
                <TouchableOpacity
                  key={emoji}
                  style={[styles.tab, filter === emoji && styles.tabActive]}
                  onPress={() => setFilter(emoji)}
                >
                  <Text style={styles.tabEmoji}>{emoji}</Text>
                  <Text style={[styles.tabText, filter === emoji && styles.tabTextActive]}>
                    {count}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          {isLoading ? (
            <ActivityIndicator style={{ marginVertical: 28 }} color={chatColors.teal} />
          ) : (
            <FlatList
              data={shown}
              keyExtractor={(item, i) => `${item.userId}:${item.emoji}:${i}`}
              style={styles.list}
              renderItem={({ item }) => {
                const isMe = item.userId === currentUserId;
                return (
                  <TouchableOpacity
                    style={styles.row}
                    disabled={!isMe || !onRemoveOwn}
                    onPress={() => {
                      if (isMe && onRemoveOwn && messageId) {
                        onRemoveOwn(messageId);
                        onClose();
                      }
                    }}
                  >
                    <Avatar uri={item.avatarUrl} size={40} username={item.displayName} />
                    <View style={styles.rowText}>
                      <Text style={styles.rowName} numberOfLines={1}>
                        {isMe ? 'You' : item.displayName}
                      </Text>
                      {isMe && onRemoveOwn && (
                        <Text style={styles.rowHint}>Tap to remove</Text>
                      )}
                    </View>
                    <Text style={styles.rowEmoji}>{item.emoji}</Text>
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={
                <Text style={styles.empty}>No reactions</Text>
              }
            />
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  sheet: {
    backgroundColor: chatColors.bg,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingBottom: 28,
    maxHeight: '68%',
    ...chatShadow,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: chatColors.textMuted,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 10,
  },
  title: {
    fontFamily: chatFonts.semiBold,
    fontSize: 16,
    color: chatColors.text,
    textAlign: 'center',
    marginBottom: 10,
  },
  tabsRow: {
    paddingHorizontal: 16,
    gap: 8,
    paddingBottom: 8,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: chatColors.white,
  },
  tabActive: {
    backgroundColor: 'rgba(15,166,166,0.16)',
  },
  tabEmoji: { fontSize: 15 },
  tabText: {
    fontFamily: chatFonts.semiBold,
    fontSize: 13,
    color: chatColors.textMuted,
  },
  tabTextActive: { color: chatColors.teal },
  list: {
    paddingHorizontal: 16,
    marginTop: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 9,
  },
  rowText: { flex: 1 },
  rowName: {
    fontFamily: chatFonts.semiBold,
    fontSize: 15,
    color: chatColors.text,
  },
  rowHint: {
    fontFamily: chatFonts.regular,
    fontSize: 12,
    color: chatColors.textMuted,
    marginTop: 1,
  },
  rowEmoji: { fontSize: 22 },
  empty: {
    fontFamily: chatFonts.regular,
    fontSize: 14,
    color: chatColors.textMuted,
    textAlign: 'center',
    paddingVertical: 24,
  },
});
