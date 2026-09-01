"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  author_kind: "user" | "club";
  author: PostAuthor;
  club: { id: string; name: string; avatar_url: string | null } | null;
  images: { path: string; position: number; width?: number | null; height?: number | null }[];
  tagged_clubs: { id: string; name: string }[];
  likes_count: number;
  comments_count: number;
  user_has_liked: boolean;
}

async function getPostImages(postIds: string[]) {
  const result = new Map<string, { path: string; position: number; width?: number | null; height?: number | null }[]>();
  if (postIds.length === 0) return result;
  const { data } = await getSupabaseBrowser()
    .from("post_images")
    .select("post_id, storage_path, position, width, height")
    .in("post_id", postIds)
    .order("position", { ascending: true });
  for (const row of (data ?? []) as any[]) {
    const images = result.get(row.post_id) ?? [];
    images.push({ path: row.storage_path, position: Number(row.position), width: row.width ?? null, height: row.height ?? null });
    result.set(row.post_id, images);
  }
  return result;
}

function postClub(post: any): { id: string; name: string; avatar_url: string | null } | null {
  if (post.author_kind !== "club" || !post.clubs) return null;
  return { id: post.clubs.id, name: post.clubs.name, avatar_url: post.clubs.avatar_url ?? null };
}

function postImages(post: any, imageMap: Map<string, { path: string; position: number; width?: number | null; height?: number | null }[]>) {
  return imageMap.get(post.id)?.length ? imageMap.get(post.id)! : (post.image_url ? [{ path: post.image_url, position: 0 }] : []);
}

function postAuthor(post: any, state: { is_following: boolean; is_requested: boolean; follows_me: boolean; profile_is_private: boolean }): PostAuthor {
  const club = postClub(post);
  if (club) return { id: club.id, username: club.name, avatar_url: club.avatar_url, is_following: false, is_requested: false, follows_me: false, profile_is_private: false };
  return { id: post.profiles.id, username: post.profiles.username, avatar_url: post.profiles.avatar_url, ...state };
}

function mergeTaggedClubs(
  primaryClubId: string | null,
  primaryClub: { id: string; name: string } | null | undefined,
  extraClubs: { id: string; name: string }[],
  authorKind: "user" | "club" = "user"
): { id: string; name: string }[] {
  const merged: { id: string; name: string }[] = [];
  const seen = new Set<string>();
  // A club-authored post already renders the club as its author (avatar + name),
  // so the club is never also shown as a "tag". Only student-authored Home posts
  // carry a club tag.
  if (authorKind !== "club" && primaryClubId && primaryClub) {
    merged.push({ id: primaryClub.id, name: primaryClub.name });
    seen.add(primaryClub.id);
  }
  if (authorKind === "club" && primaryClubId) seen.add(primaryClubId);
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
      id, image_url, caption, created_at, author_id, club_id, author_kind,
      profiles!inner(id, username, avatar_url, university),
      clubs(id, name, avatar_url)
    `
    )
    .order("created_at", { ascending: false })
    .range(offset, offset + POSTS_PAGE_SIZE - 1);

  if (myUniversity) postsQuery = postsQuery.eq("profiles.university", myUniversity);

  const { data: rawPosts, error } = await postsQuery;
  if (error || !rawPosts) return [];

  const postIds = (rawPosts as any[]).map((p) => p.id);
  const authorIds = [...new Set((rawPosts as any[]).map((p) => p.author_id))];

  const [{ data: likesRows }, { data: commentsRows }, { data: privacyRows }, { data: extraTagRows }, imageMap] =
    await Promise.all([
      supabase.from("post_likes").select("post_id, user_id").in("post_id", postIds),
      supabase.from("post_comments").select("post_id").in("post_id", postIds),
      supabase.from("user_privacy").select("user_id, is_private").in("user_id", authorIds),
      supabase
        .from("post_club_tags")
        .select("post_id, club_id, clubs(id, name)")
        .in("post_id", postIds),
      getPostImages(postIds),
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
    author_kind: p.author_kind ?? "user",
    author: postAuthor(p, {
      is_following: followedSet.has(p.author_id),
      is_requested: requestedSet.has(p.author_id),
      follows_me: followerSet.has(p.author_id),
      profile_is_private: privacyMap.get(p.author_id) ?? false,
    }),
    club: postClub(p),
    images: postImages(p, imageMap),
    tagged_clubs: mergeTaggedClubs(p.club_id, p.clubs, extraTaggedClubsMap.get(p.id) ?? [], p.author_kind ?? "user"),
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

// Single post — powers the post overlay opened from like/comment notifications
// and the profile posts grid.
async function getPostById(postId: string, userId: string): Promise<FeedPost | null> {
  const supabase = getSupabaseBrowser();
  const { data: p, error } = await supabase
    .from("posts")
    .select(
      `id, image_url, caption, created_at, author_id, club_id,
       profiles!inner(id, username, avatar_url), clubs(id, name, avatar_url), author_kind`
    )
    .eq("id", postId)
    .maybeSingle();
  if (error || !p) return null;
  const post = p as any;

  const isSelf = post.author_id === userId;
  const [{ data: likesRows }, { data: commentsRows }, { data: extraTagRows }, { data: myFollow }, { data: theirFollow }, imageMap] =
    await Promise.all([
      supabase.from("post_likes").select("user_id").eq("post_id", postId),
      supabase.from("post_comments").select("id").eq("post_id", postId),
      supabase.from("post_club_tags").select("post_id, club_id, clubs(id, name)").eq("post_id", postId),
      // Real follow relationship viewer → author (so the media overlay's Follow
      // button reflects actual state instead of always showing "Follow").
      isSelf
        ? Promise.resolve({ data: null })
        : supabase.from("follows").select("status").eq("follower_id", userId).eq("following_id", post.author_id).maybeSingle(),
      isSelf
        ? Promise.resolve({ data: null })
        : supabase
            .from("follows")
            .select("id")
            .eq("follower_id", post.author_id)
            .eq("following_id", userId)
            .eq("status", "accepted")
            .maybeSingle(),
      getPostImages([postId]),
    ]);

  const myFollowStatus = (myFollow as { status?: string } | null)?.status ?? null;

  const extra = new Map<string, { id: string; name: string }[]>();
  for (const row of (extraTagRows as any[]) ?? []) {
    if (!row.clubs) continue;
    const list = extra.get(row.post_id) ?? [];
    list.push({ id: row.clubs.id, name: row.clubs.name });
    extra.set(row.post_id, list);
  }
  const likes = (likesRows ?? []) as any[];

  return {
    id: post.id,
    image_url: post.image_url,
    caption: post.caption,
    created_at: post.created_at,
    author_kind: post.author_kind ?? "user",
    author: postAuthor(post, {
      is_following: myFollowStatus === "accepted",
      is_requested: myFollowStatus === "pending",
      follows_me: !!theirFollow,
      profile_is_private: false,
    }),
    club: postClub(post),
    images: postImages(post, imageMap),
    tagged_clubs: mergeTaggedClubs(post.club_id, post.clubs, extra.get(post.id) ?? [], post.author_kind ?? "user"),
    likes_count: likes.length,
    comments_count: ((commentsRows ?? []) as any[]).length,
    user_has_liked: likes.some((l) => l.user_id === userId),
  };
}

export function usePostDetail(postId: string | undefined, userId: string | undefined) {
  return useQuery({
    queryKey: ["postDetail", postId, userId],
    queryFn: () => getPostById(postId!, userId!),
    enabled: !!postId && !!userId,
    staleTime: 60 * 1000,
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
    onMutate: async ({ userId, postId, hasLiked }) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: ["homePostsFeed", userId] }),
        queryClient.cancelQueries({ queryKey: ["postDetail", postId, userId] }),
      ]);
      const patch = (post: FeedPost): FeedPost => post.id !== postId ? post : {
        ...post,
        user_has_liked: !hasLiked,
        likes_count: Math.max(0, post.likes_count + (hasLiked ? -1 : 1)),
      };
      const homeKey = ["homePostsFeed", userId] as const;
      const detailKey = ["postDetail", postId, userId] as const;
      const home = queryClient.getQueryData<any>(homeKey);
      const detail = queryClient.getQueryData<FeedPost | null>(detailKey);
      if (home) queryClient.setQueryData(homeKey, { ...home, pages: home.pages.map((page: FeedPost[]) => page.map(patch)) });
      if (detail) queryClient.setQueryData(detailKey, patch(detail));
      return { homeKey, detailKey, home, detail };
    },
    onError: (_err, _variables, context) => {
      if (context?.home !== undefined) queryClient.setQueryData(context.homeKey, context.home);
      if (context?.detail !== undefined) queryClient.setQueryData(context.detailKey, context.detail);
    },
    onSettled: (_data, _err, { userId }) => {
      void queryClient.invalidateQueries({ queryKey: ["homePostsFeed", userId] });
      void queryClient.invalidateQueries({ queryKey: ["postDetail"] });
      void queryClient.invalidateQueries({ queryKey: ["ownPosts", userId] });
    },
  });
}
