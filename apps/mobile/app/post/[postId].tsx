import { ScrollView, View, Text, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@weglue/shared';
import { useQueryClient } from '@tanstack/react-query';
import { usePostDetail, useLikePost } from '../../hooks/useHomePostsFeed';
import { PostCard } from '../../components/home/PostsFeed';
import { PostCardSkeleton } from '../../components/shared/SkeletonLoader';
import { useToast } from '../../components/Toast';
import { followUser } from '../../services/followService';

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

  async function handleFollow(authorId: string) {
    if (!userId) return;
    try {
      await followUser(userId, authorId);
      queryClient.invalidateQueries({ queryKey: ['postDetail', postId] });
      show('Following! 🎉');
    } catch {
      show('Failed to follow user.', 'error');
    }
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
          <PostCard post={post} viewerUserId={userId ?? ''} onLike={handleLike} onFollow={handleFollow} onShowToast={show} />
        ) : (
          <View style={{ padding: 40, alignItems: 'center' }}>
            <Text style={{ color: '#9CA3AF', fontSize: 14, fontFamily: 'Inter_400Regular' }}>
              This post is no longer available.
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
