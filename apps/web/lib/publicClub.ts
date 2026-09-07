import { createClient } from "./supabase/server";

// The read-only public club "twin" — the exact payload of migration 131's
// get_public_club_profile(uuid) SECURITY DEFINER RPC (granted to anon). It is
// the complete public-data boundary for the logged-out club QR / link route:
// club identity, meeting info, officer titles (no identities), member COUNT
// only, and bounded first pages of upcoming events, past events, media and
// official club posts. Nothing private, member-level, viewer-specific or chat.
//
// Every field below is exactly what the RPC's final jsonb_build_object emits —
// keep this in lockstep with supabase/migrations/131_public_club_twin.sql.

/** Officer identities are deliberately NOT public — only the role title and its
 *  display order (BE-4 contract: no established open-web consent basis for
 *  names/avatars). */
export interface PublicClubOfficer {
  role_title: string;
  display_order: number;
}

export interface PublicClubGoal {
  id: string;
  goal_text: string;
  display_order: number;
}

/** One recurring meeting slot, from `clubs.meeting_schedule` (jsonb). Matches
 *  the shape `parseMeetingSchedule` / `ClubProfileData.meeting_schedule`
 *  consume, so the twin formats meetings identically to the real profile. */
export interface PublicClubMeetingSlot {
  day: string;
  start: string | null;
  end: string | null;
}

export interface PublicClubEvent {
  id: string;
  title: string;
  emoji: string | null;
  description: string | null;
  cover_image_url: string | null;
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  event_end_at: string | null;
  location: string | null;
  building: string | null;
  room: string | null;
  activity_tags: string[];
  interest_tags: string[];
}

export interface PublicClubMediaItem {
  id: string;
  url: string;
  caption: string | null;
  source: string;
  image_count: number;
  created_at: string;
}

export interface PublicClubPost {
  id: string;
  caption: string | null;
  image_url: string | null;
  images: Array<{ path: string; width: number | null; height: number | null; position: number }>;
  created_at: string;
}

export interface PublicClubTwin {
  id: string;
  name: string;
  handle: string | null;
  avatar_url: string | null;
  banner_url: string | null;
  description: string | null;
  goals: PublicClubGoal[];
  meeting_day: string | null;
  meeting_time_start: string | null;
  meeting_time_end: string | null;
  meeting_schedule: PublicClubMeetingSlot[] | null;
  meeting_location: string | null;
  meeting_building: string | null;
  meeting_room: string | null;
  member_count: number;
  officers: PublicClubOfficer[];
  upcoming_events: { items: PublicClubEvent[]; has_more: boolean };
  past_events: { items: PublicClubEvent[]; has_more: boolean };
  media: { items: PublicClubMediaItem[]; has_more: boolean };
  posts: { items: PublicClubPost[]; has_more: boolean };
}

/**
 * "Photos that Glue" for the twin — the migration 131 `media` items (officer
 * uploads + tagged posts) plus any official `club_authored` post that carries a
 * cover image and isn't already represented in `media`, newest first. Mirrors
 * how the authenticated profile folds club-authored posts into its photo grid
 * (apps/web/lib/clubs/clubProfileService.getClubPhotos). Pure — safe to unit
 * test and to call during render.
 */
export function publicClubPhotos(club: PublicClubTwin): PublicClubMediaItem[] {
  const seen = new Set(club.media.items.map((m) => m.id));
  const fromPosts: PublicClubMediaItem[] = club.posts.items
    .filter((p) => !!p.image_url && !seen.has(p.id))
    .map((p) => ({
      id: p.id,
      url: p.image_url as string,
      caption: p.caption,
      source: "club_authored",
      image_count: p.images.length > 1 ? p.images.length : 1,
      created_at: p.created_at,
    }));
  return [...club.media.items, ...fromPosts].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** null → the club id is malformed, or the club is inactive / does not exist /
 *  is not public (the RPC returns a null core in every one of those cases). */
export async function getPublicClubTwin(clubId: string): Promise<PublicClubTwin | null> {
  if (!UUID_RE.test(clubId)) return null;
  const supabase = createClient();
  const { data, error } = await supabase.rpc("get_public_club_profile", { p_club_id: clubId });
  if (error || !data || typeof data !== "object" || !(data as { id?: unknown }).id) return null;
  return data as PublicClubTwin;
}
