import { useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@weglue/shared';
import { useEventAttendees } from '../../hooks/useEventAttendees';
import { Avatar } from '../../components/shared/Avatar';
import { Pill } from '../../components/shared/Pill';
import { Skeleton } from '../../components/shared/SkeletonLoader';
import { useToast } from '../../components/Toast';
import { followUser } from '../../services/followService';
import { useQueryClient } from '@tanstack/react-query';
import type { EventAttendee } from '../../services/eventService';

export default function AttendeesScreen() {
  const { eventId } = useLocalSearchParams<{ eventId: string }>();
  const { session } = useAuthStore();
  const userId = session?.user.id;
  const router = useRouter();
  const queryClient = useQueryClient();
  const { show, ToastComponent } = useToast();

  const [search, setSearch] = useState('');
  const [followingIds, setFollowingIds] = useState<Set<string>>(new Set());

  const {
    data,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useEventAttendees(eventId, userId, search);

  const attendees = data?.pages.flatMap((p) => p.attendees) ?? [];
  const total = data?.pages[0]?.total ?? 0;

  const handleFollow = useCallback(
    async (targetId: string) => {
      if (!userId) return;
      try {
        await followUser(userId, targetId);
        setFollowingIds((prev) => new Set([...prev, targetId]));
        queryClient.invalidateQueries({ queryKey: ['eventAttendees', eventId, userId] });
        show('Following! 🎉');
      } catch {
        show('Failed to follow.', 'error');
      }
    },
    [userId, eventId, queryClient, show],
  );

  const renderAttendee = ({ item }: { item: EventAttendee }) => {
    const isFollowing = item.is_following || followingIds.has(item.id);
    const isMe = item.id === userId;

    return (
      <TouchableOpacity
        onPress={() => router.push({ pathname: '/profile/[userId]', params: { userId: item.id } })}
        activeOpacity={0.7}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 16,
          paddingVertical: 12,
          gap: 12,
        }}
      >
        <Avatar uri={item.avatar_url} size={46} username={item.username} />
        <Text
          style={{
            flex: 1,
            fontSize: 15,
            fontWeight: '600',
            color: '#111827',
            fontFamily: 'Inter_600SemiBold',
          }}
          numberOfLines={1}
        >
          {item.full_name || item.username}
        </Text>

        {/* Chat icon */}
        <TouchableOpacity
          activeOpacity={0.7}
          style={{
            width: 36,
            height: 36,
            borderRadius: 8,
            borderWidth: 1.5,
            borderColor: '#D1D5DB',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name="chatbox-outline" size={18} color="#374151" />
        </TouchableOpacity>

        {/* Follow / Gluemate pill */}
        {!isMe && (
          <Pill
            variant={item.is_gluemate ? 'gluemate' : isFollowing ? 'following' : 'follow'}
            label={item.is_gluemate ? 'Gluemate' : isFollowing ? 'Following' : 'Follow'}
            onPress={() => {
              if (!item.is_gluemate && !isFollowing) {
                handleFollow(item.id);
              }
            }}
          />
        )}
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#FEFCF0' }} edges={['top']}>
      {ToastComponent}

      {/* Header */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 16,
          paddingVertical: 12,
        }}
      >
        <TouchableOpacity onPress={() => router.back()} activeOpacity={0.7} hitSlop={{ top: 10, left: 10, right: 10, bottom: 10 }}>
          <Ionicons name="chevron-back" size={26} color="#111827" />
        </TouchableOpacity>
        <Text
          style={{
            flex: 1,
            textAlign: 'center',
            fontSize: 18,
            fontWeight: '700',
            color: '#111827',
            fontFamily: 'Zain_700Bold',
          }}
        >
          Attendees
        </Text>
        <View style={{ width: 26 }} />
      </View>

      {/* Going count */}
      <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
        <Text
          style={{
            fontSize: 17,
            fontWeight: '700',
            color: '#111827',
            fontFamily: 'Inter_700Bold',
          }}
        >
          {total} Going
        </Text>
      </View>

      {/* Search Bar */}
      <View
        style={{
          marginHorizontal: 16,
          marginBottom: 8,
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: '#fff',
          borderRadius: 12,
          borderWidth: 1,
          borderColor: '#E5E7EB',
          paddingHorizontal: 12,
          height: 44,
          gap: 8,
        }}
      >
        <Ionicons name="search" size={18} color="#9CA3AF" />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search attendees..."
          placeholderTextColor="#9CA3AF"
          style={{
            flex: 1,
            fontSize: 14,
            color: '#111827',
            fontFamily: 'Inter_400Regular',
          }}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')} activeOpacity={0.7}>
            <Ionicons name="close-circle" size={18} color="#9CA3AF" />
          </TouchableOpacity>
        )}
      </View>

      {isLoading ? (
        <View style={{ paddingHorizontal: 16, paddingTop: 8, gap: 16 }}>
          {[1, 2, 3, 4, 5].map((k) => (
            <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Skeleton width={46} height={46} borderRadius={23} />
              <Skeleton width={120} height={14} />
            </View>
          ))}
        </View>
      ) : (
        <FlatList<EventAttendee>
          data={attendees}
          keyExtractor={(item) => item.id}
          renderItem={renderAttendee}
          showsVerticalScrollIndicator={false}
          onEndReached={() => {
            if (hasNextPage && !isFetchingNextPage) fetchNextPage();
          }}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            isFetchingNextPage ? (
              <ActivityIndicator style={{ paddingVertical: 16 }} color="#0FA6A6" />
            ) : null
          }
          ListEmptyComponent={
            <View style={{ alignItems: 'center', paddingVertical: 40 }}>
              <Text style={{ color: '#9CA3AF', fontSize: 14, fontFamily: 'Inter_400Regular' }}>
                No attendees found.
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}
