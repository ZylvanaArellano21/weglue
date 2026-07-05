import { useCallback, useState } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  FlatList,
  RefreshControl,
  Share,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@weglue/shared';
import { useHomePostsFeed, useLikePost } from '../../hooks/useHomePostsFeed';
import { PostCardSkeleton } from '../shared/SkeletonLoader';
import { Avatar } from '../shared/Avatar';
import { Pill } from '../shared/Pill';
import { useToast } from '../Toast';
import { followUser } from '../../services/followService';
import { useQueryClient } from '@tanstack/react-query';
import type { FeedPost } from '../../services/postService';
import { CommentsSheet } from './CommentsSheet';

export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
  if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
}

export interface PostCardProps {
  post: FeedPost;
  viewerUserId: string;
  onLike: (postId: string, hasLiked: boolean) => void;
  onFollow: (authorId: string) => void;
}

export function PostCard({ post, viewerUserId, onLike, onFollow }: PostCardProps) {
  const router = useRouter();
  const [commentsVisible, setCommentsVisible] = useState(false);

  const handlePressAuthor = () => {
    router.push({ pathname: '/profile/[userId]', params: { userId: post.author.id } });
  };

  const handlePressClub = (clubId: string) => {
    router.push({ pathname: '/(tabs)/clubs/[clubId]', params: { clubId } });
  };

  const handleShare = async () => {
    try {
      await Share.share({
        title: `@${post.author.username}'s post`,
        message: `Check out this post on We Glue: weglue://post/${post.id}`,
        url: `weglue://post/${post.id}`,
      });
    } catch {
      // User dismissed share sheet — no action needed
    }
  };

  const isOwnPost = post.author.id === viewerUserId;

  return (
    <View
      style={{
        backgroundColor: '#fff',
        borderRadius: 16,
        marginHorizontal: 16,
        marginBottom: 16,
        overflow: 'hidden',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.07,
        shadowRadius: 8,
        elevation: 3,
      }}
    >
      {/* Author Row */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 12,
          paddingVertical: 10,
          gap: 10,
        }}
      >
        <TouchableOpacity onPress={handlePressAuthor} activeOpacity={0.7}>
          <Avatar uri={post.author.avatar_url} size={40} username={post.author.username} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <TouchableOpacity onPress={handlePressAuthor} activeOpacity={0.7}>
            <Text
              style={{
                fontSize: 14,
                fontWeight: '700',
                color: '#111827',
                fontFamily: 'Inter_700Bold',
              }}
            >
              @{post.author.username}
            </Text>
          </TouchableOpacity>
          {post.tagged_clubs.length > 0 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginTop: 2 }}>
              <Text style={{ fontSize: 13, color: '#6B7280', fontFamily: 'Inter_400Regular' }}>
                tag{' '}
              </Text>
              {post.tagged_clubs.map((club, idx) => (
                <TouchableOpacity key={club.id} onPress={() => handlePressClub(club.id)} activeOpacity={0.7}>
                  <Text style={{ fontSize: 13, color: '#0FA6A6', fontFamily: 'Inter_400Regular' }}>
                    {club.name}
                    {idx < post.tagged_clubs.length - 1 ? ', ' : ''}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
        {!isOwnPost && (
          <Pill
            variant={post.author.is_following ? 'following' : 'follow'}
            onPress={() => !post.author.is_following && onFollow(post.author.id)}
          />
        )}
      </View>

      {/* Post Image */}
      {post.image_url ? (
        <Image
          source={{ uri: post.image_url }}
          style={{ width: '100%', aspectRatio: 4 / 5 }}
          resizeMode="cover"
        />
      ) : null}

      {/* Interaction Row */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 12,
          paddingTop: 12,
          gap: 20,
        }}
      >
        <TouchableOpacity
          onPress={() => onLike(post.id, post.user_has_liked)}
          activeOpacity={0.7}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}
        >
          <Ionicons
            name={post.user_has_liked ? 'heart' : 'heart-outline'}
            size={22}
            color={post.user_has_liked ? '#F02719' : '#374151'}
          />
          <Text style={{ fontSize: 13, color: '#374151', fontFamily: 'Inter_400Regular' }}>
            {post.likes_count}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setCommentsVisible(true)}
          activeOpacity={0.7}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}
        >
          <Ionicons name="chatbubble-outline" size={20} color="#374151" />
          <Text style={{ fontSize: 13, color: '#374151', fontFamily: 'Inter_400Regular' }}>
            {post.comments_count}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={handleShare}
          activeOpacity={0.7}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}
        >
          <Ionicons name="arrow-redo-outline" size={20} color="#374151" />
        </TouchableOpacity>
      </View>

      <CommentsSheet
        visible={commentsVisible}
        postId={post.id}
        viewerUserId={viewerUserId}
        onClose={() => setCommentsVisible(false)}
      />

      {/* Caption */}
      <View style={{ paddingHorizontal: 12, paddingTop: 8, paddingBottom: 12 }}>
        {post.caption ? (
          <Text style={{ fontSize: 14, color: '#111827', fontFamily: 'Inter_400Regular' }}>
            <Text style={{ fontWeight: '700', fontFamily: 'Inter_700Bold' }}>
              @{post.author.username}{' '}
            </Text>
            {post.caption}
          </Text>
        ) : null}
        <Text
          style={{
            fontSize: 12,
            color: '#9CA3AF',
            fontFamily: 'Inter_400Regular',
            marginTop: 6,
          }}
        >
          {timeAgo(post.created_at)}
        </Text>
      </View>
    </View>
  );
}

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
    isRefetching,
  } = useHomePostsFeed(userId);

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
        renderItem={({ item }) => (
          <PostCard
            post={item}
            viewerUserId={userId ?? ''}
            onLike={handleLike}
            onFollow={handleFollow}
          />
        )}
        contentContainerStyle={{ paddingTop: 8, paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
        onEndReached={() => {
          if (hasNextPage && !isFetchingNextPage) fetchNextPage();
        }}
        onEndReachedThreshold={0.5}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor="#0FA6A6"
            colors={['#0FA6A6']}
          />
        }
      />
    </View>
  );
}
