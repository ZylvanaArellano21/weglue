"use client";

import { useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isClientTagConflict } from "@weglue/shared";
import { getSupabaseBrowser } from "../supabase-browser";
import { clientTag } from "../messages/service";

// Post interactions for the media overlay: comments (list + add), author-only
// caption editing, and reporting — all on the SAME tables mobile uses, so a
// comment/edit/report on web is reflected on mobile.

export interface PostComment {
  id: string;
  content: string;
  created_at: string;
  /** Immediate parent (migration 128); null for a top-level comment. */
  parent_comment_id: string | null;
  author: { id: string; username: string; avatar_url: string | null };
}

async function getPostComments(postId: string): Promise<PostComment[]> {
  const supabase = getSupabaseBrowser();
  const { data, error } = await supabase
    .from("post_comments")
    .select("id, content, created_at, user_id, parent_comment_id, profiles!inner(id, username, avatar_url)")
    .eq("post_id", postId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as any[]).map((c) => ({
    id: c.id,
    content: c.content,
    created_at: c.created_at,
    parent_comment_id: c.parent_comment_id ?? null,
    author: { id: c.profiles.id, username: c.profiles.username, avatar_url: c.profiles.avatar_url },
  }));
}

// A comment's author can delete it themselves at any time, so the content is
// captured server-side, at report time, via a SECURITY DEFINER RPC — a later
// self-delete cannot erase the evidence (same pattern as report_message).
// Mirrors apps/mobile/services/reportService.ts's 'comment' branch.
export async function reportComment(commentId: string, reason?: string | null): Promise<void> {
  const supabase = getSupabaseBrowser();
  const { error } = await supabase.rpc("report_comment", {
    p_comment_id: commentId,
    p_reason: reason ?? null,
    p_details: null,
  });
  if (error) throw error;
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
  // One tag per comment; reused if a submit is retried, regenerated once a
  // comment lands (migration 100).
  const tagRef = useRef(clientTag());
  return useMutation({
    mutationFn: async ({
      postId,
      userId,
      content,
      parentCommentId,
    }: {
      postId: string;
      userId: string;
      content: string;
      parentCommentId?: string | null;
    }) => {
      const supabase = getSupabaseBrowser();
      const { error } = await supabase.from("post_comments").insert({
        post_id: postId,
        user_id: userId,
        content: content.trim(),
        client_tag: tagRef.current,
        parent_comment_id: parentCommentId ?? null,
      });
      if (!error) return;
      // Retry of a comment that already posted under this tag — succeed quietly.
      if (isClientTagConflict(error, "uq_post_comments_user_client_tag")) {
        const { data: existing } = await supabase
          .from("post_comments")
          .select("id")
          .eq("user_id", userId)
          .eq("client_tag", tagRef.current)
          .maybeSingle();
        if (existing) return;
      }
      throw error;
    },
    onMutate: async ({ postId, userId, content, parentCommentId }) => {
      await qc.cancelQueries({ queryKey: ["postComments", postId] });
      const own = qc.getQueryData<any>(["ownProfile", userId]);
      const previousComments = qc.getQueryData<PostComment[]>(["postComments", postId]);
      const optimisticId = `optimistic-${crypto.randomUUID()}`;
      const optimistic: PostComment = {
        id: optimisticId,
        content: content.trim(),
        created_at: new Date().toISOString(),
        parent_comment_id: parentCommentId ?? null,
        author: { id: userId, username: own?.username ?? "you", avatar_url: own?.avatar_url ?? null },
      };
      qc.setQueryData<PostComment[]>(["postComments", postId], (current) => [...(current ?? []), optimistic]);
      const increment = (post: any) => post?.id === postId ? { ...post, comments_count: (post.comments_count ?? 0) + 1 } : post;
      qc.setQueriesData({ queryKey: ["postDetail", postId] }, increment);
      qc.setQueriesData({ queryKey: ["homePostsFeed"] }, (feed: any) => feed ? { ...feed, pages: feed.pages.map((page: any[]) => page.map(increment)) } : feed);
      return { postId, previousComments, optimisticId };
    },
    onError: (_error, { postId }, context) => {
      if (context?.previousComments) qc.setQueryData(["postComments", postId], context.previousComments);
      else qc.setQueryData<PostComment[]>(["postComments", postId], (current) => current?.filter((c) => c.id !== context?.optimisticId));
      invalidatePost(qc, postId);
    },
    onSuccess: (_d, { postId }) => {
      tagRef.current = clientTag();
      invalidatePost(qc, postId);
    },
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
