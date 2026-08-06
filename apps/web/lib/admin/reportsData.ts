// ============================================================================
// Admin Dashboard — Day-5 moderation: canonical Reports read access (SERVER-ONLY)
// ============================================================================
// Same contract as data.ts / contentData.ts / messagingData.ts:
//   requireSecureAdmin() FIRST, then read through the service-role client;
//   Lists expose workflow metadata only; report detail may expose retained
//   evidence to the already-authorized founder through a server-rendered path.
//
// CANONICAL SOURCE OF TRUTH — the `reports` table (migrations 033 + 038 + 040):
//   id, reporter_id (→profiles SET NULL), reporter_username, reporter_email,
//   entity_type IN ('club','event','post','user','message','chat'), entity_id,
//   entity_name, club_id (→clubs SET NULL), reason, details,
//   status IN ('pending','reviewing','resolved','dismissed'),
//   created_at,
//   email_sent_at, email_error                                     (038 bookkeeping)
//   message_id, conversation_id, conversation_type, message_type,
//   message_sender_id,
//   content_snapshot / attachment_snapshot are legacy columns only. Day 10F
//   moves message evidence into private.report_message_evidence.
//
// The schema has NO updated_at / resolved_at / assigned_to / reviewed_by /
// moderation_notes columns. Those features are therefore reported HONESTLY as
// "not recorded in the current schema" — never faked, and NOT added here (a new
// migration outside the approved Day 10F scope would require a separate
// reviewed migration).
//
// EVIDENCE PRIVACY INVARIANTS (Day 10F, non-negotiable):
//   • Message evidence is read only from private.report_message_evidence, never
//     the student-readable reports row.
//   • A valid private gateway, AAL2, recent MFA, and a successful durable audit
//     are required before this loader selects a body or issues a signed URL.
//   • Lists expose only an existence flag; unavailable/expired/purged evidence
//     remains an honest unavailable state.
// ============================================================================

if (typeof window !== "undefined") {
  throw new Error("lib/admin/reportsData.ts is server-only and must not be imported in the browser.");
}

import { createAdminClient } from "../supabase/admin";
import { requireRecentMfa, requireSecureAdmin } from "./secureAdmin";
import { randomUUID } from "crypto";
import { emailMap, universityNameMap, PAGE_SIZE } from "./data";
import type { Paginated } from "./data";

type Admin = ReturnType<typeof createAdminClient>;

function fmtIds(ids: string[]): string {
  return `(${ids.join(",")})`;
}

function preview(text: string | null, len = 100): string | null {
  if (!text) return null;
  const t = text.trim();
  if (!t) return null;
  return t.length > len ? `${t.slice(0, len)}…` : t;
}

// ── Canonical status model + transitions ─────────────────────────────────────

/** The ONLY report statuses the production CHECK constraint permits. */
export const REPORT_STATUSES = ["pending", "reviewing", "resolved", "dismissed"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

/**
 * Canonical safe status transitions. Every admin moderation action is validated
 * against the report's CURRENT status using this map — an unlisted transition is
 * rejected before any write. There are no invented statuses.
 *
 *   pending    → reviewing (under review) | resolved | dismissed
 *   reviewing  → resolved | dismissed | pending (send back to queue)
 *   resolved   → pending (reopen)
 *   dismissed  → pending (reopen)
 */
export const REPORT_TRANSITIONS: Record<ReportStatus, ReportStatus[]> = {
  pending: ["reviewing", "resolved", "dismissed"],
  reviewing: [],
  resolved: [],
  dismissed: [],
};

export function isReportStatus(v: unknown): v is ReportStatus {
  return typeof v === "string" && (REPORT_STATUSES as readonly string[]).includes(v);
}

export function canTransition(from: string, to: string): boolean {
  if (!isReportStatus(from) || !isReportStatus(to)) return false;
  return REPORT_TRANSITIONS[from].includes(to);
}

// The canonical report target entity types (from the CHECK constraint). Comments
// are intentionally absent — they are reported via their parent post.
export const REPORT_ENTITY_TYPES = ["club", "event", "post", "user", "message", "chat"] as const;
export type ReportEntityType = (typeof REPORT_ENTITY_TYPES)[number];

const ENTITY_TYPE_LABEL: Record<string, string> = {
  club: "Club",
  event: "Event",
  post: "Post",
  user: "User",
  message: "Message",
  chat: "Conversation",
};

export function reportEntityTypeLabel(type: string): string {
  return ENTITY_TYPE_LABEL[type] ?? type;
}

// ── Small shared lookup maps ─────────────────────────────────────────────────

async function profileMap(admin: Admin, ids: (string | null)[]): Promise<Map<string, any>> {
  const map = new Map<string, any>();
  const unique = Array.from(new Set(ids.filter(Boolean))) as string[];
  if (unique.length === 0) return map;
  const { data } = await admin.from("profiles").select("id, full_name, username, avatar_url, university_id").in("id", unique);
  for (const p of (data ?? []) as any[]) map.set(p.id, p);
  return map;
}

async function clubMap(admin: Admin, ids: (string | null)[]): Promise<Map<string, any>> {
  const map = new Map<string, any>();
  const unique = Array.from(new Set(ids.filter(Boolean))) as string[];
  if (unique.length === 0) return map;
  const { data } = await admin.from("clubs").select("id, name, handle, university_id").in("id", unique);
  for (const c of (data ?? []) as any[]) map.set(c.id, c);
  return map;
}

async function findUserIdsByEmail(admin: Admin, query: string, cap = 2000): Promise<string[]> {
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

/**
 * Resolve human-readable target labels + safe admin links for a batch of reports
 * (one query per referenced entity table). NEVER reads message content — a
 * message target links to its conversation only.
 */
async function resolveTargets(
  admin: Admin,
  reports: any[]
): Promise<Map<string, { label: string; href: string | null; subjectUserId: string | null }>> {
  const out = new Map<string, { label: string; href: string | null; subjectUserId: string | null }>();

  const byType = (t: string) => reports.filter((r) => r.entity_type === t && r.entity_id).map((r) => r.entity_id);
  const [clubs, events, posts, users] = await Promise.all([
    (async () => {
      const ids = Array.from(new Set(byType("club")));
      if (!ids.length) return new Map<string, any>();
      const { data } = await admin.from("clubs").select("id, name, handle").in("id", ids);
      return new Map((data ?? []).map((c: any) => [c.id, c]));
    })(),
    (async () => {
      const ids = Array.from(new Set(byType("event")));
      if (!ids.length) return new Map<string, any>();
      const { data } = await admin.from("events").select("id, title, created_by").in("id", ids);
      return new Map((data ?? []).map((e: any) => [e.id, e]));
    })(),
    (async () => {
      const ids = Array.from(new Set(byType("post")));
      if (!ids.length) return new Map<string, any>();
      const { data } = await admin.from("posts").select("id, caption, post_type, author_id").in("id", ids);
      return new Map((data ?? []).map((p: any) => [p.id, p]));
    })(),
    (async () => {
      const ids = Array.from(new Set(byType("user")));
      if (!ids.length) return new Map<string, any>();
      const { data } = await admin.from("profiles").select("id, full_name, username").in("id", ids);
      return new Map((data ?? []).map((p: any) => [p.id, p]));
    })(),
  ]);

  for (const r of reports) {
    const t = r.entity_type as string;
    const id = r.entity_id as string | null;
    const fallback = r.entity_name || `${reportEntityTypeLabel(t)}${id ? "" : " (no target id)"}`;
    let label = fallback;
    let href: string | null = null;
    let subjectUserId: string | null = null;

    if (t === "club" && id) {
      const c = clubs.get(id);
      label = c ? `${c.name}` : r.entity_name || "Club (deleted)";
      href = `/admin/clubs/${id}`;
    } else if (t === "event" && id) {
      const e = events.get(id);
      label = e ? e.title : r.entity_name || "Event (deleted)";
      href = `/admin/events/${id}`;
      subjectUserId = e?.created_by ?? null;
    } else if (t === "post" && id) {
      const p = posts.get(id);
      label = p ? preview(p.caption, 60) || `${p.post_type === "event" ? "Event" : "Picture"} post` : r.entity_name || "Post (deleted)";
      href = `/admin/posts/${id}`;
      subjectUserId = p?.author_id ?? null;
    } else if (t === "user" && id) {
      const u = users.get(id);
      label = u ? `${u.full_name || u.username} (@${u.username})` : r.entity_name || "User (deleted)";
      href = `/admin/users/${id}`;
      subjectUserId = id;
    } else if (t === "message") {
      // Never expose the message body — link to the conversation thread only.
      label = r.entity_name || "Reported message";
      href = r.conversation_id ? `/admin/conversations/${r.conversation_id}` : null;
      subjectUserId = r.message_sender_id ?? null;
    } else if (t === "chat") {
      label = r.entity_name || "Reported conversation";
      href = id ? `/admin/conversations/${id}` : r.conversation_id ? `/admin/conversations/${r.conversation_id}` : null;
    }

    out.set(r.id, { label, href, subjectUserId });
  }
  return out;
}

// ── Filter option loaders ────────────────────────────────────────────────────

/** Distinct non-empty report reasons (bounded scan) for the reason filter. */
export async function listReportReasons(): Promise<string[]> {
  await requireSecureAdmin();
  const admin = createAdminClient();
  const { data } = await admin.from("reports").select("reason").not("reason", "is", null).limit(5000);
  const set = new Set<string>();
  for (const r of (data ?? []) as any[]) {
    const v = (r.reason ?? "").trim();
    if (v) set.add(v);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

// ── Reports list ─────────────────────────────────────────────────────────────

export interface AdminReportRow {
  id: string;
  status: ReportStatus;
  entity_type: string;
  entity_type_label: string;
  entity_id: string | null;
  target_label: string;
  target_href: string | null;
  reason: string | null;
  reporter_id: string | null;
  reporter_username: string | null;
  reporter_email: string | null;
  reported_user_id: string | null;
  reported_username: string | null;
  club_id: string | null;
  club_name: string | null;
  university: string | null;
  /** True when this report retains protected evidence (never the evidence itself). */
  has_protected_evidence: boolean;
  /** Email delivery bookkeeping — a safe operational signal, not evidence. */
  email_delivered: boolean;
  created_at: string;
  /** Number of OTHER reports that share this same target (grouping signal). */
  related_count: number;
  resolution_outcome: string | null;
  enforcement_action: string | null;
  enforcement_status: string | null;
  decision_at: string | null;
}

export interface ListReportsParams {
  search?: string;
  searchField?: "any" | "reporter" | "reported" | "target";
  status?: "all" | ReportStatus | "open";
  entityType?: "all" | ReportEntityType;
  /** Filter to a specific target entity (used by Entity → filtered Reports nav). */
  entityId?: string;
  reason?: string;
  clubId?: string;
  universityId?: string;
  dateFrom?: string;
  dateTo?: string;
  sort?: "created_at";
  dir?: "asc" | "desc";
  page?: number;
}

const SAFE_LIST_COLUMNS =
  "id, status, entity_type, entity_id, entity_name, reason, reporter_id, reporter_username, reporter_email, message_sender_id, message_id, conversation_id, conversation_type, message_type, club_id, email_sent_at, created_at";

export async function listReports(params: ListReportsParams = {}): Promise<Paginated<AdminReportRow>> {
  await requireSecureAdmin();
  const admin = createAdminClient();

  const page = Math.max(1, params.page ?? 1);
  const dir = params.dir ?? "desc";
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  const search = params.search?.trim();
  const field = params.searchField ?? "any";

  let q = admin.from("reports").select(SAFE_LIST_COLUMNS, { count: "exact" });

  // Status filter (with an "open" convenience = pending + reviewing).
  if (params.status === "open") q = q.in("status", ["pending", "reviewing"]);
  else if (params.status && params.status !== "all") q = q.eq("status", params.status);

  if (params.entityType && params.entityType !== "all") q = q.eq("entity_type", params.entityType);
  if (params.entityId) q = q.eq("entity_id", params.entityId);
  if (params.reason) q = q.eq("reason", params.reason);
  if (params.clubId) q = q.eq("club_id", params.clubId);
  if (params.dateFrom) q = q.gte("created_at", params.dateFrom);
  if (params.dateTo) q = q.lte("created_at", params.dateTo);

  // University → the report's related club's university (documented scope).
  if (params.universityId) {
    const { data: clubs } = await admin.from("clubs").select("id").eq("university_id", params.universityId).limit(2000);
    const clubIds = (clubs ?? []).map((c: any) => c.id);
    if (clubIds.length === 0) return { rows: [], total: 0, page, pageSize: PAGE_SIZE };
    q = q.in("club_id", clubIds);
  }

  // Search across reporter, reported subject, and target — never message content.
  if (search) {
    const like = `%${search}%`;
    const isEmail = search.includes("@");
    const parts: string[] = [];
    // Report IDs are safe structural identifiers and are useful when following
    // an audit or support escalation.
    parts.push(`id.ilike.${like}`);

    // Reporter matches: username / email(→reporter_id) / reporter_email column.
    if (field === "any" || field === "reporter") {
      if (!isEmail) parts.push(`reporter_username.ilike.${like}`);
      parts.push(`reporter_email.ilike.${like}`);
      if (isEmail) {
        const ids = await findUserIdsByEmail(admin, search);
        if (ids.length) parts.push(`reporter_id.in.${fmtIds(ids)}`);
      }
    }

    // Reported subject: matched user ids → entity_id (user reports) OR
    // message_sender_id (message reports).
    if (field === "any" || field === "reported") {
      const uids = isEmail
        ? await findUserIdsByEmail(admin, search)
        : ((await admin.from("profiles").select("id").or(`full_name.ilike.${like},username.ilike.${like}`).limit(500)).data ?? []).map(
            (p: any) => p.id
          );
      if (uids.length) {
        parts.push(`message_sender_id.in.${fmtIds(uids)}`);
        parts.push(`entity_id.in.${fmtIds(uids)}`);
      }
    }

    // Target: stored entity_name, or entity_id sets resolved from clubs/events/posts.
    if (field === "any" || field === "target") {
      if (!isEmail) parts.push(`entity_name.ilike.${like}`);
      const [{ data: clubs }, { data: events }, { data: posts }] = await Promise.all([
        admin.from("clubs").select("id").or(`name.ilike.${like},handle.ilike.${like}`).limit(300),
        isEmail ? Promise.resolve({ data: [] as any[] }) : admin.from("events").select("id").ilike("title", like).limit(300),
        isEmail ? Promise.resolve({ data: [] as any[] }) : admin.from("posts").select("id").ilike("caption", like).limit(300),
      ]);
      const targetIds = [
        ...(clubs ?? []).map((c: any) => c.id),
        ...(events ?? []).map((e: any) => e.id),
        ...(posts ?? []).map((p: any) => p.id),
      ];
      if (targetIds.length) parts.push(`entity_id.in.${fmtIds(targetIds)}`);
    }

    if (parts.length === 0) return { rows: [], total: 0, page, pageSize: PAGE_SIZE };
    q = q.or(parts.join(","));
  }

  q = q.order("created_at", { ascending: dir === "asc" }).range(from, to);
  const { data, count, error } = await q;
  if (error) throw error;

  const reports = (data ?? []) as any[];
  if (reports.length === 0) return { rows: [], total: count ?? 0, page, pageSize: PAGE_SIZE };

  const reporterIds = reports.map((r) => r.reporter_id).filter(Boolean) as string[];
  const subjectIds = reports.map((r) => (r.entity_type === "user" ? r.entity_id : r.message_sender_id)).filter(Boolean) as string[];
  const clubIds = reports.map((r) => r.club_id).filter(Boolean) as string[];

  const [reporters, subjects, clubs, targets, relatedCounts, hasEvidence, decisions] = await Promise.all([
    profileMap(admin, reporterIds),
    profileMap(admin, subjectIds),
    clubMap(admin, clubIds),
    resolveTargets(admin, reports),
    relatedTargetCounts(admin, reports),
    protectedEvidenceFlags(admin, reports.map((r) => r.id)),
    latestDecisionMap(admin, reports.map((r) => r.id)),
  ]);

  const uniIds = [...clubs.values()].map((c) => c.university_id).filter(Boolean) as string[];
  const uniMap = await universityNameMap(admin, uniIds);
  const reporterEmails = await emailMap(reporterIds);
  const ownerIds = reports.map((r) => targets.get(r.id)?.subjectUserId).filter(Boolean) as string[];
  const owners = await profileMap(admin, ownerIds);

  const rows: AdminReportRow[] = reports.map((r) => {
    const club = r.club_id ? clubs.get(r.club_id) : null;
    const target = targets.get(r.id);
    const subjectId = r.entity_type === "user" ? r.entity_id : r.message_sender_id ?? target?.subjectUserId;
    const subject = subjectId ? subjects.get(subjectId) ?? owners.get(subjectId) : null;
    const decision = decisions.get(r.id);
    return {
      id: r.id,
      status: r.status,
      entity_type: r.entity_type,
      entity_type_label: reportEntityTypeLabel(r.entity_type),
      entity_id: r.entity_id ?? null,
      target_label: target?.label ?? r.entity_name ?? reportEntityTypeLabel(r.entity_type),
      target_href: target?.href ?? null,
      reason: r.reason ?? null,
      reporter_id: r.reporter_id ?? null,
      reporter_username: r.reporter_username ?? null,
      reporter_email: r.reporter_email ?? reporterEmails.get(r.reporter_id) ?? null,
      reported_user_id: subjectId ?? null,
      reported_username: subject?.username ?? null,
      club_id: r.club_id ?? null,
      club_name: club?.name ?? null,
      university: club?.university_id ? uniMap.get(club.university_id) ?? null : null,
      has_protected_evidence: hasEvidence.get(r.id) ?? false,
      email_delivered: !!r.email_sent_at,
      created_at: r.created_at,
      related_count: relatedCounts.get(r.id) ?? 0,
      resolution_outcome: decision?.resolution_outcome ?? null,
      enforcement_action: decision?.enforcement_action ?? null,
      enforcement_status: decision?.enforcement_status ?? null,
      decision_at: decision?.created_at ?? null,
    };
  });

  return { rows, total: count ?? rows.length, page, pageSize: PAGE_SIZE };
}

/**
 * Count OTHER reports sharing the same (entity_type, entity_id) target — a
 * grouped-report signal — without ever loading their content.
 */
async function relatedTargetCounts(admin: Admin, reports: any[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const targeted = reports.filter((r) => r.entity_id);
  if (targeted.length === 0) return map;
  const ids = Array.from(new Set(targeted.map((r) => r.entity_id)));
  const { data } = await admin.from("reports").select("id, entity_type, entity_id").in("entity_id", ids).limit(5000);
  const buckets = new Map<string, string[]>();
  for (const r of (data ?? []) as any[]) {
    const key = `${r.entity_type}:${r.entity_id}`;
    const arr = buckets.get(key) ?? [];
    arr.push(r.id);
    buckets.set(key, arr);
  }
  for (const r of targeted) {
    const key = `${r.entity_type}:${r.entity_id}`;
    const all = buckets.get(key) ?? [];
    map.set(r.id, Math.max(0, all.length - 1));
  }
  return map;
}

/**
 * Which reports RETAIN protected evidence — WITHOUT reading the evidence. We
 * only read whether a private evidence row exists. The snapshot text and
 * attachment path are never selected on list paths.
 */
async function protectedEvidenceFlags(admin: Admin, reportIds: string[]): Promise<Map<string, boolean>> {
  const map = new Map<string, boolean>();
  if (reportIds.length === 0) return map;
  const { data } = await admin
    .schema("private")
    .from("report_message_evidence")
    .select("report_id")
    .in("report_id", reportIds);
  for (const r of (data ?? []) as any[]) map.set(r.report_id, true);
  return map;
}

async function latestDecisionMap(admin: Admin, reportIds: string[]): Promise<Map<string, any>> {
  const map = new Map<string, any>();
  if (reportIds.length === 0) return map;
  const { data } = await admin
    .from("report_decision_history")
    .select("id, report_id, sequence_no, new_status, resolution_outcome, enforcement_action, enforcement_status, created_at")
    .in("report_id", reportIds)
    .order("sequence_no", { ascending: false });
  for (const row of (data ?? []) as any[]) if (!map.has(row.report_id)) map.set(row.report_id, row);
  return map;
}

// ── Report detail ────────────────────────────────────────────────────────────

export interface RelatedReport {
  id: string;
  status: ReportStatus;
  reason: string | null;
  reporter_username: string | null;
  created_at: string;
}

export interface ReportDetail {
  id: string;
  status: ReportStatus;
  entity_type: string;
  entity_type_label: string;
  entity_id: string | null;
  reason: string | null;
  details: string | null;
  created_at: string;
  // Reporter
  reporter_id: string | null;
  reporter_name: string | null;
  reporter_username: string | null;
  reporter_email: string | null;
  reporter_avatar: string | null;
  reporter_exists: boolean;
  // Reported subject (user / message sender), where applicable
  reported_user_id: string | null;
  reported_name: string | null;
  reported_username: string | null;
  reported_avatar: string | null;
  // Target
  target_label: string;
  target_href: string | null;
  // Related context
  club_id: string | null;
  club_name: string | null;
  club_handle: string | null;
  university: string | null;
  // Message/chat safe workflow metadata (NEVER the body/attachment/snapshot)
  message: {
    message_id: string | null;
    conversation_id: string | null;
    conversation_type: string | null;
    message_type: string | null;
    conversation_href: string | null;
    /** True when snapshot columns are populated (availability signal only). */
    has_retained_evidence: boolean;
  } | null;
  // Email delivery bookkeeping (operational, not evidence)
  email_delivered: boolean;
  email_error: string | null;
  // Valid next statuses from the current state
  allowedTransitions: ReportStatus[];
  // Grouped reports for the same target
  relatedReports: RelatedReport[];
  decisions: Array<{
    id: string;
    previous_status: string;
    new_status: string;
    resolution_outcome: string;
    internal_decision_note: string;
    public_category: string | null;
    public_explanation: string | null;
    enforcement_action: string;
    enforcement_target_type: string | null;
    enforcement_target_id: string | null;
    enforcement_status: string;
    notification_status: string;
    actor_user_id: string;
    actor_email: string | null;
    correlation_id: string;
    created_at: string;
    delivery_status: string | null;
    delivery_error: string | null;
  }>;
  evidence: {
    content_snapshot: string | null;
    attachment: { name?: string; mime?: string; size?: number; available: boolean; signed_url?: string } | null;
  } | null;
  /** Structural retention state only; internal hold/appeal reasons stay private. */
  evidence_retention: {
    active_hold: { id: string; hold_type: "legal" | "safety"; applied_at: string } | null;
    appeal_status: "active" | "resolved" | null;
  } | null;
  auditEvents: Array<{ id: string; action: string; event_type: string; success: boolean; correlation_id: string; occurred_at: string; error_code: string | null }>;
}

export async function getReportDetail(id: string): Promise<ReportDetail | null> {
  await requireSecureAdmin();
  const admin = createAdminClient();

  const { data: report } = await admin
    .from("reports")
    .select(
      "id, status, entity_type, entity_id, entity_name, reason, details, reporter_id, reporter_username, reporter_email, message_id, conversation_id, conversation_type, message_type, message_sender_id, club_id, email_sent_at, email_error, created_at"
    )
    .eq("id", id)
    .maybeSingle();
  if (!report) return null;
  const r = report as any;

  const subjectId = r.entity_type === "user" ? r.entity_id : r.message_sender_id;
  const [reporterMap, subjectMap, clubs, targets, evidenceFlags, decisionRows] = await Promise.all([
    r.reporter_id ? profileMap(admin, [r.reporter_id]) : Promise.resolve(new Map<string, any>()),
    subjectId ? profileMap(admin, [subjectId]) : Promise.resolve(new Map<string, any>()),
    r.club_id ? clubMap(admin, [r.club_id]) : Promise.resolve(new Map<string, any>()),
    resolveTargets(admin, [r]),
    protectedEvidenceFlags(admin, [r.id]),
    admin.from("report_decision_history").select("id, previous_status, new_status, resolution_outcome, internal_decision_note, public_category, public_explanation, enforcement_action, enforcement_target_type, enforcement_target_id, enforcement_status, notification_status, actor_user_id, actor_email, correlation_id, created_at").eq("report_id", r.id).order("sequence_no", { ascending: false }),
  ]);

  const reporter = r.reporter_id ? reporterMap.get(r.reporter_id) : null;
  const target = targets.get(r.id);
  const owner = target?.subjectUserId ? (await profileMap(admin, [target.subjectUserId])).get(target.subjectUserId) : null;
  const resolvedSubjectId = subjectId ?? target?.subjectUserId ?? null;
  const subject = resolvedSubjectId ? subjectMap.get(resolvedSubjectId) ?? owner : null;
  const club = r.club_id ? clubs.get(r.club_id) : null;
  const uniId = club?.university_id ?? null;
  const uniName = uniId ? (await universityNameMap(admin, [uniId])).get(uniId) ?? null : null;
  const reporterEmails = r.reporter_id ? await emailMap([r.reporter_id]) : new Map<string, string | null>();
  const decisionData = (decisionRows.data ?? []) as any[];
  const correlations = decisionData.map((d) => d.correlation_id).filter(Boolean);
  const { data: auditRows } = correlations.length
    ? await admin.from("admin_audit_events").select("id, action, event_type, success, correlation_id, occurred_at, error_code").in("correlation_id", correlations).order("occurred_at", { ascending: true }).limit(100)
    : { data: [] as any[] };
  const { data: deliveryRows } = decisionData.length
    ? await admin.from("report_notification_deliveries").select("decision_id, state, last_error").in("decision_id", decisionData.map((d) => d.id))
    : { data: [] as any[] };
  const deliveryMap = new Map(((deliveryRows ?? []) as any[]).map((d) => [d.decision_id, d]));

  // Related reports for the same target (metadata only).
  let relatedReports: RelatedReport[] = [];
  if (r.entity_id) {
    const { data: rel } = await admin
      .from("reports")
      .select("id, status, reason, reporter_username, created_at")
      .eq("entity_type", r.entity_type)
      .eq("entity_id", r.entity_id)
      .neq("id", r.id)
      .order("created_at", { ascending: false })
      .limit(50);
    relatedReports = ((rel ?? []) as any[]).map((x) => ({
      id: x.id,
      status: x.status,
      reason: x.reason ?? null,
      reporter_username: x.reporter_username ?? null,
      created_at: x.created_at,
    }));
  }

  const isMessageReport = r.entity_type === "message" || r.entity_type === "chat";
  let evidenceRow: any = null;
  let evidenceRetention: ReportDetail["evidence_retention"] = null;
  // Never read private evidence before a fresh founder step-up and durable
  // audit acknowledgement. A failed audit is fail-closed for evidence reads.
  if (isMessageReport && evidenceFlags.get(r.id)) {
    try {
      const actor = await requireRecentMfa();
      const { data: audited, error: auditError } = await admin.rpc("admin_record_report_evidence_view", {
        p_actor_id: actor.id,
        p_actor_email: actor.email ?? null,
        p_report_id: r.id,
        p_correlation_id: randomUUID(),
      });
      if (!auditError && audited === true) {
        const privateAdmin = admin.schema("private");
        const [{ data }, { data: holds }, { data: appeals }] = await Promise.all([
          privateAdmin
            .from("report_message_evidence")
            .select("content_snapshot, attachment_name, attachment_size, attachment_mime, source_attachment_path, retained_attachment_bucket, retained_attachment_path, attachment_state")
            .eq("report_id", r.id)
            .maybeSingle(),
          privateAdmin
            .from("report_evidence_holds")
            .select("id, hold_type, applied_at")
            .eq("report_id", r.id)
            .is("released_at", null)
            .maybeSingle(),
          privateAdmin
            .from("report_evidence_appeals")
            .select("status")
            .eq("report_id", r.id)
            .order("submitted_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]);
        evidenceRow = data ?? null;
        evidenceRetention = {
          active_hold: holds?.id && (holds.hold_type === "legal" || holds.hold_type === "safety") && holds.applied_at
            ? { id: holds.id, hold_type: holds.hold_type, applied_at: holds.applied_at }
            : null,
          appeal_status: appeals?.status === "active" || appeals?.status === "resolved" ? appeals.status : null,
        };
      }
    } catch {
      // The report's structural metadata remains available; evidence is not.
    }
  }
  let signedUrl: string | undefined;
  const evidencePath = evidenceRow?.attachment_state === "retained"
    ? evidenceRow.retained_attachment_path
    : evidenceRow?.attachment_state === "source_pending"
      ? evidenceRow.source_attachment_path
      : null;
  const evidenceBucket = evidenceRow?.attachment_state === "retained"
    ? evidenceRow.retained_attachment_bucket
    : evidenceRow?.attachment_state === "source_pending"
      ? "chat-attachments"
      : null;
  if (evidenceBucket && evidencePath) {
    const signed = await admin.storage.from(evidenceBucket).createSignedUrl(evidencePath, 300);
    if (!signed.error) signedUrl = signed.data?.signedUrl;
  }

  return {
    id: r.id,
    status: r.status,
    entity_type: r.entity_type,
    entity_type_label: reportEntityTypeLabel(r.entity_type),
    entity_id: r.entity_id ?? null,
    reason: r.reason ?? null,
    details: r.details ?? null,
    created_at: r.created_at,
    reporter_id: r.reporter_id ?? null,
    reporter_name: reporter?.full_name ?? null,
    reporter_username: r.reporter_username ?? reporter?.username ?? null,
    reporter_email: r.reporter_email ?? reporterEmails.get(r.reporter_id) ?? null,
    reporter_avatar: reporter?.avatar_url ?? null,
    reporter_exists: !!reporter,
    reported_user_id: resolvedSubjectId,
    reported_name: subject?.full_name ?? null,
    reported_username: subject?.username ?? null,
    reported_avatar: subject?.avatar_url ?? null,
    target_label: target?.label ?? r.entity_name ?? reportEntityTypeLabel(r.entity_type),
    target_href: target?.href ?? null,
    club_id: r.club_id ?? null,
    club_name: club?.name ?? null,
    club_handle: club?.handle ?? null,
    university: uniName,
    message: isMessageReport
      ? {
          message_id: r.message_id ?? null,
          conversation_id: r.conversation_id ?? null,
          conversation_type: r.conversation_type ?? null,
          message_type: r.message_type ?? null,
          conversation_href: r.conversation_id ? `/admin/conversations/${r.conversation_id}` : null,
          has_retained_evidence: evidenceFlags.get(r.id) ?? false,
        }
      : null,
    email_delivered: !!r.email_sent_at,
    email_error: r.email_error ?? null,
    allowedTransitions: isReportStatus(r.status) ? REPORT_TRANSITIONS[r.status as ReportStatus] : [],
    relatedReports,
    decisions: decisionData.map((d) => ({
      id: d.id,
      previous_status: d.previous_status,
      new_status: d.new_status,
      resolution_outcome: d.resolution_outcome,
      internal_decision_note: d.internal_decision_note,
      public_category: d.public_category ?? null,
      public_explanation: d.public_explanation ?? null,
      enforcement_action: d.enforcement_action,
      enforcement_target_type: d.enforcement_target_type ?? null,
      enforcement_target_id: d.enforcement_target_id ?? null,
      enforcement_status: d.enforcement_status,
      notification_status: d.notification_status,
      actor_user_id: d.actor_user_id,
      actor_email: d.actor_email ?? null,
      correlation_id: d.correlation_id,
      created_at: d.created_at,
      delivery_status: deliveryMap.get(d.id)?.state ?? null,
      delivery_error: deliveryMap.get(d.id)?.last_error ?? null,
    })),
    evidence: isMessageReport && evidenceRow
      ? {
          content_snapshot: evidenceRow.content_snapshot ?? null,
          attachment: evidenceRow.attachment_name
            ? { name: evidenceRow.attachment_name, mime: evidenceRow.attachment_mime, size: evidenceRow.attachment_size, available: !!signedUrl, ...(signedUrl ? { signed_url: signedUrl } : {}) }
            : null,
        }
      : null,
    evidence_retention: isMessageReport && evidenceRow ? evidenceRetention : null,
    auditEvents: ((auditRows ?? []) as any[]).map((a) => ({ id: a.id, action: a.action, event_type: a.event_type, success: !!a.success, correlation_id: a.correlation_id, occurred_at: a.occurred_at, error_code: a.error_code ?? null })),
  };
}

// ── Overview counts (list header + Restrictions cross-link) ──────────────────

export interface ReportsSummary {
  total: number;
  pending: number;
  reviewing: number;
  resolved: number;
  dismissed: number;
  byType: Record<string, number>;
}

export async function getReportsSummary(): Promise<ReportsSummary> {
  await requireSecureAdmin();
  const admin = createAdminClient();
  const count = async (apply?: (q: any) => any) => {
    let q = admin.from("reports").select("id", { count: "exact", head: true });
    if (apply) q = apply(q);
    const { count: c } = await q;
    return c ?? 0;
  };
  const [total, pending, reviewing, resolved, dismissed, typeRows] = await Promise.all([
    count(),
    count((q) => q.eq("status", "pending")),
    count((q) => q.eq("status", "reviewing")),
    count((q) => q.eq("status", "resolved")),
    count((q) => q.eq("status", "dismissed")),
    admin.from("reports").select("entity_type").limit(20000),
  ]);
  const byType: Record<string, number> = {};
  for (const r of (typeRows.data ?? []) as any[]) byType[r.entity_type] = (byType[r.entity_type] ?? 0) + 1;
  return { total, pending, reviewing, resolved, dismissed, byType };
}
