import { useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@weglue/shared';
import { useChatDetails } from '../../../../hooks/useChats';
import { Avatar } from '../../../../components/shared/Avatar';
import { ConfirmationModal } from '../../../../components/chat/ConfirmationModal';
import { jumpToMessage, openDirectChatWith } from '../../../../lib/chatNavigation';
import { getClubPollHistory } from '../../../../services/clubPollService';
import { followUser, unfollowUser } from '../../../../services/followService';
import { useQuery } from '@tanstack/react-query';
import { useOfficerStore } from '../../../../store/officerStore';
import { requestLeaveClub } from '../../../../store/leaveClubStore';
import { supabase } from '../../../../lib/supabase';
import type { ClubPoll } from '../../../../services/clubPollService';
import {
  chatColors,
  chatFonts,
  chatShadow,
  chatSizes,
  chatTypography,
} from '../../../../components/chat/chatTheme';

type ContentTab = 'polls' | 'photos' | 'calendar' | 'files';

export default function ChatInfo() {
  const { chatId, channelId } = useLocalSearchParams<{ chatId: string; channelId?: string }>();
  const router = useRouter();
  const { user } = useAuthStore();
  const userId = user?.id ?? '';

  const [activeTab, setActiveTab] = useState<ContentTab>('photos');
  const [confirmAction, setConfirmAction] = useState<'leave' | 'delete' | null>(null);
  const [followStates, setFollowStates] = useState<Record<string, boolean>>({});

  const { data: chatDetails, isLoading } = useChatDetails(chatId);
  const clubId = chatDetails?.club_id ?? undefined;
  const isDirect = chatDetails?.type === 'direct';
  const isGroup = !isDirect;
  const isOfficer = useOfficerStore((s) => (clubId ? s.officerClubIds.includes(clubId) : false));

  // Fix 5: fetch current follow states for all group members
  useEffect(() => {
    if (!isGroup || !userId || !chatDetails) return;
    const otherIds = chatDetails.participants
      .filter((p) => p.user_id !== userId)
      .map((p) => p.user_id);
    if (!otherIds.length) return;
    supabase
      .from('follows')
      .select('following_id, status')
      .eq('follower_id', userId)
      .in('following_id', otherIds)
      .eq('status', 'accepted')
      .then(({ data }) => {
        const states: Record<string, boolean> = {};
        for (const row of (data ?? []) as any[]) {
          states[row.following_id] = true;
        }
        setFollowStates(states);
      });
  }, [chatDetails?.id, isGroup, userId]);

  const { data: polls, isLoading: pollsLoading } = useQuery({
    queryKey: ['clubPollHistory', clubId, userId],
    queryFn: () => getClubPollHistory(clubId!, userId),
    enabled: !!clubId && isGroup && activeTab === 'polls',
    staleTime: 60 * 1000,
  });

  if (isLoading || !chatDetails) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.center}>
          <ActivityIndicator color={chatColors.teal} />
        </View>
      </SafeAreaView>
    );
  }

  // chatDetails.name is live-resolved by chatService (display name for DMs,
  // current club name for club chats, "Deleted account" when gone).
  const displayName = chatDetails.name ?? 'Chat';

  const tabs: ContentTab[] = isDirect
    ? ['photos', 'calendar', 'files']
    : ['polls', 'photos', 'calendar', 'files'];

  function winningOption(poll: ClubPoll): string {
    if (!poll.options.length) return '—';
    const winner = poll.options.reduce((a, b) => (a.vote_count >= b.vote_count ? a : b));
    return winner.option_text;
  }

  // Leaving from a club chat goes through the same centralized flow as
  // every other surface: server-side eligibility (sole officer blocked),
  // one modal, and the leave_club RPC — never a raw club_members delete.
  function handleLeave() {
    const cid = chatDetails?.club_id;
    if (!cid) return;
    setConfirmAction(null);
    requestLeaveClub({
      clubId: cid,
      onLeft: () => {
        // Pop info + the chat itself — the conversation is gone from the
        // user's list once membership ends.
        router.back();
        router.back();
      },
    });
  }

  async function handleDelete() {
    await supabase
      .from('conversation_participants')
      .delete()
      .eq('conversation_id', chatId)
      .eq('user_id', userId);
    router.back();
    router.back();
  }

  function renderContentGrid() {
    if (activeTab === 'polls' && isGroup) {
      if (pollsLoading) {
        return (
          <View style={styles.center}>
            <ActivityIndicator color={chatColors.teal} />
          </View>
        );
      }
      if (!polls || polls.length === 0) {
        return (
          <View style={styles.center}>
            <Text style={styles.emptyText}>No polls yet</Text>
          </View>
        );
      }
      return (
        <FlatList
          data={polls}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.pollHistoryRow}
              onPress={() => {
                if (item.channel_id) {
                  jumpToMessage(chatId, item.channel_id, item.message_id);
                }
              }}
              activeOpacity={0.75}
            >
              <Text style={styles.pollHistoryQuestion} numberOfLines={2}>
                {item.question}
              </Text>
              <Text style={styles.pollHistoryWinner} numberOfLines={1}>
                {winningOption(item)}
              </Text>
              <Ionicons name="chevron-forward" size={14} color={chatColors.textMuted} />
            </TouchableOpacity>
          )}
        />
      );
    }

    return (
      <View style={styles.gridRow}>
        {(isDirect ? [0, 1, 2] : [0, 1, 2, 3]).map((i) => (
          <View
            key={i}
            style={[styles.gridCell, isDirect && styles.gridCellDirect]}
          />
        ))}
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={chatColors.text} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.profileSection}>
          <Avatar uri={chatDetails.avatar_url} size={chatSizes.avatarInfo} username={displayName} />
          <Text style={styles.profileName}>{displayName}</Text>
        </View>

        <View style={styles.actionRow}>
          {isGroup && isOfficer && (
            <TouchableOpacity
              style={styles.actionItem}
              onPress={() => router.push(`/(tabs)/messages/add-people` as any)}
            >
              <Ionicons name="person-add-outline" size={22} color={chatColors.text} />
              <Text style={chatTypography.infoAction}>Add</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.actionItem}
            onPress={() =>
              router.push(
                (channelId
                  ? `/(tabs)/messages/${chatId}/search?channelId=${channelId}`
                  : `/(tabs)/messages/${chatId}/search`) as any,
              )
            }
          >
            <Ionicons name="search-outline" size={22} color={chatColors.text} />
            <Text style={chatTypography.infoAction}>Search</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.actionItem}
            onPress={() => (isDirect ? setConfirmAction('delete') : handleLeave())}
          >
            <Ionicons
              name={isDirect ? 'trash-outline' : 'exit-outline'}
              size={22}
              color={chatColors.text}
            />
            <Text style={chatTypography.infoAction}>{isDirect ? 'Delete' : 'Leave'}</Text>
          </TouchableOpacity>
        </View>

        {isGroup && (
          <>
            <TouchableOpacity style={styles.linkRow}>
              <Ionicons name="link-outline" size={20} color={chatColors.text} />
              <Text style={chatTypography.infoRow}>Invite Link</Text>
            </TouchableOpacity>
            <View style={styles.divider} />
            <Text style={styles.peopleHeader}>People</Text>
            {chatDetails.participants.map((member) => (
              <View key={member.user_id} style={styles.memberRow}>
                <Avatar uri={member.avatar_url} size={chatSizes.avatarSuggested} username={member.username} />
                <View style={styles.memberText}>
                  <Text style={chatTypography.roleLabel}>{member.role}</Text>
                  <Text style={chatTypography.rowName}>{member.username}</Text>
                </View>
                {member.user_id !== userId && (
                  <>
                    <TouchableOpacity
                      onPress={() => {
                        void openDirectChatWith(member.user_id);
                      }}
                      style={styles.msgIcon}
                    >
                      <Ionicons name="chatbubble-outline" size={18} color={chatColors.text} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.followBtnOutline}
                      onPress={async () => {
                        const isFollowing = !!followStates[member.user_id];
                        if (isFollowing) {
                          await unfollowUser(userId, member.user_id);
                        } else {
                          await followUser(userId, member.user_id);
                        }
                        setFollowStates((prev) => ({
                          ...prev,
                          [member.user_id]: !isFollowing,
                        }));
                      }}
                    >
                      <Text style={[chatTypography.followBtn, { color: chatColors.teal }]}>
                        {followStates[member.user_id] ? 'Following' : 'Follow'}
                      </Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
            ))}
          </>
        )}

        <View style={styles.tabBar}>
          {tabs.map((tab) => {
            const active = activeTab === tab;
            const icon =
              tab === 'polls'
                ? 'checkbox-outline'
                : tab === 'photos'
                  ? 'images-outline'
                  : tab === 'calendar'
                    ? 'calendar-outline'
                    : 'attach-outline';
            return (
              <TouchableOpacity
                key={tab}
                style={[styles.tab, active && styles.tabActive]}
                onPress={() => setActiveTab(tab)}
              >
                <Ionicons
                  name={icon as any}
                  size={22}
                  color={active ? chatColors.teal : chatColors.text}
                />
              </TouchableOpacity>
            );
          })}
        </View>

        {renderContentGrid()}
      </ScrollView>

      <ConfirmationModal
        visible={confirmAction === 'delete'}
        title={`Delete ${displayName}?`}
        message={`Are you sure you want to delete ${displayName}?`}
        confirmLabel="Delete"
        destructive
        onConfirm={handleDelete}
        onCancel={() => setConfirmAction(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: chatColors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  header: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  backBtn: { padding: 4, alignSelf: 'flex-start' },
  scroll: { paddingBottom: 32 },
  profileSection: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  profileName: {
    ...chatTypography.chatTitle,
    marginTop: 10,
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 40,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: chatColors.border,
  },
  actionItem: {
    alignItems: 'center',
    gap: 4,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  divider: {
    height: 1,
    backgroundColor: chatColors.border,
  },
  peopleHeader: {
    ...chatTypography.infoRow,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 10,
  },
  memberText: {
    flex: 1,
  },
  msgIcon: {
    padding: 6,
  },
  followBtnOutline: {
    backgroundColor: chatColors.bg,
    borderRadius: 15,
    paddingHorizontal: 14,
    paddingVertical: 6,
    ...chatShadow,
  },
  tabBar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 12,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: chatColors.border,
    marginTop: 8,
  },
  tab: {
    padding: 8,
  },
  tabActive: {
    borderBottomWidth: 2,
    borderBottomColor: chatColors.teal,
  },
  gridRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  gridCell: {
    width: '25%',
    aspectRatio: 1,
    backgroundColor: chatColors.gridPlaceholder,
    borderWidth: 0.5,
    borderColor: chatColors.border,
  },
  gridCellDirect: {
    width: '33.333%',
  },
  emptyText: {
    fontFamily: chatFonts.regular,
    fontSize: 14,
    color: chatColors.textMuted,
  },
  pollHistoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: chatColors.border,
    gap: 8,
  },
  pollHistoryQuestion: {
    fontFamily: chatFonts.semiBold,
    fontSize: 14,
    color: chatColors.text,
    flex: 1,
  },
  pollHistoryWinner: {
    fontFamily: chatFonts.regular,
    fontSize: 12,
    color: chatColors.teal,
    maxWidth: 100,
  },
});
