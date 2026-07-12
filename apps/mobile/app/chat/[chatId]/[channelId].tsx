import { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@weglue/shared';
import { useChatDetails } from '../../../hooks/useChats';
import { ConversationThread } from '../../../components/chat/ConversationThread';
import { useOfficerStore } from '../../../store/officerStore';
import {
  getChannelMeta,
  canPostInChannel,
  markChannelRead,
  type ChannelMeta,
} from '../../../services/channelService';
import { recordChannelVisit } from '../../../lib/chatNavigation';
import { chatColors, chatFonts, chatTypography } from '../../../components/chat/chatTheme';

// ─── Official club chat channel thread (Members + Officers chats) ───────────
// Rendering / sending / viewer / polls all come from the shared
// ConversationThread. This screen adds the thread header (thread title
// prominent, parent conversation title secondary — Bug 9) and enforces the
// per-channel posting permission (Bug 19). The old side drawer is gone (Bug 1);
// channel switching happens on the conversation hub.

export default function ChannelThread() {
  const { chatId, channelId, jumpToMessageId, pname } = useLocalSearchParams<{
    chatId: string;
    channelId: string;
    jumpToMessageId?: string;
    pname?: string;
    pavatar?: string;
  }>();
  const router = useRouter();
  const { user } = useAuthStore();
  const userId = user?.id ?? '';
  const queryClient = useQueryClient();

  const { data: chatDetails } = useChatDetails(chatId);
  const clubId = chatDetails?.club_id ?? undefined;
  const isOfficer = useOfficerStore((s) => (clubId ? s.officerClubIds.includes(clubId) : false));

  const [meta, setMeta] = useState<ChannelMeta | null>(null);
  const [canPost, setCanPost] = useState(true);

  const parentTitle = chatDetails?.name ?? pname ?? '';

  useEffect(() => {
    if (channelId) recordChannelVisit(chatId, channelId);
  }, [channelId, chatId]);

  // Resolve the channel + posting permission. A stale/foreign channel id must
  // never render another conversation's thread (Bug 15) — bounce to the hub.
  useEffect(() => {
    let cancelled = false;
    if (!channelId) return;
    (async () => {
      const m = await getChannelMeta(channelId);
      if (cancelled) return;
      if (!m || (m.conversation_id && m.conversation_id !== chatId)) {
        router.replace(`/chat/${chatId}` as any);
        return;
      }
      setMeta(m);
      const allowed = await canPostInChannel(channelId);
      if (!cancelled) setCanPost(allowed);
    })();
    return () => {
      cancelled = true;
    };
  }, [channelId, chatId, router]);

  // Re-derive posting permission whenever officer status changes (promote /
  // demote propagated live by useClubRealtimeSync) so the composer un/locks
  // within ~1s without leaving the thread (Bug 19).
  useEffect(() => {
    if (!channelId) return;
    let cancelled = false;
    canPostInChannel(channelId).then((allowed) => {
      if (!cancelled) setCanPost(allowed);
    });
    return () => {
      cancelled = true;
    };
  }, [channelId, isOfficer]);

  // Demoted out of the Officers chat while viewing it → leave safely to the
  // Messages list. Only fires on a true→false transition so a slow initial
  // officer-status load never bounces a legitimate officer (Bug 19).
  const wasOfficerRef = useRef(isOfficer);
  useEffect(() => {
    if (chatDetails?.type === 'officer_chat' && wasOfficerRef.current && !isOfficer) {
      router.replace('/(tabs)/messages' as any);
    }
    wasOfficerRef.current = isOfficer;
  }, [isOfficer, chatDetails?.type, router]);

  // Mark read on entry so the hub unread badge clears; refresh the hub preview.
  useEffect(() => {
    if (!channelId) return;
    void markChannelRead(channelId).then(() => {
      queryClient.invalidateQueries({ queryKey: ['conversationHub', chatId, userId] });
    });
  }, [channelId, chatId, userId, queryClient]);

  const threadTitle = meta ? (meta.kind === 'main' ? 'Main chat' : `#${meta.name}`) : '';
  const blockedReason =
    meta?.post_permission === 'officers'
      ? 'Only club officers can post in this chat.'
      : meta?.post_permission === 'certain'
        ? 'Only selected members can post in this chat.'
        : undefined;

  const openInfo = () =>
    router.push(`/chat/${chatId}/info?channelId=${channelId}` as any);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={chatColors.text} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.headerCenter}
          onPress={openInfo}
          activeOpacity={0.7}
          accessibilityLabel={`${threadTitle} information`}
        >
          <View style={styles.titleWrap}>
            <View style={styles.titleLine}>
              <Text style={styles.threadTitle} numberOfLines={1}>
                {threadTitle}
              </Text>
              <Ionicons name="chevron-forward" size={16} color={chatColors.textMuted} />
            </View>
            {!!parentTitle && (
              <Text style={styles.parentTitle} numberOfLines={1}>
                {parentTitle}
              </Text>
            )}
          </View>
        </TouchableOpacity>
        <View style={styles.headerRightSpacer} />
      </View>

      <ConversationThread
        conversationId={chatId}
        channelId={channelId || null}
        currentUserId={userId}
        canModerate={isOfficer}
        isOfficer={isOfficer}
        canPost={canPost}
        blockedReason={blockedReason}
        allowPolls
        onOpenProfile={(uid) => router.push(`/profile/${uid}` as any)}
        jumpToMessageId={jumpToMessageId}
        emptyLabel={
          meta
            ? meta.kind === 'main'
              ? 'No messages yet'
              : `No messages in #${meta.name} yet`
            : 'No messages yet'
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: chatColors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: chatColors.border,
    backgroundColor: chatColors.bg,
  },
  backBtn: { padding: 4, marginRight: 4 },
  headerCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  headerRightSpacer: { width: 32 },
  titleWrap: { alignItems: 'center', flexShrink: 1 },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  threadTitle: { ...chatTypography.chatTitle, fontSize: 17, flexShrink: 1 },
  parentTitle: {
    fontFamily: chatFonts.regular,
    fontSize: 12,
    color: chatColors.textMuted,
    marginTop: 1,
  },
});
