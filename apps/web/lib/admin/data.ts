// ============================================================================
// Admin Dashboard — canonical read-only data access  (SERVER-ONLY)
// ============================================================================
//
// Every exported function calls `requireSecureAdmin()` FIRST, then reads through the
// service-role client. That ordering is the contract: authorization is enforced
// per-operation, and the service-role key never leaves the server (this module
// must never be imported by a Client Component).
//
// CANONICAL SOURCES OF TRUTH used here (derived from supabase/migrations/*.sql,
// never from the stale generated types):
//   • profiles            — id, username, full_name, avatar_url, major, bio,
//                            year, university_id, onboarding_completed, created_at
//   • auth.users          — email (via GoTrue admin API; NOT a public column)
//   • universities        — id, name
//   • clubs               — id, name, handle, description, avatar_url,
//                            cover_image_url/banner_url, meeting_*, is_active,
//                            claimed, university_id, created_at
//   • club_members        — (club_id, user_id, role in {member,officer}, joined_at)
//                            ← officer authority + live membership counts
//   • club_officers       — display roster (display_name, role_title) — display only
//   • events              — club_id, created_by, event_date, ...
//   • posts               — author_id, club_id, ...
//   • reports             — entity_type, entity_id, status, ...
//
// Counts are computed LIVE (count queries / aggregation), never read from the
// cached clubs.member_count mirror.
// ============================================================================

if (typeof window !== "undefined") {
  throw new Error(
    "lib/admin/data.ts is server-only and must not be imported in the browser."
  );
}

import { createAdminClient } from "../supabase/admin";
import { requireSecureAdmin } from "./secureAdmin";

export const PAGE_SIZE = 25;

// ── Shared row types ────────────────────────────────────────────────────────

export interface AdminUserRow {
  id: string;
  username: string;
  full_name: string;
  avatar_url: string | null;
  email: string | null;
  university: string | null;
  onboarding_completed: boolean;
  created_at: string;
  club_count: number;
  officer_count: number;
  report_count: number;
}

export interface AdminClubRow {
  id: string;
  name: string;
  handle: string;
  avatar_url: string | null;
  university: string | null;
  is_active: boolean;
  claimed: boolean;
  member_count: number;
  officer_count: number;
  post_count: number;
  event_count: number;
  report_count: number;
  created_at: string;
}

export interface Paginated<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface UniversityOption {
  id: string;
  name: string;
}

// ── Email helpers (auth.users via GoTrue admin API) ─────────────────────────
//
// Email is NOT a column on public.profiles — it lives in auth.users. We resolve
// it through the service-role GoTrue admin API. For a bounded page of rows this
// is a handful of parallel lookups; at very large scale a canonical indexed
// email mirror / SECURITY DEFINER RPC is the right move (see V2 backlog).

export async function emailMap(userIds: string[]): Promise<Map<string, string | null>> {
  const admin = createAdminClient();
  const unique = Array.from(new Set(userIds.filter(Boolean)));
  const entries = await Promise.all(
    unique.map(async (id): Promise<[string, string | null]> => {
      try {
        const { data } = await admin.auth.admin.getUserById(id);
        return [id, data.user?.email ?? null];
      } catch {
        return [id, null];
      }
    })
  );
  return new Map(entries);
}

/**
 * Best-effort email search via a bounded scan of the GoTrue user directory.
 * Returns the matching auth user IDs. Bounded so a huge directory can't stall a
 * request; a proper indexed email search is a V2 improvement.
 */
async function findUserIdsByEmail(query: string, cap = 2000): Promise<string[]> {
  const admin = createAdminClient();
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const perPage = 200;
  const ids: string[] = [];
  let page = 1;
  let scanned = 0;
  // eslint-disable-next-line no-constant-condition
  while (scanned < cap) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error || !data?.users?.length) break;
    for (const u of data.users) {
      if (u.email && u.email.toLowerCase().includes(needle)) ids.push(u.id);
    }
    scanned += data.users.length;
    if (data.users.length < perPage) break;
    page += 1;
  }
  return ids;
}

// ── Universities (filter options) ───────────────────────────────────────────

export async function listUniversities(): Promise<UniversityOption[]> {
  await requireSecureAdmin();
  const admin = createAdminClient();
  const { data } = await admin
    .from("universities")
    .select("id, name")
    .order("name", { ascending: true });
  return (data ?? []) as UniversityOption[];
}

// ── Overview ─────────────────────────────────────────────────────────────────

export interface OverviewStats {
  users: number | null;
  clubs: number | null;
  posts: number | null;
  events: number | null;
  reports: number | null;
  openReports: number | null;
  memberships: number | null;
  officers: number | null;
  universities: number | null;
  recentUsers: { id: string; full_name: string; username: string; avatar_url: string | null; created_at: string }[];
  recentClubs: { id: string; name: string; handle: string; avatar_url: string | null; created_at: string }[];
}

async function safeCount(
  admin: ReturnType<typeof createAdminClient>,
  table: string,
  apply?: (q: any) => any
): Promise<number | null> {
  try {
    let q = admin.from(table).select("*", { count: "exact", head: true });
    if (apply) q = apply(q);
    const { count, error } = await q;
    if (error) return null;
    return count ?? 0;
  } catch {
    return null;
  }
}

export async function getOverviewStats(): Promise<OverviewStats> {
  await requireSecureAdmin();
  const admin = createAdminClient();

  const [
    users,
    clubs,
    posts,
    events,
    reports,
    openReports,
    memberships,
    officers,
    universities,
    recentUsersRes,
    recentClubsRes,
  ] = await Promise.all([
    safeCount(admin, "profiles"),
    safeCount(admin, "clubs"),
    safeCount(admin, "posts"),
    safeCount(admin, "events"),
    safeCount(admin, "reports"),
    safeCount(admin, "reports", (q) => q.in("status", ["pending", "reviewing"])),
    safeCount(admin, "club_members"),
    safeCount(admin, "club_members", (q) => q.eq("role", "officer")),
    safeCount(admin, "universities"),
    admin
      .from("profiles")
      .select("id, full_name, username, avatar_url, created_at")
      .order("created_at", { ascending: false })
      .limit(6),
    admin
      .from("clubs")
      .select("id, name, handle, avatar_url, created_at")
      .order("created_at", { ascending: false })
      .limit(6),
  ]);

  return {
    users,
    clubs,
    posts,
    events,
    reports,
    openReports,
    memberships,
    officers,
    universities,
    recentUsers: (recentUsersRes.data ?? []) as OverviewStats["recentUsers"],
    recentClubs: (recentClubsRes.data ?? []) as OverviewStats["recentClubs"],
  };
}

// ── Users list ───────────────────────────────────────────────────────────────

export interface ListUsersParams {
  search?: string;
  universityId?: string;
  onboarding?: "all" | "completed" | "pending";
  sort?: "created_at" | "full_name" | "username";
  dir?: "asc" | "desc";
  page?: number;
}

export async function listUsers(params: ListUsersParams = {}): Promise<Paginated<AdminUserRow>> {
  await requireSecureAdmin();
  const admin = createAdminClient();

  const page = Math.max(1, params.page ?? 1);
  const sort = params.sort ?? "created_at";
  const dir = params.dir ?? "desc";
  const search = params.search?.trim();
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let q = admin
    .from("profiles")
    .select("id, username, full_name, avatar_url, university_id, onboarding_completed, created_at", {
      count: "exact",
    });

  if (params.universityId) q = q.eq("university_id", params.universityId);
  if (params.onboarding === "completed") q = q.eq("onboarding_completed", true);
  if (params.onboarding === "pending") q = q.eq("onboarding_completed", false);

  if (search) {
    if (search.includes("@")) {
      // Email search → resolve auth ids, then constrain by id.
      const ids = await findUserIdsByEmail(search);
      if (ids.length === 0) {
        return { rows: [], total: 0, page, pageSize: PAGE_SIZE };
      }
      q = q.in("id", ids);
    } else {
      const like = `%${search}%`;
      q = q.or(`full_name.ilike.${like},username.ilike.${like}`);
    }
  }

  q = q.order(sort, { ascending: dir === "asc" }).range(from, to);

  const { data, count, error } = await q;
  if (error) throw error;

  const profiles = (data ?? []) as any[];
  const ids = profiles.map((p) => p.id);

  const [emails, uniMap, aggregates] = await Promise.all([
    emailMap(ids),
    universityNameMap(admin, profiles.map((p) => p.university_id)),
    userAggregates(admin, ids),
  ]);

  const rows: AdminUserRow[] = profiles.map((p) => ({
    id: p.id,
    username: p.username,
    full_name: p.full_name,
    avatar_url: p.avatar_url,
    email: emails.get(p.id) ?? null,
    university: p.university_id ? uniMap.get(p.university_id) ?? null : null,
    onboarding_completed: !!p.onboarding_completed,
    created_at: p.created_at,
    club_count: aggregates.clubs.get(p.id) ?? 0,
    officer_count: aggregates.officer.get(p.id) ?? 0,
    report_count: aggregates.reports.get(p.id) ?? 0,
  }));

  return { rows, total: count ?? rows.length, page, pageSize: PAGE_SIZE };
}

export async function universityNameMap(
  admin: ReturnType<typeof createAdminClient>,
  universityIds: (string | null)[]
): Promise<Map<string, string>> {
  const ids = Array.from(new Set(universityIds.filter(Boolean))) as string[];
  if (ids.length === 0) return new Map();
  const { data } = await admin.from("universities").select("id, name").in("id", ids);
  return new Map((data ?? []).map((u: any) => [u.id, u.name]));
}

/** Batched per-user counts (club memberships, officer roles, reports-against). */
async function userAggregates(
  admin: ReturnType<typeof createAdminClient>,
  userIds: string[]
): Promise<{ clubs: Map<string, number>; officer: Map<string, number>; reports: Map<string, number> }> {
  const clubs = new Map<string, number>();
  const officer = new Map<string, number>();
  const reports = new Map<string, number>();
  if (userIds.length === 0) return { clubs, officer, reports };

  const [memberRes, reportRes] = await Promise.all([
    admin.from("club_members").select("user_id, role").in("user_id", userIds),
    admin.from("reports").select("entity_id").eq("entity_type", "user").in("entity_id", userIds),
  ]);

  for (const m of (memberRes.data ?? []) as any[]) {
    clubs.set(m.user_id, (clubs.get(m.user_id) ?? 0) + 1);
    if (m.role === "officer") officer.set(m.user_id, (officer.get(m.user_id) ?? 0) + 1);
  }
  for (const r of (reportRes.data ?? []) as any[]) {
    if (r.entity_id) reports.set(r.entity_id, (reports.get(r.entity_id) ?? 0) + 1);
  }
  return { clubs, officer, reports };
}

// ── User detail ──────────────────────────────────────────────────────────────

export interface UserDetail {
  id: string;
  username: string;
  full_name: string;
  avatar_url: string | null;
  email: string | null;
  bio: string | null;
  major: string | null;
  year: string | null;
  university: string | null;
  university_id: string | null;
  onboarding_completed: boolean;
  created_at: string;
  interests: string[];
  activities: string[];
  memberships: {
    club_id: string;
    club_name: string;
    club_handle: string;
    avatar_url: string | null;
    role: string;
    officer_title: string | null;
    joined_at: string;
  }[];
  officerRoles: {
    club_id: string;
    club_name: string;
    club_handle: string;
    role_title: string;
  }[];
  postCount: number;
  eventCount: number;
  reportCount: number;
}

export async function getUserDetail(id: string): Promise<UserDetail | null> {
  await requireSecureAdmin();
  const admin = createAdminClient();

  const { data: profile } = await admin
    .from("profiles")
    .select("id, username, full_name, avatar_url, bio, major, year, university_id, onboarding_completed, created_at")
    .eq("id", id)
    .maybeSingle();

  if (!profile) return null;
  const p = profile as any;

  const [
    emails,
    uniName,
    interestsRes,
    activitiesRes,
    membersRes,
    officersRes,
    postCount,
    eventCount,
    reportCount,
  ] = await Promise.all([
    emailMap([p.id]),
    p.university_id
      ? admin.from("universities").select("name").eq("id", p.university_id).maybeSingle()
      : Promise.resolve({ data: null }),
    admin.from("user_interests").select("interest").eq("user_id", id),
    admin.from("user_activities").select("activity").eq("user_id", id),
    admin
      .from("club_members")
      .select("role, joined_at, clubs(id, name, handle, avatar_url)")
      .eq("user_id", id)
      .order("joined_at", { ascending: false }),
    admin
      .from("club_officers")
      .select("role_title, clubs(id, name, handle)")
      .eq("user_id", id),
    safeCount(admin, "posts", (q) => q.eq("author_id", id)),
    safeCount(admin, "events", (q) => q.eq("created_by", id)),
    safeCount(admin, "reports", (q) => q.eq("entity_type", "user").eq("entity_id", id)),
  ]);

  const officerTitleByClub = new Map<string, string>();
  for (const o of (officersRes.data ?? []) as any[]) {
    if (o.clubs?.id) officerTitleByClub.set(o.clubs.id, o.role_title);
  }

  const memberships = ((membersRes.data ?? []) as any[])
    .filter((m) => m.clubs)
    .map((m) => ({
      club_id: m.clubs.id,
      club_name: m.clubs.name,
      club_handle: m.clubs.handle,
      avatar_url: m.clubs.avatar_url ?? null,
      role: m.role,
      officer_title: officerTitleByClub.get(m.clubs.id) ?? null,
      joined_at: m.joined_at,
    }));

  const officerRoles = ((officersRes.data ?? []) as any[])
    .filter((o) => o.clubs)
    .map((o) => ({
      club_id: o.clubs.id,
      club_name: o.clubs.name,
      club_handle: o.clubs.handle,
      role_title: o.role_title,
    }));

  return {
    id: p.id,
    username: p.username,
    full_name: p.full_name,
    avatar_url: p.avatar_url,
    email: emails.get(p.id) ?? null,
    bio: p.bio,
    major: p.major,
    year: p.year,
    university: (uniName as any)?.data?.name ?? null,
    university_id: p.university_id ?? null,
    onboarding_completed: !!p.onboarding_completed,
    created_at: p.created_at,
    interests: ((interestsRes.data ?? []) as any[]).map((r) => r.interest),
    activities: ((activitiesRes.data ?? []) as any[]).map((r) => r.activity),
    memberships,
    officerRoles,
    postCount: postCount ?? 0,
    eventCount: eventCount ?? 0,
    reportCount: reportCount ?? 0,
  };
}

// ── Clubs list ───────────────────────────────────────────────────────────────

export interface ListClubsParams {
  search?: string;
  universityId?: string;
  /** Filter to clubs that have this interest assigned (either tier). */
  interestId?: string;
  status?: "all" | "active" | "inactive";
  sort?: "created_at" | "name" | "handle";
  dir?: "asc" | "desc";
  page?: number;
}

export async function listClubs(params: ListClubsParams = {}): Promise<Paginated<AdminClubRow>> {
  await requireSecureAdmin();
  const admin = createAdminClient();

  const page = Math.max(1, params.page ?? 1);
  const sort = params.sort ?? "created_at";
  const dir = params.dir ?? "desc";
  const search = params.search?.trim();
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let q = admin
    .from("clubs")
    .select("id, name, handle, avatar_url, university_id, is_active, claimed, created_at", {
      count: "exact",
    });

  if (params.interestId) {
    const { data: tagged, error: tagErr } = await admin
      .from("club_interests")
      .select("club_id")
      .eq("interest_id", params.interestId);
    if (tagErr) throw tagErr;
    const ids = Array.from(new Set((tagged ?? []).map((r: any) => r.club_id)));
    // No club has this interest → return an empty page rather than every club.
    q = q.in("id", ids.length > 0 ? ids : ["00000000-0000-0000-0000-000000000000"]);
  }
  if (params.universityId) q = q.eq("university_id", params.universityId);
  if (params.status === "active") q = q.eq("is_active", true);
  if (params.status === "inactive") q = q.eq("is_active", false);
  if (search) {
    const like = `%${search}%`;
    q = q.or(`name.ilike.${like},handle.ilike.${like}`);
  }

  q = q.order(sort, { ascending: dir === "asc" }).range(from, to);

  const { data, count, error } = await q;
  if (error) throw error;

  const clubs = (data ?? []) as any[];
  const ids = clubs.map((c) => c.id);

  const [uniMap, aggregates] = await Promise.all([
    universityNameMap(admin, clubs.map((c) => c.university_id)),
    clubAggregates(admin, ids),
  ]);

  const rows: AdminClubRow[] = clubs.map((c) => ({
    id: c.id,
    name: c.name,
    handle: c.handle,
    avatar_url: c.avatar_url,
    university: c.university_id ? uniMap.get(c.university_id) ?? null : null,
    is_active: !!c.is_active,
    claimed: !!c.claimed,
    member_count: aggregates.members.get(c.id) ?? 0,
    officer_count: aggregates.officers.get(c.id) ?? 0,
    post_count: aggregates.posts.get(c.id) ?? 0,
    event_count: aggregates.events.get(c.id) ?? 0,
    report_count: aggregates.reports.get(c.id) ?? 0,
    created_at: c.created_at,
  }));

  return { rows, total: count ?? rows.length, page, pageSize: PAGE_SIZE };
}

/** Batched per-club counts (live membership/officer/post/event/report totals). */
async function clubAggregates(
  admin: ReturnType<typeof createAdminClient>,
  clubIds: string[]
): Promise<{
  members: Map<string, number>;
  officers: Map<string, number>;
  posts: Map<string, number>;
  events: Map<string, number>;
  reports: Map<string, number>;
}> {
  const members = new Map<string, number>();
  const officers = new Map<string, number>();
  const posts = new Map<string, number>();
  const events = new Map<string, number>();
  const reports = new Map<string, number>();
  const empty = { members, officers, posts, events, reports };
  if (clubIds.length === 0) return empty;

  const [memberRes, postRes, eventRes, reportRes] = await Promise.all([
    admin.from("club_members").select("club_id, role").in("club_id", clubIds),
    admin.from("posts").select("club_id").in("club_id", clubIds),
    admin.from("events").select("club_id").in("club_id", clubIds),
    admin.from("reports").select("entity_id").eq("entity_type", "club").in("entity_id", clubIds),
  ]);

  for (const m of (memberRes.data ?? []) as any[]) {
    members.set(m.club_id, (members.get(m.club_id) ?? 0) + 1);
    if (m.role === "officer") officers.set(m.club_id, (officers.get(m.club_id) ?? 0) + 1);
  }
  for (const p of (postRes.data ?? []) as any[]) {
    if (p.club_id) posts.set(p.club_id, (posts.get(p.club_id) ?? 0) + 1);
  }
  for (const e of (eventRes.data ?? []) as any[]) {
    if (e.club_id) events.set(e.club_id, (events.get(e.club_id) ?? 0) + 1);
  }
  for (const r of (reportRes.data ?? []) as any[]) {
    if (r.entity_id) reports.set(r.entity_id, (reports.get(r.entity_id) ?? 0) + 1);
  }
  return empty;
}

// ── Club detail ──────────────────────────────────────────────────────────────

export interface ClubDetail {
  id: string;
  name: string;
  handle: string;
  description: string | null;
  avatar_url: string | null;
  cover_image_url: string | null;
  university: string | null;
  university_id: string | null;
  meeting_day: string | null;
  meeting_time_start: string | null;
  meeting_time_end: string | null;
  meeting_location: string | null;
  meeting_building: string | null;
  meeting_room: string | null;
  is_active: boolean;
  claimed: boolean;
  created_at: string;
  memberCount: number;
  officerCount: number;
  postCount: number;
  eventCount: number;
  reportCount: number;
  conversationCount: number | null;
  members: {
    user_id: string;
    full_name: string;
    username: string;
    avatar_url: string | null;
    email: string | null;
    role: string;
    officer_title: string | null;
    joined_at: string;
  }[];
  officers: {
    user_id: string | null;
    display_name: string;
    role_title: string;
    username: string | null;
    email: string | null;
    avatar_url: string | null;
  }[];
}

export async function getClubDetail(id: string): Promise<ClubDetail | null> {
  await requireSecureAdmin();
  const admin = createAdminClient();

  const { data: club } = await admin
    .from("clubs")
    .select(
      "id, name, handle, description, avatar_url, cover_image_url, banner_url, university_id, meeting_day, meeting_time_start, meeting_time_end, meeting_location, meeting_building, meeting_room, is_active, claimed, created_at"
    )
    .eq("id", id)
    .maybeSingle();

  if (!club) return null;
  const c = club as any;

  const [
    uniName,
    membersRes,
    officersRes,
    postCount,
    eventCount,
    reportCount,
    conversationCount,
  ] = await Promise.all([
    c.university_id
      ? admin.from("universities").select("name").eq("id", c.university_id).maybeSingle()
      : Promise.resolve({ data: null }),
    admin
      .from("club_members")
      .select("user_id, role, joined_at, profiles(id, username, full_name, avatar_url)")
      .eq("club_id", id)
      .order("joined_at", { ascending: true }),
    admin
      .from("club_officers")
      .select("user_id, display_name, role_title, avatar_url, display_order, profiles(username, avatar_url)")
      .eq("club_id", id)
      .order("display_order", { ascending: true }),
    safeCount(admin, "posts", (q) => q.eq("club_id", id)),
    safeCount(admin, "events", (q) => q.eq("club_id", id)),
    safeCount(admin, "reports", (q) => q.eq("entity_type", "club").eq("entity_id", id)),
    safeCount(admin, "conversations", (q) => q.eq("club_id", id)),
  ]);

  const memberRows = ((membersRes.data ?? []) as any[]).filter((m) => m.profiles);
  const officerRows = (officersRes.data ?? []) as any[];

  const allUserIds = [
    ...memberRows.map((m) => m.user_id),
    ...officerRows.map((o) => o.user_id).filter(Boolean),
  ];
  const emails = await emailMap(allUserIds);

  const officerTitleByUser = new Map<string, string>();
  for (const o of officerRows) {
    if (o.user_id) officerTitleByUser.set(o.user_id, o.role_title);
  }

  const members = memberRows.map((m) => ({
    user_id: m.user_id,
    full_name: m.profiles.full_name,
    username: m.profiles.username,
    avatar_url: m.profiles.avatar_url ?? null,
    email: emails.get(m.user_id) ?? null,
    role: m.role,
    officer_title: officerTitleByUser.get(m.user_id) ?? null,
    joined_at: m.joined_at,
  }));

  const officers = officerRows.map((o) => ({
    user_id: o.user_id ?? null,
    display_name: o.display_name,
    role_title: o.role_title,
    username: o.profiles?.username ?? null,
    email: o.user_id ? emails.get(o.user_id) ?? null : null,
    avatar_url: o.avatar_url ?? o.profiles?.avatar_url ?? null,
  }));

  return {
    id: c.id,
    name: c.name,
    handle: c.handle,
    description: c.description,
    avatar_url: c.avatar_url,
    cover_image_url: c.cover_image_url ?? c.banner_url ?? null,
    university: (uniName as any)?.data?.name ?? null,
    university_id: c.university_id ?? null,
    meeting_day: c.meeting_day,
    meeting_time_start: c.meeting_time_start,
    meeting_time_end: c.meeting_time_end,
    meeting_location: c.meeting_location,
    meeting_building: c.meeting_building,
    meeting_room: c.meeting_room,
    is_active: !!c.is_active,
    claimed: !!c.claimed,
    created_at: c.created_at,
    memberCount: members.length,
    officerCount: members.filter((m) => m.role === "officer").length,
    postCount: postCount ?? 0,
    eventCount: eventCount ?? 0,
    reportCount: reportCount ?? 0,
    conversationCount: conversationCount,
    members,
    officers,
  };
}

// ── Global search ────────────────────────────────────────────────────────────

export interface SearchResults {
  users: { id: string; full_name: string; username: string; avatar_url: string | null; email: string | null }[];
  clubs: { id: string; name: string; handle: string; avatar_url: string | null; university: string | null }[];
  universities: { id: string; name: string; slug: string }[];
  officers: {
    id: string;
    user_id: string;
    full_name: string;
    username: string;
    club_name: string;
    role_title: string | null;
  }[];
  posts: { id: string; caption: string | null; author_username: string; club_name: string | null }[];
  comments: { id: string; content: string; author_username: string }[];
  events: { id: string; title: string; club_name: string | null; event_date: string }[];
  rsvps: { id: string; event_id: string; attendee_username: string; event_title: string; status: string }[];
  conversations: { id: string; title: string; type_label: string; club_name: string | null }[];
  channels: { id: string; name: string; conversation_title: string; club_name: string | null }[];
  messages: { id: string; conversation_id: string; sender_username: string; conversation_title: string; message_type: string; deleted: boolean }[];
  notifications: { id: string; type: string; recipient_username: string; title: string | null }[];
  reports: { id: string; target_label: string; entity_type_label: string; reason: string | null; status: string; reporter_username: string | null }[];
  deletedContent: { key: string; entity_type_label: string; identity: string; href: string }[];
  diagnostics: { key: string; label: string; description: string; href: string }[];
}

const EMPTY_SEARCH: SearchResults = {
  users: [],
  clubs: [],
  universities: [],
  officers: [],
  posts: [],
  comments: [],
  events: [],
  rsvps: [],
  conversations: [],
  channels: [],
  messages: [],
  notifications: [],
  reports: [],
  deletedContent: [],
  diagnostics: [],
};

function preview(text: string | null, len = 80): string | null {
  if (!text) return null;
  const t = text.trim();
  return t.length > len ? `${t.slice(0, len)}…` : t;
}

export async function searchEntities(query: string): Promise<SearchResults> {
  await requireSecureAdmin();
  const admin = createAdminClient();
  const term = query.trim();
  if (term.length < 2) return EMPTY_SEARCH;

  const like = `%${term}%`;
  const isEmail = term.includes("@");

  // Users
  let userIdFilter: string[] | null = null;
  if (isEmail) userIdFilter = await findUserIdsByEmail(term);

  const usersPromise = (async () => {
    let uq = admin
      .from("profiles")
      .select("id, full_name, username, avatar_url")
      .limit(8);
    if (isEmail) {
      if (!userIdFilter || userIdFilter.length === 0) return [];
      uq = uq.in("id", userIdFilter);
    } else {
      uq = uq.or(`full_name.ilike.${like},username.ilike.${like}`);
    }
    const { data } = await uq;
    const rows = (data ?? []) as any[];
    const emails = await emailMap(rows.map((r) => r.id));
    return rows.map((r) => ({
      id: r.id,
      full_name: r.full_name,
      username: r.username,
      avatar_url: r.avatar_url ?? null,
      email: emails.get(r.id) ?? null,
    }));
  })();

  const clubsPromise = (async () => {
    const { data } = await admin
      .from("clubs")
      .select("id, name, handle, avatar_url, university_id")
      .or(`name.ilike.${like},handle.ilike.${like}`)
      .limit(8);
    const rows = (data ?? []) as any[];
    const uniMap = await universityNameMap(admin, rows.map((r) => r.university_id));
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      handle: r.handle,
      avatar_url: r.avatar_url ?? null,
      university: r.university_id ? uniMap.get(r.university_id) ?? null : null,
    }));
  })();

  const universitiesPromise = (async () => {
    const { data } = await admin
      .from("universities")
      .select("id, name, slug")
      .or(`name.ilike.${like},slug.ilike.${like}`)
      .limit(6);
    return ((data ?? []) as any[]).map((u) => ({ id: u.id, name: u.name, slug: u.slug }));
  })();

  const officersPromise = (async () => {
    // Officers matched by user name/username or club name/handle (Day-2 entity).
    const [{ data: matchUsers }, { data: matchClubs }] = await Promise.all([
      isEmail
        ? Promise.resolve({ data: (userIdFilter ?? []).map((id) => ({ id })) as any[] })
        : admin.from("profiles").select("id").or(`full_name.ilike.${like},username.ilike.${like}`).limit(200),
      admin.from("clubs").select("id").or(`name.ilike.${like},handle.ilike.${like}`).limit(200),
    ]);
    const uIds = (matchUsers ?? []).map((u: any) => u.id);
    const cIds = (matchClubs ?? []).map((c: any) => c.id);
    const parts: string[] = [];
    if (uIds.length) parts.push(`user_id.in.(${uIds.join(",")})`);
    if (cIds.length) parts.push(`club_id.in.(${cIds.join(",")})`);
    if (parts.length === 0) return [];
    const { data } = await admin
      .from("club_members")
      .select("id, club_id, user_id, profiles!inner(full_name, username), clubs!inner(name)")
      .eq("role", "officer")
      .or(parts.join(","))
      .limit(6);
    const rows = (data ?? []) as any[];
    // Attach role titles from the display roster.
    const titles = new Map<string, string>();
    if (rows.length) {
      const { data: roster } = await admin
        .from("club_officers")
        .select("club_id, user_id, role_title")
        .in("club_id", rows.map((r) => r.club_id))
        .in("user_id", rows.map((r) => r.user_id));
      for (const o of (roster ?? []) as any[]) if (o.user_id) titles.set(`${o.club_id}:${o.user_id}`, o.role_title);
    }
    return rows.map((r) => ({
      id: r.id,
      user_id: r.user_id,
      full_name: r.profiles?.full_name ?? "",
      username: r.profiles?.username ?? "",
      club_name: r.clubs?.name ?? "",
      role_title: titles.get(`${r.club_id}:${r.user_id}`) ?? null,
    }));
  })();

  // Shared matched user/club id sets for Day-3 content search (bounded).
  const matchedIdsPromise = (async () => {
    const [{ data: mUsers }, { data: mClubs }] = await Promise.all([
      isEmail
        ? Promise.resolve({ data: (userIdFilter ?? []).map((id) => ({ id })) as any[] })
        : admin.from("profiles").select("id").or(`full_name.ilike.${like},username.ilike.${like}`).limit(200),
      admin.from("clubs").select("id").or(`name.ilike.${like},handle.ilike.${like}`).limit(200),
    ]);
    return {
      userIds: (mUsers ?? []).map((u: any) => u.id),
      clubIds: (mClubs ?? []).map((c: any) => c.id),
    };
  })();

  const postsPromise = (async () => {
    const { userIds, clubIds } = await matchedIdsPromise;
    const parts: string[] = [];
    if (!isEmail) parts.push(`caption.ilike.${like}`);
    if (userIds.length) parts.push(`author_id.in.(${userIds.join(",")})`);
    if (clubIds.length) parts.push(`club_id.in.(${clubIds.join(",")})`);
    if (parts.length === 0) return [];
    const { data } = await admin
      .from("posts")
      .select("id, caption, author_id, club_id")
      .or(parts.join(","))
      .order("created_at", { ascending: false })
      .limit(6);
    const rows = (data ?? []) as any[];
    const [authors, clubsMap] = await Promise.all([
      (async () => {
        const m = new Map<string, string>();
        const ids = Array.from(new Set(rows.map((r) => r.author_id)));
        if (ids.length) {
          const { data: p } = await admin.from("profiles").select("id, username").in("id", ids);
          for (const x of (p ?? []) as any[]) m.set(x.id, x.username);
        }
        return m;
      })(),
      (async () => {
        const m = new Map<string, string>();
        const ids = Array.from(new Set(rows.map((r) => r.club_id).filter(Boolean)));
        if (ids.length) {
          const { data: c } = await admin.from("clubs").select("id, name").in("id", ids as string[]);
          for (const x of (c ?? []) as any[]) m.set(x.id, x.name);
        }
        return m;
      })(),
    ]);
    return rows.map((r) => ({
      id: r.id,
      caption: preview(r.caption),
      author_username: authors.get(r.author_id) ?? "",
      club_name: r.club_id ? clubsMap.get(r.club_id) ?? null : null,
    }));
  })();

  const commentsPromise = (async () => {
    const { userIds } = await matchedIdsPromise;
    const parts: string[] = [];
    if (!isEmail) parts.push(`content.ilike.${like}`);
    if (userIds.length) parts.push(`user_id.in.(${userIds.join(",")})`);
    if (parts.length === 0) return [];
    const { data } = await admin
      .from("post_comments")
      .select("id, content, user_id")
      .or(parts.join(","))
      .order("created_at", { ascending: false })
      .limit(6);
    const rows = (data ?? []) as any[];
    const authors = new Map<string, string>();
    const ids = Array.from(new Set(rows.map((r) => r.user_id)));
    if (ids.length) {
      const { data: p } = await admin.from("profiles").select("id, username").in("id", ids);
      for (const x of (p ?? []) as any[]) authors.set(x.id, x.username);
    }
    return rows.map((r) => ({
      id: r.id,
      content: preview(r.content) ?? "",
      author_username: authors.get(r.user_id) ?? "",
    }));
  })();

  const eventsPromise = (async () => {
    const { userIds, clubIds } = await matchedIdsPromise;
    const parts: string[] = [];
    if (!isEmail) parts.push(`title.ilike.${like}`);
    if (userIds.length) parts.push(`created_by.in.(${userIds.join(",")})`);
    if (clubIds.length) parts.push(`club_id.in.(${clubIds.join(",")})`);
    if (parts.length === 0) return [];
    const { data } = await admin
      .from("events")
      .select("id, title, event_date, club_id, clubs(name)")
      .or(parts.join(","))
      .order("event_date", { ascending: false })
      .limit(6);
    return ((data ?? []) as any[]).map((e) => ({
      id: e.id,
      title: e.title,
      club_name: e.clubs?.name ?? null,
      event_date: e.event_date,
    }));
  })();

  const rsvpsPromise = (async () => {
    const { userIds } = await matchedIdsPromise;
    // RSVPs by attendee OR by matching event title.
    const { data: evByTitle } = isEmail
      ? { data: [] as any[] }
      : await admin.from("events").select("id").ilike("title", like).limit(200);
    const eventIds = (evByTitle ?? []).map((e: any) => e.id);
    const parts: string[] = [];
    if (userIds.length) parts.push(`user_id.in.(${userIds.join(",")})`);
    if (eventIds.length) parts.push(`event_id.in.(${eventIds.join(",")})`);
    if (parts.length === 0) return [];
    const { data } = await admin
      .from("event_rsvps")
      .select("id, event_id, user_id, status, profiles!inner(username), events!inner(title)")
      .or(parts.join(","))
      .order("created_at", { ascending: false })
      .limit(6);
    return ((data ?? []) as any[]).map((r) => ({
      id: r.id,
      event_id: r.event_id,
      attendee_username: r.profiles?.username ?? "",
      event_title: r.events?.title ?? "",
      status: r.status,
    }));
  })();

  // ── Day-4 messaging + notifications (METADATA ONLY) ─────────────────────────
  // Message-CONTENT search is NOT here — that requires a fresh MFA step-up and
  // lives behind /admin/api/message-search. These match on names/identities only.

  const conversationsPromise = (async () => {
    const { userIds, clubIds } = await matchedIdsPromise;
    // Conversations by name, club, or a matched participant.
    let participantConvIds: string[] = [];
    if (userIds.length) {
      const { data: cp } = await admin.from("conversation_participants").select("conversation_id").in("user_id", userIds).limit(2000);
      participantConvIds = Array.from(new Set((cp ?? []).map((r: any) => r.conversation_id)));
    }
    const parts: string[] = [];
    if (!isEmail) parts.push(`name.ilike.${like}`);
    if (clubIds.length) parts.push(`club_id.in.(${clubIds.join(",")})`);
    if (participantConvIds.length) parts.push(`id.in.(${participantConvIds.join(",")})`);
    if (parts.length === 0) return [];
    const { data } = await admin
      .from("conversations")
      .select("id, type, name, club_id")
      .or(parts.join(","))
      .order("created_at", { ascending: false })
      .limit(6);
    const rows = (data ?? []) as any[];
    const cIds = Array.from(new Set(rows.map((r) => r.club_id).filter(Boolean))) as string[];
    const cMap = new Map<string, string>();
    if (cIds.length) {
      const { data: cs } = await admin.from("clubs").select("id, name").in("id", cIds);
      for (const c of (cs ?? []) as any[]) cMap.set(c.id, c.name);
    }
    const LABEL: Record<string, string> = { direct: "Direct message", group: "Custom group", club_group: "Club chat", officer_chat: "Official club chat" };
    return rows.map((r) => ({
      id: r.id,
      title: (r.name && r.name.trim()) || (r.club_id ? cMap.get(r.club_id) ?? "Club conversation" : LABEL[r.type] ?? r.type),
      type_label: LABEL[r.type] ?? r.type,
      club_name: r.club_id ? cMap.get(r.club_id) ?? null : null,
    }));
  })();

  const channelsPromise = (async () => {
    const { clubIds } = await matchedIdsPromise;
    // Channels by their own name, or by matching club → conversation.
    let convIds: string[] = [];
    if (clubIds.length) {
      const { data: convs } = await admin.from("conversations").select("id").in("club_id", clubIds).limit(2000);
      convIds = (convs ?? []).map((c: any) => c.id);
    }
    const parts: string[] = [`name.ilike.${like}`];
    if (convIds.length) parts.push(`conversation_id.in.(${convIds.join(",")})`);
    const { data } = await admin
      .from("conversation_channels")
      .select("id, name, conversation_id")
      .or(parts.join(","))
      .limit(6);
    const rows = (data ?? []) as any[];
    const cvIds = Array.from(new Set(rows.map((r) => r.conversation_id)));
    const cvMap = new Map<string, any>();
    if (cvIds.length) {
      const { data: cvs } = await admin.from("conversations").select("id, name, type, club_id").in("id", cvIds);
      for (const cv of (cvs ?? []) as any[]) cvMap.set(cv.id, cv);
    }
    const clubById = new Map<string, string>();
    const clubIdSet = Array.from(new Set([...cvMap.values()].map((cv) => cv.club_id).filter(Boolean))) as string[];
    if (clubIdSet.length) {
      const { data: cs } = await admin.from("clubs").select("id, name").in("id", clubIdSet);
      for (const c of (cs ?? []) as any[]) clubById.set(c.id, c.name);
    }
    return rows.map((r) => {
      const cv = cvMap.get(r.conversation_id);
      const clubName = cv?.club_id ? clubById.get(cv.club_id) ?? null : null;
      return {
        id: r.id,
        name: r.name,
        conversation_title: (cv?.name && cv.name.trim()) || clubName || "Conversation",
        club_name: clubName,
      };
    });
  })();

  const messagesPromise = (async () => {
    // METADATA-only message search: sender identity or conversation name (never
    // message content — that path requires recent MFA).
    const { userIds } = await matchedIdsPromise;
    const { data: convByName } = isEmail ? { data: [] as any[] } : await admin.from("conversations").select("id").ilike("name", like).limit(200);
    const convIds = (convByName ?? []).map((c: any) => c.id);
    const parts: string[] = [];
    if (userIds.length) parts.push(`sender_id.in.(${userIds.join(",")})`);
    if (convIds.length) parts.push(`conversation_id.in.(${convIds.join(",")})`);
    if (parts.length === 0) return [];
    const { data } = await admin
      .from("messages")
      .select("id, conversation_id, sender_id, message_type, deleted_at")
      .or(parts.join(","))
      .order("created_at", { ascending: false })
      .limit(6);
    const rows = (data ?? []) as any[];
    const sMap = new Map<string, string>();
    const sIds = Array.from(new Set(rows.map((r) => r.sender_id)));
    if (sIds.length) {
      const { data: ps } = await admin.from("profiles").select("id, username").in("id", sIds);
      for (const p of (ps ?? []) as any[]) sMap.set(p.id, p.username);
    }
    const cvMap = new Map<string, any>();
    const cvIds = Array.from(new Set(rows.map((r) => r.conversation_id)));
    if (cvIds.length) {
      const { data: cvs } = await admin.from("conversations").select("id, name, club_id, type").in("id", cvIds);
      for (const cv of (cvs ?? []) as any[]) cvMap.set(cv.id, cv);
    }
    const clubById = new Map<string, string>();
    const clubIdSet = Array.from(new Set([...cvMap.values()].map((cv) => cv.club_id).filter(Boolean))) as string[];
    if (clubIdSet.length) {
      const { data: cs } = await admin.from("clubs").select("id, name").in("id", clubIdSet);
      for (const c of (cs ?? []) as any[]) clubById.set(c.id, c.name);
    }
    const LABEL: Record<string, string> = { direct: "Direct message", group: "Custom group", club_group: "Club chat", officer_chat: "Official club chat" };
    return rows.map((r) => {
      const cv = cvMap.get(r.conversation_id);
      const clubName = cv?.club_id ? clubById.get(cv.club_id) ?? null : null;
      return {
        id: r.id,
        conversation_id: r.conversation_id,
        sender_username: sMap.get(r.sender_id) ?? "",
        conversation_title: (cv?.name && cv.name.trim()) || clubName || (cv ? LABEL[cv.type] ?? cv.type : "Conversation"),
        message_type: r.message_type,
        deleted: !!r.deleted_at,
      };
    });
  })();

  const notificationsPromise = (async () => {
    const { userIds } = await matchedIdsPromise;
    const parts: string[] = [];
    if (userIds.length) parts.push(`user_id.in.(${userIds.join(",")})`);
    if (!isEmail) parts.push(`type.ilike.${like}`);
    if (parts.length === 0) return [];
    const { data } = await admin
      .from("notifications")
      .select("id, type, user_id, message")
      .or(parts.join(","))
      .order("created_at", { ascending: false })
      .limit(6);
    const rows = (data ?? []) as any[];
    const rMap = new Map<string, string>();
    const rIds = Array.from(new Set(rows.map((r) => r.user_id)));
    if (rIds.length) {
      const { data: ps } = await admin.from("profiles").select("id, username").in("id", rIds);
      for (const p of (ps ?? []) as any[]) rMap.set(p.id, p.username);
    }
    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      recipient_username: rMap.get(r.user_id) ?? "",
      title: r.message ?? null,
    }));
  })();

  // ── Day-5 moderation search (SAFE METADATA ONLY) ────────────────────────────
  // Reports by reporter / reported user / target name / reason / status. NEVER
  // the content_snapshot/attachment_snapshot evidence columns.

  const REPORT_ENTITY_LABEL: Record<string, string> = {
    club: "Club",
    event: "Event",
    post: "Post",
    user: "User",
    message: "Message",
    chat: "Conversation",
  };

  const reportsPromise = (async () => {
    const { userIds } = await matchedIdsPromise;
    const statusToken = ["pending", "reviewing", "resolved", "dismissed"].includes(term.toLowerCase()) ? term.toLowerCase() : null;
    // Target entity ids matched by name.
    const [{ data: clubsT }, { data: eventsT }, { data: postsT }] = await Promise.all([
      admin.from("clubs").select("id").or(`name.ilike.${like},handle.ilike.${like}`).limit(100),
      isEmail ? Promise.resolve({ data: [] as any[] }) : admin.from("events").select("id").ilike("title", like).limit(100),
      isEmail ? Promise.resolve({ data: [] as any[] }) : admin.from("posts").select("id").ilike("caption", like).limit(100),
    ]);
    const targetIds = [...(clubsT ?? []), ...(eventsT ?? []), ...(postsT ?? [])].map((r: any) => r.id);
    const parts: string[] = [];
    if (!isEmail) parts.push(`entity_name.ilike.${like}`);
    if (!isEmail) parts.push(`reporter_username.ilike.${like}`);
    parts.push(`reporter_email.ilike.${like}`);
    if (!isEmail) parts.push(`reason.ilike.${like}`);
    if (statusToken) parts.push(`status.eq.${statusToken}`);
    if (userIds.length) {
      parts.push(`reporter_id.in.(${userIds.join(",")})`);
      parts.push(`entity_id.in.(${userIds.join(",")})`);
      parts.push(`message_sender_id.in.(${userIds.join(",")})`);
    }
    if (targetIds.length) parts.push(`entity_id.in.(${targetIds.join(",")})`);
    if (parts.length === 0) return [];
    const { data } = await admin
      .from("reports")
      .select("id, status, entity_type, entity_name, reason, reporter_username")
      .or(parts.join(","))
      .order("created_at", { ascending: false })
      .limit(6);
    return ((data ?? []) as any[]).map((r) => ({
      id: r.id,
      target_label: r.entity_name || REPORT_ENTITY_LABEL[r.entity_type] || r.entity_type,
      entity_type_label: REPORT_ENTITY_LABEL[r.entity_type] ?? r.entity_type,
      reason: r.reason ?? null,
      status: r.status,
      reporter_username: r.reporter_username ?? null,
    }));
  })();

  // Deleted content: deactivated clubs + deleted conversations matched by name
  // (safe metadata; deleted messages are not surfaced in quick search).
  const deletedContentPromise = (async () => {
    const [{ data: clubsD }, { data: convD }] = await Promise.all([
      admin.from("clubs").select("id, name, handle").eq("is_active", false).or(`name.ilike.${like},handle.ilike.${like}`).limit(4),
      isEmail
        ? Promise.resolve({ data: [] as any[] })
        : admin.from("conversations").select("id, name").not("deleted_at", "is", null).ilike("name", like).limit(4),
    ]);
    const out: { key: string; entity_type_label: string; identity: string; href: string }[] = [];
    for (const c of (clubsD ?? []) as any[]) out.push({ key: `club:${c.id}`, entity_type_label: "Deactivated club", identity: c.name, href: `/admin/clubs/${c.id}` });
    for (const c of (convD ?? []) as any[]) out.push({ key: `conversation:${c.id}`, entity_type_label: "Deleted conversation", identity: c.name || "Conversation", href: `/admin/conversations/${c.id}` });
    return out;
  })();

  // Data Health issues by category + moderation tools (navigational shortcuts).
  const diagnosticsPromise = (async () => {
    const catalog = [
      { key: "accounts", label: "Data Health · Accounts", description: "Auth ↔ profile consistency checks", href: "/admin/data-health", keywords: ["account", "auth", "profile", "orphan", "signup", "health"] },
      { key: "clubs", label: "Data Health · Clubs", description: "Officer roster & membership integrity", href: "/admin/data-health", keywords: ["officer", "member", "club", "roster", "duplicate", "health"] },
      { key: "content", label: "Data Health · Content", description: "Posts/comments reference integrity", href: "/admin/data-health", keywords: ["post", "comment", "content", "orphan", "health"] },
      { key: "messaging", label: "Data Health · Messaging", description: "Conversation/channel/message references", href: "/admin/data-health", keywords: ["message", "channel", "conversation", "notification", "health"] },
      { key: "moderation", label: "Data Health · Moderation", description: "Reports pointing at missing targets", href: "/admin/data-health", keywords: ["report", "moderation", "target", "health"] },
      { key: "edit-history", label: "Edit History", description: "Recently-edited entities (no before/after)", href: "/admin/edit-history", keywords: ["edit", "history", "updated", "changed"] },
      { key: "audit-history", label: "Audit History", description: "Structured audit coverage & status", href: "/admin/audit-history", keywords: ["audit", "log", "trail", "history"] },
      { key: "deleted-content", label: "Deleted Content", description: "Deactivated/deleted entities", href: "/admin/deleted-content", keywords: ["deleted", "removed", "archived", "deactivated", "restore", "purge"] },
      { key: "settings", label: "Admin Settings", description: "Operational status & kill switches", href: "/admin/settings", keywords: ["setting", "mfa", "kill switch", "env", "status"] },
    ];
    const t = term.toLowerCase();
    return catalog
      .filter((c) => c.keywords.some((k) => k.includes(t) || t.includes(k)))
      .slice(0, 5)
      .map(({ key, label, description, href }) => ({ key, label, description, href }));
  })();

  const [users, clubs, universities, officers, posts, comments, events, rsvps, conversations, channels, messages, notifications, reports, deletedContent, diagnostics] = await Promise.all([
    usersPromise,
    clubsPromise,
    universitiesPromise,
    officersPromise,
    postsPromise,
    commentsPromise,
    eventsPromise,
    rsvpsPromise,
    conversationsPromise,
    channelsPromise,
    messagesPromise,
    notificationsPromise,
    reportsPromise,
    deletedContentPromise,
    diagnosticsPromise,
  ]);
  return { users, clubs, universities, officers, posts, comments, events, rsvps, conversations, channels, messages, notifications, reports, deletedContent, diagnostics };
}
