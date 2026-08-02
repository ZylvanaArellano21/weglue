import { useState } from 'react';
import { ScrollView, View, Text, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@weglue/shared';
import { useQueryClient } from '@tanstack/react-query';
import { usePostDetail, useLikePost } from '../../hooks/useHomePostsFeed';
import { PostCard } from '../../components/home/PostCard';
import { PostCardSkeleton } from '../../components/shared/SkeletonLoader';
import { ConfirmModal } from '../../components/ConfirmModal';
import { useToast } from '../../components/Toast';
import { followUser, unfollowUser } from '../../services/followService';
import { CONTENT_UNAVAILABLE } from '../../lib/contentAvailability';
import type { FeedPost } from '../../services/postService';

export default function PostDetailScreen() {
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const { session } = useAuthStore();
  const userId = session?.user.id;
  const router = useRouter();
  const queryClient = useQueryClient();
  const { show, ToastComponent } = useToast();

  const { data: post, isLoading } = usePostDetail(postId, userId);
  const { mutate: likePost } = useLikePost();

  function handleLike(id: string, hasLiked: boolean) {
    if (!userId) return;
    likePost(
      { userId, postId: id, hasLiked },
      {
        onSuccess: () => show(hasLiked ? 'Like removed' : 'Post liked! ❤️'),
        onError: () => show('Failed to like post.', 'error'),
      },
    );
  }

  function invalidateRelationshipQueries() {
    queryClient.invalidateQueries({ queryKey: ['postDetail', postId] });
    queryClient.invalidateQueries({ queryKey: ['homePostsFeed', userId] });
    queryClient.invalidateQueries({ queryKey: ['userProfile'] });
  }

  // Starting a follow is immediate; stopping one confirms first (same rules
  // as the Home posts feed).
  async function handleFollow(author: FeedPost['author']) {
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
  }

  const [unfollowTarget, setUnfollowTarget] = useState<FeedPost['author'] | null>(null);

  async function performUnfollow(author: FeedPost['author'], successMessage: string) {
    if (!userId) return;
    try {
      await unfollowUser(userId, author.id);
      invalidateRelationshipQueries();
      show(successMessage);
    } catch {
      show('Failed to unfollow.', 'error');
    }
  }

  function handleRequestUnfollow(author: FeedPost['author']) {
    if (!author.is_following && author.is_requested) {
      void performUnfollow(author, 'Request canceled.');
      return;
    }
    setUnfollowTarget(author);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#FEFCF0' }} edges={['top']}>
      {ToastComponent}
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
        <Text style={{ fontSize: 18, fontWeight: '700', color: '#111827', fontFamily: 'Zain_700Bold' }}>
          Post
        </Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingTop: 8, paddingBottom: 24 }}>
        {isLoading ? (
          <PostCardSkeleton />
        ) : post ? (
          <PostCard
            post={post}
            viewerUserId={userId ?? ''}
            onLike={handleLike}
            onFollow={handleFollow}
            onRequestUnfollow={handleRequestUnfollow}
            onShowToast={show}
          />
        ) : (
          <View style={{ padding: 40, alignItems: 'center' }}>
            <Text style={{ color: '#9CA3AF', fontSize: 14, fontFamily: 'Inter_400Regular' }}>
              {CONTENT_UNAVAILABLE}
            </Text>
          </View>
        )}
      </ScrollView>

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
        onConfirm={() => {
          const author = unfollowTarget;
          setUnfollowTarget(null);
          if (author) void performUnfollow(author, 'Unfollowed.');
        }}
        onCancel={() => setUnfollowTarget(null)}
      />
    </SafeAreaView>
  );
}
