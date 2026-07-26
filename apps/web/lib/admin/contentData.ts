// ============================================================================
// Admin Dashboard — Day-3 content read access: posts + comments  (SERVER-ONLY)
// ============================================================================
// Same contract as data.ts / data2.ts: requireSecureAdmin() FIRST, then read
// through the service-role client; canonical tables only; counts computed live.
//
// CANONICAL SOURCES (from supabase/migrations/*.sql):
//   • posts          — id, author_id, club_id (nullable = "not tagged to a
//                       club"), post_type ('picture'|'event'), image_url
//                       (single-image model), caption, linked_event_id, created_at
//                       NOTE: there is NO posts.status / deleted_at / hidden
//                       column — posts have no soft-delete lifecycle. Removal
//                       from a club is the canonical "unglue" behavior
//                       (remove_post_from_club): club_id→NULL + tag/photo cleanup.
//   • post_comments  — id, post_id, user_id, content, created_at (no status/
//                       hidden/updated_at; content is the only editable field).
//   • post_likes     — engagement (reaction) count per post.
//   • post_club_tags — extra club tags beyond the primary posts.club_id.
//   • reports        — entity_type IN (club,event,post,user,message,chat).
//                       There is NO 'comment' entity_type, so comments are not a
//                       canonical report target — reported via their parent post.
// ============================================================================

if (typeof window !== "undefined") {
  throw new Error("lib/admin/contentData.ts is server-only and must not be imported in the browser.");
}

import { createAdminClient } from "../supabase/admin";
import { requireSecureAdmin } from "./secureAdmin";
import { emailMap, universityNameMap, PAGE_SIZE } from "./data";
import type { Paginated } from "./data";

function fmtIds(ids: string[]): string {
  return `(${ids.join(",")})`;
}

function captionPreview(caption: string | null, len = 140): string | null {
  if (!caption) return null;
  const trimmed = caption.trim();
  return trimmed.length > len ? `${trimmed.slice(0, len)}…` : trimmed;
}

// ── Shared filter option loaders ─────────────────────────────────────────────

/** Post ids that have at least one report (entity_type='post'), for the
 * "reported only" filter and per-row report counts. */
async function postReportCounts(
  admin: ReturnType<typeof createAdminClient>,
  postIds: string[]
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (postIds.length === 0) return map;
  const { data } = await admin
    .from("reports")
    .select("entity_id")
    .eq("entity_type", "post")
    .in("entity_id", postIds);
  for (const r of (data ?? []) as any[]) {
    if (r.entity_id) map.set(r.entity_id, (map.get(r.entity_id) ?? 0) + 1);
  }
  return map;
}

async function allReportedPostIds(admin: ReturnType<typeof createAdminClient>): Promise<string[]> {
  const { data } = await admin
    .from("reports")
    .select("entity_id")
    .eq("entity_type", "post")
    .not("entity_id", "is", null)
    .limit(5000);
  return Array.from(new Set((data ?? []).map((r: any) => r.entity_id).filter(Boolean)));
}

/** Resolve the club + author id sets that belong to a given university, so a
 * university filter can match posts by their tagged club OR their author. */
async function universityScope(
  admin: ReturnType<typeof createAdminClient>,
  universityId: string
): Promise<{ clubIds: string[]; authorIds: string[] }> {
  const [{ data: clubs }, { data: profs }] = await Promise.all([
    admin.from("clubs").select("id").eq("university_id", universityId).limit(2000),
    admin.from("profiles").select("id").eq("university_id", universityId).limit(5000),
  ]);
  return {
    clubIds: (clubs ?? []).map((c: any) => c.id),
    authorIds: (profs ?? []).map((p: any) => p.id),
  };
}

// ── Posts list ────────────────────────────────────────────────────────────────

export interface AdminPostRow {
  id: string;
  caption: string | null;
  post_type: string;
  image_url: string | null;
  author_id: string;
  author_name: string;
  author_username: string;
  author_email: string | null;
  club_id: string | null;
  club_name: string | null;
  club_handle: string | null;
  university: string | null;
  media_count: number;
  comment_count: number;
  like_count: number;
  report_count: number;
  created_at: string;
}

export interface ListPostsParams {
  search?: string;
  universityId?: string;
  clubId?: string;
  type?: "all" | "picture" | "event";
  tag?: "all" | "tagged" | "untagged";
  reports?: "all" | "reported";
  dateFrom?: string;
  dateTo?: string;
  sort?: "created_at";
  dir?: "asc" | "desc";
  page?: number;
}

export async function listPosts(params: ListPostsParams = {}): Promise<Paginated<AdminPostRow>> {
  await requireSecureAdmin();
  const admin = createAdminClient();

  const page = Math.max(1, params.page ?? 1);
  const dir = params.dir ?? "desc";
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  const search = params.search?.trim();

  let q = admin
    .from("posts")
    .select("id, author_id, club_id, post_type, image_url, caption, created_at", { count: "exact" });

  if (params.clubId) q = q.eq("club_id", params.clubId);
  if (params.type === "picture" || params.type === "event") q = q.eq("post_type", params.type);
  if (params.tag === "tagged") q = q.not("club_id", "is", null);
  if (params.tag === "untagged") q = q.is("club_id", null);
  if (params.dateFrom) q = q.gte("created_at", params.dateFrom);
  if (params.dateTo) q = q.lte("created_at", params.dateTo);

  if (params.reports === "reported") {
    const ids = await allReportedPostIds(admin);
    if (ids.length === 0) return { rows: [], total: 0, page, pageSize: PAGE_SIZE };
    q = q.in("id", ids);
  }

  if (params.universityId) {
    const { clubIds, authorIds } = await universityScope(admin, params.universityId);
    const parts: string[] = [];
    if (clubIds.length) parts.push(`club_id.in.${fmtIds(clubIds)}`);
    if (authorIds.length) parts.push(`author_id.in.${fmtIds(authorIds)}`);
    if (parts.length === 0) return { rows: [], total: 0, page, pageSize: PAGE_SIZE };
    q = q.or(parts.join(","));
  }

  if (search) {
    const like = `%${search}%`;
    const isEmail = search.includes("@");
    const [{ data: authors }, { data: clubs }] = await Promise.all([
      admin.from("profiles").select("id").or(`full_name.ilike.${like},username.ilike.${like}`).limit(500),
      admin.from("clubs").select("id").or(`name.ilike.${like},handle.ilike.${like}`).limit(500),
    ]);
    let emailAuthorIds: string[] = [];
    if (isEmail) emailAuthorIds = await findAuthorIdsByEmail(admin, search);
    const authorIds = Array.from(
      new Set([...(authors ?? []).map((a: any) => a.id), ...emailAuthorIds])
    );
    const clubIds = (clubs ?? []).map((c: any) => c.id);
    const parts: string[] = [];
    if (!isEmail) parts.push(`caption.ilike.${like}`);
    if (authorIds.length) parts.push(`author_id.in.${fmtIds(authorIds)}`);
    if (clubIds.length) parts.push(`club_id.in.${fmtIds(clubIds)}`);
    if (parts.length === 0) return { rows: [], total: 0, page, pageSize: PAGE_SIZE };
    q = q.or(parts.join(","));
  }

  q = q.order("created_at", { ascending: dir === "asc" }).range(from, to);
  const { data, count, error } = await q;
  if (error) throw error;

  const posts = (data ?? []) as any[];
  const ids = posts.map((p) => p.id);
  const authorIds = posts.map((p) => p.author_id);
  const clubIds = posts.map((p) => p.club_id).filter(Boolean) as string[];

  const [emails, authorMap, clubMap, comments, likes, reports] = await Promise.all([
    emailMap(authorIds),
    profileMap(admin, authorIds),
    clubMap_(admin, clubIds),
    childCounts(admin, "post_comments", "post_id", ids),
    childCounts(admin, "post_likes", "post_id", ids),
    postReportCounts(admin, ids),
  ]);

  const uniIds = [
    ...clubIds.map((id) => clubMap.get(id)?.university_id),
    ...authorIds.map((id) => authorMap.get(id)?.university_id),
  ].filter(Boolean) as string[];
  const uniMap = await universityNameMap(admin, uniIds);

  const rows: AdminPostRow[] = posts.map((p) => {
    const club = p.club_id ? clubMap.get(p.club_id) : null;
    const author = authorMap.get(p.author_id);
    const uniId = club?.university_id ?? author?.university_id ?? null;
    return {
      id: p.id,
      caption: captionPreview(p.caption),
      post_type: p.post_type,
      image_url: p.image_url ?? null,
      author_id: p.author_id,
      author_name: author?.full_name ?? "",
      author_username: author?.username ?? "",
      author_email: emails.get(p.author_id) ?? null,
      club_id: p.club_id ?? null,
      club_name: club?.name ?? null,
      club_handle: club?.handle ?? null,
      university: uniId ? uniMap.get(uniId) ?? null : null,
      media_count: p.image_url ? 1 : 0,
      comment_count: comments.get(p.id) ?? 0,
      like_count: likes.get(p.id) ?? 0,
      report_count: reports.get(p.id) ?? 0,
      created_at: p.created_at,
    };
  });

  return { rows, total: count ?? rows.length, page, pageSize: PAGE_SIZE };
}

// ── Small shared helpers ──────────────────────────────────────────────────────

async function findAuthorIdsByEmail(
  admin: ReturnType<typeof createAdminClient>,
  query: string,
  cap = 2000
): Promise<string[]> {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const perPage = 200;
  const ids: string[] = [];
  let page = 1;
  let scanned = 0;
  while (scanned < cap) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error || !data?.users?.length) break;
    for (const u of data.users) if (u.email && u.email.toLowerCase().includes(needle)) ids.push(u.id);
    scanned += data.users.length;
    if (data.users.length < perPage) break;
    page += 1;
  }
  return ids;
}

async function profileMap(
  admin: ReturnType<typeof createAdminClient>,
  ids: string[]
): Promise<Map<string, any>> {
  const map = new Map<string, any>();
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (unique.length === 0) return map;
  const { data } = await admin
    .from("profiles")
    .select("id, full_name, username, avatar_url, university_id")
    .in("id", unique);
  for (const p of (data ?? []) as any[]) map.set(p.id, p);
  return map;
}

async function clubMap_(
  admin: ReturnType<typeof createAdminClient>,
  ids: string[]
): Promise<Map<string, any>> {
  const map = new Map<string, any>();
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (unique.length === 0) return map;
  const { data } = await admin
    .from("clubs")
    .select("id, name, handle, avatar_url, university_id")
    .in("id", unique);
  for (const c of (data ?? []) as any[]) map.set(c.id, c);
  return map;
}

/** Batched child-row counts keyed by a parent id column (e.g. comments/likes per post). */
async function childCounts(
  admin: ReturnType<typeof createAdminClient>,
  table: string,
  parentCol: string,
  parentIds: string[]
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (parentIds.length === 0) return map;
  const { data } = await admin.from(table).select(parentCol).in(parentCol, parentIds);
  for (const r of (data ?? []) as any[]) {
    const key = r[parentCol];
    if (key) map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
}

// ── Post detail ────────────────────────────────────────────────────────────────

export interface PostComment {
  id: string;
  content: string;
  user_id: string;
  full_name: string;
  username: string;
  avatar_url: string | null;
  created_at: string;
}

export interface PostReport {
  id: string;
  reason: string | null;
  details: string | null;
  status: string;
  reporter_username: string | null;
  created_at: string;
}

export interface PostTag {
  club_id: string;
  name: string;
  handle: string;
  primary: boolean;
}

export interface PostDetail {
  id: string;
  caption: string | null;
  post_type: string;
  image_url: string | null;
  linked_event_id: string | null;
  author_id: string;
  author_name: string;
  author_username: string;
  author_email: string | null;
  author_avatar: string | null;
  university: string | null;
  created_at: string;
  tags: PostTag[];
  likeCount: number;
  commentCount: number;
  reportCount: number;
  comments: PostComment[];
  reports: PostReport[];
}

export async function getPostDetail(id: string): Promise<PostDetail | null> {
  await requireSecureAdmin();
  const admin = createAdminClient();

  const { data: post } = await admin
    .from("posts")
    .select("id, author_id, club_id, post_type, image_url, caption, linked_event_id, created_at")
    .eq("id", id)
    .maybeSingle();
  if (!post) return null;
  const p = post as any;

  const [authorMap, extraTagsRes, commentsRes, reportsRes, likeCount, commentCount, reportCount] =
    await Promise.all([
      profileMap(admin, [p.author_id]),
      admin.from("post_club_tags").select("club_id").eq("post_id", id),
      admin
        .from("post_comments")
        .select("id, content, user_id, created_at, profiles!inner(full_name, username, avatar_url)")
        .eq("post_id", id)
        .order("created_at", { ascending: true })
        .limit(200),
      admin
        .from("reports")
        .select("id, reason, details, status, reporter_username, created_at")
        .eq("entity_type", "post")
        .eq("entity_id", id)
        .order("created_at", { ascending: false }),
      admin.from("post_likes").select("id", { count: "exact", head: true }).eq("post_id", id),
      admin.from("post_comments").select("id", { count: "exact", head: true }).eq("post_id", id),
      admin.from("reports").select("id", { count: "exact", head: true }).eq("entity_type", "post").eq("entity_id", id),
    ]);

  const author = authorMap.get(p.author_id);
  const emails = await emailMap([p.author_id]);

  // Tag set: primary club_id + any post_club_tags rows.
  const tagClubIds = Array.from(
    new Set([
      ...(p.club_id ? [p.club_id] : []),
      ...((extraTagsRes.data ?? []) as any[]).map((t) => t.club_id).filter(Boolean),
    ])
  );
  const clubMap = await clubMap_(admin, tagClubIds);
  const tags: PostTag[] = tagClubIds.map((cid) => ({
    club_id: cid,
    name: clubMap.get(cid)?.name ?? "",
    handle: clubMap.get(cid)?.handle ?? "",
    primary: cid === p.club_id,
  }));

  const uniId = (p.club_id ? clubMap.get(p.club_id)?.university_id : null) ?? author?.university_id ?? null;
  const uniName = uniId ? (await universityNameMap(admin, [uniId])).get(uniId) ?? null : null;

  return {
    id: p.id,
    caption: p.caption ?? null,
    post_type: p.post_type,
    image_url: p.image_url ?? null,
    linked_event_id: p.linked_event_id ?? null,
    author_id: p.author_id,
    author_name: author?.full_name ?? "",
    author_username: author?.username ?? "",
    author_email: emails.get(p.author_id) ?? null,
    author_avatar: author?.avatar_url ?? null,
    university: uniName,
    created_at: p.created_at,
    tags,
    likeCount: likeCount.count ?? 0,
    commentCount: commentCount.count ?? 0,
    reportCount: reportCount.count ?? 0,
    comments: ((commentsRes.data ?? []) as any[]).map((c) => ({
      id: c.id,
      content: c.content,
      user_id: c.user_id,
      full_name: c.profiles?.full_name ?? "",
      username: c.profiles?.username ?? "",
      avatar_url: c.profiles?.avatar_url ?? null,
      created_at: c.created_at,
    })),
    reports: ((reportsRes.data ?? []) as any[]).map((r) => ({
      id: r.id,
      reason: r.reason ?? null,
      details: r.details ?? null,
      status: r.status,
      reporter_username: r.reporter_username ?? null,
      created_at: r.created_at,
    })),
  };
}

// ── Comments list ────────────────────────────────────────────────────────────

export interface AdminCommentRow {
  id: string;
  content: string;
  user_id: string;
  author_name: string;
  author_username: string;
  author_email: string | null;
  avatar_url: string | null;
  post_id: string;
  post_caption: string | null;
  club_id: string | null;
  club_name: string | null;
  university: string | null;
  created_at: string;
}

export interface ListCommentsParams {
  search?: string;
  universityId?: string;
  clubId?: string;
  postId?: string;
  dateFrom?: string;
  dateTo?: string;
  sort?: "created_at";
  dir?: "asc" | "desc";
  page?: number;
}

export async function listComments(params: ListCommentsParams = {}): Promise<Paginated<AdminCommentRow>> {
  await requireSecureAdmin();
  const admin = createAdminClient();

  const page = Math.max(1, params.page ?? 1);
  const dir = params.dir ?? "desc";
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  const search = params.search?.trim();

  let q = admin
    .from("post_comments")
    .select("id, content, user_id, post_id, created_at", { count: "exact" });

  if (params.postId) q = q.eq("post_id", params.postId);
  if (params.dateFrom) q = q.gte("created_at", params.dateFrom);
  if (params.dateTo) q = q.lte("created_at", params.dateTo);

  // Club / university filters resolve to a set of parent post ids.
  if (params.clubId || params.universityId) {
    let postQ = admin.from("posts").select("id");
    if (params.clubId) postQ = postQ.eq("club_id", params.clubId);
    if (params.universityId) {
      const { clubIds } = await universityScope(admin, params.universityId);
      if (clubIds.length === 0) return { rows: [], total: 0, page, pageSize: PAGE_SIZE };
      postQ = postQ.in("club_id", clubIds);
    }
    const { data: scopedPosts } = await postQ.limit(5000);
    const postIds = (scopedPosts ?? []).map((r: any) => r.id);
    if (postIds.length === 0) return { rows: [], total: 0, page, pageSize: PAGE_SIZE };
    q = q.in("post_id", postIds);
  }

  if (search) {
    const like = `%${search}%`;
    const isEmail = search.includes("@");
    const authorIds = isEmail
      ? await findAuthorIdsByEmail(admin, search)
      : ((await admin.from("profiles").select("id").or(`full_name.ilike.${like},username.ilike.${like}`).limit(500)).data ?? []).map((a: any) => a.id);
    const parts: string[] = [];
    if (!isEmail) parts.push(`content.ilike.${like}`);
    if (authorIds.length) parts.push(`user_id.in.${fmtIds(authorIds)}`);
    if (parts.length === 0) return { rows: [], total: 0, page, pageSize: PAGE_SIZE };
    q = q.or(parts.join(","));
  }

  q = q.order("created_at", { ascending: dir === "asc" }).range(from, to);
  const { data, count, error } = await q;
  if (error) throw error;

  const comments = (data ?? []) as any[];
  const userIds = comments.map((c) => c.user_id);
  const postIds = Array.from(new Set(comments.map((c) => c.post_id)));

  const [emails, authorMap, posts] = await Promise.all([
    emailMap(userIds),
    profileMap(admin, userIds),
    postMap(admin, postIds),
  ]);
  const clubIds = Array.from(new Set([...posts.values()].map((p) => p.club_id).filter(Boolean))) as string[];
  const clubMap = await clubMap_(admin, clubIds);
  const uniIds = [...clubMap.values()].map((c) => c.university_id).filter(Boolean) as string[];
  const uniMap = await universityNameMap(admin, uniIds);

  const rows: AdminCommentRow[] = comments.map((c) => {
    const author = authorMap.get(c.user_id);
    const post = posts.get(c.post_id);
    const club = post?.club_id ? clubMap.get(post.club_id) : null;
    const uniId = club?.university_id ?? null;
    return {
      id: c.id,
      content: c.content,
      user_id: c.user_id,
      author_name: author?.full_name ?? "",
      author_username: author?.username ?? "",
      author_email: emails.get(c.user_id) ?? null,
      avatar_url: author?.avatar_url ?? null,
      post_id: c.post_id,
      post_caption: captionPreview(post?.caption ?? null, 80),
      club_id: post?.club_id ?? null,
      club_name: club?.name ?? null,
      university: uniId ? uniMap.get(uniId) ?? null : null,
      created_at: c.created_at,
    };
  });

  return { rows, total: count ?? rows.length, page, pageSize: PAGE_SIZE };
}

async function postMap(
  admin: ReturnType<typeof createAdminClient>,
  ids: string[]
): Promise<Map<string, any>> {
  const map = new Map<string, any>();
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (unique.length === 0) return map;
  const { data } = await admin.from("posts").select("id, caption, club_id, author_id").in("id", unique);
  for (const p of (data ?? []) as any[]) map.set(p.id, p);
  return map;
}

// ── Comment detail ────────────────────────────────────────────────────────────

export interface CommentDetail {
  id: string;
  content: string;
  user_id: string;
  author_name: string;
  author_username: string;
  author_email: string | null;
  avatar_url: string | null;
  created_at: string;
  post_id: string;
  post_caption: string | null;
  post_type: string | null;
  club_id: string | null;
  club_name: string | null;
  club_handle: string | null;
  university: string | null;
}

export async function getCommentDetail(id: string): Promise<CommentDetail | null> {
  await requireSecureAdmin();
  const admin = createAdminClient();

  const { data: comment } = await admin
    .from("post_comments")
    .select("id, content, user_id, post_id, created_at")
    .eq("id", id)
    .maybeSingle();
  if (!comment) return null;
  const c = comment as any;

  const [authorMap, postRes, emails] = await Promise.all([
    profileMap(admin, [c.user_id]),
    admin.from("posts").select("id, caption, club_id, post_type").eq("id", c.post_id).maybeSingle(),
    emailMap([c.user_id]),
  ]);
  const author = authorMap.get(c.user_id);
  const post = postRes.data as any;
  const club = post?.club_id ? (await clubMap_(admin, [post.club_id])).get(post.club_id) : null;
  const uniId = club?.university_id ?? null;
  const uniName = uniId ? (await universityNameMap(admin, [uniId])).get(uniId) ?? null : null;

  return {
    id: c.id,
    content: c.content,
    user_id: c.user_id,
    author_name: author?.full_name ?? "",
    author_username: author?.username ?? "",
    author_email: emails.get(c.user_id) ?? null,
    avatar_url: author?.avatar_url ?? null,
    created_at: c.created_at,
    post_id: c.post_id,
    post_caption: captionPreview(post?.caption ?? null, 120),
    post_type: post?.post_type ?? null,
    club_id: post?.club_id ?? null,
    club_name: club?.name ?? null,
    club_handle: club?.handle ?? null,
    university: uniName,
  };
}
