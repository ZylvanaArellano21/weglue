// ============================================================================
// Admin Dashboard — Day-2 canonical read-only data access  (SERVER-ONLY)
// ============================================================================
// Memberships, officers, gluemates (mutual follows), universities. Same rules
// as data.ts: requireSecureAdmin() first, service-role reads, canonical tables,
// live counts. Emails from auth.users via emailMap().
// ============================================================================

if (typeof window !== "undefined") {
  throw new Error("lib/admin/data2.ts is server-only and must not be imported in the browser.");
}

import { createAdminClient } from "../supabase/admin";
import { requireSecureAdmin } from "./secureAdmin";
import { emailMap, PAGE_SIZE } from "./data";
import type { Paginated } from "./data";

function fmtIds(ids: string[]): string {
  return `(${ids.join(",")})`;
}

/** Club options for filter dropdowns (capped; a searchable picker is the scale answer). */
export async function listClubOptions(): Promise<{ id: string; name: string }[]> {
  await requireSecureAdmin();
  const admin = createAdminClient();
  const { data } = await admin.from("clubs").select("id, name").order("name", { ascending: true }).limit(200);
  return (data ?? []) as { id: string; name: string }[];
}

/**
 * The only restriction-adjacent canonical mechanism today is report triage
 * (reports.status). Returns the live status breakdown for the Restrictions page,
 * which is otherwise an honest "no restriction system yet" surface.
 */
export async function reportStatusCounts(): Promise<Record<string, number>> {
  await requireSecureAdmin();
  const admin = createAdminClient();
  const statuses = ["pending", "reviewing", "resolved", "dismissed"];
  const entries = await Promise.all(
    statuses.map(async (s) => {
      const { count } = await admin.from("reports").select("id", { count: "exact", head: true }).eq("status", s);
      return [s, count ?? 0] as const;
    })
  );
  return Object.fromEntries(entries);
}

// ── Memberships ──────────────────────────────────────────────────────────────

export interface MembershipRow {
  id: string;
  club_id: string;
  user_id: string;
  role: string;
  joined_at: string;
  full_name: string;
  username: string;
  avatar_url: string | null;
  email: string | null;
  club_name: string;
  club_handle: string;
  club_avatar: string | null;
  university: string | null;
  officer_title: string | null;
}

export interface ListMembershipsParams {
  search?: string;
  role?: "all" | "member" | "officer";
  clubId?: string;
  universityId?: string;
  sort?: "joined_at" | "role";
  dir?: "asc" | "desc";
  page?: number;
}

/** Resolve club_member ids matching a free-text search on user OR club. */
async function membershipSearchFilter(
  admin: ReturnType<typeof createAdminClient>,
  search: string
): Promise<{ userIds: string[]; clubIds: string[] } | null> {
  const like = `%${search}%`;
  const isEmail = search.includes("@");
  const [{ data: users }, { data: clubs }] = await Promise.all([
    isEmail
      ? Promise.resolve({ data: [] as any[] })
      : admin.from("profiles").select("id").or(`full_name.ilike.${like},username.ilike.${like}`).limit(500),
    admin.from("clubs").select("id").or(`name.ilike.${like},handle.ilike.${like}`).limit(500),
  ]);
  const userIds = (users ?? []).map((u: any) => u.id);
  const clubIds = (clubs ?? []).map((c: any) => c.id);
  return { userIds, clubIds };
}

export async function listMemberships(params: ListMembershipsParams = {}): Promise<Paginated<MembershipRow>> {
  await requireSecureAdmin();
  const admin = createAdminClient();
  const page = Math.max(1, params.page ?? 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  const sort = params.sort ?? "joined_at";
  const dir = params.dir ?? "desc";

  let q = admin
    .from("club_members")
    .select(
      "id, club_id, user_id, role, joined_at, profiles!inner(id, full_name, username, avatar_url), clubs!inner(id, name, handle, avatar_url, university_id, universities(name))",
      { count: "exact" }
    );

  if (params.role === "member" || params.role === "officer") q = q.eq("role", params.role);
  if (params.clubId) q = q.eq("club_id", params.clubId);
  if (params.universityId) q = q.eq("clubs.university_id", params.universityId);

  if (params.search?.trim()) {
    const resolved = await membershipSearchFilter(admin, params.search.trim());
    const parts: string[] = [];
    if (resolved && resolved.userIds.length) parts.push(`user_id.in.${fmtIds(resolved.userIds)}`);
    if (resolved && resolved.clubIds.length) parts.push(`club_id.in.${fmtIds(resolved.clubIds)}`);
    if (parts.length === 0) return { rows: [], total: 0, page, pageSize: PAGE_SIZE };
    q = q.or(parts.join(","));
  }

  q = q.order(sort, { ascending: dir === "asc" }).range(from, to);
  const { data, count, error } = await q;
  if (error) throw error;

  const raw = (data ?? []) as any[];
  const emails = await emailMap(raw.map((r) => r.user_id));
  const officerTitles = await officerTitleMap(
    admin,
    raw.filter((r) => r.role === "officer").map((r) => ({ club_id: r.club_id, user_id: r.user_id }))
  );

  const rows: MembershipRow[] = raw.map((r) => ({
    id: r.id,
    club_id: r.club_id,
    user_id: r.user_id,
    role: r.role,
    joined_at: r.joined_at,
    full_name: r.profiles?.full_name ?? "",
    username: r.profiles?.username ?? "",
    avatar_url: r.profiles?.avatar_url ?? null,
    email: emails.get(r.user_id) ?? null,
    club_name: r.clubs?.name ?? "",
    club_handle: r.clubs?.handle ?? "",
    club_avatar: r.clubs?.avatar_url ?? null,
    university: r.clubs?.universities?.name ?? null,
    officer_title: officerTitles.get(`${r.club_id}:${r.user_id}`) ?? null,
  }));

  return { rows, total: count ?? rows.length, page, pageSize: PAGE_SIZE };
}

async function officerTitleMap(
  admin: ReturnType<typeof createAdminClient>,
  pairs: { club_id: string; user_id: string }[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (pairs.length === 0) return map;
  const clubIds = Array.from(new Set(pairs.map((p) => p.club_id)));
  const userIds = Array.from(new Set(pairs.map((p) => p.user_id)));
  const { data } = await admin
    .from("club_officers")
    .select("club_id, user_id, role_title")
    .in("club_id", clubIds)
    .in("user_id", userIds);
  for (const o of (data ?? []) as any[]) {
    if (o.user_id) map.set(`${o.club_id}:${o.user_id}`, o.role_title);
  }
  return map;
}

export async function getMembershipDetail(id: string): Promise<MembershipRow | null> {
  await requireSecureAdmin();
  const admin = createAdminClient();
  const { data: r } = await admin
    .from("club_members")
    .select(
      "id, club_id, user_id, role, joined_at, profiles!inner(id, full_name, username, avatar_url), clubs!inner(id, name, handle, avatar_url, university_id, universities(name))"
    )
    .eq("id", id)
    .maybeSingle();
  if (!r) return null;
  const row = r as any;
  const emails = await emailMap([row.user_id]);
  const titles = await officerTitleMap(admin, row.role === "officer" ? [{ club_id: row.club_id, user_id: row.user_id }] : []);
  return {
    id: row.id,
    club_id: row.club_id,
    user_id: row.user_id,
    role: row.role,
    joined_at: row.joined_at,
    full_name: row.profiles?.full_name ?? "",
    username: row.profiles?.username ?? "",
    avatar_url: row.profiles?.avatar_url ?? null,
    email: emails.get(row.user_id) ?? null,
    club_name: row.clubs?.name ?? "",
    club_handle: row.clubs?.handle ?? "",
    club_avatar: row.clubs?.avatar_url ?? null,
    university: row.clubs?.universities?.name ?? null,
    officer_title: titles.get(`${row.club_id}:${row.user_id}`) ?? null,
  };
}

// ── Officers ─────────────────────────────────────────────────────────────────

export interface OfficerRow extends MembershipRow {}

export interface ListOfficersParams {
  search?: string;
  clubId?: string;
  universityId?: string;
  sort?: "joined_at";
  dir?: "asc" | "desc";
  page?: number;
}

export async function listOfficers(params: ListOfficersParams = {}): Promise<Paginated<OfficerRow>> {
  await requireSecureAdmin();
  const admin = createAdminClient();
  const page = Math.max(1, params.page ?? 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  const dir = params.dir ?? "desc";

  let q = admin
    .from("club_members")
    .select(
      "id, club_id, user_id, role, joined_at, profiles!inner(id, full_name, username, avatar_url), clubs!inner(id, name, handle, avatar_url, university_id, universities(name))",
      { count: "exact" }
    )
    .eq("role", "officer");

  if (params.clubId) q = q.eq("club_id", params.clubId);
  if (params.universityId) q = q.eq("clubs.university_id", params.universityId);

  if (params.search?.trim()) {
    const term = params.search.trim();
    const like = `%${term}%`;
    // Match user name/username, or officer title (via roster), or club.
    const [{ data: users }, { data: roster }, { data: clubs }] = await Promise.all([
      admin.from("profiles").select("id").or(`full_name.ilike.${like},username.ilike.${like}`).limit(500),
      admin.from("club_officers").select("user_id").ilike("role_title", like).limit(500),
      admin.from("clubs").select("id").or(`name.ilike.${like},handle.ilike.${like}`).limit(500),
    ]);
    const userIds = Array.from(
      new Set([...(users ?? []).map((u: any) => u.id), ...(roster ?? []).map((o: any) => o.user_id).filter(Boolean)])
    );
    const clubIds = (clubs ?? []).map((c: any) => c.id);
    const parts: string[] = [];
    if (userIds.length) parts.push(`user_id.in.${fmtIds(userIds)}`);
    if (clubIds.length) parts.push(`club_id.in.${fmtIds(clubIds)}`);
    if (parts.length === 0) return { rows: [], total: 0, page, pageSize: PAGE_SIZE };
    q = q.or(parts.join(","));
  }

  q = q.order("joined_at", { ascending: dir === "asc" }).range(from, to);
  const { data, count, error } = await q;
  if (error) throw error;

  const raw = (data ?? []) as any[];
  const emails = await emailMap(raw.map((r) => r.user_id));
  const titles = await officerTitleMap(admin, raw.map((r) => ({ club_id: r.club_id, user_id: r.user_id })));

  const rows: OfficerRow[] = raw.map((r) => ({
    id: r.id,
    club_id: r.club_id,
    user_id: r.user_id,
    role: r.role,
    joined_at: r.joined_at,
    full_name: r.profiles?.full_name ?? "",
    username: r.profiles?.username ?? "",
    avatar_url: r.profiles?.avatar_url ?? null,
    email: emails.get(r.user_id) ?? null,
    club_name: r.clubs?.name ?? "",
    club_handle: r.clubs?.handle ?? "",
    club_avatar: r.clubs?.avatar_url ?? null,
    university: r.clubs?.universities?.name ?? null,
    officer_title: titles.get(`${r.club_id}:${r.user_id}`) ?? null,
  }));

  return { rows, total: count ?? rows.length, page, pageSize: PAGE_SIZE };
}

/** Live officer counts per club (batched) — for last-officer UI guards in lists. */
export async function clubOfficerCounts(clubIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (clubIds.length === 0) return map;
  const admin = createAdminClient();
  const { data } = await admin
    .from("club_members")
    .select("club_id")
    .eq("role", "officer")
    .in("club_id", Array.from(new Set(clubIds)));
  for (const r of (data ?? []) as any[]) map.set(r.club_id, (map.get(r.club_id) ?? 0) + 1);
  return map;
}

/** Live officer count for a club — for last-officer UI hints. */
export async function clubOfficerCount(clubId: string): Promise<number> {
  await requireSecureAdmin();
  const admin = createAdminClient();
  const { count } = await admin
    .from("club_members")
    .select("id", { count: "exact", head: true })
    .eq("club_id", clubId)
    .eq("role", "officer");
  return count ?? 0;
}

// ── Gluemates (mutual accepted follows) ──────────────────────────────────────

export interface GluemateRow {
  a: { id: string; full_name: string; username: string; avatar_url: string | null; university: string | null };
  b: { id: string; full_name: string; username: string; avatar_url: string | null; university: string | null };
  since: string | null;
}

export interface ListGluematesParams {
  search?: string;
  universityId?: string;
  page?: number;
}

/**
 * Derive mutual accepted follows. Loads accepted follows (bounded) and pairs
 * them in memory — fine at current scale; a SQL view/RPC is the scale answer
 * (see V2 backlog). Gluemates are NOT a separate table.
 */
export async function listGluemates(params: ListGluematesParams = {}): Promise<Paginated<GluemateRow>> {
  await requireSecureAdmin();
  const admin = createAdminClient();
  const page = Math.max(1, params.page ?? 1);

  const { data: follows } = await admin
    .from("follows")
    .select("follower_id, following_id, created_at")
    .eq("status", "accepted")
    .limit(10000);

  const seen = new Map<string, string>(); // "a>b" directed → created_at
  for (const f of (follows ?? []) as any[]) seen.set(`${f.follower_id}>${f.following_id}`, f.created_at);

  const pairs = new Map<string, { a: string; b: string; since: string | null }>();
  for (const f of (follows ?? []) as any[]) {
    const a = f.follower_id as string;
    const b = f.following_id as string;
    if (!seen.has(`${b}>${a}`)) continue; // not mutual
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (pairs.has(key)) continue;
    const [lo, hi] = a < b ? [a, b] : [b, a];
    const t1 = seen.get(`${lo}>${hi}`);
    const t2 = seen.get(`${hi}>${lo}`);
    const since = [t1, t2].filter(Boolean).sort().reverse()[0] ?? null; // later of the two
    pairs.set(key, { a: lo, b: hi, since });
  }

  let allPairs = Array.from(pairs.values());

  // Enrich with profiles (only the ids we need).
  const ids = Array.from(new Set(allPairs.flatMap((p) => [p.a, p.b])));
  const profileMap = new Map<string, any>();
  if (ids.length) {
    const { data: profs } = await admin
      .from("profiles")
      .select("id, full_name, username, avatar_url, university_id, universities(name)")
      .in("id", ids);
    for (const p of (profs ?? []) as any[]) profileMap.set(p.id, p);
  }

  // Filters (post-derivation, in memory).
  if (params.universityId) {
    allPairs = allPairs.filter(
      (p) => profileMap.get(p.a)?.university_id === params.universityId || profileMap.get(p.b)?.university_id === params.universityId
    );
  }
  if (params.search?.trim()) {
    const s = params.search.trim().toLowerCase();
    const match = (id: string) => {
      const pr = profileMap.get(id);
      return pr && ((pr.full_name ?? "").toLowerCase().includes(s) || (pr.username ?? "").toLowerCase().includes(s));
    };
    allPairs = allPairs.filter((p) => match(p.a) || match(p.b));
  }

  allPairs.sort((x, y) => (y.since ?? "").localeCompare(x.since ?? ""));
  const total = allPairs.length;
  const from = (page - 1) * PAGE_SIZE;
  const pageItems = allPairs.slice(from, from + PAGE_SIZE);

  const shape = (id: string) => {
    const pr = profileMap.get(id) ?? {};
    return {
      id,
      full_name: pr.full_name ?? "",
      username: pr.username ?? "",
      avatar_url: pr.avatar_url ?? null,
      university: pr.universities?.name ?? null,
    };
  };

  const rows: GluemateRow[] = pageItems.map((p) => ({ a: shape(p.a), b: shape(p.b), since: p.since }));
  return { rows, total, page, pageSize: PAGE_SIZE };
}

/** A single user's gluemates (mutual accepted follows) + one-way follow counts. */
export async function getUserGluemates(userId: string): Promise<{
  mutual: { id: string; full_name: string; username: string; avatar_url: string | null }[];
  followingOnly: number;
  followerOnly: number;
}> {
  await requireSecureAdmin();
  const admin = createAdminClient();
  const [{ data: following }, { data: followers }] = await Promise.all([
    admin.from("follows").select("following_id").eq("follower_id", userId).eq("status", "accepted"),
    admin.from("follows").select("follower_id").eq("following_id", userId).eq("status", "accepted"),
  ]);
  const followingIds = new Set((following ?? []).map((f: any) => f.following_id));
  const followerIds = new Set((followers ?? []).map((f: any) => f.follower_id));
  const mutualIds = [...followingIds].filter((id) => followerIds.has(id));

  const mutual: { id: string; full_name: string; username: string; avatar_url: string | null }[] = [];
  if (mutualIds.length) {
    const { data: profs } = await admin.from("profiles").select("id, full_name, username, avatar_url").in("id", mutualIds);
    for (const p of (profs ?? []) as any[]) mutual.push({ id: p.id, full_name: p.full_name, username: p.username, avatar_url: p.avatar_url });
  }

  return {
    mutual,
    followingOnly: [...followingIds].filter((id) => !followerIds.has(id)).length,
    followerOnly: [...followerIds].filter((id) => !followingIds.has(id)).length,
  };
}

// ── Universities ─────────────────────────────────────────────────────────────

export interface UniversityRow {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  created_at: string;
  user_count: number;
  club_count: number;
}

export async function listUniversitiesFull(search?: string): Promise<UniversityRow[]> {
  await requireSecureAdmin();
  const admin = createAdminClient();

  let q = admin.from("universities").select("id, name, slug, is_active, created_at").order("name", { ascending: true });
  if (search?.trim()) {
    const like = `%${search.trim()}%`;
    q = q.or(`name.ilike.${like},slug.ilike.${like}`);
  }
  const { data: unis } = await q;
  const rows = (unis ?? []) as any[];
  const ids = rows.map((u) => u.id);

  const userCounts = new Map<string, number>();
  const clubCounts = new Map<string, number>();
  if (ids.length) {
    const [{ data: profs }, { data: clubs }] = await Promise.all([
      admin.from("profiles").select("university_id").in("university_id", ids),
      admin.from("clubs").select("university_id").in("university_id", ids),
    ]);
    for (const p of (profs ?? []) as any[]) if (p.university_id) userCounts.set(p.university_id, (userCounts.get(p.university_id) ?? 0) + 1);
    for (const c of (clubs ?? []) as any[]) if (c.university_id) clubCounts.set(c.university_id, (clubCounts.get(c.university_id) ?? 0) + 1);
  }

  return rows.map((u) => ({
    id: u.id,
    name: u.name,
    slug: u.slug,
    is_active: !!u.is_active,
    created_at: u.created_at,
    user_count: userCounts.get(u.id) ?? 0,
    club_count: clubCounts.get(u.id) ?? 0,
  }));
}

export interface UniversityDetail {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  created_at: string;
  userCount: number;
  clubCount: number;
  eventCount: number | null;
  users: { id: string; full_name: string; username: string; avatar_url: string | null }[];
  clubs: { id: string; name: string; handle: string; avatar_url: string | null }[];
}

export async function getUniversityDetail(id: string): Promise<UniversityDetail | null> {
  await requireSecureAdmin();
  const admin = createAdminClient();
  const { data: uni } = await admin
    .from("universities")
    .select("id, name, slug, is_active, created_at")
    .eq("id", id)
    .maybeSingle();
  if (!uni) return null;
  const u = uni as any;

  const [{ data: users, count: userCount }, { data: clubs, count: clubCount }] = await Promise.all([
    admin.from("profiles").select("id, full_name, username, avatar_url", { count: "exact" }).eq("university_id", id).order("created_at", { ascending: false }).limit(50),
    admin.from("clubs").select("id, name, handle, avatar_url", { count: "exact" }).eq("university_id", id).order("created_at", { ascending: false }).limit(50),
  ]);

  const clubIds = (clubs ?? []).map((c: any) => c.id);
  let eventCount: number | null = null;
  if (clubIds.length) {
    const { count } = await admin.from("events").select("id", { count: "exact", head: true }).in("club_id", clubIds);
    eventCount = count ?? 0;
  } else {
    eventCount = 0;
  }

  return {
    id: u.id,
    name: u.name,
    slug: u.slug,
    is_active: !!u.is_active,
    created_at: u.created_at,
    userCount: userCount ?? 0,
    clubCount: clubCount ?? 0,
    eventCount,
    users: ((users ?? []) as any[]).map((p) => ({ id: p.id, full_name: p.full_name, username: p.username, avatar_url: p.avatar_url })),
    clubs: ((clubs ?? []) as any[]).map((c) => ({ id: c.id, name: c.name, handle: c.handle, avatar_url: c.avatar_url })),
  };
}
