import { useCallback, useState } from 'react';
import { View, Text, FlatList, RefreshControl } from 'react-native';
import { useAuthStore } from '@weglue/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useHomePostsFeed, useLikePost } from '../../hooks/useHomePostsFeed';
import { PostCardSkeleton } from '../shared/SkeletonLoader';
import { useToast } from '../Toast';
import { followUser } from '../../services/followService';
import { PostCard } from './PostCard';
import type { FeedPost } from '../../services/postService';

export function PostsFeed() {
  const { session } = useAuthStore();
  const userId = session?.user.id;
  const queryClient = useQueryClient();
  const { show, ToastComponent } = useToast();

  const {
    data,
    isLoading,
    isError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    refetch,
  } = useHomePostsFeed(userId);

  // Pull-to-refresh state kept separate from background refetches (likes,
  // invalidations) so the spinner only shows for a real pull.
  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  }, [refetch]);

  const { mutate: likePost } = useLikePost();

  const allPosts = data?.pages.flatMap((p) => p) ?? [];

  const handleLike = useCallback(
    (postId: string, hasLiked: boolean) => {
      if (!userId) return;
      likePost(
        { userId, postId, hasLiked },
        {
          onSuccess: () => show(hasLiked ? 'Like removed' : 'Post liked! ❤️'),
          onError: () => show('Failed to like post.', 'error'),
        },
      );
    },
    [userId, likePost, show],
  );

  const handleFollow = useCallback(
    async (authorId: string) => {
      if (!userId) return;
      try {
        await followUser(userId, authorId);
        queryClient.invalidateQueries({ queryKey: ['homePostsFeed', userId] });
        show('Following! 🎉');
      } catch {
        show('Failed to follow user.', 'error');
      }
    },
    [userId, queryClient, show],
  );

  const renderItem = useCallback(
    ({ item }: { item: FeedPost }) => (
      <PostCard
        post={item}
        viewerUserId={userId ?? ''}
        onLike={handleLike}
        onFollow={handleFollow}
        onShowToast={show}
      />
    ),
    [userId, handleLike, handleFollow, show],
  );

  if (isLoading) {
    return (
      <View style={{ paddingTop: 8 }}>
        {[1, 2].map((k) => (
          <PostCardSkeleton key={k} />
        ))}
      </View>
    );
  }

  if (isError) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
        <Text style={{ color: '#6B7280', textAlign: 'center', fontSize: 15 }}>
          Something went wrong loading posts.
        </Text>
      </View>
    );
  }

  if (allPosts.length === 0) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 }}>
        <Text style={{ fontSize: 40, marginBottom: 16 }}>📸</Text>
        <Text
          style={{
            fontSize: 16,
            fontWeight: '600',
            color: '#374151',
            textAlign: 'center',
            fontFamily: 'Zain_700Bold',
            marginBottom: 8,
          }}
        >
          No posts yet.
        </Text>
        <Text
          style={{
            fontSize: 14,
            color: '#9CA3AF',
            textAlign: 'center',
            fontFamily: 'Inter_400Regular',
          }}
        >
          Follow people to see their posts!
        </Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      {ToastComponent}
      <FlatList<FeedPost>
        data={allPosts}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={{ paddingTop: 8, paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
        onEndReached={() => {
          if (hasNextPage && !isFetchingNextPage) fetchNextPage();
        }}
        onEndReachedThreshold={0.5}
        windowSize={7}
        maxToRenderPerBatch={6}
        initialNumToRender={6}
        removeClippedSubviews
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor="#0FA6A6"
            colors={['#0FA6A6']}
          />
        }
      />
    </View>
  );
}
