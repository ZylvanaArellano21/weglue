import { createClient } from "./supabase/server";

// The read-only public club "twin" — the exact payload of migration 131's
// get_public_club_profile(uuid) SECURITY DEFINER RPC (granted to anon). It is
// the complete public-data boundary for the logged-out club QR / link route:
// club identity, meeting info, officer titles (no identities), member COUNT
// only, and bounded first pages of upcoming events, past events, media and
// official club posts. Nothing private, member-level, viewer-specific or chat.

export interface PublicClubOfficer {
  role_title: string;
  display_order: number;
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
  building: string | null;
  room: string | null;
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
  goals: string[];
  meeting_day: string | null;
  meeting_time_start: string | null;
  meeting_time_end: string | null;
  meeting_schedule: string | null;
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
