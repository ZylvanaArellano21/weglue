import * as ImageManipulator from 'expo-image-manipulator';
import { isClientTagConflict } from '@weglue/shared';
import { supabase } from '../lib/supabase';

export interface PostAuthor {
  id: string;
  username: string;
  avatar_url: string | null;
  is_following: boolean;
  // Viewer has a pending follow request to this (private) author.
  is_requested: boolean;
  // Author follows the viewer (drives Gluemate / Follow back states).
  follows_me: boolean;
  profile_is_private: boolean;
}

export interface FeedPost {
  id: string;
  image_url: string | null;
  caption: string | null;
  created_at: string;
  author_kind: 'user' | 'club';
  author: PostAuthor;
  club: { id: string; name: string; avatar_url: string | null } | null;
  images: PostImage[];
  tagged_clubs: { id: string; name: string }[];
  likes_count: number;
  comments_count: number;
  user_has_liked: boolean;
}

export interface PostImage {
  path: string;
  position: number;
  width?: number | null;
  height?: number | null;
}

export interface PostComment {
  id: string;
  content: string;
  created_at: string;
  author: { id: string; username: string; avatar_url: string | null };
}

function buildTaggedClubsMap(
  extraTagRows: { post_id: string; club_id: string; clubs: { id: string; name: string } }[] | null,
): Map<string, { id: string; name: string }[]> {
  const map = new Map<string, { id: string; name: string }[]>();
  for (const row of extraTagRows ?? []) {
    if (!row.clubs) continue;
    const list = map.get(row.post_id) ?? [];
    list.push({ id: row.clubs.id, name: row.clubs.name });
    map.set(row.post_id, list);
  }
  return map;
}

function mergeTaggedClubs(
  primaryClubId: string | null,
  primaryClub: { id: string; name: string } | null | undefined,
  extraClubs: { id: string; name: string }[],
  authorKind: 'user' | 'club' = 'user',
): { id: string; name: string }[] {
  const merged: { id: string; name: string }[] = [];
  const seen = new Set<string>();
  // A club-authored post IS the club's post — the club already renders as the
  // author (avatar + name), so its own club_id is never shown as a "tag". Only
  // student-authored Home posts surface a club tag.
  if (authorKind !== 'club' && primaryClubId && primaryClub) {
    merged.push({ id: primaryClub.id, name: primaryClub.name });
    seen.add(primaryClub.id);
  }
  if (authorKind === 'club' && primaryClubId) {
    // Never let the authoring club leak back in as an extra tag either.
    seen.add(primaryClubId);
  }
  for (const club of extraClubs) {
    if (!seen.has(club.id)) {
      merged.push(club);
      seen.add(club.id);
    }
  }
  return merged;
}

async function getPostImages(postIds: string[]): Promise<Map<string, PostImage[]>> {
  const result = new Map<string, PostImage[]>();
  if (postIds.length === 0) return result;

  const { data } = await supabase
    .from('post_images')
    .select('post_id, storage_path, position, width, height')
    .in('post_id', postIds)
    .order('position', { ascending: true });

  for (const row of (data ?? []) as any[]) {
    const images = result.get(row.post_id) ?? [];
    images.push({
      path: row.storage_path,
      position: Number(row.position),
      width: row.width ?? null,
      height: row.height ?? null,
    });
    result.set(row.post_id, images);
  }
  return result;
}

function postImages(post: any, imageMap: Map<string, PostImage[]>): PostImage[] {
  const images = imageMap.get(post.id);
  if (images && images.length > 0) return images;
  return post.image_url ? [{ path: post.image_url, position: 0 }] : [];
}

function postClub(post: any): { id: string; name: string; avatar_url: string | null } | null {
  if (post.author_kind !== 'club' || !post.clubs) return null;
  return {
    id: post.clubs.id,
    name: post.clubs.name,
    avatar_url: post.clubs.avatar_url ?? null,
  };
}

function postAuthor(post: any, viewerState: {
  isFollowing: boolean;
  isRequested: boolean;
  followsMe: boolean;
  profileIsPrivate: boolean;
}): PostAuthor {
  const club = postClub(post);
  // Club-authored posts use the club identity in the public response. The
  // acting officer remains posts.author_id for audit/admin use, but is never
  // returned as the non-admin FeedPost author.
  if (club) {
    return {
      id: club.id,
      username: club.name,
      avatar_url: club.avatar_url,
      is_following: false,
      is_requested: false,
      follows_me: false,
      profile_is_private: false,
    };
  }
  return {
    id: post.profiles.id,
    username: post.profiles.username,
    avatar_url: post.profiles.avatar_url,
    is_following: viewerState.isFollowing,
    is_requested: viewerState.isRequested,
    follows_me: viewerState.followsMe,
    profile_is_private: viewerState.profileIsPrivate,
  };
}

export async function getHomePostsFeed(
  userId: string,
  page: number = 0,
): Promise<FeedPost[]> {
  const PAGE_SIZE = 20;
  const offset = page * PAGE_SIZE;

  const [{ data: followedRows }, { data: followerRows }, { data: myProfile }] = await Promise.all([
    supabase
      .from('follows')
      .select('following_id, status')
      .eq('follower_id', userId),
    supabase
      .from('follows')
      .select('follower_id')
      .eq('following_id', userId)
      .eq('status', 'accepted'),
    supabase.from('profiles').select('university').eq('id', userId).single(),
  ]);

  const followedIds = ((followedRows ?? []) as any[])
    .filter((r) => r.status === 'accepted')
    .map((r) => r.following_id);
  const requestedIds = ((followedRows ?? []) as any[])
    .filter((r) => r.status === 'pending')
    .map((r) => r.following_id);
  const followerIds = ((followerRows ?? []) as any[]).map((r) => r.follower_id);
  const myUniversity: string | null = (myProfile as any)?.university ?? null;

  // Home → Posts shows every picture post from the viewer's university/community.
  // No follow relationship and no club membership required. Scope is the same
  // university only (never all We Glue users globally). Filtering by the
  // author's university server-side keeps pagination correct at scale — a
  // client-side filter after .range() would silently drop same-university posts
  // whenever the newest 20 rows happened to be from other schools.
  let postsQuery = supabase
    .from('posts')
    .select(`
      id, image_url, caption, created_at, author_id, club_id, author_kind,
      profiles!inner(id, username, avatar_url, university),
      clubs(id, name, avatar_url)
    `)
    .order('created_at', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);

  if (myUniversity) {
    postsQuery = postsQuery.eq('profiles.university', myUniversity);
  }

  const { data: rawPosts, error } = await postsQuery;

  if (error || !rawPosts) return [];

  const postIds = (rawPosts as any[]).map((p) => p.id);
  const authorIds = [...new Set((rawPosts as any[]).map((p) => p.author_id))];

  const [{ data: likesRows }, { data: commentsRows }, { data: privacyRows }, { data: extraTagRows }, imageMap] =
    await Promise.all([
      supabase.from('post_likes').select('post_id, user_id').in('post_id', postIds),
      supabase
        .from('post_comments')
        .select('post_id')
        .in('post_id', postIds),
      supabase
        .from('user_privacy')
        .select('user_id, is_private')
        .in('user_id', authorIds),
      supabase
        .from('post_club_tags')
        .select('post_id, club_id, clubs(id, name)')
        .in('post_id', postIds),
      getPostImages(postIds),
    ]);

  const extraTaggedClubsMap = buildTaggedClubsMap(extraTagRows as any);

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
    ((privacyRows as any[]) ?? []).map((r) => [r.user_id, r.is_private]),
  );

  const followedSet = new Set(followedIds);
  const requestedSet = new Set(requestedIds);
  const followerSet = new Set(followerIds);

  // No follow/club/university drop here — the university scope is already
  // enforced by the query above. Strictly newest-first for everyone: follow
  // status never changes whether a post appears or where it ranks.
  const posts: FeedPost[] = (rawPosts as any[]).map((p) => ({
    id: p.id,
    image_url: p.image_url,
    caption: p.caption,
    created_at: p.created_at,
    author_kind: p.author_kind ?? 'user',
    author: postAuthor(p, {
      isFollowing: followedSet.has(p.author_id),
      isRequested: requestedSet.has(p.author_id),
      followsMe: followerSet.has(p.author_id),
      profileIsPrivate: privacyMap.get(p.author_id) ?? false,
    }),
    club: postClub(p),
    images: postImages(p, imageMap),
    tagged_clubs: mergeTaggedClubs(p.club_id, p.clubs, extraTaggedClubsMap.get(p.id) ?? [], p.author_kind ?? 'user'),
    likes_count: likesCountMap.get(p.id) ?? 0,
    comments_count: commentsCountMap.get(p.id) ?? 0,
    user_has_liked: userLikedSet.has(p.id),
  }));

  posts.sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  return posts;
}

export async function getPostById(postId: string, userId: string): Promise<FeedPost | null> {
  const { data: p, error } = await supabase
    .from('posts')
    .select(`
      id, image_url, caption, created_at, author_id, club_id, author_kind,
      profiles!inner(id, username, avatar_url),
      clubs(id, name, avatar_url)
    `)
    .eq('id', postId)
    .single();

  if (error || !p) return null;

  const [{ data: likesRows }, { data: commentsRows }, { data: followRow }, { data: followsMeRow }, { data: privacyRow }, { data: extraTagRows }, imageMap] =
    await Promise.all([
      supabase.from('post_likes').select('user_id').eq('post_id', postId),
      supabase.from('post_comments').select('id').eq('post_id', postId),
      supabase
        .from('follows')
        .select('status')
        .eq('follower_id', userId)
        .eq('following_id', (p as any).author_id)
        .maybeSingle(),
      supabase
        .from('follows')
        .select('id')
        .eq('follower_id', (p as any).author_id)
        .eq('following_id', userId)
        .eq('status', 'accepted')
        .maybeSingle(),
      supabase
        .from('user_privacy')
        .select('is_private')
        .eq('user_id', (p as any).author_id)
        .maybeSingle(),
      supabase
        .from('post_club_tags')
        .select('post_id, club_id, clubs(id, name)')
        .eq('post_id', postId),
      getPostImages([postId]),
    ]);

  const likes = (likesRows ?? []) as any[];

  return {
    id: p.id,
    image_url: p.image_url,
    caption: p.caption,
    created_at: p.created_at,
    author_kind: (p as any).author_kind ?? 'user',
    author: postAuthor(p, {
      isFollowing: (followRow as any)?.status === 'accepted',
      isRequested: (followRow as any)?.status === 'pending',
      followsMe: !!followsMeRow,
      profileIsPrivate: (privacyRow as any)?.is_private ?? false,
    }),
    club: postClub(p),
    images: postImages(p, imageMap),
    tagged_clubs: mergeTaggedClubs(
      (p as any).club_id,
      (p as any).clubs,
      (extraTagRows as any[] ?? []).map((r) => ({ id: r.clubs.id, name: r.clubs.name })),
      (p as any).author_kind ?? 'user',
    ),
    likes_count: likes.length,
    comments_count: (commentsRows ?? []).length,
    user_has_liked: likes.some((l) => l.user_id === userId),
  };
}

// ─── Profile posts feed (vertical post viewer) ────────────────────────────────
//
// Full-detail posts for one author, newest first, same page size/order as the
// profile grid (getUserPosts/getOwnPosts) so the viewer's indices line up with
// the tapped grid item.
export async function getUserPostsFeed(
  profileUserId: string,
  viewerUserId: string,
  page: number = 0,
): Promise<FeedPost[]> {
  const PAGE_SIZE = 12;
  const offset = page * PAGE_SIZE;

  const { data: rawPosts, error } = await supabase
    .from('posts')
    .select(`
      id, image_url, caption, created_at, author_id, club_id, author_kind,
      profiles!inner(id, username, avatar_url),
      clubs(id, name, avatar_url)
    `)
    .eq('author_id', profileUserId)
    .eq('author_kind', 'user')
    .not('image_url', 'is', null)
    .order('created_at', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);

  if (error || !rawPosts || rawPosts.length === 0) return [];

  const postIds = (rawPosts as any[]).map((p) => p.id);

  const [{ data: likesRows }, { data: commentsRows }, { data: followRow }, { data: followsMeRow }, { data: privacyRow }, { data: extraTagRows }, imageMap] =
    await Promise.all([
      supabase.from('post_likes').select('post_id, user_id').in('post_id', postIds),
      supabase.from('post_comments').select('post_id').in('post_id', postIds),
      supabase
        .from('follows')
        .select('status')
        .eq('follower_id', viewerUserId)
        .eq('following_id', profileUserId)
        .maybeSingle(),
      supabase
        .from('follows')
        .select('id')
        .eq('follower_id', profileUserId)
        .eq('following_id', viewerUserId)
        .eq('status', 'accepted')
        .maybeSingle(),
      supabase
        .from('user_privacy')
        .select('is_private')
        .eq('user_id', profileUserId)
        .maybeSingle(),
      supabase
        .from('post_club_tags')
        .select('post_id, club_id, clubs(id, name)')
        .in('post_id', postIds),
      getPostImages(postIds),
    ]);

  const extraTaggedClubsMap = buildTaggedClubsMap(extraTagRows as any);

  const likesCountMap = new Map<string, number>();
  const userLikedSet = new Set<string>();
  for (const like of (likesRows as any[]) ?? []) {
    likesCountMap.set(like.post_id, (likesCountMap.get(like.post_id) ?? 0) + 1);
    if (like.user_id === viewerUserId) userLikedSet.add(like.post_id);
  }

  const commentsCountMap = new Map<string, number>();
  for (const comment of (commentsRows as any[]) ?? []) {
    commentsCountMap.set(comment.post_id, (commentsCountMap.get(comment.post_id) ?? 0) + 1);
  }

  const isFollowing = (followRow as any)?.status === 'accepted';
  const isRequested = (followRow as any)?.status === 'pending';
  const followsMe = !!followsMeRow;
  const isPrivate = (privacyRow as any)?.is_private ?? false;

  return (rawPosts as any[]).map((p) => ({
    id: p.id,
    image_url: p.image_url,
    caption: p.caption,
    created_at: p.created_at,
    author_kind: p.author_kind ?? 'user',
    author: postAuthor(p, {
      isFollowing,
      isRequested,
      followsMe,
      profileIsPrivate: isPrivate,
    }),
    club: postClub(p),
    images: postImages(p, imageMap),
    tagged_clubs: mergeTaggedClubs(p.club_id, p.clubs, extraTaggedClubsMap.get(p.id) ?? [], p.author_kind ?? 'user'),
    likes_count: likesCountMap.get(p.id) ?? 0,
    comments_count: commentsCountMap.get(p.id) ?? 0,
    user_has_liked: userLikedSet.has(p.id),
  }));
}

// ─── Batch post lookup (club Photos that Glue viewer) ─────────────────────────
//
// Full FeedPost objects for an arbitrary id set, with the viewer's like/follow
// state resolved — the club photo viewer renders these with the exact same
// post block design as the profile post viewer. Posts deleted since the ids
// were collected simply come back missing; callers drop them.
export async function getPostsByIds(
  viewerUserId: string,
  postIds: string[],
): Promise<Map<string, FeedPost>> {
  const result = new Map<string, FeedPost>();
  if (postIds.length === 0) return result;

  const { data: rawPosts, error } = await supabase
    .from('posts')
    .select(`
      id, image_url, caption, created_at, author_id, club_id, author_kind,
      profiles!inner(id, username, avatar_url),
      clubs(id, name, avatar_url)
    `)
    .in('id', postIds);

  if (error || !rawPosts || rawPosts.length === 0) return result;

  const foundIds = (rawPosts as any[]).map((p) => p.id);
  const authorIds = [...new Set((rawPosts as any[]).map((p) => p.author_id))];

  const [
    { data: likesRows },
    { data: commentsRows },
    { data: myFollows },
    { data: followerRows },
    { data: privacyRows },
    { data: extraTagRows },
    imageMap,
  ] = await Promise.all([
    supabase.from('post_likes').select('post_id, user_id').in('post_id', foundIds),
    supabase.from('post_comments').select('post_id').in('post_id', foundIds),
    supabase
      .from('follows')
      .select('following_id, status')
      .eq('follower_id', viewerUserId)
      .in('following_id', authorIds),
    supabase
      .from('follows')
      .select('follower_id')
      .eq('following_id', viewerUserId)
      .eq('status', 'accepted')
      .in('follower_id', authorIds),
    supabase.from('user_privacy').select('user_id, is_private').in('user_id', authorIds),
    supabase
      .from('post_club_tags')
      .select('post_id, club_id, clubs(id, name)')
      .in('post_id', foundIds),
    getPostImages(foundIds),
  ]);

  const extraTaggedClubsMap = buildTaggedClubsMap(extraTagRows as any);

  const likesCountMap = new Map<string, number>();
  const userLikedSet = new Set<string>();
  for (const like of (likesRows as any[]) ?? []) {
    likesCountMap.set(like.post_id, (likesCountMap.get(like.post_id) ?? 0) + 1);
    if (like.user_id === viewerUserId) userLikedSet.add(like.post_id);
  }

  const commentsCountMap = new Map<string, number>();
  for (const comment of (commentsRows as any[]) ?? []) {
    commentsCountMap.set(comment.post_id, (commentsCountMap.get(comment.post_id) ?? 0) + 1);
  }

  const followingMap = new Map(
    ((myFollows as any[]) ?? []).map((f) => [f.following_id, f.status as string]),
  );
  const followerSet = new Set(((followerRows as any[]) ?? []).map((f) => f.follower_id));
  const privacyMap = new Map<string, boolean>(
    ((privacyRows as any[]) ?? []).map((r) => [r.user_id, r.is_private]),
  );

  for (const p of rawPosts as any[]) {
    result.set(p.id, {
      id: p.id,
      image_url: p.image_url,
      caption: p.caption,
      created_at: p.created_at,
      author_kind: p.author_kind ?? 'user',
      author: postAuthor(p, {
        isFollowing: followingMap.get(p.author_id) === 'accepted',
        isRequested: followingMap.get(p.author_id) === 'pending',
        followsMe: followerSet.has(p.author_id),
        profileIsPrivate: privacyMap.get(p.author_id) ?? false,
      }),
      club: postClub(p),
      images: postImages(p, imageMap),
      tagged_clubs: mergeTaggedClubs(p.club_id, p.clubs, extraTaggedClubsMap.get(p.id) ?? [], p.author_kind ?? 'user'),
      likes_count: likesCountMap.get(p.id) ?? 0,
      comments_count: commentsCountMap.get(p.id) ?? 0,
      user_has_liked: userLikedSet.has(p.id),
    });
  }

  return result;
}

// ─── Edit own post caption (RLS also enforces author-only updates) ───────────

export async function updatePostCaption(
  userId: string,
  postId: string,
  caption: string,
): Promise<void> {
  const { error } = await supabase
    .from('posts')
    .update({ caption: caption.trim() || null })
    .eq('id', postId)
    .eq('author_id', userId);

  if (error) throw error;
}

export async function getPostComments(postId: string): Promise<PostComment[]> {
  const { data, error } = await supabase
    .from('post_comments')
    .select('id, content, created_at, profiles!inner(id, username, avatar_url)')
    .eq('post_id', postId)
    .order('created_at', { ascending: true });

  if (error || !data) return [];

  return (data as any[]).map((c) => ({
    id: c.id,
    content: c.content,
    created_at: c.created_at,
    author: {
      id: c.profiles.id,
      username: c.profiles.username,
      avatar_url: c.profiles.avatar_url,
    },
  }));
}

export async function addComment(
  postId: string,
  userId: string,
  content: string,
  // Stable per-submit tag so a double-tap / lost-response retry does not post
  // the same comment twice (migration 100).
  clientTag: string,
): Promise<void> {
  const { error } = await supabase
    .from('post_comments')
    .insert({ post_id: postId, user_id: userId, content, client_tag: clientTag });

  if (!error) return;
  // Retry of a comment that already landed under this tag — confirm and succeed.
  if (isClientTagConflict(error, 'uq_post_comments_user_client_tag')) {
    const { data: existing } = await supabase
      .from('post_comments')
      .select('id')
      .eq('user_id', userId)
      .eq('client_tag', clientTag)
      .maybeSingle();
    if (existing) return;
  }
  throw error;
}

async function compressImage(uri: string): Promise<string> {
  const result = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: 1080 } }],
    { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG },
  );
  return result.uri;
}

export async function createPost(
  userId: string,
  imageUri: string | string[],
  caption: string | undefined,
  clubIds: string[] | undefined,
  // Stable per-compose tag: a double-tap or a lost-response retry of the SAME
  // New Post reuses it and collapses to one row (migration 100).
  clientTag: string,
  /** Set only for the locked Club Profile flow; Home tags remain user posts. */
  authoredClubId?: string,
): Promise<string> {
  const imageUris = Array.isArray(imageUri) ? imageUri : [imageUri];
  if (imageUris.length < 1 || imageUris.length > 5) {
    throw new Error('Posts must contain between 1 and 5 images');
  }

  const publicUrls = await Promise.all(imageUris.map(async (uri, position) => {
    const compressedUri = await compressImage(uri);
    const filename = `${userId}/${Date.now()}-${position}.jpg`;
    const response = await fetch(compressedUri);
    const blob = await response.blob();
    const arrayBuffer = await new Response(blob).arrayBuffer();
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('posts')
      .upload(filename, new Uint8Array(arrayBuffer), {
        contentType: 'image/jpeg',
        upsert: false,
      });
    if (uploadError || !uploadData) throw uploadError ?? new Error('Upload failed');
    return supabase.storage.from('posts').getPublicUrl(uploadData.path).data.publicUrl;
  }));

  // A post made from a Club Profile is authored by the club. A Home post can
  // still tag one or more clubs and remains student-authored.
  if (authoredClubId || publicUrls.length > 1) {
    const { data, error } = await supabase.rpc('create_post', {
      p_caption: caption ?? null,
      p_image_paths: publicUrls,
      p_club_id: authoredClubId ?? null,
      p_client_tag: clientTag,
    });
    if (error) throw error;
    const result = data as any;
    const postId = result?.post_id ?? result?.post?.id ?? result?.id;
    if (!postId) throw new Error('Failed to create post');

    if (!authoredClubId && clubIds && clubIds.length > 0) {
      const { error: tagError } = await supabase
        .from('post_club_tags')
        .upsert(clubIds.map((clubId) => ({ post_id: postId, club_id: clubId })), {
          onConflict: 'post_id,club_id',
          ignoreDuplicates: true,
        });
      if (tagError) throw tagError;
    }
    return postId;
  }

  const primaryClubId = clubIds && clubIds.length > 0 ? clubIds[0] : null;

  const { data: post, error } = await supabase
    .from('posts')
    .insert({
      author_id: userId,
      club_id: primaryClubId,
      post_type: 'picture',
      image_url: publicUrls[0],
      caption: caption ?? null,
      client_tag: clientTag,
    })
    .select('id')
    .single();

  let postId: string;
  if (error) {
    // A retry whose first attempt actually landed: resolve the existing post by
    // its tag. Any other 23505 is a real error.
    if (!isClientTagConflict(error, 'uq_posts_author_client_tag')) throw error;
    const { data: existing, error: fetchError } = await supabase
      .from('posts')
      .select('id')
      .eq('author_id', userId)
      .eq('client_tag', clientTag)
      .single();
    if (fetchError || !existing) throw fetchError ?? error;
    postId = existing.id;
  } else {
    if (!post) throw new Error('Failed to create post');
    postId = post.id;
  }

  // Idempotent on both paths: a retry that lost its response before the tags
  // landed still gets them; UNIQUE(post_id, club_id) makes the repeat a no-op.
  if (clubIds && clubIds.length > 1) {
    const additionalTags = clubIds.slice(1).map((cid) => ({
      post_id: postId,
      club_id: cid,
    }));
    const { error: tagError } = await supabase
      .from('post_club_tags')
      .upsert(additionalTags, { onConflict: 'post_id,club_id', ignoreDuplicates: true });
    if (tagError) throw tagError;
  }

  return postId;
}
