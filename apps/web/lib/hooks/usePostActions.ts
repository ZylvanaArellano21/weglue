"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabaseBrowser } from "../supabase-browser";

// Post interactions for the media overlay: comments (list + add), author-only
// caption editing, and reporting — all on the SAME tables mobile uses, so a
// comment/edit/report on web is reflected on mobile.

export interface PostComment {
  id: string;
  content: string;
  created_at: string;
  author: { id: string; username: string; avatar_url: string | null };
}

async function getPostComments(postId: string): Promise<PostComment[]> {
  const supabase = getSupabaseBrowser();
  const { data, error } = await supabase
    .from("post_comments")
    .select("id, content, created_at, user_id, profiles!inner(id, username, avatar_url)")
    .eq("post_id", postId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as any[]).map((c) => ({
    id: c.id,
    content: c.content,
    created_at: c.created_at,
    author: { id: c.profiles.id, username: c.profiles.username, avatar_url: c.profiles.avatar_url },
  }));
}

export function usePostComments(postId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["postComments", postId],
    queryFn: () => getPostComments(postId!),
    enabled: !!postId && enabled,
    staleTime: 30 * 1000,
  });
}

function invalidatePost(qc: ReturnType<typeof useQueryClient>, postId: string) {
  void qc.invalidateQueries({ queryKey: ["postComments", postId] });
  void qc.invalidateQueries({ queryKey: ["postDetail"] });
  void qc.invalidateQueries({ queryKey: ["homePostsFeed"] });
  void qc.invalidateQueries({ queryKey: ["clubPhotoFeed"] });
  void qc.invalidateQueries({ queryKey: ["ownPosts"] });
}

export function useAddComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ postId, userId, content }: { postId: string; userId: string; content: string }) => {
      const supabase = getSupabaseBrowser();
      const { error } = await supabase.from("post_comments").insert({ post_id: postId, user_id: userId, content: content.trim() });
      if (error) throw error;
    },
    onMutate: async ({ postId, userId, content }) => {
      await qc.cancelQueries({ queryKey: ["postComments", postId] });
      const own = qc.getQueryData<any>(["ownProfile", userId]);
      const optimistic: PostComment = {
        id: `optimistic-${crypto.randomUUID()}`,
        content: content.trim(),
        created_at: new Date().toISOString(),
        author: { id: userId, username: own?.username ?? "you", avatar_url: own?.avatar_url ?? null },
      };
      qc.setQueryData<PostComment[]>(["postComments", postId], (current) => [...(current ?? []), optimistic]);
      const increment = (post: any) => post?.id === postId ? { ...post, comments_count: (post.comments_count ?? 0) + 1 } : post;
      qc.setQueriesData({ queryKey: ["postDetail", postId] }, increment);
      qc.setQueriesData({ queryKey: ["homePostsFeed"] }, (feed: any) => feed ? { ...feed, pages: feed.pages.map((page: any[]) => page.map(increment)) } : feed);
      return { postId };
    },
    onError: (_error, { postId }) => invalidatePost(qc, postId),
    onSuccess: (_d, { postId }) => invalidatePost(qc, postId),
  });
}

// Author-only caption edit (RLS also enforces author_id) — mirrors mobile
// updatePostCaption. Mobile does NOT support editing post media or officers
// editing others' posts, so web deliberately doesn't either.
export function useUpdatePostCaption() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ postId, userId, caption }: { postId: string; userId: string; caption: string }) => {
      const supabase = getSupabaseBrowser();
      const { error } = await supabase
        .from("posts")
        .update({ caption: caption.trim() || null })
        .eq("id", postId)
        .eq("author_id", userId);
      if (error) throw error;
    },
    onSuccess: (_d, { postId }) => invalidatePost(qc, postId),
  });
}
