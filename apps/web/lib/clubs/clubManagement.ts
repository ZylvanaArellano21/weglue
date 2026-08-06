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
  const q = query.trim();

  // SEARCHING — go through the migration-057 RPC.
  //
  // Correctness: search_students() excludes blocked students in BOTH directions
  // using auth.uid(), not anything the browser supplies.
  //
  // Performance: ILIKE (texticlike) is not leakproof, so with a real RLS policy
  // on profiles the table is a security barrier and PostgreSQL can no longer
  // push an ILIKE down to the trigram indexes. Measured on 200k profiles, a
  // no-match fragment cost 81.7 ms client-side (Seq Scan) vs 2.9 ms via the RPC.
  //
  // Same-campus scoping happens inside the function, so the extra
  // `profiles.university` round trip this replaced is gone.
  // 3-character minimum, matching search_students(). Below that the server
  // returns nothing by design (a trigram index cannot serve a shorter pattern),
  // so fall through to the browse listing rather than showing an empty result.
  if (q.length >= 3) {
    const { data, error } = await supabase.rpc("search_students", { p_query: q, p_limit: 30 });
    if (error) throw error;
    return ((data ?? []) as any[]).map((u) => ({
      id: u.id,
      username: u.username,
      full_name: u.full_name,
      avatar_url: u.avatar_url,
    }));
  }

  // BROWSING (no search term) — a plain equality-scoped listing. There is no
  // ILIKE here, so the leakproof/security-barrier problem above does not apply,
  // and the profiles RLS policy already excludes blocked students in both
  // directions. Kept as a direct query so the empty-query browse list behaves
  // exactly as it did before.
  const { data: me } = await supabase
    .from("profiles")
    .select("university")
    .eq("id", viewerUserId)
    .maybeSingle();
  const myUniversity = (me as { university?: string | null } | null)?.university ?? null;

  let req = supabase
    .from("profiles")
    .select("id, username, full_name, avatar_url, university")
    .neq("id", viewerUserId)
    .order("username")
    .limit(30);
  if (myUniversity) req = req.eq("university", myUniversity);

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

/**
 * A club is a legitimate shared context: two students who have blocked each
 * other stay in it, and each still needs to see who the members and officers
 * are. `profiles!inner` used to drop a blocked person's row entirely (058 hides
 * the profile row in BOTH directions), so the person silently disappeared from
 * the list and the club looked smaller than it is.
 *
 * Membership rows come from `club_members`, whose SELECT rule is unchanged.
 * Display identity comes from the narrow, caller-bound `club_shared_identities`
 * RPC (074): id, username, full_name, avatar_url, role for the CURRENT members
 * of this one club and nothing else — no bio, posts, events or follow state, and
 * no way to ask about an arbitrary user. The normal profile stays unreadable.
 */
export async function getClubMemberList(clubId: string): Promise<ClubMemberRow[]> {
  const supabase = getSupabaseBrowser();
  const [{ data, error }, { data: identityRows, error: identityError }] = await Promise.all([
    supabase
      .from("club_members")
      .select("user_id, role, joined_at")
      .eq("club_id", clubId)
      .order("joined_at", { ascending: true }),
    supabase.rpc("club_shared_identities", { p_club_id: clubId }),
  ]);
  if (error) throw error;
  if (identityError) throw identityError;
  const identities = new Map<string, any>(
    ((identityRows ?? []) as any[]).map((row) => [row.id as string, row])
  );
  return ((data ?? []) as any[])
    .map((m) => {
      const identity = identities.get(m.user_id);
      if (!identity) return null;
      return {
        id: m.user_id,
        username: identity.username,
        full_name: identity.full_name,
        avatar_url: identity.avatar_url,
        role: m.role === "officer" ? "officer" : "member",
        joined_at: m.joined_at,
      } as ClubMemberRow;
    })
    .filter((row): row is ClubMemberRow => row !== null);
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
