import { supabase } from '../lib/supabase';
import { todayInAppTz } from '../lib/timezone';
import { isEventPast } from '../lib/eventDisplay';

export type EventTier = 'your_clubs' | 'recommended';

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

export interface HomeEventsFeedPage {
  sections: HomeEventsFeedSection[];
  hasMore: boolean;
}

const EVENTS_PAGE_SIZE = 20;

export async function getHomeEventsFeed(
  userId: string,
  page: number = 0,
): Promise<HomeEventsFeedPage> {
  const today = todayInAppTz();
  const offset = page * EVENTS_PAGE_SIZE;

  const [
    { data: memberships },
    { data: userActivities },
    { data: savedEvents },
    { data: userRsvps },
  ] = await Promise.all([
    supabase.from('club_members').select('club_id, role').eq('user_id', userId),
    supabase.from('user_activities').select('activity').eq('user_id', userId),
    supabase.from('saved_events').select('event_id').eq('user_id', userId),
    supabase.from('event_rsvps').select('event_id, status').eq('user_id', userId),
  ]);

  const joinedClubIds = new Set((memberships ?? []).map((m: any) => m.club_id));
  // Officers of a club always see that club's events, regardless of visibility
  // (mirrors the events RLS policy in migration 029).
  const officerClubIds = new Set(
    (memberships ?? []).filter((m: any) => m.role === 'officer').map((m: any) => m.club_id),
  );
  const userActivitySet = new Set((userActivities ?? []).map((a: any) => a.activity));
  const savedSet = new Set((savedEvents ?? []).map((s: any) => s.event_id));
  const rsvpMap = new Map((userRsvps ?? []).map((r: any) => [r.event_id, r.status as 'going' | 'cant']));

  const { data: rawEvents, error } = await supabase
    .from('events')
    .select(`
      id, title, description, cover_image_url, event_date, start_time, end_time,
      location, building, room, club_id, created_by, visibility, specific_user_ids,
      clubs!inner(id, name, avatar_url),
      event_interests(interest),
      event_activities(activity)
    `)
    .gte('event_date', today)
    .order('event_date', { ascending: true })
    .order('id', { ascending: true })
    .range(offset, offset + EVENTS_PAGE_SIZE - 1);

  if (error || !rawEvents) return { sections: [], hasMore: false };

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

  const yourClubs: HomeFeedEvent[] = [];
  const recommendedMatched: HomeFeedEvent[] = [];
  const recommendedOther: HomeFeedEvent[] = [];

  for (const e of rawEvents as any[]) {
    const visibility = e.visibility as 'everyone' | 'members' | 'specific';
    const specificIds: string[] = e.specific_user_ids ?? [];
    const isInJoinedClub = joinedClubIds.has(e.club_id);
    const isOfficerOfClub = officerClubIds.has(e.club_id);
    const isCreator = e.created_by === userId;

    // Visibility gate: hide events that shouldn't appear on this user's feed.
    // Creator + hosting-club officers always see the event; this mirrors the
    // events RLS policy so the feed and the DB agree.
    if (
      visibility === 'members' &&
      !isInJoinedClub &&
      !isOfficerOfClub &&
      !isCreator
    ) {
      continue;
    }
    if (
      visibility === 'specific' &&
      !isCreator &&
      !isOfficerOfClub &&
      !specificIds.includes(userId)
    ) {
      continue;
    }

    const activityTags: string[] = (e.event_activities ?? []).map((a: any) => a.activity);
    const interestTags: string[] = (e.event_interests ?? []).map((i: any) => i.interest);

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
      tier: isInJoinedClub ? 'your_clubs' : 'recommended',
    };

    if (isInJoinedClub) {
      yourClubs.push(event);
    } else {
      // Event recommendations match on the user's ACTIVITIES only
      // (interests drive club recommendations, not events).
      const hasOverlap = activityTags.some((t) => userActivitySet.has(t));
      if (hasOverlap) {
        recommendedMatched.push(event);
      } else {
        recommendedOther.push(event);
      }
    }
  }

  // Interest-matched events float to the top of "Recommended for You"
  const recommended = [...recommendedMatched, ...recommendedOther];

  const sections: HomeEventsFeedSection[] = [];
  if (yourClubs.length > 0) sections.push({ label: 'Your Clubs', data: yourClubs });
  if (recommended.length > 0) sections.push({ label: 'Recommended for You', data: recommended });

  return { sections, hasMore: (rawEvents as any[]).length === EVENTS_PAGE_SIZE };
}

export async function rsvpToEvent(
  userId: string,
  eventId: string,
  status: 'going' | 'cant',
): Promise<void> {
  // Attendance on ended events is immutable from EVERY entry point (club
  // profile, home, calendar, deep links) — the UI hides the buttons, this is
  // the backstop.
  const { data: eventRow } = await supabase
    .from('events')
    .select('event_date, end_time')
    .eq('id', eventId)
    .maybeSingle();
  if (eventRow && isEventPast(eventRow.event_date, eventRow.end_time)) {
    throw new Error('This event has ended');
  }

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
  specific_user_ids?: string[];
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
      specific_user_ids: eventData.specific_user_ids?.length
        ? eventData.specific_user_ids
        : null,
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

// ─── Raw event row for the edit form ─────────────────────────────────────────

export interface EventForEdit {
  id: string;
  club_id: string;
  club_name: string;
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
  visibility: 'everyone' | 'members' | 'specific';
  specific_user_ids: string[];
}

export async function getEventForEdit(eventId: string): Promise<EventForEdit | null> {
  const { data, error } = await supabase
    .from('events')
    .select(`
      id, club_id, title, emoji, description, cover_image_url, event_date,
      start_time, end_time, location, building, room, visibility, specific_user_ids,
      clubs!inner(name)
    `)
    .eq('id', eventId)
    .maybeSingle();

  if (error || !data) return null;
  const e = data as any;
  return {
    id: e.id,
    club_id: e.club_id,
    club_name: e.clubs?.name ?? '',
    title: e.title,
    emoji: e.emoji,
    description: e.description,
    cover_image_url: e.cover_image_url,
    event_date: e.event_date,
    start_time: e.start_time,
    end_time: e.end_time,
    location: e.location,
    building: e.building,
    room: e.room,
    visibility: (e.visibility ?? 'everyone') as 'everyone' | 'members' | 'specific',
    specific_user_ids: e.specific_user_ids ?? [],
  };
}

// ─── Update / Delete (officers only — also enforced by events RLS) ───────────

export interface UpdateEventInput {
  title?: string;
  emoji?: string | null;
  description?: string | null;
  cover_image_url?: string | null;
  event_date?: string;
  start_time?: string;
  end_time?: string;
  location?: string | null;
  building?: string | null;
  room?: string | null;
  visibility?: 'everyone' | 'members' | 'specific';
  specific_user_ids?: string[] | null;
}

export async function updateEvent(
  userId: string,
  eventId: string,
  updates: UpdateEventInput,
): Promise<void> {
  const { data: eventRow } = await supabase
    .from('events')
    .select('club_id')
    .eq('id', eventId)
    .maybeSingle();
  if (!eventRow) throw new Error('Event not found');

  const { data: officerCheck } = await supabase
    .from('club_members')
    .select('id')
    .eq('club_id', (eventRow as any).club_id)
    .eq('user_id', userId)
    .eq('role', 'officer')
    .maybeSingle();
  if (!officerCheck) throw new Error('Only club officers can edit events');

  const { error } = await supabase.from('events').update(updates).eq('id', eventId);
  if (error) throw error;
}

// Permanent delete. FK cascades remove RSVPs, saved-event rows, tags, and
// share messages so no ghost events survive anywhere (Home, Calendar,
// Weekly Events, club profile, other users' saved/RSVP lists).
export async function deleteEvent(userId: string, eventId: string): Promise<void> {
  const { data: eventRow } = await supabase
    .from('events')
    .select('club_id')
    .eq('id', eventId)
    .maybeSingle();
  if (!eventRow) return; // already gone — nothing to do

  const { data: officerCheck } = await supabase
    .from('club_members')
    .select('id')
    .eq('club_id', (eventRow as any).club_id)
    .eq('user_id', userId)
    .eq('role', 'officer')
    .maybeSingle();
  if (!officerCheck) throw new Error('Only club officers can delete events');

  const { error } = await supabase.from('events').delete().eq('id', eventId);
  if (error) throw error;
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
  visibility: 'everyone' | 'members' | 'specific';
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
          event_date, start_time, end_time, location, building, room, visibility,
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
    visibility: ((event as any).visibility ?? 'everyone') as 'everyone' | 'members' | 'specific',
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
