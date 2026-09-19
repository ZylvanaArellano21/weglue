import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, FlatList, RefreshControl, Platform } from 'react-native';
import { useAuthStore } from '@weglue/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useHomePostsFeed, useLikePost } from '../../hooks/useHomePostsFeed';
import { useHomeTabStore } from '../../store/homeTabStore';
import { PostCardSkeleton } from '../shared/SkeletonLoader';
import { useToast } from '../Toast';
import { followUser, unfollowUser } from '../../services/followService';
import { ConfirmModal } from '../ConfirmModal';
import { PostCard } from './PostCard';
import type { FeedPost } from '../../services/postService';

export function PostsFeed() {
  // Selector, not `useAuthStore()`: the store's default subscription is to the
  // WHOLE object, so a bare destructure re-renders this feed on every
  // unrelated store field change (e.g. every `setLoading` toggle during a
  // profile-sync pass in app/_layout.tsx), not just when the session changes.
  const userId = useAuthStore((s) => s.session?.user.id);
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

  // Flatten + dedupe by id so a post can never render twice (e.g. when a new
  // post shifts pagination windows between page fetches).
  const allPosts = useMemo(() => {
    const seen = new Set<string>();
    const posts: FeedPost[] = [];
    for (const post of data?.pages.flat() ?? []) {
      if (seen.has(post.id)) continue;
      seen.add(post.id);
      posts.push(post);
    }
    return posts;
  }, [data]);

  // ── Scroll to a freshly created post ────────────────────────────────────────
  // After creating a normal post, new-post.tsx sets pendingScrollPostId. As
  // soon as that post shows up in the feed data (the feed was invalidated
  // before navigating back, so it may land a moment later), scroll straight
  // to it so the user immediately sees what they shared.
  const listRef = useRef<FlatList<FeedPost>>(null);
  const pendingScrollPostId = useHomeTabStore((s) => s.pendingScrollPostId);

  useEffect(() => {
    if (!pendingScrollPostId) return;
    const index = allPosts.findIndex((p) => p.id === pendingScrollPostId);
    if (index < 0) return; // feed still refetching — try again on next data change
    useHomeTabStore.getState().setPendingScrollPostId(null);
    // Give the list one frame to lay out before scrolling.
    requestAnimationFrame(() => {
      listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0 });
    });
  }, [pendingScrollPostId, allPosts]);

  // Drop a stale pending scroll if the post never appears (e.g. moderation
  // delay) so it can't hijack a scroll position minutes later.
  useEffect(() => {
    if (!pendingScrollPostId) return;
    const timer = setTimeout(() => {
      if (useHomeTabStore.getState().pendingScrollPostId === pendingScrollPostId) {
        useHomeTabStore.getState().setPendingScrollPostId(null);
      }
    }, 15000);
    return () => clearTimeout(timer);
  }, [pendingScrollPostId]);

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

  const invalidateRelationshipQueries = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['homePostsFeed', userId] });
    queryClient.invalidateQueries({ queryKey: ['userProfile'] });
    queryClient.invalidateQueries({ queryKey: ['ownProfile', userId] });
    queryClient.invalidateQueries({ queryKey: ['ownGluemates', userId] });
  }, [queryClient, userId]);

  // Starting a follow (Follow / Follow back) is immediate — no confirmation.
  const handleFollow = useCallback(
    async (author: FeedPost['author']) => {
      if (!userId) return;
      try {
        await followUser(userId, author.id);
        invalidateRelationshipQueries();
        show(
          author.profile_is_private
            ? 'Follow request sent!'
            : author.follows_me
              ? "You're now Gluemates! 🎉"
              : 'Following! 🎉',
        );
      } catch {
        show('Failed to follow user.', 'error');
      }
    },
    [userId, invalidateRelationshipQueries, show],
  );

  // Stopping a follow always confirms first. Canceling a pending request is
  // immediate (matches the profile screen's Requested button).
  const [unfollowTarget, setUnfollowTarget] = useState<FeedPost['author'] | null>(null);

  const performUnfollow = useCallback(
    async (author: FeedPost['author'], successMessage: string) => {
      if (!userId) return;
      try {
        await unfollowUser(userId, author.id);
        invalidateRelationshipQueries();
        show(successMessage);
      } catch {
        show('Failed to unfollow.', 'error');
      }
    },
    [userId, invalidateRelationshipQueries, show],
  );

  const handleRequestUnfollow = useCallback(
    (author: FeedPost['author']) => {
      if (!author.is_following && author.is_requested) {
        void performUnfollow(author, 'Request canceled.');
        return;
      }
      setUnfollowTarget(author);
    },
    [performUnfollow],
  );

  const confirmUnfollow = useCallback(() => {
    if (!unfollowTarget) return;
    const author = unfollowTarget;
    setUnfollowTarget(null);
    void performUnfollow(author, 'Unfollowed.');
  }, [unfollowTarget, performUnfollow]);

  const renderItem = useCallback(
    ({ item }: { item: FeedPost }) => (
      <PostCard
        post={item}
        viewerUserId={userId ?? ''}
        onLike={handleLike}
        onFollow={handleFollow}
        onRequestUnfollow={handleRequestUnfollow}
        onShowToast={show}
      />
    ),
    [userId, handleLike, handleFollow, handleRequestUnfollow, show],
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
        ref={listRef}
        data={allPosts}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        onScrollToIndexFailed={({ index }) => {
          // Post cards vary in height, so distant indexes may not be measured
          // yet — jump to top (new posts are newest-first) as a safe landing.
          listRef.current?.scrollToOffset({ offset: 0, animated: true });
          setTimeout(() => {
            listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0 });
          }, 350);
        }}
        contentContainerStyle={{ paddingTop: 8, paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
        // Post cards have variable, unpredictable heights (image ratio, caption
        // length, single vs carousel) so the list has no getItemLayout. Removing
        // the async image measurement (`stableHeightOnly` on the card's
        // PhotoCarousel) is what keeps the content height stable; anchoring the
        // scroll position on top of that (maintainVisibleContentPosition) stops
        // the user being snapped off the true bottom by any residual estimate
        // shift. iOS only — on Android the prop also holds the scroll far
        // enough from the end that onEndReached never fires.
        maintainVisibleContentPosition={
          Platform.OS === 'ios' ? { minIndexForVisible: 0 } : undefined
        }
        onEndReached={() => {
          if (hasNextPage && !isFetchingNextPage) fetchNextPage();
        }}
        onEndReachedThreshold={0.5}
        windowSize={9}
        maxToRenderPerBatch={6}
        initialNumToRender={6}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor="#0FA6A6"
            colors={['#0FA6A6']}
          />
        }
      />

      <ConfirmModal
        visible={!!unfollowTarget}
        title={`Unfollow @${unfollowTarget?.username ?? ''}?`}
        message={
          unfollowTarget?.follows_me
            ? `You'll no longer be Gluemates. @${unfollowTarget?.username ?? ''} will still follow you.`
            : `You'll stop following @${unfollowTarget?.username ?? ''}.`
        }
        confirmLabel="Unfollow"
        cancelLabel="Cancel"
        destructive
        onConfirm={confirmUnfollow}
        onCancel={() => setUnfollowTarget(null)}
      />
    </View>
  );
}
