"use client";

import { useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isClientTagConflict } from "@weglue/shared";
import { getSupabaseBrowser } from "../supabase-browser";
import { uploadToBucket } from "../imageUpload";
import { clientTag } from "../messages/service";

// Web port of apps/mobile/services/postService.ts::createPost + the New Post
// flow. Same `posts` bucket + posts table + post_club_tags, so a post created
// on web shows on mobile. Author identity = the signed-in user; club tags are
// optional and multi-select.

export interface TagClub {
  id: string;
  name: string;
  avatar_url: string | null;
}

/** All active clubs, for the optional "tag a club" picker. Pass `false` when the
 *  caller already knows the club (posting from inside a Club Profile) so that
 *  flow never fetches a list it cannot use. */
export function useAllClubs(enabled = true) {
  return useQuery({
    queryKey: ["allClubs"],
    queryFn: async (): Promise<TagClub[]> => {
      const supabase = getSupabaseBrowser();
      const { data } = await supabase
        .from("clubs")
        .select("id, name, avatar_url")
        .eq("is_active", true)
        .order("name");
      return (data ?? []) as TagClub[];
    },
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}

async function createPost(
  userId: string,
  file: File | File[],
  caption: string | undefined,
  clubIds: string[],
  // Stable per-compose tag: a double-click or a lost-response retry of the same
  // New Post reuses it and collapses to one row (migration 100).
  tag: string,
  authoredClubId?: string,
): Promise<string> {
  const supabase = getSupabaseBrowser();
  const files = Array.isArray(file) ? file : [file];
  if (files.length < 1 || files.length > 5) {
    throw new Error("Posts must contain between 1 and 5 images");
  }
  const uploadStamp = Date.now();
  const publicUrls = await Promise.all(
    files.map((image, position) =>
      uploadToBucket("posts", `${userId}/${uploadStamp}-${position}.jpg`, image)
    )
  );

  // An explicitly locked club is a club-authored post. Ordinary Home posts
  // keep the existing student author and optional club-tag behavior.
  if (authoredClubId || publicUrls.length > 1) {
    const { data, error } = await supabase.rpc("create_post", {
      p_caption: caption ?? null,
      p_image_paths: publicUrls,
      p_club_id: authoredClubId ?? null,
    });
    if (error) throw error;
    const result = data as any;
    const postId = result?.post_id ?? result?.post?.id ?? result?.id;
    if (!postId) throw new Error("Failed to create post");
    if (!authoredClubId && clubIds.length > 0) {
      const { error: tagError } = await supabase
        .from("post_club_tags")
        .upsert(clubIds.map((clubId) => ({ post_id: postId, club_id: clubId })), {
          onConflict: "post_id,club_id",
          ignoreDuplicates: true,
        });
      if (tagError) throw tagError;
    }
    return postId;
  }

  const publicUrl = publicUrls[0]!;

  const primaryClubId = clubIds.length > 0 ? clubIds[0]! : null;

  const { data: post, error } = await supabase
    .from("posts")
    .insert({
      author_id: userId,
      club_id: primaryClubId,
      post_type: "picture",
      image_url: publicUrl,
      caption: caption ?? null,
      client_tag: tag,
    })
    .select("id")
    .single();
  let postId: string;
  if (error) {
    // Retry of a create that already landed: resolve the post by its tag. Other
    // 23505s are real.
    if (!isClientTagConflict(error, "uq_posts_author_client_tag")) throw error;
    const { data: existing, error: fetchError } = await supabase
      .from("posts")
      .select("id")
      .eq("author_id", userId)
      .eq("client_tag", tag)
      .single();
    if (fetchError || !existing) throw fetchError ?? error;
    postId = (existing as any).id;
  } else {
    if (!post) throw new Error("Failed to create post");
    postId = (post as any).id;
  }

  // Idempotent on both paths: UNIQUE(post_id, club_id) makes a repeat a no-op,
  // so a lost-response retry still lands the tags.
  if (clubIds.length > 1) {
    const extra = clubIds.slice(1).map((cid) => ({ post_id: postId, club_id: cid }));
    const { error: tagError } = await supabase
      .from("post_club_tags")
      .upsert(extra, { onConflict: "post_id,club_id", ignoreDuplicates: true });
    if (tagError) throw tagError;
  }
  return postId;
}

export function useCreatePost(userId: string | undefined) {
  const queryClient = useQueryClient();
  // One tag per New Post form; reused across double-clicks and lost-response
  // retries, regenerated after a post lands so the next one is a new create.
  const tagRef = useRef(clientTag());
  return useMutation({
    mutationFn: ({ file, caption, clubIds, authoredClubId }: { file: File | File[]; caption?: string; clubIds: string[]; authoredClubId?: string }) =>
      createPost(userId!, file, caption, clubIds, tagRef.current, authoredClubId),
    onSuccess: () => {
      tagRef.current = clientTag();
      void queryClient.invalidateQueries({ queryKey: ["homePostsFeed", userId] });
      void queryClient.invalidateQueries({ queryKey: ["ownPosts", userId] });
    },
  });
}
