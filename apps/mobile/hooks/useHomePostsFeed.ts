import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  getHomePostsFeed,
  getPostById,
  getPostComments,
  addComment,
  getUserPostsFeed,
  updatePostCaption,
  type FeedPost,
} from '../services/postService';
import { supabase } from '../lib/supabase';
import { timedQuery } from '../lib/timedQuery';

// Applies a patch to one post everywhere it may be cached: the Home feed and
// profile viewer infinite queries plus the single post-detail query. Used for
// optimistic like updates so the heart/count flips instantly.
export function patchPostInCaches(
  queryClient: QueryClient,
  postId: string,
  patch: (post: FeedPost) => FeedPost,
): void {
  for (const prefix of ['homePostsFeed', 'userPostsFeed']) {
    queryClient.setQueriesData({ queryKey: [prefix] }, (old: any) => {
      if (!old?.pages) return old;
      return {
        ...old,
        pages: old.pages.map((page: FeedPost[]) =>
          page.map((p) => (p.id === postId ? patch(p) : p)),
        ),
      };
    });
  }
  queryClient.setQueriesData({ queryKey: ['postDetail'] }, (old: any) =>
    old && old.id === postId ? patch(old) : old,
  );
  // Club Photos that Glue viewer: items wrap a post ({ photo, post }).
  queryClient.setQueriesData({ queryKey: ['clubPhotoFeed'] }, (old: any) => {
    if (!Array.isArray(old)) return old;
    return old.map((item: any) =>
      item?.post?.id === postId ? { ...item, post: patch(item.post) } : item,
    );
  });
}

// Removes a post from every cached list immediately (delete flow).
export function removePostFromCaches(queryClient: QueryClient, postId: string): void {
  for (const prefix of ['homePostsFeed', 'userPostsFeed', 'ownPosts', 'userPosts']) {
    queryClient.setQueriesData({ queryKey: [prefix] }, (old: any) => {
      if (!old?.pages) return old;
      return {
        ...old,
        pages: old.pages.map((page: any[]) => page.filter((p) => p.id !== postId)),
      };
    });
  }
  queryClient.setQueriesData({ queryKey: ['clubPhotoFeed'] }, (old: any) => {
    if (!Array.isArray(old)) return old;
    return old.filter((item: any) => item?.post?.id !== postId);
  });
  // Deleted posts also vanish from every club's Photos that Glue (the
  // club_photos rows cascade server-side); refetch the club caches.
  queryClient.invalidateQueries({ queryKey: ['clubPhotoFeed'] });
  queryClient.invalidateQueries({ queryKey: ['clubProfile'] });
}

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
    // Optimistic: flip the heart + count in every cache immediately.
    onMutate: async ({ postId, hasLiked }) => {
      await queryClient.cancelQueries({ queryKey: ['homePostsFeed'] });
      await queryClient.cancelQueries({ queryKey: ['userPostsFeed'] });
      await queryClient.cancelQueries({ queryKey: ['postDetail'] });
      patchPostInCaches(queryClient, postId, (p) => ({
        ...p,
        user_has_liked: !hasLiked,
        likes_count: Math.max(0, p.likes_count + (hasLiked ? -1 : 1)),
      }));
    },
    onError: (_err, { postId, hasLiked }) => {
      // Roll the optimistic flip back
      patchPostInCaches(queryClient, postId, (p) => ({
        ...p,
        user_has_liked: hasLiked,
        likes_count: Math.max(0, p.likes_count + (hasLiked ? 1 : -1)),
      }));
    },
    onSettled: (_data, _err, { userId, postId }) => {
      queryClient.invalidateQueries({ queryKey: ['homePostsFeed', userId] });
      queryClient.invalidateQueries({ queryKey: ['userPostsFeed'] });
      queryClient.invalidateQueries({ queryKey: ['postDetail', postId] });
    },
  });
}

// ─── Profile posts feed — powers the vertical post viewer ────────────────────

export function useUserPostsFeed(
  profileUserId: string | undefined,
  viewerUserId: string | undefined,
) {
  return useInfiniteQuery({
    queryKey: ['userPostsFeed', profileUserId],
    queryFn: ({ pageParam = 0 }) =>
      timedQuery('userPostsFeed', getUserPostsFeed(profileUserId!, viewerUserId!, pageParam)),
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === 12 ? allPages.length : undefined,
    initialPageParam: 0,
    enabled: !!profileUserId && !!viewerUserId,
    staleTime: 60 * 1000,
  });
}

export function useUpdatePostCaption() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, postId, caption }: { userId: string; postId: string; caption: string }) =>
      updatePostCaption(userId, postId, caption),
    onMutate: async ({ postId, caption }) => {
      patchPostInCaches(queryClient, postId, (p) => ({
        ...p,
        caption: caption.trim() || null,
      }));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['userPostsFeed'] });
      queryClient.invalidateQueries({ queryKey: ['homePostsFeed'] });
      queryClient.invalidateQueries({ queryKey: ['postDetail'] });
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
    mutationFn: ({
      postId,
      userId,
      content,
      clientTag,
      parentCommentId,
    }: {
      postId: string;
      userId: string;
      content: string;
      clientTag: string;
      parentCommentId?: string | null;
    }) => addComment(postId, userId, content, clientTag, parentCommentId ?? null),
    onSuccess: (_data, { postId }) => {
      // Bump the visible count immediately, then refetch for the real numbers.
      patchPostInCaches(queryClient, postId, (p) => ({
        ...p,
        comments_count: p.comments_count + 1,
      }));
      queryClient.invalidateQueries({ queryKey: ['postComments', postId] });
      queryClient.invalidateQueries({ queryKey: ['homePostsFeed'] });
      queryClient.invalidateQueries({ queryKey: ['userPostsFeed'] });
      queryClient.invalidateQueries({ queryKey: ['postDetail', postId] });
    },
  });
}
