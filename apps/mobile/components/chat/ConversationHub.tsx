import { useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { Avatar } from '../shared/Avatar';
import { useConversationHub } from '../../hooks/useClubChannels';
import type { HubThread } from '../../services/channelService';
import { chatColors, chatFonts, chatTypography } from './chatTheme';

// ─── Conversation hub list ───────────────────────────────────────────────────
// Full-screen replacement for the old clipped side drawer (Bug 1). Renders the
// permanent Main chat then every hashtag channel of ONE parent conversation,
// each with its own picture, last sender + preview, time and unread count.
// Channels are already scoped to this conversation id by the query, so Members
// and Officers threads never mix (Bug 15).

interface Props {
  conversationId: string;
  userId: string;
  isOfficer: boolean;
  onOpenThread: (thread: HubThread) => void;
  onAddChannel: () => void;
}

export function ConversationHub({
  conversationId,
  userId,
  isOfficer,
  onOpenThread,
  onAddChannel,
}: Props) {
  const queryClient = useQueryClient();
  const { data: threads, isLoading, refetch, isRefetching } = useConversationHub(
    conversationId,
    userId,
  );

  const onRefresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['clubChannels'] });
    refetch();
  }, [queryClient, refetch]);

  if (isLoading && !threads) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={chatColors.teal} />
      </View>
    );
  }

  const list = threads ?? [];
  const main = list.filter((t) => t.kind === 'main');
  const channels = list.filter((t) => t.kind !== 'main');

  return (
    <ScrollView
      contentContainerStyle={styles.scroll}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={onRefresh} tintColor={chatColors.teal} />}
    >
      {main.map((t) => (
        <ThreadRow key={t.id} thread={t} onPress={() => onOpenThread(t)} />
      ))}

      {(channels.length > 0 || isOfficer) && (
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionHeader}>Channels</Text>
          {isOfficer && (
            <TouchableOpacity onPress={onAddChannel} style={styles.addBtn} hitSlop={8}>
              <Ionicons name="add" size={16} color={chatColors.teal} />
              <Text style={styles.addText}>Add Channel</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {channels.map((t) => (
        <ThreadRow key={t.id} thread={t} onPress={() => onOpenThread(t)} />
      ))}

      {channels.length === 0 && !isOfficer && main.length > 0 && (
        <Text style={styles.noChannels}>No channels yet.</Text>
      )}
    </ScrollView>
  );
}

function ThreadRow({ thread, onPress }: { thread: HubThread; onPress: () => void }) {
  const isMain = thread.kind === 'main';
  const title = isMain ? 'Main chat' : `#${thread.name}`;
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      {thread.avatar_url ? (
        <Avatar uri={thread.avatar_url} size={48} username={thread.name} />
      ) : (
        <View style={styles.iconWrap}>
          <Ionicons
            name={isMain ? 'chatbubbles' : 'pricetag'}
            size={22}
            color={chatColors.teal}
          />
        </View>
      )}
      <View style={styles.rowBody}>
        <View style={styles.rowTopLine}>
          <Text
            style={[styles.rowTitle, thread.unread_count > 0 && styles.rowTitleUnread]}
            numberOfLines={1}
          >
            {title}
          </Text>
          {thread.last_at && (
            <Text style={styles.rowTime}>{formatHubTime(thread.last_at)}</Text>
          )}
        </View>
        <View style={styles.rowBottomLine}>
          <Text style={styles.rowPreview} numberOfLines={1}>
            {thread.last_preview
              ? `${thread.last_sender ? `${thread.last_sender}: ` : ''}${thread.last_preview}`
              : isMain
                ? 'No messages yet'
                : `No messages in #${thread.name} yet`}
          </Text>
          {thread.unread_count > 0 && (
            <View style={styles.unreadBadge}>
              <Text style={styles.unreadText}>
                {thread.unread_count > 99 ? '99+' : thread.unread_count}
              </Text>
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

function formatHubTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }
  const diffDays = (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24);
  if (diffDays < 7) {
    return d.toLocaleDateString('en-US', { weekday: 'short' });
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingVertical: 6 },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 6,
  },
  sectionHeader: {
    fontFamily: chatFonts.semiBold,
    fontSize: 13,
    letterSpacing: 0.4,
    color: chatColors.textMuted,
    textTransform: 'uppercase',
  },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  addText: { fontFamily: chatFonts.semiBold, fontSize: 13, color: chatColors.teal },
  noChannels: {
    fontFamily: chatFonts.regular,
    fontSize: 13,
    color: chatColors.textMuted,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(15,166,166,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: { flex: 1, justifyContent: 'center' },
  rowTopLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowTitle: { ...chatTypography.rowName, flexShrink: 1 },
  rowTitleUnread: { fontFamily: chatFonts.bold },
  rowTime: { fontFamily: chatFonts.regular, fontSize: 12, color: chatColors.textMuted, marginLeft: 8 },
  rowBottomLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
  rowPreview: { fontFamily: chatFonts.regular, fontSize: 13, color: chatColors.textMuted, flex: 1 },
  unreadBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: chatColors.teal,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    marginLeft: 8,
  },
  unreadText: { fontFamily: chatFonts.bold, fontSize: 11, color: chatColors.cream },
});
