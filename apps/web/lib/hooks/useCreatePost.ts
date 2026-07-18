"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabaseBrowser } from "../supabase-browser";
import { uploadToBucket } from "../imageUpload";

// Web port of apps/mobile/services/postService.ts::createPost + the New Post
// flow. Same `posts` bucket + posts table + post_club_tags, so a post created
// on web shows on mobile. Author identity = the signed-in user; club tags are
// optional and multi-select.

export interface TagClub {
  id: string;
  name: string;
  avatar_url: string | null;
}

/** All active clubs (for the optional "tag a club" picker). */
export function useAllClubs() {
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
    staleTime: 5 * 60 * 1000,
  });
}

async function createPost(
  userId: string,
  file: File,
  caption: string | undefined,
  clubIds: string[]
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
    })
    .select("id")
    .single();
  if (error || !post) throw error ?? new Error("Failed to create post");

  if (clubIds.length > 1) {
    const extra = clubIds.slice(1).map((cid) => ({ post_id: (post as any).id, club_id: cid }));
    const { error: tagError } = await supabase.from("post_club_tags").insert(extra);
    if (tagError) throw tagError;
  }
  return (post as any).id;
}

export function useCreatePost(userId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ file, caption, clubIds }: { file: File; caption?: string; clubIds: string[] }) =>
      createPost(userId!, file, caption, clubIds),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["homePostsFeed", userId] });
      void queryClient.invalidateQueries({ queryKey: ["ownPosts", userId] });
    },
  });
}
