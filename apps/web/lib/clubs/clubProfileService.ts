"use client";

import { getSupabaseBrowser } from "../supabase-browser";
import { dateInAppTz, splitPastAndUpcoming } from "../datetime";

// Web port of apps/mobile/services/clubService.getClubProfile + getClubPhotos.
// Reads the SAME tables mobile reads; RLS enforces which events/photos the
// viewer may see (everyone / members / specific), so web and mobile show the
// identical club to the identical viewer.

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

export interface ClubEvent {
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
  visibility: "everyone" | "members" | "specific";
}

export interface ClubPhoto {
  id: string;
  url: string;
  source: "officer_upload" | "tagged_post" | "club_authored";
  post_id: string | null;
  caption: string | null;
  created_at: string;
  /** >1 when the backing post is a multi-photo carousel (drives the grid badge). */
  image_count: number;
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
  meeting_schedule: { day: string; start: string | null; end: string | null }[] | null;
  member_count: number;
  is_member: boolean;
  is_officer: boolean;
  officer_role: string | null;
  events_this_month: number;
  goals: ClubGoal[];
  officers: ClubOfficer[];
  upcoming_events: ClubEvent[];
  past_events: ClubEvent[];
  photos: ClubPhoto[];
  gluemates: ClubGluemate[];
  gluemates_count: number;
}

const CLUB_PHOTOS_SELECT = "id, url, source, post_id, caption, created_at";

async function getClubPhotos(clubId: string): Promise<ClubPhoto[]> {
  const supabase = getSupabaseBrowser();
  const [{ data: legacyRows, error: legacyError }, { data: authoredRows, error: authoredError }] = await Promise.all([
    supabase
      .from("club_photos")
      .select(CLUB_PHOTOS_SELECT)
      .eq("club_id", clubId)
      .eq("is_visible", true)
      .or("source.eq.officer_upload,post_id.not.is.null")
      .order("created_at", { ascending: false }),
    supabase
      .from("posts")
      .select("id, image_url, caption, created_at")
      .eq("club_id", clubId)
      .eq("author_kind", "club")
      .not("image_url", "is", null),
  ]);
  if (legacyError) throw legacyError;
  if (authoredError) throw authoredError;
  const photos = ((legacyRows ?? []) as any[]).map((row) => ({
    id: row.id,
    url: row.url,
    source: row.source as ClubPhoto["source"],
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
      source: "club_authored",
      post_id: post.id,
      caption: post.caption,
      created_at: post.created_at,
      image_count: 1,
    });
  }

  const postIds = [...new Set(photos.map((p) => p.post_id).filter(Boolean) as string[])];
  if (postIds.length > 0) {
    const { data: imgRows } = await supabase
      .from("post_images")
      .select("post_id")
      .in("post_id", postIds);
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

export async function getClubProfile(
  clubId: string,
  userId: string
): Promise<ClubProfileData | null> {
  const supabase = getSupabaseBrowser();

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
      .from("clubs")
      .select(
        "id, name, handle, description, avatar_url, banner_url, meeting_day, meeting_time_start, meeting_time_end, meeting_location, meeting_building, meeting_room, meeting_schedule"
      )
      .eq("id", clubId)
      .single(),
    supabase.from("club_members").select("id", { count: "exact", head: true }).eq("club_id", clubId),
    supabase
      .from("club_members")
      .select("role")
      .eq("club_id", clubId)
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("club_goals")
      .select("id, goal_text, display_order")
      .eq("club_id", clubId)
      .order("display_order"),
    supabase
      .from("club_officers")
      .select("id, user_id, display_name, role_title, profiles(avatar_url)")
      .eq("club_id", clubId),
    // This preview-safe RPC is deliberately distinct from events SELECT:
    // non-members may see members-only cards on a club profile, but never
    // receive attendee data or gain direct-detail access. Selected events are
    // omitted unless the caller is selected, creator, or officer.
    supabase.rpc("get_club_profile_events", { p_club_id: clubId }),
    getClubPhotos(clubId),
    getClubGluemates(clubId, userId),
  ]);

  if (!club) return null;

  const membershipRole = (membership as { role?: string } | null)?.role ?? null;
  const isMember = !!membership;
  const isOfficer = membershipRole === "officer";

  const officers: ClubOfficer[] = ((officerRows ?? []) as any[]).map((o) => ({
    id: o.id,
    user_id: o.user_id,
    display_name: o.display_name,
    role_title: o.role_title,
    avatar_url: o.profiles?.avatar_url ?? null,
  }));

  const officerRole = isOfficer
    ? officers.find((o) => o.user_id === userId)?.role_title ?? "Officer"
    : null;

  const allEvents: ClubEvent[] = ((eventRows ?? []) as any[]).map((e) => ({
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
    visibility: e.visibility as "everyone" | "members" | "specific",
  }));
  const { upcoming, past } = splitPastAndUpcoming(allEvents);

  // "Events this month" = events hosted by THIS club in the current calendar
  // month (spec §15) — not unseen notifications.
  const ym = dateInAppTz(new Date()).slice(0, 7);
  const eventsThisMonth = allEvents.filter((e) => e.event_date.startsWith(ym)).length;

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
    is_member: isMember,
    is_officer: isOfficer,
    officer_role: officerRole,
    events_this_month: eventsThisMonth,
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
  const supabase = getSupabaseBrowser();
  // All three reads are independent — fetching every club member's profile
  // up front (instead of waiting for following/followers to resolve so the
  // mutual set can be computed, THEN querying club_members for just that
  // subset) trades a few extra lightweight rows for one fewer sequential
  // network round trip. This function runs inside getClubProfile's own
  // Promise.all, so its round-trip count directly sets a floor on how fast
  // the whole club profile can open.
  const [{ data: following }, { data: followers }, { data: members }] = await Promise.all([
    supabase.from("follows").select("following_id").eq("follower_id", userId).eq("status", "accepted"),
    supabase.from("follows").select("follower_id").eq("following_id", userId).eq("status", "accepted"),
    supabase
      .from("club_members")
      .select("user_id, profiles!inner(id, username, avatar_url)")
      .eq("club_id", clubId),
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
