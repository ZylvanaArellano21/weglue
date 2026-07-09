import { supabase } from '../lib/supabase';
import { todayInAppTz } from '../lib/timezone';

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
  location: string | null;
  building: string | null;
  room: string | null;
  visibility: 'everyone' | 'members' | 'specific';
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
  source: 'officer_upload' | 'tagged_post';
  post_id: string | null;
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
  member_count: number;
  is_member: boolean;
  goals: ClubGoal[];
  officers: ClubOfficer[];
  upcoming_events: ClubUpcomingEvent[];
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
    { data: photoRows },
    gluemates,
  ] = await Promise.all([
    supabase
      .from('clubs')
      .select('id, name, handle, description, avatar_url, banner_url, meeting_day, meeting_time_start, meeting_time_end, meeting_location, meeting_building, meeting_room')
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
    supabase
      .from('events')
      .select('id, title, emoji, cover_image_url, event_date, start_time, end_time, location, building, room, visibility')
      .eq('club_id', clubId)
      .gte('event_date', todayInAppTz())
      .order('event_date', { ascending: true })
      .limit(5),
    supabase
      .from('club_photos')
      .select('id, url, source, post_id')
      .eq('club_id', clubId)
      .order('created_at', { ascending: false })
      .limit(9),
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
    member_count: memberCount ?? 0,
    is_member: !!membership,
    goals: (goals ?? []) as ClubGoal[],
    officers,
    upcoming_events: ((eventRows ?? []) as any[]).map((e) => ({
      id: e.id,
      title: e.title,
      emoji: e.emoji,
      cover_image_url: e.cover_image_url,
      event_date: e.event_date,
      start_time: e.start_time,
      end_time: e.end_time,
      location: e.location,
      building: e.building,
      room: e.room,
      visibility: e.visibility as 'everyone' | 'members' | 'specific',
    })),
    photos: (photoRows ?? []) as ClubPhoto[],
    gluemates: gluemates.slice(0, 4),
    gluemates_count: gluemates.length,
  };
}

async function getClubGluemates(clubId: string, userId: string): Promise<ClubGluemate[]> {
  const [{ data: following }, { data: followers }] = await Promise.all([
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
  ]);

  const followingIds = new Set((following ?? []).map((r: any) => r.following_id));
  const followerIds = new Set((followers ?? []).map((r: any) => r.follower_id));
  const mutualIds = [...followingIds].filter((id) => followerIds.has(id));

  if (mutualIds.length === 0) return [];

  const { data: members } = await supabase
    .from('club_members')
    .select('user_id, profiles!inner(id, username, avatar_url)')
    .eq('club_id', clubId)
    .in('user_id', mutualIds);

  return ((members ?? []) as any[]).map((m) => ({
    id: m.profiles.id,
    username: m.profiles.username,
    avatar_url: m.profiles.avatar_url,
  }));
}

export async function joinClub(userId: string, clubId: string): Promise<void> {
  await supabase
    .from('club_members')
    .upsert({ user_id: userId, club_id: clubId, role: 'member' }, { onConflict: 'club_id,user_id' });
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
  const { data } = await supabase
    .from('club_members')
    .select('role')
    .eq('club_id', clubId)
    .eq('user_id', userId)
    .maybeSingle();
  return (data as { role?: string } | null)?.role === 'officer';
}

// Number of active officers of a club (source of truth: club_members.role).
export async function getClubOfficerCount(clubId: string): Promise<number> {
  const { count } = await supabase
    .from('club_members')
    .select('id', { count: 'exact', head: true })
    .eq('club_id', clubId)
    .eq('role', 'officer');
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

export async function addOfficer(
  clubId: string,
  userId: string,
  roleTitle: string,
  displayName: string,
): Promise<void> {
  // Elevate to officer in club_members
  const { error: memberError } = await supabase
    .from('club_members')
    .upsert(
      { club_id: clubId, user_id: userId, role: 'officer' },
      { onConflict: 'club_id,user_id' },
    );

  if (memberError) throw memberError;

  // Upsert into club_officers for display
  const { data: profile } = await supabase
    .from('profiles')
    .select('avatar_url')
    .eq('id', userId)
    .single();

  const { error: officerError } = await supabase.from('club_officers').upsert(
    {
      club_id: clubId,
      user_id: userId,
      role_title: roleTitle,
      display_name: displayName,
      avatar_url: profile?.avatar_url ?? null,
    },
    { onConflict: 'club_id,user_id' },
  );

  if (officerError) throw officerError;
}

export async function removeOfficer(clubId: string, userId: string): Promise<void> {
  // Downgrade to member
  const { error: memberError } = await supabase
    .from('club_members')
    .update({ role: 'member' })
    .eq('club_id', clubId)
    .eq('user_id', userId);

  if (memberError) throw memberError;

  // Remove from club_officers display table
  await supabase
    .from('club_officers')
    .delete()
    .eq('club_id', clubId)
    .eq('user_id', userId);
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

export async function deleteClubPhoto(photoId: string): Promise<void> {
  const { error } = await supabase
    .from('club_photos')
    .update({ is_visible: false })
    .eq('id', photoId);

  if (error) throw error;
}
