import { useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  SectionList,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@weglue/shared';
import { useChatDetails } from '../../../../hooks/useChats';
import { Avatar } from '../../../../components/shared/Avatar';
import { jumpToMessage } from '../../../../lib/chatNavigation';
import { getClubPollHistory } from '../../../../services/clubPollService';
import { useQuery } from '@tanstack/react-query';
import type { ClubPoll } from '../../../../services/clubPollService';

type Tab = 'members' | 'polls';

export default function ChatInfo() {
  const { chatId } = useLocalSearchParams<{ chatId: string }>();
  const router = useRouter();
  const { user } = useAuthStore();
  const userId = user?.id ?? '';

  const [activeTab, setActiveTab] = useState<Tab>('members');

  const { data: chatDetails, isLoading } = useChatDetails(chatId);
  const clubId = chatDetails?.club_id ?? undefined;

  const { data: polls, isLoading: pollsLoading } = useQuery({
    queryKey: ['clubPollHistory', clubId, userId],
    queryFn: () => getClubPollHistory(clubId!, userId),
    enabled: !!clubId && activeTab === 'polls',
    staleTime: 60 * 1000,
  });

  if (isLoading || !chatDetails) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.center}>
          <ActivityIndicator color="#0FA6A6" />
        </View>
      </SafeAreaView>
    );
  }

  const displayName = chatDetails.name ?? 'Group Chat';

  function winningOption(poll: ClubPoll): string {
    if (!poll.options.length) return '—';
    const winner = poll.options.reduce((a, b) => (a.vote_count >= b.vote_count ? a : b));
    return winner.option_text;
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color="#1A1A1A" />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{displayName}</Text>
        <View style={{ width: 36 }} />
      </View>

      {/* Tab bar */}
      <View style={styles.tabBar}>
        {(['members', 'polls'] as Tab[]).map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[styles.tab, activeTab === tab && styles.tabActive]}
            onPress={() => setActiveTab(tab)}
          >
            <Text style={[styles.tabLabel, activeTab === tab && styles.tabLabelActive]}>
              {tab === 'members' ? 'Members' : 'Polls'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Members tab */}
      {activeTab === 'members' && (
        <FlatList
          data={chatDetails.participants}
          keyExtractor={(item) => item.user_id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.memberRow}
              onPress={() => router.push(`/profile/${item.user_id}`)}
              activeOpacity={0.7}
            >
              <Avatar uri={item.avatar_url} size={40} username={item.username} />
              <View style={styles.memberInfo}>
                <Text style={styles.memberName}>{item.username}</Text>
                {item.full_name && (
                  <Text style={styles.memberSub}>{item.full_name}</Text>
                )}
              </View>
              {item.user_id !== userId && (
                <TouchableOpacity
                  onPress={async () => {
                    const { openDirectChatWith } = await import('../../../../lib/chatNavigation');
                    await openDirectChatWith(item.user_id);
                  }}
                  style={styles.dmBtn}
                >
                  <Ionicons name="chatbubble-outline" size={18} color="#0FA6A6" />
                </TouchableOpacity>
              )}
            </TouchableOpacity>
          )}
          ListHeaderComponent={
            <Text style={styles.sectionLabel}>
              {chatDetails.participants.length} member{chatDetails.participants.length !== 1 ? 's' : ''}
            </Text>
          }
        />
      )}

      {/* Polls tab */}
      {activeTab === 'polls' && (
        <>
          {pollsLoading ? (
            <View style={styles.center}>
              <ActivityIndicator color="#0FA6A6" />
            </View>
          ) : !polls || polls.length === 0 ? (
            <View style={styles.center}>
              <Ionicons name="bar-chart-outline" size={40} color="#D1D5DB" />
              <Text style={styles.emptyText}>No polls yet</Text>
            </View>
          ) : (
            <FlatList
              data={polls}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.list}
              renderItem={({ item }) => {
                const winner = winningOption(item);
                const isActive =
                  (!item.start_at || new Date() >= new Date(item.start_at)) &&
                  (!item.end_at || new Date() <= new Date(item.end_at));

                return (
                  <TouchableOpacity
                    style={styles.pollRow}
                    onPress={() => {
                      // Jump to message in thread — tap navigates to channel, scrolls to message
                      if (item.channel_id) {
                        jumpToMessage(chatId, item.channel_id, item.message_id);
                      }
                    }}
                    activeOpacity={0.75}
                  >
                    <View style={styles.pollIconCol}>
                      <Ionicons
                        name="bar-chart-outline"
                        size={20}
                        color={isActive ? '#0FA6A6' : '#9CA3AF'}
                      />
                    </View>
                    <View style={styles.pollContent}>
                      <Text style={styles.pollQuestion} numberOfLines={2}>
                        {item.question}
                      </Text>
                      <Text style={styles.pollWinner} numberOfLines={1}>
                        Winning: {winner}
                      </Text>
                      <Text style={styles.pollMeta}>
                        {item.total_votes} vote{item.total_votes !== 1 ? 's' : ''} ·{' '}
                        {isActive ? 'Active' : 'Ended'}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color="#D1D5DB" />
                  </TouchableOpacity>
                );
              }}
            />
          )}
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FEFCF0' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  backBtn: { padding: 4, marginRight: 8 },
  headerTitle: {
    fontFamily: 'Zain_700Bold',
    fontSize: 17,
    color: '#1A1A1A',
    flex: 1,
    textAlign: 'center',
  },
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: '#0FA6A6',
  },
  tabLabel: {
    fontFamily: 'Zain_700Bold',
    fontSize: 14,
    color: '#9CA3AF',
  },
  tabLabelActive: {
    color: '#0FA6A6',
  },
  list: { paddingVertical: 8 },
  sectionLabel: {
    fontFamily: 'Zain_400Regular',
    fontSize: 12,
    color: '#9CA3AF',
    paddingHorizontal: 16,
    paddingVertical: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  memberInfo: { flex: 1 },
  memberName: {
    fontFamily: 'Zain_700Bold',
    fontSize: 15,
    color: '#1A1A1A',
  },
  memberSub: {
    fontFamily: 'Zain_400Regular',
    fontSize: 13,
    color: '#6B7280',
  },
  dmBtn: { padding: 6 },
  emptyText: {
    fontFamily: 'Zain_400Regular',
    fontSize: 14,
    color: '#9CA3AF',
  },
  pollRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  pollIconCol: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pollContent: { flex: 1 },
  pollQuestion: {
    fontFamily: 'Zain_700Bold',
    fontSize: 14,
    color: '#1A1A1A',
    lineHeight: 20,
  },
  pollWinner: {
    fontFamily: 'Zain_400Regular',
    fontSize: 13,
    color: '#0FA6A6',
    marginTop: 2,
  },
  pollMeta: {
    fontFamily: 'Zain_400Regular',
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: 2,
  },
});
