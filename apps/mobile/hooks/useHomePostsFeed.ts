import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getHomePostsFeed, getPostById } from '../services/postService';
import { supabase } from '../lib/supabase';

export function useHomePostsFeed(userId: string | undefined) {
  return useInfiniteQuery({
    queryKey: ['homePostsFeed', userId],
    queryFn: ({ pageParam = 0 }) => getHomePostsFeed(userId!, pageParam),
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === 20 ? allPages.length : undefined,
    initialPageParam: 0,
    enabled: !!userId,
    staleTime: 2 * 60 * 1000,
  });
}

export function useLikePost() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, postId, hasLiked }: { userId: string; postId: string; hasLiked: boolean }) => {
      if (hasLiked) {
        await supabase.from('post_likes').delete().eq('user_id', userId).eq('post_id', postId);
      } else {
        await supabase.from('post_likes').upsert({ user_id: userId, post_id: postId }, { onConflict: 'post_id,user_id' });
      }
    },
    onSuccess: (_data, { userId, postId }) => {
      queryClient.invalidateQueries({ queryKey: ['homePostsFeed', userId] });
      queryClient.invalidateQueries({ queryKey: ['postDetail', postId] });
    },
  });
}

export function usePostDetail(postId: string | undefined, userId: string | undefined) {
  return useQuery({
    queryKey: ['postDetail', postId, userId],
    queryFn: () => getPostById(postId!, userId!),
    enabled: !!postId && !!userId,
    staleTime: 60 * 1000,
  });
}
