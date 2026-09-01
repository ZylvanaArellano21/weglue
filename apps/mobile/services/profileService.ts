import { supabase } from '../lib/supabase';
import { addDaysToDateString, todayInAppTz } from '../lib/timezone';
import { bucketCalendarEvents, type CalendarEvent, type CalendarSection } from './calendarService';
import type { UserPost } from './followService';

// ─── Own Profile ─────────────────────────────────────────────────────────────

export interface OwnProfileData {
  id: string;
  username: string;
  full_name: string;
  avatar_url: string | null;
  avatar_type: string | null;
  bio: string | null;
  major: string | null;
  year: string | null;
  university: string | null;
  clubs_count: number;
  gluemates_count: number;
  // Full arrays — UI slices to 6/2 respectively with show-more
  interests: string[];
  activities: string[];
  club_roles: Array<{ club_id: string; club_name: string; role_title: string }>;
}

export interface OwnClub {
  club_id: string;
  club_name: string;
  club_handle: string;
  avatar_url: string | null;
  role: 'member' | 'officer';
}

export interface OwnGluemate {
  user_id: string;
  username: string;
  full_name: string;
  avatar_url: string | null;
}

// ─── Fetch own full profile ───────────────────────────────────────────────────

export async function getOwnProfile(userId: string): Promise<OwnProfileData | null> {
  const [
    { data: profile },
    { data: interests },
    { data: activities },
    { data: memberships },
    { data: clubRoles },
  ] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, username, full_name, avatar_url, avatar_type, bio, major, year, university')
      .eq('id', userId)
      .single(),
    supabase.from('user_interests').select('interest').eq('user_id', userId),
    supabase.from('user_activities').select('activity').eq('user_id', userId),
    supabase.from('club_members').select('club_id').eq('user_id', userId),
    supabase
      .from('club_officers')
      .select('club_id, role_title, clubs!inner(id, name)')
      .eq('user_id', userId),
  ]);

  if (!profile) return null;

  const clubIds = (memberships ?? []).map((m: any) => m.club_id);
  const gluematesCount = await getGluematesCount(userId);

  return {
    id: profile.id,
    username: profile.username,
    full_name: profile.full_name,
    avatar_url: profile.avatar_url,
    avatar_type: profile.avatar_type,
    bio: profile.bio,
    major: profile.major,
    year: (profile as any).year,
    university: (profile as any).university,
    clubs_count: clubIds.length,
    gluemates_count: gluematesCount,
    interests: (interests ?? []).map((i: any) => i.interest),
    activities: (activities ?? []).map((a: any) => a.activity),
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

// ─── Stats tap-target list fetches ───────────────────────────────────────────

export async function getOwnClubsList(userId: string): Promise<OwnClub[]> {
  const { data } = await supabase
    .from('club_members')
    .select('role, clubs!inner(id, name, handle, avatar_url)')
    .eq('user_id', userId);

  return ((data ?? []) as any[]).map((row) => ({
    club_id: row.clubs.id,
    club_name: row.clubs.name,
    club_handle: row.clubs.handle,
    avatar_url: row.clubs.avatar_url ?? null,
    role: row.role as 'member' | 'officer',
  }));
}

export async function getOwnGluematesList(userId: string): Promise<OwnGluemate[]> {
  const { data: following } = await supabase
    .from('follows')
    .select('following_id')
    .eq('follower_id', userId)
    .eq('status', 'accepted');

  if (!following || following.length === 0) return [];

  const followingIds = (following as any[]).map((r) => r.following_id);

  // The follower_id FK hint is required — follows has TWO FKs to profiles,
  // and an unhinted profiles!inner embed fails with PGRST201 (ambiguous),
  // which silently made this list always come back empty.
  const { data: mutualFollowers } = await supabase
    .from('follows')
    .select('follower_id, profiles!follows_follower_id_fkey(id, username, full_name, avatar_url)')
    .eq('following_id', userId)
    .in('follower_id', followingIds)
    .eq('status', 'accepted');

  return ((mutualFollowers ?? []) as any[]).map((r) => ({
    user_id: r.profiles.id,
    username: r.profiles.username,
    full_name: r.profiles.full_name,
    avatar_url: r.profiles.avatar_url,
  }));
}

// ─── Weekly Events (THIS WEEK only — dayDiff 0-7) ────────────────────────────

export async function getOwnThisWeekEvents(userId: string): Promise<CalendarSection[]> {
  const today = todayInAppTz();
  const sevenDaysOut = addDaysToDateString(today, 7);

  const { data: rsvps } = await supabase
    .from('event_rsvps')
    .select('event_id')
    .eq('user_id', userId)
    .eq('status', 'going');

  if (!rsvps || rsvps.length === 0) return [];

  const eventIds = (rsvps as any[]).map((r) => r.event_id);

  const { data: rawEvents } = await supabase
    .from('events')
    .select(`
      id, title, emoji, event_date, start_time, end_time, event_end_at, visibility,
      location, building, room, cover_image_url,
      clubs!inner(id, name, avatar_url)
    `)
    .in('id', eventIds)
    .gt('event_end_at', new Date().toISOString())
    .lte('event_date', sevenDaysOut)
    .order('event_date', { ascending: true })
    .order('start_time', { ascending: true });

  if (!rawEvents || rawEvents.length === 0) return [];

  // Enrich with RSVP status and saved status
  const ids = (rawEvents as any[]).map((e) => e.id);
  const [{ data: goingRsvps }, { data: savedRows }] = await Promise.all([
    supabase
      .from('event_rsvps')
      .select('event_id, profiles!inner(id, username, avatar_url)')
      .in('event_id', ids)
      .eq('status', 'going'),
    supabase
      .from('saved_events')
      .select('event_id')
      .eq('user_id', userId)
      .in('event_id', ids),
  ]);

  const countMap = new Map<string, number>();
  const previewMap = new Map<string, any[]>();
  const savedSet = new Set<string>((savedRows ?? []).map((s: any) => s.event_id));

  for (const row of (goingRsvps as any[]) ?? []) {
    countMap.set(row.event_id, (countMap.get(row.event_id) ?? 0) + 1);
    const list = previewMap.get(row.event_id) ?? [];
    if (list.length < 4) {
      list.push({
        id: row.profiles.id,
        username: row.profiles.username,
        avatar_url: row.profiles.avatar_url,
      });
      previewMap.set(row.event_id, list);
    }
  }

  const events: CalendarEvent[] = (rawEvents as any[]).map((e): CalendarEvent => ({
    id: e.id,
    title: e.title,
    emoji: e.emoji ?? null,
    event_date: e.event_date,
    start_time: e.start_time,
    end_time: e.end_time,
    event_end_at: e.event_end_at,
    visibility: (e.visibility ?? 'everyone') as CalendarEvent['visibility'],
    location: e.location ?? null,
    building: e.building ?? null,
    room: e.room ?? null,
    cover_image_url: e.cover_image_url ?? null,
    club: { id: e.clubs.id, name: e.clubs.name, avatar_url: e.clubs.avatar_url ?? null },
    attendee_count: countMap.get(e.id) ?? 0,
    attendee_preview: previewMap.get(e.id) ?? [],
    user_rsvp_status: 'going',
    is_saved: savedSet.has(e.id),
  }));

  return bucketCalendarEvents(events, today);
}

// ─── Own Posts (paginated, own profile grid) ──────────────────────────────────

export async function getOwnPosts(userId: string, page: number = 0): Promise<UserPost[]> {
  const PAGE_SIZE = 12;
  const { data } = await supabase
    .from('posts')
    .select('id, image_url, created_at, post_images(count)')
    .eq('author_id', userId)
    .not('image_url', 'is', null)
    .order('created_at', { ascending: false })
    .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

  return (data ?? []).map((p: any) => ({
    id: p.id,
    image_url: p.image_url,
    created_at: p.created_at,
    image_count: p.post_images?.[0]?.count ?? (p.image_url ? 1 : 0),
  })) as UserPost[];
}

// ─── Delete own post (removes from grid + DB) ────────────────────────────────

export async function deleteOwnPost(userId: string, postId: string): Promise<void> {
  const { data: post } = await supabase
    .from('posts')
    .select('image_url, author_id')
    .eq('id', postId)
    .single();

  if (!post || (post as any).author_id !== userId) {
    throw new Error('Post not found or not owned by user');
  }

  // Delete Storage object if the post has an image
  const imageUrl = (post as any).image_url as string | null;
  if (imageUrl) {
    const urlParts = imageUrl.split('/storage/v1/object/public/posts/');
    if (urlParts.length === 2) {
      const storagePath = urlParts[1];
      await supabase.storage.from('posts').remove([storagePath]);
    }
  }

  await supabase.from('posts').delete().eq('id', postId).eq('author_id', userId);
}

// ─── Edit Profile — update display name ──────────────────────────────────────

export async function updateDisplayName(
  userId: string,
  fullName: string,
): Promise<void> {
  const trimmed = fullName.trim();
  if (!trimmed) throw new Error('Display name cannot be empty');

  const { error } = await supabase
    .from('profiles')
    .update({ full_name: trimmed })
    .eq('id', userId);

  if (error) throw error;
}

// ─── Edit Profile — replace interests & activities ───────────────────────────
//
// UPDATE-not-insert: deletes all existing rows then re-inserts the new set.
// Calling code must invalidate ['homeEventsFeed'] and ['discoveryClubs']
// cache keys after this resolves.
//
export async function updateUserInterests(
  userId: string,
  interests: string[],
): Promise<void> {
  const { error: deleteError } = await supabase
    .from('user_interests')
    .delete()
    .eq('user_id', userId);
  if (deleteError) throw deleteError;

  if (interests.length > 0) {
    const { error: insertError } = await supabase
      .from('user_interests')
      .insert(interests.map((interest) => ({ user_id: userId, interest })));
    // Surface failures (e.g. a value outside the CHECK constraint) — swallowing
    // them here left the delete applied and silently wiped the user's data.
    if (insertError) throw insertError;
  }
}

export async function updateUserActivities(
  userId: string,
  activities: string[],
): Promise<void> {
  const { error: deleteError } = await supabase
    .from('user_activities')
    .delete()
    .eq('user_id', userId);
  if (deleteError) throw deleteError;

  if (activities.length > 0) {
    const { error: insertError } = await supabase
      .from('user_activities')
      .insert(activities.map((activity) => ({ user_id: userId, activity })));
    if (insertError) throw insertError;
  }
}

// ─── Edit Profile — update avatar (re-upload or text) ────────────────────────

export async function updateProfileAvatar(
  userId: string,
  avatarUrl: string | null,
  avatarType: 'photo' | 'camera' | 'text' | 'preset' | null,
): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({ avatar_url: avatarUrl, avatar_type: avatarType })
    .eq('id', userId);

  if (error) throw error;
}

// ─── Weekly Event swipe-delete — remove RSVP cascade ─────────────────────────
//
// Removes the going RSVP. NOT optimistic — caller should await before
// updating UI. On completion, caller invalidates:
//   ['userWeeklyEvents', userId]
//   ['calendarEvents', userId]
//   ['homeEventsFeed', userId]
//
export async function removeEventRsvp(userId: string, eventId: string): Promise<void> {
  const { error } = await supabase
    .from('event_rsvps')
    .delete()
    .eq('user_id', userId)
    .eq('event_id', eventId);

  if (error) throw error;
}

// ─── Prop / Callback interface documentation for Cursor (Step 2) ─────────────
//
// OwnProfileScreenProps (apps/mobile/app/profile/own.tsx):
//   profile:          OwnProfileData | null
//   isLoading:        boolean
//   onEditProfile:    () => void  — navigate to Edit Profile sheet
//   onEditInterests:  () => void  — navigate to Edit Interests screen
//   onEditActivities: () => void  — navigate to Edit Activities screen
//   onEditPicture:    () => void  — navigate to Edit Profile Pic screen
//   onClubsTap:       () => void  — navigate to own clubs list
//   onGluematesTap:   () => void  — navigate to own gluemates list
//   onDeletePost:     (postId: string) => Promise<void>
//   onRemoveEvent:    (eventId: string) => Promise<void>
//   showMoreInterests: boolean  — true when interests.length > 6
//   showMoreRoles:     boolean  — true when club_roles.length > 2
//
// EditInterestsScreenProps (apps/mobile/app/profile/edit-interests.tsx):
//   currentInterests: string[]     — pre-populate chips
//   onSave: (selected: string[]) => Promise<void>
//   onCancel: () => void
//
// EditActivitiesScreenProps (apps/mobile/app/profile/edit-activities.tsx):
//   currentActivities: string[]
//   onSave: (selected: string[]) => Promise<void>
//   onCancel: () => void
//
// EditProfilePicScreenProps (apps/mobile/app/profile/edit-profile-pic.tsx):
//   currentAvatarUrl:  string | null
//   currentAvatarType: string | null
//   textMaxLength:     4  — task spec: cap at ~4 chars
//   onSave: (avatarUrl: string | null, avatarType: 'photo'|'camera'|'text'|'preset'|null) => Promise<void>
//   onCancel: () => void
//
// RemoveEventConfirmationCallbackShape:
//   onConfirm: () => Promise<void>  — executes removeEventRsvp then cache invalidation
//   onCancel:  () => void
