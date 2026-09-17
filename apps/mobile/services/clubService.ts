import { supabase } from '../lib/supabase';
import { splitPastAndUpcoming } from '../lib/eventDisplay';

export interface OfficerStatus {
  isOfficer: boolean;
  officerClubIds: string[];
}

export async function getUserOfficerStatus(userId: string): Promise<OfficerStatus> {
  const { data } = await supabase
    .from('club_members')
    .select('club_id')
    .eq('user_id', userId)
    .eq('role', 'officer');

  const officerClubIds = (data ?? []).map((row: any) => row.club_id);
  return {
    isOfficer: officerClubIds.length > 0,
    officerClubIds,
  };
}

export interface ClubGoal {
  id: string;
  goal_text: string;
  display_order: number;
}

export interface ClubOfficer {
  id: string;
  user_id: string | null;
  display_name: string;
  role_title: string;
  avatar_url: string | null;
}

export interface ClubUpcomingEvent {
  id: string;
  title: string;
  emoji: string | null;
  cover_image_url: string | null;
  event_date: string;
  start_time: string;
  end_time: string;
  event_end_at: string;
  location: string | null;
  building: string | null;
  room: string | null;
  visibility: 'everyone' | 'members' | 'specific';
  /** False only for the members-only club-profile preview. */
  can_open: boolean;
}

export async function getAllClubs(): Promise<UserClub[]> {
  const { data, error } = await supabase
    .from('clubs')
    .select('id, name, avatar_url')
    .order('name');

  if (error) throw error;
  return (data ?? []) as UserClub[];
}

export interface ClubPhoto {
  id: string;
  url: string;
  source: 'officer_upload' | 'tagged_post' | 'club_authored';
  post_id: string | null;
  caption: string | null;
  created_at: string;
  /** >1 when the backing post is a multi-photo carousel (drives the grid badge). */
  image_count: number;
}

// One source of truth for every Photos that Glue surface (club profile
// preview, Edit Club, See all grid, full viewer): visible photos of this
// club, newest first, tagged rows only while their post still exists.
// A photo hidden by an officer (is_visible=false) is filtered by RLS AND
// by this predicate — it can never leak into any of those screens.
const CLUB_PHOTOS_SELECT = 'id, url, source, post_id, caption, created_at';

export async function getClubPhotos(clubId: string): Promise<ClubPhoto[]> {
  const [{ data: legacyRows, error: legacyError }, { data: authoredRows, error: authoredError }] = await Promise.all([
    supabase
      .from('club_photos')
      .select(CLUB_PHOTOS_SELECT)
      .eq('club_id', clubId)
      .eq('is_visible', true)
      .or('source.eq.officer_upload,post_id.not.is.null')
      .order('created_at', { ascending: false }),
    supabase
      .from('posts')
      .select('id, image_url, caption, created_at')
      .eq('club_id', clubId)
      .eq('author_kind', 'club')
      .not('image_url', 'is', null),
  ]);
  if (legacyError) throw legacyError;
  if (authoredError) throw authoredError;

  const photos = ((legacyRows ?? []) as any[]).map((row) => ({
    id: row.id,
    url: row.url,
    source: row.source,
    post_id: row.post_id,
    caption: row.caption,
    created_at: row.created_at,
    image_count: 1,
  })) as ClubPhoto[];
  const existingPostIds = new Set(photos.map((photo) => photo.post_id).filter(Boolean));
  for (const post of (authoredRows ?? []) as any[]) {
    if (existingPostIds.has(post.id)) continue;
    photos.push({
      id: post.id,
      url: post.image_url,
      // A club-authored post's club identity IS its authorship — removal is a
      // full delete, not a detach (see clubPhotoRemoval planner).
      source: 'club_authored',
      post_id: post.id,
      caption: post.caption,
      created_at: post.created_at,
      image_count: 1,
    });
  }

  // One extra query fills in the carousel count for every photo backed by a post.
  const postIds = [...new Set(photos.map((p) => p.post_id).filter(Boolean) as string[])];
  if (postIds.length > 0) {
    const { data: imgRows } = await supabase
      .from('post_images')
      .select('post_id')
      .in('post_id', postIds);
    const counts = new Map<string, number>();
    for (const r of (imgRows ?? []) as { post_id: string }[]) {
      counts.set(r.post_id, (counts.get(r.post_id) ?? 0) + 1);
    }
    for (const photo of photos) {
      if (photo.post_id && counts.has(photo.post_id)) photo.image_count = counts.get(photo.post_id)!;
    }
  }

  photos.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  return photos;
}

export interface ClubGluemate {
  id: string;
  username: string;
  avatar_url: string | null;
}

export interface ClubProfileData {
  id: string;
  name: string;
  handle: string;
  description: string;
  avatar_url: string | null;
  banner_url: string | null;
  meeting_day: string | null;
  meeting_time_start: string | null;
  meeting_time_end: string | null;
  meeting_location: string | null;
  meeting_building: string | null;
  meeting_room: string | null;
  /** JSONB array of { day, start, end } — multi-day schedule. */
  meeting_schedule: { day: string; start: string | null; end: string | null }[] | null;
  member_count: number;
  is_member: boolean;
  goals: ClubGoal[];
  officers: ClubOfficer[];
  upcoming_events: ClubUpcomingEvent[];
  past_events: ClubUpcomingEvent[];
  photos: ClubPhoto[];
  gluemates: ClubGluemate[];
  gluemates_count: number;
}

export async function getClubProfile(
  clubId: string,
  userId: string,
): Promise<ClubProfileData | null> {
  const [
    { data: club },
    { count: memberCount },
    { data: membership },
    { data: goals },
    { data: officerRows },
    { data: eventRows },
    photoRows,
    gluemates,
  ] = await Promise.all([
    supabase
      .from('clubs')
      .select('id, name, handle, description, avatar_url, banner_url, meeting_day, meeting_time_start, meeting_time_end, meeting_location, meeting_building, meeting_room, meeting_schedule')
      .eq('id', clubId)
      .single(),
    supabase
      .from('club_members')
      .select('id', { count: 'exact', head: true })
      .eq('club_id', clubId),
    supabase
      .from('club_members')
      .select('id')
      .eq('club_id', clubId)
      .eq('user_id', userId)
      .maybeSingle(),
    supabase
      .from('club_goals')
      .select('id, goal_text, display_order')
      .eq('club_id', clubId)
      .order('display_order'),
    supabase
      .from('club_officers')
      .select('id, user_id, display_name, role_title, profiles(avatar_url)')
      .eq('club_id', clubId),
    // The canonical RPC intentionally returns a card-only preview for a
    // members-only event to a non-member, while selected events stay hidden.
    supabase.rpc('get_club_profile_events', { p_club_id: clubId }),
    getClubPhotos(clubId),
    getClubGluemates(clubId, userId),
  ]);

  if (!club) return null;

  const officers: ClubOfficer[] = ((officerRows ?? []) as any[]).map((o) => ({
    id: o.id,
    user_id: o.user_id,
    display_name: o.display_name,
    role_title: o.role_title,
    avatar_url: o.profiles?.avatar_url ?? null,
  }));

  const allEvents: ClubUpcomingEvent[] = ((eventRows ?? []) as any[]).map((e) => ({
    id: e.id,
    title: e.title,
    emoji: e.emoji,
    cover_image_url: e.cover_image_url,
    event_date: e.event_date,
    start_time: e.start_time,
    end_time: e.end_time,
    event_end_at: e.event_end_at,
    location: e.location,
    building: e.building,
    room: e.room,
    visibility: e.visibility as 'everyone' | 'members' | 'specific',
    can_open: e.can_open === true,
  }));
  const { upcoming, past } = splitPastAndUpcoming(allEvents);

  return {
    id: club.id,
    name: club.name,
    handle: club.handle,
    description: club.description,
    avatar_url: club.avatar_url,
    banner_url: club.banner_url,
    meeting_day: club.meeting_day,
    meeting_time_start: club.meeting_time_start,
    meeting_time_end: club.meeting_time_end,
    meeting_location: club.meeting_location,
    meeting_building: club.meeting_building,
    meeting_room: club.meeting_room,
    meeting_schedule: (club as any).meeting_schedule ?? null,
    member_count: memberCount ?? 0,
    is_member: !!membership,
    goals: (goals ?? []) as ClubGoal[],
    officers,
    upcoming_events: upcoming,
    past_events: past,
    photos: photoRows,
    gluemates: gluemates.slice(0, 4),
    gluemates_count: gluemates.length,
  };
}

async function getClubGluemates(clubId: string, userId: string): Promise<ClubGluemate[]> {
  // All three reads are independent — fetching every club member's profile
  // up front (instead of waiting for following/followers to resolve so the
  // mutual set can be computed, THEN querying club_members for just that
  // subset) trades a few extra lightweight rows for one fewer sequential
  // network round trip. This function runs inside getClubProfile's own
  // Promise.all, so its round-trip count directly sets a floor on how fast
  // the whole club profile can open.
  const [{ data: following }, { data: followers }, { data: members }] = await Promise.all([
    supabase
      .from('follows')
      .select('following_id')
      .eq('follower_id', userId)
      .eq('status', 'accepted'),
    supabase
      .from('follows')
      .select('follower_id')
      .eq('following_id', userId)
      .eq('status', 'accepted'),
    supabase
      .from('club_members')
      .select('user_id, profiles!inner(id, username, avatar_url)')
      .eq('club_id', clubId),
  ]);

  const followingIds = new Set((following ?? []).map((r: any) => r.following_id));
  const followerIds = new Set((followers ?? []).map((r: any) => r.follower_id));
  const mutualIds = new Set([...followingIds].filter((id) => followerIds.has(id)));

  if (mutualIds.size === 0) return [];

  return ((members ?? []) as any[])
    .filter((m) => mutualIds.has(m.user_id))
    .map((m) => ({
      id: m.profiles.id,
      username: m.profiles.username,
      avatar_url: m.profiles.avatar_url,
    }));
}

export async function joinClub(userId: string, clubId: string): Promise<void> {
  // "Ensure joined": ignoreDuplicates so a double-tap / retry is a safe no-op.
  // A plain upsert would REWRITE role to 'member' on conflict and silently
  // demote an officer. A rejected join must surface, not report false success.
  const { error } = await supabase
    .from('club_members')
    .upsert(
      { user_id: userId, club_id: clubId, role: 'member' },
      { onConflict: 'club_id,user_id', ignoreDuplicates: true },
    );
  if (error) throw error;
}

export type LeaveClubResult = 'left' | 'blocked_only_officer' | 'not_member';

export class OnlyOfficerError extends Error {
  constructor() {
    super("You're the only officer of this club. Assign another officer before leaving.");
    this.name = 'OnlyOfficerError';
  }
}

// Leaves a club via the race-safe leave_club RPC (migration 029). The RPC
// blocks the sole officer of a club from leaving and, on success, lets the
// existing AFTER DELETE triggers strip officer role + officer/club group-chat
// access + club_officers row + members-only RSVPs atomically. Throws
// OnlyOfficerError when the caller is the last officer so callers can surface
// the "assign another officer first" note without mutating any UI state.
export async function leaveClub(_userId: string, clubId: string): Promise<LeaveClubResult> {
  const { data, error } = await supabase.rpc('leave_club', { p_club_id: clubId });
  if (error) throw error;
  const result = data as LeaveClubResult;
  if (result === 'blocked_only_officer') throw new OnlyOfficerError();
  return result;
}

// Whether this user is currently an officer of the club (source of truth:
// club_members.role — never a cached store, so the leave flow can't pick the
// wrong confirmation modal off stale state).
export async function getIsClubOfficer(userId: string, clubId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('club_members')
    .select('role')
    .eq('club_id', clubId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return (data as { role?: string } | null)?.role === 'officer';
}

// Number of active officers of a club (source of truth: club_members.role).
export async function getClubOfficerCount(clubId: string): Promise<number> {
  const { count, error } = await supabase
    .from('club_members')
    .select('id', { count: 'exact', head: true })
    .eq('club_id', clubId)
    .eq('role', 'officer');
  if (error) throw error;
  return count ?? 0;
}

export interface UserClub {
  id: string;
  name: string;
  avatar_url: string | null;
}

export async function getUserMemberClubs(userId: string): Promise<UserClub[]> {
  const { data } = await supabase
    .from('club_members')
    .select('clubs!inner(id, name, avatar_url)')
    .eq('user_id', userId);

  return ((data ?? []) as any[]).map((m) => ({
    id: m.clubs.id,
    name: m.clubs.name,
    avatar_url: m.clubs.avatar_url,
  }));
}

export async function getUserOfficerClubs(userId: string): Promise<UserClub[]> {
  const { data } = await supabase
    .from('club_members')
    .select('clubs!inner(id, name, avatar_url)')
    .eq('user_id', userId)
    .eq('role', 'officer');

  return ((data ?? []) as any[]).map((m) => ({
    id: m.clubs.id,
    name: m.clubs.name,
    avatar_url: m.clubs.avatar_url,
  }));
}

// ─── Club Management (Officers only) ─────────────────────────────────────────

export interface UpdateClubInput {
  name?: string;
  description?: string;
  avatar_url?: string;
  banner_url?: string;
  meeting_day?: string | null;
  meeting_time_start?: string | null;
  meeting_time_end?: string | null;
  meeting_location?: string | null;
  meeting_building?: string | null;
  meeting_room?: string | null;
  meeting_schedule?: { day: string; start: string | null; end: string | null }[] | null;
}

export async function updateClubProfile(
  clubId: string,
  data: UpdateClubInput,
): Promise<void> {
  const { error } = await supabase
    .from('clubs')
    .update(data)
    .eq('id', clubId);

  if (error) throw error;
}

export async function updateClubGoals(clubId: string, goalTexts: string[]): Promise<void> {
  const trimmed = goalTexts.map((g) => g.trim()).filter((g) => g.length > 0);

  const { error: deleteError } = await supabase.from('club_goals').delete().eq('club_id', clubId);
  if (deleteError) throw deleteError;

  if (trimmed.length === 0) return;

  const { error: insertError } = await supabase.from('club_goals').insert(
    trimmed.map((goal_text, index) => ({
      club_id: clubId,
      goal_text,
      display_order: index,
    })),
  );
  if (insertError) throw insertError;
}

// Adds (or promotes) an officer through the add_club_officer RPC — atomic,
// permission-checked server-side, idempotent, and it makes the DB triggers
// handle member+officer group chat adds and the three notifications
// ("members group chat", "officers group chat", "added as [Role]").
// The old client-side upsert path silently failed: club_members had no
// UPDATE policy, so promoting an existing member updated zero rows.
export async function addOfficer(
  clubId: string,
  userId: string,
  roleTitle: string,
): Promise<void> {
  const { error } = await supabase.rpc('add_club_officer', {
    p_club_id: clubId,
    p_user_id: userId,
    p_role_title: roleTitle.trim(),
  });
  if (error) throw error;
}

// Removes an officer through the remove_club_officer RPC — atomic and
// permission-checked server-side. One call downgrades club_members.role
// (which revokes Officers-chat access via the role-change trigger), deletes
// the club_officers display row (so the role disappears from the club AND
// the person's profile together), and notifies the removed officer. The old
// two-step client path could partially fail and leave a stale role visible.
export async function removeOfficer(clubId: string, userId: string): Promise<void> {
  const { error } = await supabase.rpc('remove_club_officer', {
    p_club_id: clubId,
    p_user_id: userId,
  });
  if (error) throw error;
}

export async function deleteClub(clubId: string): Promise<void> {
  const { error } = await supabase
    .from('clubs')
    .update({ is_active: false })
    .eq('id', clubId);

  if (error) throw error;
}

export async function uploadClubPhoto(
  clubId: string,
  photoUrl: string,
  uploadedBy: string,
  caption?: string,
): Promise<void> {
  const { error } = await supabase.from('club_photos').insert({
    club_id: clubId,
    url: photoUrl,
    uploaded_by: uploadedBy,
    source: 'officer_upload',
    caption: caption ?? null,
    is_visible: true,
  });

  if (error) throw error;
}

export interface AppUser {
  id: string;
  username: string;
  full_name: string;
  avatar_url: string | null;
}

export async function searchAllUsers(query: string): Promise<AppUser[]> {
  const q = query.trim();
  let req = supabase
    .from('profiles')
    .select('id, username, full_name, avatar_url')
    .order('username')
    .limit(50);

  if (q) {
    req = req.or(`username.ilike.%${q}%,full_name.ilike.%${q}%`);
  }

  const { data, error } = await req;
  if (error) throw error;
  return (data ?? []) as AppUser[];
}

export interface UniversityUser extends AppUser {
  university: string | null;
}

// Officer assignment search: only people from the caller's own university
// can be picked (clubs are university-scoped communities).
export async function searchUniversityUsers(
  viewerUserId: string,
  query: string,
): Promise<UniversityUser[]> {
  const { data: me } = await supabase
    .from('profiles')
    .select('university')
    .eq('id', viewerUserId)
    .maybeSingle();

  const myUniversity = (me as { university?: string | null } | null)?.university ?? null;

  const q = query.trim();
  let req = supabase
    .from('profiles')
    .select('id, username, full_name, avatar_url, university')
    .neq('id', viewerUserId)
    .order('username')
    .limit(30);

  if (myUniversity) req = req.eq('university', myUniversity);
  if (q) req = req.or(`username.ilike.%${q}%,full_name.ilike.%${q}%`);

  const { data, error } = await req;
  if (error) throw error;
  return (data ?? []) as UniversityUser[];
}

// "Hide from this club": the photo disappears from this club's Photos that
// Glue only. The underlying post stays on the poster's profile, Home, and
// every other surface. Durable (is_visible=false in Supabase) and respected
// by every club photo query via the shared is_visible filter.
export async function hideClubPhoto(photoId: string): Promise<void> {
  const { error } = await supabase
    .from('club_photos')
    .update({ is_visible: false })
    .eq('id', photoId);

  if (error) throw error;
}

// "Remove from club": strips ONLY this club's association from a tagged
// post — posts.club_id / post_club_tags row / club_photos row — via the
// officer-checked SECURITY DEFINER RPC. The post itself (caption, image,
// owner, likes, comments, shares, Home, profile, DMs) is untouched; every
// rendering of the post simply stops showing this club's tag. Tracked by
// the post's stable id + the club relationship, never by image comparison.
export async function removePostFromClub(postId: string, clubId: string): Promise<void> {
  const { error } = await supabase.rpc('remove_post_from_club', {
    p_post_id: postId,
    p_club_id: clubId,
  });
  if (error) throw error;
}

// Deletes an officer-uploaded photo row (club_photos only — no post exists
// behind it) via the officer-checked SECURITY DEFINER RPC.
export async function deleteClubPhotoEverywhere(photoId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_club_photo_everywhere', {
    p_photo_id: photoId,
  });
  if (error) throw error;
}

export interface ClubPostCreateResult {
  post_id?: string;
  id: string;
  image_url: string | null;
  caption: string | null;
  created_at: string;
  author_kind: 'club';
  club: { id: string; name: string; avatar_url: string | null };
  images: { path: string; position: number; width?: number | null; height?: number | null }[];
}

/** Creates a club-authored post. The database verifies club_members.role.
 *
 * `imageDimensions` (optional, one entry per `imagePaths` in the same order)
 * lets a single image render at its natural aspect with no layout shift —
 * the same contract `create_post` already relies on (migration 118).
 * Omitting it leaves those rows' width/height NULL, which is exactly the
 * condition that produced a real scroll-rejection bug on the Home feed when
 * the image's aspect had to be measured asynchronously after layout instead
 * of being known up front — so any future caller of this function should
 * pass it whenever the images were just uploaded and their dimensions are
 * already in hand. */
export async function createClubPost(
  clubId: string,
  imagePaths: string[],
  caption?: string,
  imageDimensions?: Array<{ width: number; height: number }>,
): Promise<ClubPostCreateResult> {
  const { data, error } = await supabase.rpc('create_club_post', {
    p_club_id: clubId,
    p_image_paths: imagePaths,
    p_caption: caption?.trim() || null,
    p_image_dimensions: imageDimensions ?? null,
  });
  if (error) throw error;
  return data as ClubPostCreateResult;
}

/** Any current officer may edit the club post caption; RLS is authoritative. */
export async function updateClubPostCaption(postId: string, caption: string): Promise<void> {
  const { error } = await supabase
    .from('posts')
    .update({ caption: caption.trim() || null })
    .eq('id', postId)
    .eq('author_kind', 'club')
    .select('id')
    .single();
  if (error) throw error;
}

/** Any current officer may delete a club post; its images cascade with it. */
export async function deleteClubPost(postId: string): Promise<void> {
  const { error } = await supabase
    .from('posts')
    .delete()
    .eq('id', postId)
    .eq('author_kind', 'club')
    .select('id')
    .single();
  if (error) throw error;
}
