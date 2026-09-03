"use client";

import { useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabaseBrowser } from "../supabase-browser";
import { imageDimensions, uploadToBucket } from "../imageUpload";
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
  const uploaded = await Promise.all(
    files.map(async (image, position) => {
      const [url, dims] = await Promise.all([
        uploadToBucket("posts", `${userId}/${uploadStamp}-${position}.jpg`, image),
        imageDimensions(image).catch(() => ({ width: 0, height: 0 })),
      ]);
      return { url, width: dims.width || null, height: dims.height || null };
    })
  );

  // Every post (1..5 images) goes through the one create_post RPC — matching
  // apps/mobile/services/postService.ts. It handles club-authored vs student
  // posts, the retry-returns-existing idempotency (migration 100), and stores
  // each image's dimensions so a single image can render at its natural aspect
  // with no layout shift (migration 117). A locked club is a club-authored
  // post; a Home post stays student-authored and may tag clubs via
  // post_club_tags.
  const { data, error } = await supabase.rpc("create_post", {
    p_caption: caption ?? null,
    p_image_paths: uploaded.map((u) => u.url),
    p_club_id: authoredClubId ?? null,
    p_client_tag: tag,
    p_image_dimensions: uploaded.map((u) => ({ width: u.width, height: u.height })),
  });
  if (error) throw error;
  const result = data as any;
  const postId = result?.post_id ?? result?.post?.id ?? result?.id;
  if (!postId) throw new Error("Failed to create post");

  if (!authoredClubId && clubIds.length > 0) {
    // Idempotent: UNIQUE(post_id, club_id) makes a repeat a no-op, so a
    // lost-response retry still lands the tags.
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
