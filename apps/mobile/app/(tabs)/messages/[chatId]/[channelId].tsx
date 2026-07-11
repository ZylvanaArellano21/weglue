import { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@weglue/shared';
import { useChatDetails } from '../../../../hooks/useChats';
import { ConversationThread } from '../../../../components/chat/ConversationThread';
import { ChannelDrawer } from '../../../../components/chat/ChannelDrawer';
import { Avatar } from '../../../../components/shared/Avatar';
import { useOfficerStore } from '../../../../store/officerStore';
import { supabase } from '../../../../lib/supabase';
import { recordChannelVisit } from '../../../../lib/chatNavigation';
import { chatColors, chatSizes, chatTypography } from '../../../../components/chat/chatTheme';

// ─── Official club chat channel thread (Members + Officers chats) ───────────
// Rendering, sending, actions, viewer and polls all come from the shared
// ConversationThread — this screen only adds club identity + channel chrome.

export default function ChannelThread() {
  const { chatId, channelId, jumpToMessageId, pname, pavatar } =
    useLocalSearchParams<{
      chatId: string;
      channelId: string;
      jumpToMessageId?: string;
      pname?: string;
      pavatar?: string;
    }>();
  const router = useRouter();
  const { user } = useAuthStore();
  const userId = user?.id ?? '';

  const { data: chatDetails } = useChatDetails(chatId);
  const clubId = chatDetails?.club_id ?? undefined;
  const conversationId = chatId;

  const isOfficer = useOfficerStore((s) => (clubId ? s.officerClubIds.includes(clubId) : false));

  const [channelName, setChannelName] = useState('');
  const [isRestricted, setIsRestricted] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeChannelId, setActiveChannelId] = useState(channelId ?? '');

  useEffect(() => {
    if (activeChannelId) recordChannelVisit(chatId, activeChannelId);
  }, [activeChannelId, chatId]);

  useEffect(() => {
    if (!activeChannelId) return;
    supabase
      .from('conversation_channels')
      .select('name, is_restricted, conversation_id')
      .eq('id', activeChannelId)
      .single()
      .then(async ({ data }) => {
        if (!data) return;
        // A stale/foreign channel id must never render another conversation's
        // thread — fall back to this conversation's default channel.
        if (data.conversation_id && data.conversation_id !== chatId) {
          const { data: own } = await supabase
            .from('conversation_channels')
            .select('id, name, is_restricted, is_default, display_order')
            .eq('conversation_id', chatId)
            .order('display_order', { ascending: true });
          const fallback = (own ?? []).find((c: any) => c.is_default) ?? (own ?? [])[0];
          if (fallback) {
            setActiveChannelId(fallback.id);
            setChannelName(fallback.name);
            setIsRestricted(fallback.is_restricted);
          }
          return;
        }
        setChannelName(data.name);
        setIsRestricted(data.is_restricted);
      });
  }, [activeChannelId, chatId]);

  useEffect(() => {
    if (channelId) setActiveChannelId(channelId);
  }, [channelId]);

  function handleSelectChannel(id: string, name: string) {
    setActiveChannelId(id);
    setChannelName(name);
    router.setParams({ channelId: id } as any);
  }

  function handleAddChannel() {
    Alert.alert('Add Channel', 'Channel creation is handled by club officers.');
  }

  const displayName = chatDetails?.name ?? (pname || 'Group Chat');
  const headerAvatarUrl = chatDetails?.avatar_url ?? (pavatar || null);

  const openClubProfile = () => {
    if (clubId) router.push(`/(tabs)/clubs/${clubId}` as any);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={chatColors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          {/* Official chat identity: name/picture open the CLUB profile. */}
          <TouchableOpacity onPress={openClubProfile} style={styles.identityTap} activeOpacity={0.7}>
            <Avatar uri={headerAvatarUrl} size={chatSizes.avatarHeader} username={displayName} />
            <Text style={styles.headerTitle} numberOfLines={1}>
              {displayName}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() =>
              router.push(`/(tabs)/messages/${chatId}/info?channelId=${activeChannelId}` as any)
            }
            hitSlop={8}
            accessibilityLabel="Chat information"
          >
            <Ionicons name="chevron-forward" size={18} color={chatColors.textMuted} />
          </TouchableOpacity>
        </View>
      </View>

      <TouchableOpacity style={styles.channelBar} onPress={() => setDrawerOpen(true)} activeOpacity={0.8}>
        <Ionicons name="menu" size={18} color={chatColors.text} />
        <Text style={styles.channelLabel}>#{channelName}</Text>
      </TouchableOpacity>

      <ConversationThread
        conversationId={conversationId}
        channelId={activeChannelId || null}
        currentUserId={userId}
        canModerate={isOfficer}
        isRestricted={isRestricted}
        isOfficer={isOfficer}
        allowPolls
        onOpenProfile={(uid) => router.push(`/profile/${uid}` as any)}
        jumpToMessageId={jumpToMessageId}
        emptyLabel={channelName ? `No messages in #${channelName} yet` : 'No messages yet'}
      />

      {clubId && (
        <ChannelDrawer
          visible={drawerOpen}
          clubId={clubId}
          conversationId={chatId}
          activeChannelId={activeChannelId}
          isOfficer={isOfficer}
          onSelectChannel={handleSelectChannel}
          onClose={() => setDrawerOpen(false)}
          onAddChannel={handleAddChannel}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: chatColors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: chatColors.border,
    backgroundColor: chatColors.bg,
  },
  backBtn: { padding: 4, marginRight: 4 },
  headerCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  identityTap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 1,
  },
  headerTitle: {
    ...chatTypography.chatTitle,
    flexShrink: 1,
  },
  channelBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: chatColors.border,
    backgroundColor: chatColors.bg,
  },
  channelLabel: {
    ...chatTypography.channelName,
  },
});
