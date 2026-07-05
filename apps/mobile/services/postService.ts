import * as ImageManipulator from 'expo-image-manipulator';
import { supabase } from '../lib/supabase';

export interface PostAuthor {
  id: string;
  username: string;
  avatar_url: string | null;
  is_following: boolean;
  profile_is_private: boolean;
}

export interface FeedPost {
  id: string;
  image_url: string | null;
  caption: string | null;
  created_at: string;
  author: PostAuthor;
  tagged_club: { id: string; name: string } | null;
  likes_count: number;
  comments_count: number;
  user_has_liked: boolean;
}

export async function getHomePostsFeed(
  userId: string,
  page: number = 0,
): Promise<FeedPost[]> {
  const PAGE_SIZE = 20;
  const offset = page * PAGE_SIZE;

  const [{ data: followedRows }, { data: myProfile }] = await Promise.all([
    supabase
      .from('follows')
      .select('following_id')
      .eq('follower_id', userId)
      .eq('status', 'accepted'),
    supabase.from('profiles').select('university').eq('id', userId).single(),
  ]);

  const followedIds = (followedRows ?? []).map((r: any) => r.following_id);
  const myUniversity: string | null = (myProfile as any)?.university ?? null;

  const { data: rawPosts, error } = await supabase
    .from('posts')
    .select(`
      id, image_url, caption, created_at, author_id, club_id,
      profiles!inner(id, username, avatar_url),
      clubs(id, name)
    `)
    .order('created_at', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);

  if (error || !rawPosts) return [];

  const postIds = (rawPosts as any[]).map((p) => p.id);
  const authorIds = [...new Set((rawPosts as any[]).map((p) => p.author_id))];

  const [{ data: likesRows }, { data: commentsRows }, { data: authorUniversities }, { data: privacyRows }] =
    await Promise.all([
      supabase.from('post_likes').select('post_id, user_id').in('post_id', postIds),
      supabase
        .from('post_comments')
        .select('post_id')
        .in('post_id', postIds),
      supabase
        .from('profiles')
        .select('id, university')
        .in('id', authorIds),
      supabase
        .from('user_privacy')
        .select('user_id, is_private')
        .in('user_id', authorIds),
    ]);

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

  const authorUniversityMap = new Map<string, string | null>(
    (authorUniversities as any[]).map((p) => [p.id, p.university]),
  );

  const privacyMap = new Map<string, boolean>(
    ((privacyRows as any[]) ?? []).map((r) => [r.user_id, r.is_private]),
  );

  const followedSet = new Set(followedIds);

  const posts: (FeedPost & { _sort_key: number })[] = (rawPosts as any[])
    .filter((p) => {
      if (p.author_id === userId) return true;
      const authorUniv = authorUniversityMap.get(p.author_id);
      return followedSet.has(p.author_id) || (myUniversity && authorUniv === myUniversity);
    })
    .map((p) => ({
      id: p.id,
      image_url: p.image_url,
      caption: p.caption,
      created_at: p.created_at,
      author: {
        id: p.profiles.id,
        username: p.profiles.username,
        avatar_url: p.profiles.avatar_url,
        is_following: followedSet.has(p.author_id),
        profile_is_private: privacyMap.get(p.author_id) ?? false,
      },
      tagged_club: p.club_id ? { id: p.clubs.id, name: p.clubs.name } : null,
      likes_count: likesCountMap.get(p.id) ?? 0,
      comments_count: commentsCountMap.get(p.id) ?? 0,
      user_has_liked: userLikedSet.has(p.id),
      _sort_key: followedSet.has(p.author_id) ? 0 : 1,
    }));

  posts.sort((a, b) => {
    if (a._sort_key !== b._sort_key) return a._sort_key - b._sort_key;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  return posts.map(({ _sort_key: _, ...rest }) => rest);
}

export async function getPostById(postId: string, userId: string): Promise<FeedPost | null> {
  const { data: p, error } = await supabase
    .from('posts')
    .select(`
      id, image_url, caption, created_at, author_id, club_id,
      profiles!inner(id, username, avatar_url),
      clubs(id, name)
    `)
    .eq('id', postId)
    .single();

  if (error || !p) return null;

  const [{ data: likesRows }, { data: commentsRows }, { data: followRow }, { data: privacyRow }] =
    await Promise.all([
      supabase.from('post_likes').select('user_id').eq('post_id', postId),
      supabase.from('post_comments').select('id').eq('post_id', postId),
      supabase
        .from('follows')
        .select('id')
        .eq('follower_id', userId)
        .eq('following_id', (p as any).author_id)
        .eq('status', 'accepted')
        .maybeSingle(),
      supabase
        .from('user_privacy')
        .select('is_private')
        .eq('user_id', (p as any).author_id)
        .maybeSingle(),
    ]);

  const likes = (likesRows ?? []) as any[];

  return {
    id: p.id,
    image_url: p.image_url,
    caption: p.caption,
    created_at: p.created_at,
    author: {
      id: (p as any).profiles.id,
      username: (p as any).profiles.username,
      avatar_url: (p as any).profiles.avatar_url,
      is_following: !!followRow,
      profile_is_private: (privacyRow as any)?.is_private ?? false,
    },
    tagged_club: (p as any).club_id ? { id: (p as any).clubs.id, name: (p as any).clubs.name } : null,
    likes_count: likes.length,
    comments_count: (commentsRows ?? []).length,
    user_has_liked: likes.some((l) => l.user_id === userId),
  };
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
  imageUri: string,
  caption?: string,
  clubIds?: string[],
): Promise<string> {
  const compressedUri = await compressImage(imageUri);

  const filename = `${userId}/${Date.now()}.jpg`;
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

  const { data: { publicUrl } } = supabase.storage
    .from('posts')
    .getPublicUrl(uploadData.path);

  const primaryClubId = clubIds && clubIds.length > 0 ? clubIds[0] : null;

  const { data: post, error } = await supabase
    .from('posts')
    .insert({
      author_id: userId,
      club_id: primaryClubId,
      post_type: 'picture',
      image_url: publicUrl,
      caption: caption ?? null,
    })
    .select('id')
    .single();

  if (error || !post) throw error ?? new Error('Failed to create post');

  if (clubIds && clubIds.length > 1) {
    const additionalTags = clubIds.slice(1).map((cid) => ({
      post_id: post.id,
      club_id: cid,
    }));
    await supabase.from('post_club_tags').insert(additionalTags);
  }

  return post.id;
}
