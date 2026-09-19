import { supabase } from '../lib/supabase';

export type FollowStatus = 'following' | 'pending' | 'not_following';

export interface UserProfileData {
  id: string;
  username: string;
  full_name: string;
  avatar_url: string | null;
  bio: string | null;
  major: string | null;
  clubs_count: number;
  gluemates_count: number;
  is_private: boolean;
  hide_interests: boolean;
  hide_events: boolean;
  follow_status: FollowStatus;
  is_gluemate: boolean;
  interests: string[];
  club_roles: Array<{ club_id: string; club_name: string; role_title: string }>;
}

export interface UserPost {
  id: string;
  image_url: string | null;
  created_at: string;
  /** >1 when the post is a multi-photo carousel (drives the grid badge). */
  image_count: number;
}

export interface UserWeeklyEvent {
  id: string;
  title: string;
  emoji: string | null;
  cover_image_url: string | null;
  event_date: string;
  start_time: string;
  end_time: string;
  event_end_at: string;
  location: string | null;
  club: { id: string; name: string };
}

export async function getUserProfile(
  targetUserId: string,
  viewerUserId: string,
): Promise<UserProfileData | null> {
  const [
    { data: profile },
    { data: privacy },
    { data: followRow },
    { data: reverseFollow },
    { data: interests },
    { data: memberships },
    { data: clubRoles },
    gluematesCount,
  ] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, username, full_name, avatar_url, bio, major')
      .eq('id', targetUserId)
      .single(),
    supabase
      .from('user_privacy')
      .select('is_private, hide_interests, hide_events')
      .eq('user_id', targetUserId)
      .maybeSingle(),
    supabase
      .from('follows')
      .select('status')
      .eq('follower_id', viewerUserId)
      .eq('following_id', targetUserId)
      .maybeSingle(),
    supabase
      .from('follows')
      .select('id')
      .eq('follower_id', targetUserId)
      .eq('following_id', viewerUserId)
      .eq('status', 'accepted')
      .maybeSingle(),
    supabase.from('user_interests').select('interest').eq('user_id', targetUserId),
    supabase.from('club_members').select('club_id').eq('user_id', targetUserId),
    supabase
      .from('club_officers')
      .select('club_id, role_title, clubs!inner(id, name)')
      .eq('user_id', targetUserId),
    // Only depends on targetUserId (known up front) — no reason to wait for
    // the rest of this Promise.all to resolve before starting it.
    getGluematesCount(targetUserId),
  ]);

  if (!profile) return null;

  const clubIds = (memberships ?? []).map((m: any) => m.club_id);

  let followStatus: FollowStatus = 'not_following';
  if (followRow) {
    followStatus = followRow.status === 'accepted' ? 'following' : 'pending';
  }

  const isGluemate = followStatus === 'following' && !!reverseFollow;

  return {
    id: profile.id,
    username: profile.username,
    full_name: profile.full_name,
    avatar_url: profile.avatar_url,
    bio: profile.bio,
    major: profile.major,
    clubs_count: clubIds.length,
    gluemates_count: gluematesCount,
    is_private: privacy?.is_private ?? false,
    hide_interests: (privacy as any)?.hide_interests ?? false,
    hide_events: (privacy as any)?.hide_events ?? false,
    follow_status: followStatus,
    is_gluemate: isGluemate,
    // Hidden interests are also enforced server-side by RLS on user_interests;
    // this array simply comes back empty when the owner hides them.
    interests: (interests ?? []).map((i: any) => i.interest),
    club_roles: (clubRoles ?? []).map((r: any) => ({
      club_id: r.clubs.id,
      club_name: r.clubs.name,
      role_title: r.role_title,
    })),
  };
}

// Both reads are independent — fetching everyone the user follows AND
// everyone who follows the user in one parallel wave (then intersecting
// client-side) replaces two sequential round trips with one.
async function getGluematesCount(userId: string): Promise<number> {
  const [{ data: following }, { data: followers }] = await Promise.all([
    supabase.from('follows').select('following_id').eq('follower_id', userId).eq('status', 'accepted'),
    supabase.from('follows').select('follower_id').eq('following_id', userId).eq('status', 'accepted'),
  ]);

  const followingIds = new Set((following ?? []).map((r: any) => r.following_id));
  let count = 0;
  for (const r of (followers ?? []) as any[]) {
    if (followingIds.has(r.follower_id)) count++;
  }
  return count;
}

// Follow (or request to follow) a user. Notifications are created by DB
// triggers (migration 031) — never insert them here or they duplicate.
export async function followUser(followerId: string, followingId: string): Promise<void> {
  if (followerId === followingId) return;

  // A repeated tap must never downgrade an accepted follow back to pending
  // or fire duplicate requests — the existing row always wins.
  const { data: existing } = await supabase
    .from('follows')
    .select('status')
    .eq('follower_id', followerId)
    .eq('following_id', followingId)
    .maybeSingle();
  if (existing) return;

  const { data: privacy } = await supabase
    .from('user_privacy')
    .select('is_private')
    .eq('user_id', followingId)
    .maybeSingle();

  const status = privacy?.is_private ? 'pending' : 'accepted';

  const { error } = await supabase
    .from('follows')
    .upsert(
      { follower_id: followerId, following_id: followingId, status },
      { onConflict: 'follower_id,following_id', ignoreDuplicates: true },
    );
  if (error) throw error;
}

// Unfollow, or cancel a pending follow request (same row either way).
export async function unfollowUser(followerId: string, followingId: string): Promise<void> {
  const { error } = await supabase
    .from('follows')
    .delete()
    .eq('follower_id', followerId)
    .eq('following_id', followingId);
  if (error) throw error;
}

export interface GluemateRow {
  user_id: string;
  username: string;
  full_name: string;
  avatar_url: string | null;
}

// Gluemates (mutual accepted follows) of ANY profile user — powers the list
// opened by tapping the Gluemates count.
export async function getUserGluematesList(userId: string): Promise<GluemateRow[]> {
  const { data: following } = await supabase
    .from('follows')
    .select('following_id')
    .eq('follower_id', userId)
    .eq('status', 'accepted');

  if (!following || following.length === 0) return [];

  const followingIds = (following as any[]).map((r) => r.following_id);

  const { data: mutuals, error } = await supabase
    .from('follows')
    .select('follower_id, profiles!follows_follower_id_fkey(id, username, full_name, avatar_url)')
    .eq('following_id', userId)
    .in('follower_id', followingIds)
    .eq('status', 'accepted');
  if (error) throw error;

  return ((mutuals ?? []) as any[]).map((r) => ({
    user_id: r.profiles.id,
    username: r.profiles.username,
    full_name: r.profiles.full_name,
    avatar_url: r.profiles.avatar_url,
  }));
}

export async function getUserPosts(
  userId: string,
  page: number = 0,
): Promise<UserPost[]> {
  const PAGE_SIZE = 12;
  const offset = page * PAGE_SIZE;

  const { data } = await supabase
    .from('posts')
    .select('id, image_url, created_at, post_images(count)')
    .eq('author_id', userId)
    // Club-authored posts belong to the club, not this person's profile grid
    // (matches getUserPostsFeed, which backs the vertical post viewer).
    .eq('author_kind', 'user')
    .not('image_url', 'is', null)
    .order('created_at', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);

  return (data ?? []).map((p: any) => ({
    id: p.id,
    image_url: p.image_url,
    created_at: p.created_at,
    image_count: p.post_images?.[0]?.count ?? (p.image_url ? 1 : 0),
  })) as UserPost[];
}

export async function getUserWeeklyEvents(
  userId: string,
  page: number = 0,
): Promise<UserWeeklyEvent[]> {
  const PAGE_SIZE = 10;
  const offset = page * PAGE_SIZE;

  const { data: rsvps } = await supabase
    .from('event_rsvps')
    .select('event_id')
    .eq('user_id', userId)
    .eq('status', 'going');

  if (!rsvps || rsvps.length === 0) return [];

  const eventIds = rsvps.map((r: any) => r.event_id);

  const { data } = await supabase
    .from('events')
    .select(`
      id, title, emoji, cover_image_url, event_date, start_time, end_time, event_end_at, location,
      clubs!inner(id, name)
    `)
    .in('id', eventIds)
    .gt('event_end_at', new Date().toISOString())
    .order('event_date', { ascending: true })
    .range(offset, offset + PAGE_SIZE - 1);

  return ((data ?? []) as any[]).map((e) => ({
    id: e.id,
    title: e.title,
    emoji: e.emoji,
    cover_image_url: e.cover_image_url,
    event_date: e.event_date,
    start_time: e.start_time,
    end_time: e.end_time,
    event_end_at: e.event_end_at,
    location: e.location,
    club: { id: e.clubs.id, name: e.clubs.name },
  }));
}
