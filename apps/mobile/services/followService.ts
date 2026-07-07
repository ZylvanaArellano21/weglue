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
}

export interface UserWeeklyEvent {
  id: string;
  title: string;
  emoji: string | null;
  cover_image_url: string | null;
  event_date: string;
  start_time: string;
  end_time: string;
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
  ]);

  if (!profile) return null;

  const clubIds = (memberships ?? []).map((m: any) => m.club_id);
  const gluematesCount = await getGluematesCount(targetUserId);

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

async function getGluematesCount(userId: string): Promise<number> {
  const { data: following } = await supabase
    .from('follows')
    .select('following_id')
    .eq('follower_id', userId)
    .eq('status', 'accepted');

  if (!following || following.length === 0) return 0;

  const followingIds = following.map((r: any) => r.following_id);

  const { count } = await supabase
    .from('follows')
    .select('*', { count: 'exact', head: true })
    .eq('following_id', userId)
    .in('follower_id', followingIds)
    .eq('status', 'accepted');

  return count ?? 0;
}

export async function followUser(followerId: string, followingId: string): Promise<void> {
  const { data: privacy } = await supabase
    .from('user_privacy')
    .select('is_private')
    .eq('user_id', followingId)
    .maybeSingle();

  const status = privacy?.is_private ? 'pending' : 'accepted';

  await supabase
    .from('follows')
    .upsert({ follower_id: followerId, following_id: followingId, status }, { onConflict: 'follower_id,following_id' });

  if (status === 'pending') {
    await supabase.from('notifications').insert({
      user_id: followingId,
      actor_id: followerId,
      type: 'follow_request',
      entity_type: 'event',
      read: false,
    });
  } else {
    await supabase.from('notifications').insert({
      user_id: followingId,
      actor_id: followerId,
      type: 'follow_accepted',
      entity_type: 'event',
      read: false,
    });
  }
}

export async function unfollowUser(followerId: string, followingId: string): Promise<void> {
  await supabase
    .from('follows')
    .delete()
    .eq('follower_id', followerId)
    .eq('following_id', followingId);
}

export async function getUserPosts(
  userId: string,
  page: number = 0,
): Promise<UserPost[]> {
  const PAGE_SIZE = 12;
  const offset = page * PAGE_SIZE;

  const { data } = await supabase
    .from('posts')
    .select('id, image_url, created_at')
    .eq('author_id', userId)
    .not('image_url', 'is', null)
    .order('created_at', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);

  return (data ?? []) as UserPost[];
}

export async function getUserWeeklyEvents(
  userId: string,
  page: number = 0,
): Promise<UserWeeklyEvent[]> {
  const PAGE_SIZE = 10;
  const offset = page * PAGE_SIZE;
  const today = new Date().toISOString().split('T')[0];

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
      id, title, emoji, cover_image_url, event_date, start_time, end_time, location,
      clubs!inner(id, name)
    `)
    .in('id', eventIds)
    .gte('event_date', today)
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
    location: e.location,
    club: { id: e.clubs.id, name: e.clubs.name },
  }));
}
