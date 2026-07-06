import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getHomePostsFeed, getPostById, getPostComments, addComment } from '../services/postService';
import { supabase } from '../lib/supabase';
import { timedQuery } from '../lib/timedQuery';

export function useHomePostsFeed(userId: string | undefined) {
  return useInfiniteQuery({
    queryKey: ['homePostsFeed', userId],
    queryFn: ({ pageParam = 0 }) =>
      timedQuery(`homePostsFeed p${pageParam}`, getHomePostsFeed(userId!, pageParam)),
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
    queryFn: () => timedQuery('postDetail', getPostById(postId!, userId!)),
    enabled: !!postId && !!userId,
    staleTime: 60 * 1000,
  });
}

export function usePostComments(postId: string | undefined) {
  return useQuery({
    queryKey: ['postComments', postId],
    queryFn: () => getPostComments(postId!),
    enabled: !!postId,
    staleTime: 30 * 1000,
  });
}

export function useAddComment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ postId, userId, content }: { postId: string; userId: string; content: string }) =>
      addComment(postId, userId, content),
    onSuccess: (_data, { postId }) => {
      queryClient.invalidateQueries({ queryKey: ['postComments', postId] });
      queryClient.invalidateQueries({ queryKey: ['homePostsFeed'] });
      queryClient.invalidateQueries({ queryKey: ['postDetail', postId] });
    },
  });
}
