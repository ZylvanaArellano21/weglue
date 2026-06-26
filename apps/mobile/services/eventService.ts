import { supabase } from '../lib/supabase';

export type EventTier = 'your_clubs' | 'recommended' | 'other';

export interface AttendeePreview {
  id: string;
  username: string;
  avatar_url: string | null;
}

export interface HomeFeedEvent {
  id: string;
  club_id: string;
  title: string;
  description: string | null;
  cover_image_url: string | null;
  event_date: string;
  start_time: string;
  end_time: string;
  location: string | null;
  building: string | null;
  room: string | null;
  activity_tags: string[];
  interest_tags: string[];
  club: {
    id: string;
    name: string;
    logo_url: string | null;
  };
  attendee_count: number;
  attendee_preview: AttendeePreview[];
  user_rsvp_status: 'going' | 'cant' | null;
  is_saved: boolean;
  is_today: boolean;
  user_has_joined_club: boolean;
  tier: EventTier;
}

export interface HomeEventsFeedSection {
  label: string;
  data: HomeFeedEvent[];
}

export async function getHomeEventsFeed(userId: string): Promise<HomeEventsFeedSection[]> {
  const today = new Date().toISOString().split('T')[0];

  const [
    { data: memberships },
    { data: userInterests },
    { data: userActivities },
    { data: savedEvents },
    { data: userRsvps },
  ] = await Promise.all([
    supabase.from('club_members').select('club_id').eq('user_id', userId),
    supabase.from('user_interests').select('interest').eq('user_id', userId),
    supabase.from('user_activities').select('activity').eq('user_id', userId),
    supabase.from('saved_events').select('event_id').eq('user_id', userId),
    supabase.from('event_rsvps').select('event_id, status').eq('user_id', userId),
  ]);

  const joinedClubIds = new Set((memberships ?? []).map((m: any) => m.club_id));
  const userInterestSet = new Set((userInterests ?? []).map((i: any) => i.interest));
  const userActivitySet = new Set((userActivities ?? []).map((a: any) => a.activity));
  const savedSet = new Set((savedEvents ?? []).map((s: any) => s.event_id));
  const rsvpMap = new Map((userRsvps ?? []).map((r: any) => [r.event_id, r.status as 'going' | 'cant']));

  const { data: rawEvents, error } = await supabase
    .from('events')
    .select(`
      id, title, description, cover_image_url, event_date, start_time, end_time,
      location, building, room, club_id,
      clubs!inner(id, name, avatar_url),
      event_interests(interest),
      event_activities(activity)
    `)
    .gte('event_date', today)
    .order('event_date', { ascending: true });

  if (error || !rawEvents) return [];

  const eventIds = (rawEvents as any[]).map((e) => e.id);

  const { data: goingRsvps } = await supabase
    .from('event_rsvps')
    .select('event_id, user_id, profiles!inner(id, username, avatar_url)')
    .in('event_id', eventIds)
    .eq('status', 'going');

  const attendeeCountMap = new Map<string, number>();
  const attendeePreviewMap = new Map<string, AttendeePreview[]>();

  for (const rsvp of (goingRsvps as any[]) ?? []) {
    attendeeCountMap.set(rsvp.event_id, (attendeeCountMap.get(rsvp.event_id) ?? 0) + 1);
    const previews = attendeePreviewMap.get(rsvp.event_id) ?? [];
    if (previews.length < 4) {
      previews.push({
        id: rsvp.profiles.id,
        username: rsvp.profiles.username,
        avatar_url: rsvp.profiles.avatar_url,
      });
      attendeePreviewMap.set(rsvp.event_id, previews);
    }
  }

  const tier1: HomeFeedEvent[] = [];
  const tier2: HomeFeedEvent[] = [];
  const tier3: HomeFeedEvent[] = [];

  for (const e of rawEvents as any[]) {
    const activityTags: string[] = (e.event_activities ?? []).map((a: any) => a.activity);
    const interestTags: string[] = (e.event_interests ?? []).map((i: any) => i.interest);
    const isInJoinedClub = joinedClubIds.has(e.club_id);

    const event: HomeFeedEvent = {
      id: e.id,
      club_id: e.club_id,
      title: e.title,
      description: e.description,
      cover_image_url: e.cover_image_url,
      event_date: e.event_date,
      start_time: e.start_time,
      end_time: e.end_time,
      location: e.location,
      building: e.building,
      room: e.room,
      activity_tags: activityTags,
      interest_tags: interestTags,
      club: {
        id: e.clubs.id,
        name: e.clubs.name,
        logo_url: e.clubs.avatar_url,
      },
      attendee_count: attendeeCountMap.get(e.id) ?? 0,
      attendee_preview: attendeePreviewMap.get(e.id) ?? [],
      user_rsvp_status: rsvpMap.get(e.id) ?? null,
      is_saved: savedSet.has(e.id),
      is_today: e.event_date === today,
      user_has_joined_club: isInJoinedClub,
      tier: 'other',
    };

    if (isInJoinedClub) {
      tier1.push({ ...event, tier: 'your_clubs' });
    } else {
      const hasOverlap =
        activityTags.some((t) => userActivitySet.has(t)) ||
        interestTags.some((t) => userInterestSet.has(t));
      if (hasOverlap) {
        tier2.push({ ...event, tier: 'recommended' });
      } else {
        tier3.push({ ...event, tier: 'other' });
      }
    }
  }

  const sections: HomeEventsFeedSection[] = [];
  if (tier1.length > 0) sections.push({ label: 'Your Clubs', data: tier1 });
  if (tier2.length > 0) sections.push({ label: 'Recommended for You', data: tier2 });
  if (tier3.length > 0) sections.push({ label: 'Other Events', data: tier3 });

  return sections;
}

export async function rsvpToEvent(
  userId: string,
  eventId: string,
  status: 'going' | 'cant',
): Promise<void> {
  const { data: existing } = await supabase
    .from('event_rsvps')
    .select('status')
    .eq('event_id', eventId)
    .eq('user_id', userId)
    .maybeSingle();

  if (existing?.status === status) {
    await supabase
      .from('event_rsvps')
      .delete()
      .eq('event_id', eventId)
      .eq('user_id', userId);
  } else {
    await supabase.from('event_rsvps').upsert(
      { event_id: eventId, user_id: userId, status },
      { onConflict: 'event_id,user_id' },
    );
  }
}

export async function toggleSaveEvent(userId: string, eventId: string): Promise<boolean> {
  const { data: existing } = await supabase
    .from('saved_events')
    .select('id')
    .eq('user_id', userId)
    .eq('event_id', eventId)
    .maybeSingle();

  if (existing) {
    await supabase
      .from('saved_events')
      .delete()
      .eq('user_id', userId)
      .eq('event_id', eventId);
    return false;
  } else {
    await supabase.from('saved_events').insert({ user_id: userId, event_id: eventId });
    return true;
  }
}

export interface CreateEventInput {
  club_id: string;
  title: string;
  emoji?: string;
  description?: string;
  cover_image_url?: string;
  event_date: string;
  start_time: string;
  end_time: string;
  location?: string;
  building?: string;
  room?: string;
  visibility: 'everyone' | 'members' | 'specific';
  interest_tags?: string[];
  activity_tags?: string[];
}

export async function createEvent(
  userId: string,
  eventData: CreateEventInput,
): Promise<string> {
  const { data: officerCheck } = await supabase
    .from('club_members')
    .select('id')
    .eq('club_id', eventData.club_id)
    .eq('user_id', userId)
    .eq('role', 'officer')
    .maybeSingle();

  if (!officerCheck) {
    throw new Error('Only club officers can create events');
  }

  const { data: event, error } = await supabase
    .from('events')
    .insert({
      club_id: eventData.club_id,
      created_by: userId,
      title: eventData.title,
      emoji: eventData.emoji ?? null,
      description: eventData.description ?? null,
      cover_image_url: eventData.cover_image_url ?? null,
      event_date: eventData.event_date,
      start_time: eventData.start_time,
      end_time: eventData.end_time,
      location: eventData.location ?? null,
      building: eventData.building ?? null,
      room: eventData.room ?? null,
      visibility: eventData.visibility,
    })
    .select('id')
    .single();

  if (error || !event) throw error ?? new Error('Failed to create event');

  if (eventData.interest_tags?.length) {
    await supabase.from('event_interests').insert(
      eventData.interest_tags.map((interest) => ({ event_id: event.id, interest })),
    );
  }

  if (eventData.activity_tags?.length) {
    await supabase.from('event_activities').insert(
      eventData.activity_tags.map((activity) => ({ event_id: event.id, activity })),
    );
  }

  return event.id;
}

// ─── Event Detail ────────────────────────────────────────────────────────────

export interface EventDetail {
  id: string;
  club_id: string;
  title: string;
  emoji: string | null;
  description: string | null;
  cover_image_url: string | null;
  event_date: string;
  start_time: string;
  end_time: string;
  location: string | null;
  building: string | null;
  room: string | null;
  club: { id: string; name: string; avatar_url: string | null };
  attendee_count: number;
  attendee_preview: AttendeePreview[];
  user_rsvp_status: 'going' | 'cant' | null;
  is_saved: boolean;
  user_has_joined_club: boolean;
}

export async function getEventDetail(
  eventId: string,
  userId: string,
): Promise<EventDetail | null> {
  const [{ data: event }, { data: savedRow }, { data: rsvpRow }] =
    await Promise.all([
      supabase
        .from('events')
        .select(`
          id, club_id, title, emoji, description, cover_image_url,
          event_date, start_time, end_time, location, building, room,
          clubs!inner(id, name, avatar_url)
        `)
        .eq('id', eventId)
        .single(),
      supabase
        .from('saved_events')
        .select('id')
        .eq('user_id', userId)
        .eq('event_id', eventId)
        .maybeSingle(),
      supabase
        .from('event_rsvps')
        .select('status')
        .eq('user_id', userId)
        .eq('event_id', eventId)
        .maybeSingle(),
    ]);

  if (!event) return null;

  const [{ data: goingRsvps }, { data: memberCheck }] = await Promise.all([
    supabase
      .from('event_rsvps')
      .select('user_id, profiles!inner(id, username, avatar_url)')
      .eq('event_id', eventId)
      .eq('status', 'going'),
    supabase
      .from('club_members')
      .select('id')
      .eq('club_id', (event as any).club_id)
      .eq('user_id', userId)
      .maybeSingle(),
  ]);

  const previews: AttendeePreview[] = ((goingRsvps ?? []) as any[])
    .slice(0, 4)
    .map((r) => ({
      id: r.profiles.id,
      username: r.profiles.username,
      avatar_url: r.profiles.avatar_url,
    }));

  return {
    id: event.id,
    club_id: (event as any).club_id,
    title: event.title,
    emoji: (event as any).emoji,
    description: event.description,
    cover_image_url: event.cover_image_url,
    event_date: event.event_date,
    start_time: event.start_time,
    end_time: event.end_time,
    location: event.location,
    building: (event as any).building,
    room: (event as any).room,
    club: {
      id: (event as any).clubs.id,
      name: (event as any).clubs.name,
      avatar_url: (event as any).clubs.avatar_url,
    },
    attendee_count: (goingRsvps ?? []).length,
    attendee_preview: previews,
    user_rsvp_status: (rsvpRow?.status as 'going' | 'cant' | null) ?? null,
    is_saved: !!savedRow,
    user_has_joined_club: !!memberCheck,
  };
}

// ─── Event Attendees ─────────────────────────────────────────────────────────

export interface EventAttendee {
  id: string;
  username: string;
  full_name: string;
  avatar_url: string | null;
  is_following: boolean;
  is_gluemate: boolean;
}

export async function getEventAttendees(
  eventId: string,
  viewerUserId: string,
  page: number = 0,
  search: string = '',
): Promise<{ attendees: EventAttendee[]; total: number }> {
  const PAGE_SIZE = 20;
  const offset = page * PAGE_SIZE;

  const { data: goingRsvps } = await supabase
    .from('event_rsvps')
    .select('user_id, profiles!inner(id, username, full_name, avatar_url)')
    .eq('event_id', eventId)
    .eq('status', 'going');

  if (!goingRsvps || goingRsvps.length === 0) {
    return { attendees: [], total: 0 };
  }

  const attendeeIds = (goingRsvps as any[]).map((r) => r.profiles.id);

  const { data: following } = await supabase
    .from('follows')
    .select('following_id, status')
    .eq('follower_id', viewerUserId)
    .in('following_id', attendeeIds);

  const { data: reverseFollows } = await supabase
    .from('follows')
    .select('follower_id')
    .eq('following_id', viewerUserId)
    .in('follower_id', attendeeIds)
    .eq('status', 'accepted');

  const followingMap = new Map(
    (following ?? []).map((f: any) => [f.following_id, f.status]),
  );
  const reverseFollowSet = new Set((reverseFollows ?? []).map((f: any) => f.follower_id));

  let all: EventAttendee[] = (goingRsvps as any[]).map((r) => {
    const isFollowing = followingMap.get(r.profiles.id) === 'accepted';
    const isGluemate = isFollowing && reverseFollowSet.has(r.profiles.id);
    return {
      id: r.profiles.id,
      username: r.profiles.username,
      full_name: r.profiles.full_name,
      avatar_url: r.profiles.avatar_url,
      is_following: isFollowing,
      is_gluemate: isGluemate,
    };
  });

  if (search.trim()) {
    const q = search.trim().toLowerCase();
    all = all.filter(
      (a) =>
        a.username.toLowerCase().includes(q) ||
        a.full_name.toLowerCase().includes(q),
    );
  }

  return {
    attendees: all.slice(offset, offset + PAGE_SIZE),
    total: all.length,
  };
}
