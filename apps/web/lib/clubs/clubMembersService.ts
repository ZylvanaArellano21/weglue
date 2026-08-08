"use client";

import { getSupabaseBrowser } from "../supabase-browser";

// Web port of apps/mobile/services/clubTabService.getClubMembers — the SAME
// query shape, the SAME club_shared_identities RPC and the SAME follow /
// gluemate derivation the mobile Members and Gluemates screens use. There is no
// separate web relationship model: "following" and "gluemate" are read from the
// one `follows` table, and every write goes through the shared follow hooks.

export interface ClubMember {
  id: string;
  username: string;
  full_name: string;
  avatar_url: string | null;
  is_following: boolean;
  /** Mutual accepted follows — the app-wide definition of a Gluemate. */
  is_gluemate: boolean;
  joined_at: string;
  role: "member" | "officer";
}

export interface ClubMembersPage {
  members: ClubMember[];
  total: number;
}

export const CLUB_MEMBERS_PAGE_SIZE = 20;

export async function getClubMembers(
  clubId: string,
  viewerId: string,
  search: string,
  page: number,
  gluematesOnly: boolean
): Promise<ClubMembersPage> {
  const supabase = getSupabaseBrowser();

  // ── Gluemates filter: mutual accepted follows, computed first so the member
  //    query can be narrowed to exactly those ids.
  let gluemateIds: string[] | null = null;
  if (gluematesOnly) {
    const [{ data: following }, { data: followers }] = await Promise.all([
      supabase.from("follows").select("following_id").eq("follower_id", viewerId).eq("status", "accepted"),
      supabase.from("follows").select("follower_id").eq("following_id", viewerId).eq("status", "accepted"),
    ]);
    const followingSet = new Set(((following ?? []) as { following_id: string }[]).map((f) => f.following_id));
    const followerSet = new Set(((followers ?? []) as { follower_id: string }[]).map((f) => f.follower_id));
    gluemateIds = [...followingSet].filter((id) => followerSet.has(id));
    if (gluemateIds.length === 0) return { members: [], total: 0 };
  }

  // A club is a legitimate shared context: two students who blocked each other
  // stay in it and each still needs to see who the members are. Display
  // identity therefore comes from the narrow, caller-bound
  // `club_shared_identities` RPC (074) rather than a `profiles!inner` join,
  // which would drop a blocked person's row and under-report the club.
  const { data: identityRows, error: identityError } = await supabase.rpc("club_shared_identities", {
    p_club_id: clubId,
  });
  if (identityError) throw identityError;
  const identities = new Map<string, { id: string; username: string; full_name: string; avatar_url: string | null }>(
    ((identityRows ?? []) as { id: string; username: string; full_name: string; avatar_url: string | null }[]).map(
      (row) => [row.id, row]
    )
  );

  let query = supabase
    .from("club_members")
    .select("user_id, joined_at, role", { count: "exact" })
    .eq("club_id", clubId)
    .order("joined_at", { ascending: true })
    .range(page * CLUB_MEMBERS_PAGE_SIZE, page * CLUB_MEMBERS_PAGE_SIZE + CLUB_MEMBERS_PAGE_SIZE - 1);

  if (gluemateIds) query = query.in("user_id", gluemateIds);

  const needle = search.trim().toLowerCase();
  if (needle) {
    // Username search resolves through the same shared-identity source, so a
    // blocked member stays findable inside a club they actually belong to while
    // remaining absent from general people search.
    const matched = [...identities.values()]
      .filter((row) => (row.username ?? "").toLowerCase().includes(needle))
      .map((row) => row.id);
    if (matched.length === 0) return { members: [], total: 0 };
    query = query.in("user_id", matched);
  }

  const { data: memberRows, count, error } = await query;
  if (error) throw error;

  const memberIds = ((memberRows ?? []) as { user_id: string }[]).map((m) => m.user_id);

  let followingSet = new Set<string>();
  let followersSet = new Set<string>();
  if (gluemateIds) {
    // Everyone on a Gluemates page is, by construction, a mutual follow.
    followingSet = new Set(memberIds);
    followersSet = new Set(memberIds);
  } else if (memberIds.length > 0) {
    const [{ data: following }, { data: followers }] = await Promise.all([
      supabase
        .from("follows")
        .select("following_id")
        .eq("follower_id", viewerId)
        .eq("status", "accepted")
        .in("following_id", memberIds),
      supabase
        .from("follows")
        .select("follower_id")
        .eq("following_id", viewerId)
        .eq("status", "accepted")
        .in("follower_id", memberIds),
    ]);
    followingSet = new Set(((following ?? []) as { following_id: string }[]).map((f) => f.following_id));
    followersSet = new Set(((followers ?? []) as { follower_id: string }[]).map((f) => f.follower_id));
  }

  const members = ((memberRows ?? []) as { user_id: string; joined_at: string; role: string }[])
    .map((m) => {
      const identity = identities.get(m.user_id);
      // No shared identity means the account is no longer an eligible student
      // (suspended, deleted); mobile excludes those rows too.
      if (!identity) return null;
      const isFollowing = followingSet.has(identity.id);
      return {
        id: identity.id,
        username: identity.username,
        full_name: identity.full_name,
        avatar_url: identity.avatar_url,
        is_following: isFollowing,
        is_gluemate: isFollowing && followersSet.has(identity.id),
        joined_at: m.joined_at,
        role: m.role === "officer" ? "officer" : "member",
      } as ClubMember;
    })
    .filter((m): m is ClubMember => m !== null);

  return { members, total: count ?? 0 };
}
