import { supabase } from '../lib/supabase';
import { todayInAppTz } from '../lib/timezone';

export interface NextEvent {
  id: string;
  title: string;
  emoji: string | null;
  event_date: string;
  start_time: string;
}

export interface MeetingSchedule {
  day: string;
  time_start: string | null;
  time_end: string | null;
  location: string | null;
  building: string | null;
  room: string | null;
}

export interface ClubWithNextEvent {
  id: string;
  name: string;
  handle: string;
  avatar_url: string | null;
  officer_role: string | null;
  next_event: NextEvent | null;
  meeting_schedule: MeetingSchedule | null;
}

export interface MyClubs {
  officer_clubs: ClubWithNextEvent[];
  member_clubs: ClubWithNextEvent[];
}

export async function getMyClubs(
  userId: string,
  officerCursor?: string,
  memberCursor?: string,
): Promise<MyClubs> {
  const PAGE_SIZE = 20;

  const { data: memberships } = await supabase
    .from('club_members')
    .select(
      'club_id, role, joined_at, clubs!inner(id, name, handle, avatar_url, meeting_day, meeting_time_start, meeting_time_end, meeting_location, meeting_building, meeting_room, is_active)',
    )
    .eq('user_id', userId)
    .eq('clubs.is_active', true)
    .order('joined_at', { ascending: false })
    .limit(PAGE_SIZE * 2);

  const clubIds = ((memberships ?? []) as any[]).map((m) => m.club_id);

  let nextEvents: Record<string, NextEvent> = {};

  if (clubIds.length > 0) {
    const today = todayInAppTz();
    const weekEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];

    const { data: events } = await supabase
      .from('events')
      .select('id, club_id, title, emoji, event_date, start_time')
      .in('club_id', clubIds)
      .gte('event_date', today)
      .lte('event_date', weekEnd)
      .order('event_date', { ascending: true });

    (events ?? []).forEach((e: any) => {
      if (!nextEvents[e.club_id]) {
        nextEvents[e.club_id] = {
          id: e.id,
          title: e.title,
          emoji: e.emoji,
          event_date: e.event_date,
          start_time: e.start_time,
        };
      }
    });
  }

  const officerClubIds = ((memberships ?? []) as any[])
    .filter((m) => m.role === 'officer')
    .map((m) => m.club_id);
  const officerRoles = new Map<string, string | null>();
  if (officerClubIds.length > 0) {
    const { data: officerRows } = await supabase
      .from('club_officers')
      .select('club_id, role_title')
      .eq('user_id', userId)
      .in('club_id', officerClubIds);
    (officerRows ?? []).forEach((row: any) => {
      officerRoles.set(row.club_id, row.role_title ?? null);
    });
  }

  const officerClubs: ClubWithNextEvent[] = [];
  const memberClubs: ClubWithNextEvent[] = [];

  for (const m of (memberships ?? []) as any[]) {
    const c = m.clubs;
    const item: ClubWithNextEvent = {
      id: c.id,
      name: c.name,
      handle: c.handle,
      avatar_url: c.avatar_url,
      officer_role: null,
      next_event: nextEvents[m.club_id] ?? null,
      meeting_schedule: c.meeting_day
        ? {
            day: c.meeting_day,
            time_start: c.meeting_time_start,
            time_end: c.meeting_time_end,
            location: c.meeting_location,
            building: c.meeting_building,
            room: c.meeting_room,
          }
        : null,
    };

    if (m.role === 'officer') {
      item.officer_role = officerRoles.get(c.id) ?? null;

      if (officerClubs.length < PAGE_SIZE) officerClubs.push(item);
    } else {
      if (memberClubs.length < PAGE_SIZE) memberClubs.push(item);
    }
  }

  return { officer_clubs: officerClubs, member_clubs: memberClubs };
}

export interface MemberWithFollowStatus {
  id: string;
  username: string;
  full_name: string;
  avatar_url: string | null;
  is_following: boolean;
  is_gluemate: boolean;
  joined_at: string;
  role: 'member' | 'officer';
}

export interface ClubMembersResult {
  members: MemberWithFollowStatus[];
  total: number;
}

export async function getClubMembers(
  clubId: string,
  viewerId: string,
  search?: string,
  page = 0,
  gluematesOnly = false,
): Promise<ClubMembersResult> {
  const PAGE_SIZE = 20;

  let gluemateIds: string[] | null = null;

  if (gluematesOnly) {
    const [{ data: following }, { data: followers }] = await Promise.all([
      supabase
        .from('follows')
        .select('following_id')
        .eq('follower_id', viewerId)
        .eq('status', 'accepted'),
      supabase
        .from('follows')
        .select('follower_id')
        .eq('following_id', viewerId)
        .eq('status', 'accepted'),
    ]);

    const followingSet = new Set((following ?? []).map((f: any) => f.following_id));
    const followerSet = new Set((followers ?? []).map((f: any) => f.follower_id));
    gluemateIds = [...followingSet].filter((id) => followerSet.has(id));

    if (gluemateIds.length === 0) {
      return { members: [], total: 0 };
    }
  }

  const needle = search?.trim().toLowerCase() ?? '';
  let identities = new Map<string, any>();
  let matchedIdentityIds: string[] | null = null;

  // Search must resolve identities before membership paging so it can match
  // the full roster. The no-search path resolves only the already-paged rows.
  if (needle) {
    const identityRows = await supabase
      .rpc('club_shared_identities', { p_club_id: clubId })
      .ilike('username', `%${needle}%`);
    if (identityRows.error) throw identityRows.error;
    identities = new Map<string, any>(
      ((identityRows.data ?? []) as any[]).map((row) => [row.id as string, row]),
    );
    matchedIdentityIds = [...identities.keys()];
    if (matchedIdentityIds.length === 0) {
      return { members: [], total: 0 };
    }
  }

  let query = supabase
    .from('club_members')
    .select('user_id, joined_at, role', { count: 'exact' })
    .eq('club_id', clubId)
    // TODO(perf): verify index supports (club_id, joined_at)
    .order('joined_at', { ascending: true })
    .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

  if (gluemateIds) {
    query = query.in('user_id', gluemateIds);
  }

  if (matchedIdentityIds) query = query.in('user_id', matchedIdentityIds);

  const { data: memberRows, count } = await query;

  const memberIds = ((memberRows ?? []) as any[]).map((m) => m.user_id);

  if (!needle && memberIds.length > 0) {
    // Membership rows are paged first; resolve only the identities needed for
    // this 20-member page while preserving blocked-member visibility.
    const identityRows = await supabase
      .rpc('club_shared_identities', { p_club_id: clubId })
      .in('id', memberIds);
    if (identityRows.error) throw identityRows.error;
    identities = new Map<string, any>(
      ((identityRows.data ?? []) as any[]).map((row) => [row.id as string, row]),
    );
  }

  let followingSet = new Set<string>();
  let followersSet = new Set<string>();

  if (gluemateIds) {
    followingSet = new Set(memberIds);
    followersSet = new Set(memberIds);
  } else if (memberIds.length > 0) {
    const [{ data: following }, { data: followers }] = await Promise.all([
      supabase
        .from('follows')
        .select('following_id')
        .eq('follower_id', viewerId)
        .eq('status', 'accepted')
        .in('following_id', memberIds),
      supabase
        .from('follows')
        .select('follower_id')
        .eq('following_id', viewerId)
        .eq('status', 'accepted')
        .in('follower_id', memberIds),
    ]);

    followingSet = new Set((following ?? []).map((f: any) => f.following_id));
    followersSet = new Set((followers ?? []).map((f: any) => f.follower_id));
  }

  const members: MemberWithFollowStatus[] = ((memberRows ?? []) as any[])
    .map((m) => {
      const p = identities.get(m.user_id);
      // A membership row with no shared identity means the account is no longer
      // an eligible student (suspended, deleted). Those were already excluded by
      // the old `profiles!inner` join, so this preserves the existing behaviour.
      if (!p) return null;
      const isFollowing = followingSet.has(p.id);
      const isFollowedBy = followersSet.has(p.id);
      return {
        id: p.id,
        username: p.username,
        full_name: p.full_name,
        avatar_url: p.avatar_url,
        is_following: isFollowing,
        is_gluemate: isFollowing && isFollowedBy,
        joined_at: m.joined_at,
        role: m.role === 'officer' ? 'officer' : 'member',
      } as MemberWithFollowStatus;
    })
    .filter((m): m is MemberWithFollowStatus => m !== null);

  return { members, total: count ?? 0 };
}
