import { useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  TextInput,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@weglue/shared';
import { useClubMembers } from '../../../../hooks/useClubMembers';
import { Avatar } from '../../../../components/shared/Avatar';
import { Skeleton } from '../../../../components/shared/SkeletonLoader';
import { useToast } from '../../../../components/Toast';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { followUser, unfollowUser } from '../../../../services/followService';
import type { MemberWithFollowStatus } from '../../../../services/clubTabService';

export type MembersParams = {
  clubId: string;
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
  onFollowChange,
}: {
  member: MemberWithFollowStatus;
  viewerId: string;
  clubId: string;
  onFollowChange: () => void;
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
        onPress={() => router.push({ pathname: '/profile/[userId]', params: { userId: member.id } })}
        activeOpacity={0.7}
      >
        <Avatar uri={member.avatar_url} size={46} username={member.username} />
      </TouchableOpacity>

      {/* Name */}
      <TouchableOpacity
        style={{ flex: 1 }}
        onPress={() => router.push({ pathname: '/profile/[userId]', params: { userId: member.id } })}
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
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function ClubMembersScreen() {
  const { clubId } = useLocalSearchParams<MembersParams>();
  const { session } = useAuthStore();
  const userId = session?.user.id ?? '';
  const router = useRouter();
  const queryClient = useQueryClient();
  const { show, ToastComponent } = useToast();

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);

  const { data, isLoading, refetch, isFetching } = useClubMembers(clubId, userId, search, page);

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
            Members
          </Text>
          {total > 0 && (
            <Text style={{ fontSize: 13, color: '#9CA3AF', fontFamily: 'Inter_400Regular' }}>
              {total} member{total !== 1 ? 's' : ''}
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
              onFollowChange={handleFollowChange}
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
                {search ? 'No members found for that search.' : 'No members yet.'}
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
    </SafeAreaView>
  );
}
