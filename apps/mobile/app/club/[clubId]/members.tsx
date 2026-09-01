import { useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  TextInput,
  RefreshControl,
  ActivityIndicator,
  Modal,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@weglue/shared';
import { useClubMembers } from '../../../hooks/useClubMembers';
import { Avatar } from '../../../components/shared/Avatar';
import { Skeleton } from '../../../components/shared/SkeletonLoader';
import { useToast } from '../../../components/Toast';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { followUser, unfollowUser } from '../../../services/followService';
import type { MemberWithFollowStatus } from '../../../services/clubTabService';
import { openDirectChatWith } from '../../../lib/chatNavigation';
import { openProfile } from '../../../lib/profileNavigation';
import { useOfficerStore } from '../../../store/officerStore';
import { ConfirmationModal } from '../../../components/chat/ConfirmationModal';
import { openReportFlow } from '../../../components/shared/ReportButton';
import { demoteClubOfficer, removeClubMemberByOfficer } from '../../../services/messagingService';

export type MembersParams = {
  clubId: string;
  filter?: string;
};

// ─── Follow Button ────────────────────────────────────────────────────────────
function FollowButton({
  member,
  viewerId,
  clubId,
  onFollowChange,
}: {
  member: MemberWithFollowStatus;
  viewerId: string;
  clubId: string;
  onFollowChange: () => void;
}) {
  const { mutate, isPending } = useMutation({
    mutationFn: () =>
      member.is_following
        ? unfollowUser(viewerId, member.id)
        : followUser(viewerId, member.id),
    onSuccess: onFollowChange,
  });

  if (member.is_gluemate) {
    return (
      <TouchableOpacity
        onPress={() => mutate()}
        disabled={isPending}
        activeOpacity={0.8}
        style={{
          paddingHorizontal: 14,
          paddingVertical: 8,
          borderRadius: 20,
          borderWidth: 1.5,
          borderColor: '#0FA6A6',
        }}
      >
        {isPending ? (
          <ActivityIndicator size="small" color="#0FA6A6" />
        ) : (
          <Text style={{ fontSize: 13, color: '#0FA6A6', fontFamily: 'Inter_600SemiBold' }}>
            Gluemate
          </Text>
        )}
      </TouchableOpacity>
    );
  }

  if (member.is_following) {
    return (
      <TouchableOpacity
        onPress={() => mutate()}
        disabled={isPending}
        activeOpacity={0.8}
        style={{
          paddingHorizontal: 14,
          paddingVertical: 8,
          borderRadius: 20,
          borderWidth: 1.5,
          borderColor: '#0FA6A6',
        }}
      >
        {isPending ? (
          <ActivityIndicator size="small" color="#0FA6A6" />
        ) : (
          <Text style={{ fontSize: 13, color: '#0FA6A6', fontFamily: 'Inter_600SemiBold' }}>
            Following
          </Text>
        )}
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      onPress={() => mutate()}
      disabled={isPending}
      activeOpacity={0.8}
      style={{
        paddingHorizontal: 18,
        paddingVertical: 8,
        borderRadius: 20,
        backgroundColor: '#0FA6A6',
      }}
    >
      {isPending ? (
        <ActivityIndicator size="small" color="#fff" />
      ) : (
        <Text style={{ fontSize: 13, color: '#fff', fontFamily: 'Inter_600SemiBold' }}>
          Follow
        </Text>
      )}
    </TouchableOpacity>
  );
}

// ─── Member Row ───────────────────────────────────────────────────────────────
function MemberRow({
  member,
  viewerId,
  clubId,
  viewerIsOfficer,
  onFollowChange,
  onOpenMenu,
}: {
  member: MemberWithFollowStatus;
  viewerId: string;
  clubId: string;
  viewerIsOfficer: boolean;
  onFollowChange: () => void;
  onOpenMenu: (member: MemberWithFollowStatus) => void;
}) {
  const router = useRouter();
  const isOwnProfile = member.id === viewerId;

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
        gap: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#F3F4F6',
      }}
    >
      {/* Avatar */}
      <TouchableOpacity
        onPress={() => openProfile(router, member.id, viewerId)}
        activeOpacity={0.7}
      >
        <Avatar uri={member.avatar_url} size={46} username={member.username} />
      </TouchableOpacity>

      {/* Name */}
      <TouchableOpacity
        style={{ flex: 1 }}
        onPress={() => openProfile(router, member.id, viewerId)}
        activeOpacity={0.7}
      >
        <Text
          style={{
            fontSize: 15,
            fontWeight: '600',
            color: '#111827',
            fontFamily: 'Inter_600SemiBold',
          }}
          numberOfLines={1}
        >
          {member.full_name || member.username}
        </Text>
        {member.full_name && member.username !== member.full_name && (
          <Text
            style={{
              fontSize: 12,
              color: '#9CA3AF',
              fontFamily: 'Inter_400Regular',
              marginTop: 1,
            }}
          >
            @{member.username}
          </Text>
        )}
      </TouchableOpacity>

      {/* Message icon */}
      {!isOwnProfile && (
        <TouchableOpacity
          onPress={() => void openDirectChatWith(member.id)}
          activeOpacity={0.7}
          style={{ padding: 4, marginRight: 4 }}
        >
          <Ionicons name="chatbubble-outline" size={18} color="#9CA3AF" />
        </TouchableOpacity>
      )}

      {/* Follow button */}
      {!isOwnProfile && (
        <FollowButton
          member={member}
          viewerId={viewerId}
          clubId={clubId}
          onFollowChange={onFollowChange}
        />
      )}

      {/* Officer moderation menu (Bug 14). Never on your own row; tapping name/
          avatar already opens the profile, so there is no "View Profile" item. */}
      {viewerIsOfficer && !isOwnProfile && (
        <TouchableOpacity
          onPress={() => onOpenMenu(member)}
          activeOpacity={0.7}
          style={{ padding: 4, marginLeft: 2 }}
          hitSlop={6}
          accessibilityLabel={`Manage ${member.full_name || member.username}`}
        >
          <Ionicons name="ellipsis-vertical" size={18} color="#9CA3AF" />
        </TouchableOpacity>
      )}
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function ClubMembersScreen() {
  const { clubId, filter } = useLocalSearchParams<MembersParams>();
  const gluematesOnly = filter === 'gluemates';
  const { session } = useAuthStore();
  const userId = session?.user.id ?? '';
  const router = useRouter();
  const queryClient = useQueryClient();
  const { show, ToastComponent } = useToast();
  const viewerIsOfficer = useOfficerStore((s) => (clubId ? s.officerClubIds.includes(clubId) : false));

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [menuMember, setMenuMember] = useState<MemberWithFollowStatus | null>(null);
  const [confirm, setConfirm] = useState<null | { kind: 'demote' | 'remove'; member: MemberWithFollowStatus }>(null);

  function refreshMembers() {
    queryClient.invalidateQueries({ queryKey: ['clubMembers', clubId] });
    queryClient.invalidateQueries({ queryKey: ['clubDetail', clubId] });
    queryClient.invalidateQueries({ queryKey: ['myChats'] });
    refetch();
  }
  async function doDemote(m: MemberWithFollowStatus) {
    setConfirm(null);
    try {
      await demoteClubOfficer(clubId!, m.id);
      refreshMembers();
      show('Officer role removed');
    } catch (e: any) {
      show(
        e?.message?.includes('cannot_remove_self')
          ? "You can't remove your own officer role here."
          : e?.message?.includes('last_officer')
            ? 'Assign another officer first.'
            : 'Could not remove officer role.',
      );
    }
  }
  async function doRemove(m: MemberWithFollowStatus) {
    setConfirm(null);
    try {
      await removeClubMemberByOfficer(clubId!, m.id);
      refreshMembers();
      show('Removed from club');
    } catch (e: any) {
      show(
        e?.message?.includes('demote_officer_first')
          ? 'Remove their officer role first.'
          : e?.message?.includes('use_leave_club')
            ? 'Use Leave club for your own membership.'
            : 'Could not remove from club.',
      );
    }
  }

  const { data, isLoading, refetch, isFetching } = useClubMembers(
    clubId,
    userId,
    search,
    page,
    gluematesOnly,
  );

  const handleFollowChange = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['clubMembers', clubId, userId] });
  }, [clubId, userId]);

  function handleSearch(text: string) {
    setSearch(text);
    setPage(0);
  }

  function clearSearch() {
    setSearch('');
    setPage(0);
  }

  const members = data?.members ?? [];
  const total = data?.total ?? 0;
  const hasMore = members.length < total && members.length > 0;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#FEFCF0' }} edges={['top']}>
      {ToastComponent}

      {/* ── Header ───────────────────────────────────────────── */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 16,
          paddingVertical: 12,
          borderBottomWidth: 1,
          borderBottomColor: '#F3F4F6',
        }}
      >
        <TouchableOpacity onPress={() => router.back()} activeOpacity={0.7} style={{ marginRight: 12 }}>
          <Ionicons name="chevron-back" size={26} color="#111827" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 18, fontWeight: '700', color: '#111827', fontFamily: 'Zain_700Bold' }}>
            {gluematesOnly ? 'Gluemates' : 'Members'}
          </Text>
          {total > 0 && (
            <Text style={{ fontSize: 13, color: '#9CA3AF', fontFamily: 'Inter_400Regular' }}>
              {total} {gluematesOnly ? 'gluemate' : 'member'}{total !== 1 ? 's' : ''}
            </Text>
          )}
        </View>
      </View>

      {/* ── Search Bar ───────────────────────────────────────── */}
      <View
        style={{
          paddingHorizontal: 16,
          paddingVertical: 12,
          borderBottomWidth: 1,
          borderBottomColor: '#F3F4F6',
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: '#fff',
            borderRadius: 12,
            borderWidth: 1,
            borderColor: '#E5E7EB',
            paddingHorizontal: 12,
            paddingVertical: 8,
            gap: 8,
          }}
        >
          <Ionicons name="search-outline" size={18} color="#9CA3AF" />
          <TextInput
            value={search}
            onChangeText={handleSearch}
            placeholder="Search members..."
            placeholderTextColor="#9CA3AF"
            style={{
              flex: 1,
              fontSize: 15,
              color: '#111827',
              fontFamily: 'Inter_400Regular',
              paddingVertical: 0,
            }}
            returnKeyType="search"
            autoCorrect={false}
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={clearSearch} activeOpacity={0.7}>
              <Ionicons name="close-circle" size={18} color="#9CA3AF" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* ── Skeleton loading ─────────────────────────────────── */}
      {isLoading ? (
        <View style={{ padding: 16, gap: 0 }}>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <View
              key={i}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                paddingVertical: 12,
                borderBottomWidth: 1,
                borderBottomColor: '#F3F4F6',
              }}
            >
              <Skeleton width={46} height={46} borderRadius={23} />
              <View style={{ flex: 1, gap: 6 }}>
                <Skeleton width={130} height={14} borderRadius={7} />
                <Skeleton width={90} height={12} borderRadius={6} />
              </View>
              <Skeleton width={72} height={34} borderRadius={17} />
            </View>
          ))}
        </View>
      ) : (
        <FlatList
          data={members}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <MemberRow
              member={item}
              viewerId={userId}
              clubId={clubId!}
              viewerIsOfficer={viewerIsOfficer}
              onFollowChange={handleFollowChange}
              onOpenMenu={setMenuMember}
            />
          )}
          refreshControl={
            <RefreshControl
              refreshing={isFetching && !isLoading}
              onRefresh={() => { setPage(0); refetch(); }}
              tintColor="#0FA6A6"
            />
          }
          ListEmptyComponent={
            <View style={{ alignItems: 'center', justifyContent: 'center', paddingTop: 60, gap: 10 }}>
              <Ionicons name="people-outline" size={40} color="#D1D5DB" />
              <Text style={{ color: '#9CA3AF', fontSize: 14, fontFamily: 'Inter_400Regular' }}>
                {search
                  ? `No ${gluematesOnly ? 'gluemates' : 'members'} found for that search.`
                  : gluematesOnly
                    ? 'No gluemates in this club yet.'
                    : 'No members yet.'}
              </Text>
            </View>
          }
          ListFooterComponent={
            hasMore ? (
              <TouchableOpacity
                onPress={() => setPage((p) => p + 1)}
                disabled={isFetching}
                activeOpacity={0.7}
                style={{ padding: 16, alignItems: 'center' }}
              >
                {isFetching ? (
                  <ActivityIndicator size="small" color="#0FA6A6" />
                ) : (
                  <Text style={{ color: '#0FA6A6', fontFamily: 'Inter_500Medium', fontSize: 14 }}>
                    Load more
                  </Text>
                )}
              </TouchableOpacity>
            ) : null
          }
          contentContainerStyle={{ flexGrow: 1 }}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* ── Officer moderation menu (Bug 14) ── */}
      <Modal visible={!!menuMember} transparent animationType="fade" onRequestClose={() => setMenuMember(null)}>
        <TouchableOpacity style={menuStyles.overlay} activeOpacity={1} onPress={() => setMenuMember(null)}>
          <View style={menuStyles.card}>
            {menuMember?.role === 'officer' && (
              <TouchableOpacity
                style={menuStyles.row}
                onPress={() => {
                  const m = menuMember;
                  setMenuMember(null);
                  setConfirm({ kind: 'demote', member: m });
                }}
              >
                <Ionicons name="remove-circle-outline" size={19} color="#C62828" />
                <Text style={[menuStyles.label, { color: '#C62828' }]}>Remove officer role</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={menuStyles.row}
              onPress={() => {
                const m = menuMember!;
                setMenuMember(null);
                setConfirm({ kind: 'remove', member: m });
              }}
            >
              <Ionicons name="person-remove-outline" size={19} color="#C62828" />
              <Text style={[menuStyles.label, { color: '#C62828' }]}>Remove from club</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={menuStyles.row}
              onPress={() => {
                const m = menuMember!;
                setMenuMember(null);
                openReportFlow({ entityType: 'user', entityId: m.id, entityName: m.full_name || m.username });
              }}
            >
              <Ionicons name="flag-outline" size={19} color="#111827" />
              <Text style={menuStyles.label}>Report</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      <ConfirmationModal
        visible={confirm?.kind === 'demote'}
        title="Remove officer role?"
        message={`${confirm?.member.full_name || confirm?.member.username || 'This person'} will stay a club member but lose officer access, including the Officers chat and its channels.`}
        confirmLabel="Remove officer role"
        destructive
        onConfirm={() => confirm && doDemote(confirm.member)}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmationModal
        visible={confirm?.kind === 'remove'}
        title="Remove from club?"
        message={`${confirm?.member.full_name || confirm?.member.username || 'This person'} will be removed from the club and all of its chats. Their We Glue account, posts and other clubs are not affected.`}
        confirmLabel="Remove from club"
        destructive
        onConfirm={() => confirm && doRemove(confirm.member)}
        onCancel={() => setConfirm(null)}
      />
    </SafeAreaView>
  );
}

const menuStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center', padding: 32 },
  card: { backgroundColor: '#FEFCF0', borderRadius: 16, paddingVertical: 6, minWidth: 260 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingVertical: 13 },
  label: { fontFamily: 'Inter_500Medium', fontSize: 14, color: '#111827' },
});
