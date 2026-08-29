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
  file: File,
  caption: string | undefined,
  clubIds: string[],
  // Stable per-compose tag: a double-click or a lost-response retry of the same
  // New Post reuses it and collapses to one row (migration 100).
  tag: string
): Promise<string> {
  const supabase = getSupabaseBrowser();
  const publicUrl = await uploadToBucket("posts", `${userId}/${Date.now()}.jpg`, file);
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
  if (error) {
    // Retry of a create that already landed: return the existing post and skip
    // the club-tag insert (done on the first attempt). Other 23505s are real.
    if (isClientTagConflict(error, "uq_posts_author_client_tag")) {
      const { data: existing, error: fetchError } = await supabase
        .from("posts")
        .select("id")
        .eq("author_id", userId)
        .eq("client_tag", tag)
        .single();
      if (fetchError || !existing) throw fetchError ?? error;
      return (existing as any).id;
    }
    throw error;
  }
  if (!post) throw new Error("Failed to create post");

  if (clubIds.length > 1) {
    const extra = clubIds.slice(1).map((cid) => ({ post_id: (post as any).id, club_id: cid }));
    const { error: tagError } = await supabase.from("post_club_tags").insert(extra);
    if (tagError) throw tagError;
  }
  return (post as any).id;
}

export function useCreatePost(userId: string | undefined) {
  const queryClient = useQueryClient();
  // One tag per New Post form; reused across double-clicks and lost-response
  // retries, regenerated after a post lands so the next one is a new create.
  const tagRef = useRef(clientTag());
  return useMutation({
    mutationFn: ({ file, caption, clubIds }: { file: File; caption?: string; clubIds: string[] }) =>
      createPost(userId!, file, caption, clubIds, tagRef.current),
    onSuccess: () => {
      tagRef.current = clientTag();
      void queryClient.invalidateQueries({ queryKey: ["homePostsFeed", userId] });
      void queryClient.invalidateQueries({ queryKey: ["ownPosts", userId] });
    },
  });
}
