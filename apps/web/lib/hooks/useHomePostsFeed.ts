"use client";

import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getSupabaseBrowser } from "../supabase-browser";

// Web port of apps/mobile/services/postService.ts::getHomePostsFeed +
// apps/mobile/hooks/useHomePostsFeed.ts (like). Home → Posts shows every
// picture post from the viewer's university/community, newest-first, no follow
// or membership required — the SAME scope and ordering as mobile.

export interface PostAuthor {
  id: string;
  username: string;
  avatar_url: string | null;
  is_following: boolean;
  is_requested: boolean;
  follows_me: boolean;
  profile_is_private: boolean;
}

export interface FeedPost {
  id: string;
  image_url: string | null;
  caption: string | null;
  created_at: string;
  author: PostAuthor;
  tagged_clubs: { id: string; name: string }[];
  likes_count: number;
  comments_count: number;
  user_has_liked: boolean;
}

function mergeTaggedClubs(
  primaryClubId: string | null,
  primaryClub: { id: string; name: string } | null | undefined,
  extraClubs: { id: string; name: string }[]
): { id: string; name: string }[] {
  const merged: { id: string; name: string }[] = [];
  const seen = new Set<string>();
  if (primaryClubId && primaryClub) {
    merged.push({ id: primaryClub.id, name: primaryClub.name });
    seen.add(primaryClub.id);
  }
  for (const club of extraClubs) {
    if (!seen.has(club.id)) {
      merged.push(club);
      seen.add(club.id);
    }
  }
  return merged;
}

const POSTS_PAGE_SIZE = 20;

async function getHomePostsFeed(userId: string, page = 0): Promise<FeedPost[]> {
  const supabase = getSupabaseBrowser();
  const offset = page * POSTS_PAGE_SIZE;

  const [{ data: followedRows }, { data: followerRows }, { data: myProfile }] =
    await Promise.all([
      supabase.from("follows").select("following_id, status").eq("follower_id", userId),
      supabase
        .from("follows")
        .select("follower_id")
        .eq("following_id", userId)
        .eq("status", "accepted"),
      supabase.from("profiles").select("university").eq("id", userId).single(),
    ]);

  const followedIds = ((followedRows ?? []) as any[])
    .filter((r) => r.status === "accepted")
    .map((r) => r.following_id);
  const requestedIds = ((followedRows ?? []) as any[])
    .filter((r) => r.status === "pending")
    .map((r) => r.following_id);
  const followerIds = ((followerRows ?? []) as any[]).map((r) => r.follower_id);
  const myUniversity: string | null = (myProfile as any)?.university ?? null;

  let postsQuery = supabase
    .from("posts")
    .select(
      `
      id, image_url, caption, created_at, author_id, club_id,
      profiles!inner(id, username, avatar_url, university),
      clubs(id, name)
    `
    )
    .order("created_at", { ascending: false })
    .range(offset, offset + POSTS_PAGE_SIZE - 1);

  if (myUniversity) postsQuery = postsQuery.eq("profiles.university", myUniversity);

  const { data: rawPosts, error } = await postsQuery;
  if (error || !rawPosts) return [];

  const postIds = (rawPosts as any[]).map((p) => p.id);
  const authorIds = [...new Set((rawPosts as any[]).map((p) => p.author_id))];

  const [{ data: likesRows }, { data: commentsRows }, { data: privacyRows }, { data: extraTagRows }] =
    await Promise.all([
      supabase.from("post_likes").select("post_id, user_id").in("post_id", postIds),
      supabase.from("post_comments").select("post_id").in("post_id", postIds),
      supabase.from("user_privacy").select("user_id, is_private").in("user_id", authorIds),
      supabase
        .from("post_club_tags")
        .select("post_id, club_id, clubs(id, name)")
        .in("post_id", postIds),
    ]);

  const extraTaggedClubsMap = new Map<string, { id: string; name: string }[]>();
  for (const row of (extraTagRows as any[]) ?? []) {
    if (!row.clubs) continue;
    const list = extraTaggedClubsMap.get(row.post_id) ?? [];
    list.push({ id: row.clubs.id, name: row.clubs.name });
    extraTaggedClubsMap.set(row.post_id, list);
  }

  const likesCountMap = new Map<string, number>();
  const userLikedSet = new Set<string>();
  for (const like of (likesRows as any[]) ?? []) {
    likesCountMap.set(like.post_id, (likesCountMap.get(like.post_id) ?? 0) + 1);
    if (like.user_id === userId) userLikedSet.add(like.post_id);
  }

  const commentsCountMap = new Map<string, number>();
  for (const comment of (commentsRows as any[]) ?? []) {
    commentsCountMap.set(comment.post_id, (commentsCountMap.get(comment.post_id) ?? 0) + 1);
  }

  const privacyMap = new Map<string, boolean>(
    ((privacyRows as any[]) ?? []).map((r) => [r.user_id, r.is_private])
  );

  const followedSet = new Set(followedIds);
  const requestedSet = new Set(requestedIds);
  const followerSet = new Set(followerIds);

  const posts: FeedPost[] = (rawPosts as any[]).map((p) => ({
    id: p.id,
    image_url: p.image_url,
    caption: p.caption,
    created_at: p.created_at,
    author: {
      id: p.profiles.id,
      username: p.profiles.username,
      avatar_url: p.profiles.avatar_url,
      is_following: followedSet.has(p.author_id),
      is_requested: requestedSet.has(p.author_id),
      follows_me: followerSet.has(p.author_id),
      profile_is_private: privacyMap.get(p.author_id) ?? false,
    },
    tagged_clubs: mergeTaggedClubs(p.club_id, p.clubs, extraTaggedClubsMap.get(p.id) ?? []),
    likes_count: likesCountMap.get(p.id) ?? 0,
    comments_count: commentsCountMap.get(p.id) ?? 0,
    user_has_liked: userLikedSet.has(p.id),
  }));

  posts.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  return posts;
}

export function useHomePostsFeed(userId: string | undefined) {
  return useInfiniteQuery({
    queryKey: ["homePostsFeed", userId],
    queryFn: ({ pageParam }) => getHomePostsFeed(userId!, pageParam),
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === POSTS_PAGE_SIZE ? allPages.length : undefined,
    initialPageParam: 0,
    enabled: !!userId,
    staleTime: 2 * 60 * 1000,
  });
}

export function useLikePost() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      userId,
      postId,
      hasLiked,
    }: {
      userId: string;
      postId: string;
      hasLiked: boolean;
    }) => {
      const supabase = getSupabaseBrowser();
      if (hasLiked) {
        await supabase.from("post_likes").delete().eq("user_id", userId).eq("post_id", postId);
      } else {
        await supabase
          .from("post_likes")
          .upsert({ user_id: userId, post_id: postId }, { onConflict: "post_id,user_id" });
      }
    },
    onSettled: (_data, _err, { userId }) => {
      void queryClient.invalidateQueries({ queryKey: ["homePostsFeed", userId] });
    },
  });
}
