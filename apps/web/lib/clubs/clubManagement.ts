"use client";

import { getSupabaseBrowser } from "../supabase-browser";

// Web port of the officer-management half of apps/mobile/services/clubService.ts.
// Every mutation goes through the SAME table writes / SECURITY DEFINER RPCs
// mobile uses, so authorization is enforced server-side (RLS + the RPCs' own
// officer checks) — the web UI hiding a control is only defence-in-depth, never
// the security boundary. Any officer position has identical power (no
// President-only paths), matching mobile.

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

export async function updateClubProfile(clubId: string, data: UpdateClubInput): Promise<void> {
  const supabase = getSupabaseBrowser();
  const { error } = await supabase.from("clubs").update(data).eq("id", clubId);
  if (error) throw error;
}

/** Replaces the club's learning outcomes (delete-all + re-insert, like mobile). */
export async function updateClubGoals(clubId: string, goalTexts: string[]): Promise<void> {
  const supabase = getSupabaseBrowser();
  const trimmed = goalTexts.map((g) => g.trim()).filter((g) => g.length > 0);
  const { error: delErr } = await supabase.from("club_goals").delete().eq("club_id", clubId);
  if (delErr) throw delErr;
  if (trimmed.length === 0) return;
  const { error: insErr } = await supabase.from("club_goals").insert(
    trimmed.map((goal_text, index) => ({ club_id: clubId, goal_text, display_order: index }))
  );
  if (insErr) throw insErr;
}

// Adds/promotes an officer via the add_club_officer RPC (atomic, permission-
// checked, idempotent; fires the member/officer group-chat adds + notifications).
export async function addOfficer(clubId: string, userId: string, roleTitle: string): Promise<void> {
  const supabase = getSupabaseBrowser();
  const { error } = await supabase.rpc("add_club_officer", {
    p_club_id: clubId,
    p_user_id: userId,
    p_role_title: roleTitle.trim(),
  });
  if (error) throw error;
}

// Removes an officer via remove_club_officer RPC (downgrades role, revokes
// Officers-chat access, deletes the club_officers row, notifies the officer).
export async function removeOfficer(clubId: string, userId: string): Promise<void> {
  const supabase = getSupabaseBrowser();
  const { error } = await supabase.rpc("remove_club_officer", { p_club_id: clubId, p_user_id: userId });
  if (error) throw error;
}

export interface UniversityUser {
  id: string;
  username: string;
  full_name: string;
  avatar_url: string | null;
}

// Officer assignment search: only people from the caller's own university are
// pickable (clubs are university-scoped), mirroring mobile searchUniversityUsers.
export async function searchUniversityUsers(viewerUserId: string, query: string): Promise<UniversityUser[]> {
  const supabase = getSupabaseBrowser();
  const { data: me } = await supabase
    .from("profiles")
    .select("university")
    .eq("id", viewerUserId)
    .maybeSingle();
  const myUniversity = (me as { university?: string | null } | null)?.university ?? null;

  const q = query.trim();
  let req = supabase
    .from("profiles")
    .select("id, username, full_name, avatar_url, university")
    .neq("id", viewerUserId)
    .order("username")
    .limit(30);
  if (myUniversity) req = req.eq("university", myUniversity);
  if (q) req = req.or(`username.ilike.%${q}%,full_name.ilike.%${q}%`);

  const { data, error } = await req;
  if (error) throw error;
  return ((data ?? []) as any[]).map((u) => ({
    id: u.id,
    username: u.username,
    full_name: u.full_name,
    avatar_url: u.avatar_url,
  }));
}

export interface ClubMemberRow {
  id: string;
  username: string;
  full_name: string;
  avatar_url: string | null;
  role: "member" | "officer";
  joined_at: string;
}

export async function getClubMemberList(clubId: string): Promise<ClubMemberRow[]> {
  const supabase = getSupabaseBrowser();
  const { data, error } = await supabase
    .from("club_members")
    .select("user_id, role, joined_at, profiles!inner(id, username, full_name, avatar_url)")
    .eq("club_id", clubId)
    .order("joined_at", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as any[]).map((m) => ({
    id: m.profiles.id,
    username: m.profiles.username,
    full_name: m.profiles.full_name,
    avatar_url: m.profiles.avatar_url,
    role: m.role === "officer" ? "officer" : "member",
    joined_at: m.joined_at,
  }));
}

// Officer removes a member. A plain delete guarded by RLS (only officers of the
// club may delete other members' rows); the AFTER DELETE triggers strip the
// removed member's group-chat access + members-only RSVPs, same as mobile.
export async function removeMember(clubId: string, userId: string): Promise<void> {
  const supabase = getSupabaseBrowser();
  const { error } = await supabase.from("club_members").delete().eq("club_id", clubId).eq("user_id", userId);
  if (error) throw error;
}

// ─── Media management (officers) ─────────────────────────────────────────────

export async function hideClubPhoto(photoId: string): Promise<void> {
  const supabase = getSupabaseBrowser();
  const { error } = await supabase.from("club_photos").update({ is_visible: false }).eq("id", photoId);
  if (error) throw error;
}

export async function removePostFromClub(postId: string, clubId: string): Promise<void> {
  const supabase = getSupabaseBrowser();
  const { error } = await supabase.rpc("remove_post_from_club", { p_post_id: postId, p_club_id: clubId });
  if (error) throw error;
}

export async function deleteClubPhotoEverywhere(photoId: string): Promise<void> {
  const supabase = getSupabaseBrowser();
  const { error } = await supabase.rpc("delete_club_photo_everywhere", { p_photo_id: photoId });
  if (error) throw error;
}
