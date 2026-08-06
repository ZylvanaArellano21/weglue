// ============================================================================
// Admin Dashboard — Day-5 moderation: Deleted Content read access (SERVER-ONLY)
// ============================================================================
// Unifies the SAFELY-DETECTABLE deleted / archived / hidden / removed entities
// that exist in the CURRENT production schema. Each entity's deletion model was
// inspected separately — they are NOT assumed to share a system:
//
//   • messages       — deleted_at / deleted_by (040): "unsend for everyone".
//                      PRIVACY-LOCKED. Metadata only; NEVER the body/attachment/
//                      poll/snapshot; NEVER restorable; NEVER purgeable here.
//   • conversations  — deleted_at (040): custom-group "delete for everyone".
//                      Metadata only. No canonical restore op → restore disabled.
//   • clubs          — is_active = false (006): a deactivated club, hidden from
//                      discovery. This has a canonical, safe, reversible restore
//                      (reactivate → is_active = true), with read-back.
//
// Deliberately NOT faked as "deleted content":
//   • users     — account deletion is a HARD cascade delete (044); no soft-delete
//                 row survives, so there is nothing to list. Reported honestly.
//   • posts / comments / events — no soft-delete/status column exists; club
//                 removal is an un-tag, not a deletion. Not listed as deleted.
//   • notifications / media — no deletion-metadata surface to detect safely.
//
// Day 10F retained evidence lives in a private table and is never
// imported/queried here. This surface remains metadata-only.
// ============================================================================

if (typeof window !== "undefined") {
  throw new Error("lib/admin/deletedContentData.ts is server-only and must not be imported in the browser.");
}

import { createAdminClient } from "../supabase/admin";
import { requireSecureAdmin } from "./secureAdmin";
import { PAGE_SIZE } from "./data";
import type { Paginated } from "./data";

type Admin = ReturnType<typeof createAdminClient>;

export type DeletedEntityType = "message" | "conversation" | "club";

export const DELETED_ENTITY_TYPES: { value: DeletedEntityType; label: string }[] = [
  { value: "club", label: "Deactivated clubs" },
  { value: "conversation", label: "Deleted conversations" },
  { value: "message", label: "Deleted messages" },
];

export interface DeletedContentRow {
  key: string; // `${entity_type}:${id}`
  entity_type: DeletedEntityType;
  entity_type_label: string;
  id: string;
  identity: string;
  owner_label: string | null;
  owner_href: string | null;
  related_label: string | null;
  related_href: string | null;
  status_label: string;
  deleted_at: string | null;
  /** True when deleted_at is an exact deletion time; false when approximated. */
  timestamp_exact: boolean;
  deleted_by_username: string | null;
  reason: string | null;
  detail_href: string | null;
  restorable: boolean;
  purgeable: boolean;
  report_count: number;
  /** Privacy-locked entities (deleted messages) suppress all body/content. */
  privacy_locked: boolean;
}

export interface ListDeletedContentParams {
  type?: "all" | DeletedEntityType;
  restorable?: "all" | "restorable" | "locked";
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  dir?: "asc" | "desc";
  page?: number;
}

const TYPE_LABEL: Record<DeletedEntityType, string> = {
  message: "Deleted message",
  conversation: "Deleted conversation",
  club: "Deactivated club",
};

// ── Small helpers ────────────────────────────────────────────────────────────

async function profileUsernames(admin: Admin, ids: (string | null)[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = Array.from(new Set(ids.filter(Boolean))) as string[];
  if (unique.length === 0) return map;
  const { data } = await admin.from("profiles").select("id, username").in("id", unique);
  for (const p of (data ?? []) as any[]) map.set(p.id, p.username);
  return map;
}

const CONV_TYPE_LABEL: Record<string, string> = {
  direct: "Direct message",
  group: "Custom group",
  club_group: "Club chat",
  officer_chat: "Official club chat",
};

// ── Per-source loaders (each returns bounded, most-recent-first rows) ─────────

async function loadDeletedClubs(admin: Admin, cap: number, search?: string): Promise<DeletedContentRow[]> {
  let q = admin
    .from("clubs")
    .select("id, name, handle, updated_at, university_id")
    .eq("is_active", false)
    .order("updated_at", { ascending: false })
    .limit(cap);
  if (search) q = q.or(`name.ilike.%${search}%,handle.ilike.%${search}%`);
  const { data } = await q;
  const clubs = (data ?? []) as any[];
  const reportCounts = await reportCountsFor(admin, "club", clubs.map((c) => c.id));
  return clubs.map((c) => ({
    key: `club:${c.id}`,
    entity_type: "club" as const,
    entity_type_label: TYPE_LABEL.club,
    id: c.id,
    identity: c.name,
    owner_label: c.handle ? `@${c.handle}` : null,
    owner_href: null,
    related_label: null,
    related_href: null,
    status_label: "Deactivated (hidden from discovery)",
    deleted_at: c.updated_at ?? null,
    timestamp_exact: false, // clubs have no deactivation timestamp; updated_at is a proxy
    deleted_by_username: null,
    reason: null,
    detail_href: `/admin/clubs/${c.id}`,
    restorable: true, // reactivate via is_active = true (canonical, reversible)
    purgeable: false,
    report_count: reportCounts.get(c.id) ?? 0,
    privacy_locked: false,
  }));
}

async function loadDeletedConversations(admin: Admin, cap: number, search?: string): Promise<DeletedContentRow[]> {
  let q = admin
    .from("conversations")
    .select("id, type, name, club_id, created_by, deleted_at")
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false })
    .limit(cap);
  if (search) q = q.ilike("name", `%${search}%`);
  const { data } = await q;
  const convs = (data ?? []) as any[];
  const creatorNames = await profileUsernames(admin, convs.map((c) => c.created_by));
  const clubIds = Array.from(new Set(convs.map((c) => c.club_id).filter(Boolean))) as string[];
  const clubNames = new Map<string, string>();
  if (clubIds.length) {
    const { data: cs } = await admin.from("clubs").select("id, name").in("id", clubIds);
    for (const c of (cs ?? []) as any[]) clubNames.set(c.id, c.name);
  }
  const reportCounts = await reportCountsByConversation(admin, convs.map((c) => c.id));
  return convs.map((c) => ({
    key: `conversation:${c.id}`,
    entity_type: "conversation" as const,
    entity_type_label: TYPE_LABEL.conversation,
    id: c.id,
    identity: (c.name && c.name.trim()) || (c.club_id ? clubNames.get(c.club_id) ?? "Club conversation" : CONV_TYPE_LABEL[c.type] ?? c.type),
    owner_label: c.created_by ? `@${creatorNames.get(c.created_by) ?? "unknown"}` : null,
    owner_href: c.created_by ? `/admin/users/${c.created_by}` : null,
    related_label: c.club_id ? clubNames.get(c.club_id) ?? "Club" : null,
    related_href: c.club_id ? `/admin/clubs/${c.club_id}` : null,
    status_label: "Deleted for everyone",
    deleted_at: c.deleted_at ?? null,
    timestamp_exact: true,
    deleted_by_username: null, // conversations have no deleted_by column
    reason: null,
    detail_href: `/admin/conversations/${c.id}`,
    restorable: false, // no canonical restore-conversation operation
    purgeable: false,
    report_count: reportCounts.get(c.id) ?? 0,
    privacy_locked: false,
  }));
}

async function loadDeletedMessages(admin: Admin, cap: number, search?: string): Promise<DeletedContentRow[]> {
  // METADATA ONLY. content / attachment_* are NEVER selected.
  let senderFilter: string[] | null = null;
  if (search) {
    const { data: p } = await admin.from("profiles").select("id").or(`full_name.ilike.%${search}%,username.ilike.%${search}%`).limit(500);
    senderFilter = (p ?? []).map((x: any) => x.id);
    if (senderFilter.length === 0) return [];
  }
  let q = admin
    .from("messages")
    .select("id, conversation_id, sender_id, deleted_by, message_type, deleted_at")
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false })
    .limit(cap);
  if (senderFilter) q = q.in("sender_id", senderFilter);
  const { data } = await q;
  const msgs = (data ?? []) as any[];
  const userNames = await profileUsernames(admin, [...msgs.map((m) => m.sender_id), ...msgs.map((m) => m.deleted_by)]);
  const reportCounts = await reportCountsByMessage(admin, msgs.map((m) => m.id));
  return msgs.map((m) => ({
    key: `message:${m.id}`,
    entity_type: "message" as const,
    entity_type_label: TYPE_LABEL.message,
    id: m.id,
    identity: `${m.message_type} message`,
    owner_label: m.sender_id ? `@${userNames.get(m.sender_id) ?? "unknown"}` : null,
    owner_href: m.sender_id ? `/admin/users/${m.sender_id}` : null,
    related_label: "Conversation",
    related_href: m.conversation_id ? `/admin/conversations/${m.conversation_id}` : null,
    status_label: "Unsent (deleted for everyone)",
    deleted_at: m.deleted_at ?? null,
    timestamp_exact: true,
    deleted_by_username: m.deleted_by ? userNames.get(m.deleted_by) ?? null : null,
    reason: null,
    detail_href: m.id ? `/admin/messages/${m.id}` : null,
    restorable: false, // privacy: retained content is never restored on this branch
    purgeable: false,
    report_count: reportCounts.get(m.id) ?? 0,
    privacy_locked: true,
  }));
}

async function reportCountsFor(admin: Admin, entityType: string, ids: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (ids.length === 0) return map;
  const { data } = await admin.from("reports").select("entity_id").eq("entity_type", entityType).in("entity_id", ids);
  for (const r of (data ?? []) as any[]) if (r.entity_id) map.set(r.entity_id, (map.get(r.entity_id) ?? 0) + 1);
  return map;
}
async function reportCountsByConversation(admin: Admin, ids: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (ids.length === 0) return map;
  const { data } = await admin.from("reports").select("conversation_id").in("conversation_id", ids);
  for (const r of (data ?? []) as any[]) if (r.conversation_id) map.set(r.conversation_id, (map.get(r.conversation_id) ?? 0) + 1);
  return map;
}
async function reportCountsByMessage(admin: Admin, ids: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (ids.length === 0) return map;
  const { data } = await admin.from("reports").select("message_id").in("message_id", ids);
  for (const r of (data ?? []) as any[]) if (r.message_id) map.set(r.message_id, (map.get(r.message_id) ?? 0) + 1);
  return map;
}

// ── Unified list (bounded merge for "all"; each source most-recent-first) ─────

const MERGE_CAP = 200;

export async function listDeletedContent(params: ListDeletedContentParams = {}): Promise<Paginated<DeletedContentRow>> {
  await requireSecureAdmin();
  const admin = createAdminClient();

  const page = Math.max(1, params.page ?? 1);
  const dir = params.dir ?? "desc";
  const search = params.search?.trim();
  const type = params.type ?? "all";

  // Gather from each requested source (bounded).
  const sources: Promise<DeletedContentRow[]>[] = [];
  if (type === "all" || type === "club") sources.push(loadDeletedClubs(admin, MERGE_CAP, search));
  if (type === "all" || type === "conversation") sources.push(loadDeletedConversations(admin, MERGE_CAP, search));
  if (type === "all" || type === "message") sources.push(loadDeletedMessages(admin, MERGE_CAP, search));

  let rows = (await Promise.all(sources)).flat();

  // Restorable / privacy-locked filter.
  if (params.restorable === "restorable") rows = rows.filter((r) => r.restorable);
  else if (params.restorable === "locked") rows = rows.filter((r) => !r.restorable);

  // Date range on the deletion timestamp.
  if (params.dateFrom) rows = rows.filter((r) => r.deleted_at && r.deleted_at >= params.dateFrom!);
  if (params.dateTo) rows = rows.filter((r) => r.deleted_at && r.deleted_at <= params.dateTo!);

  // Sort by deletion time (a null timestamp sorts last).
  rows.sort((a, b) => {
    const av = a.deleted_at ?? "";
    const bv = b.deleted_at ?? "";
    return dir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
  });

  const total = rows.length;
  const from = (page - 1) * PAGE_SIZE;
  const paged = rows.slice(from, from + PAGE_SIZE);
  return { rows: paged, total, page, pageSize: PAGE_SIZE };
}

/** Summary counts for the section header. */
export interface DeletedContentSummary {
  clubs: number;
  conversations: number;
  messages: number;
  restorable: number;
}

export async function getDeletedContentSummary(): Promise<DeletedContentSummary> {
  await requireSecureAdmin();
  const admin = createAdminClient();
  const [clubs, conversations, messages] = await Promise.all([
    admin.from("clubs").select("id", { count: "exact", head: true }).eq("is_active", false),
    admin.from("conversations").select("id", { count: "exact", head: true }).not("deleted_at", "is", null),
    admin.from("messages").select("id", { count: "exact", head: true }).not("deleted_at", "is", null),
  ]);
  const clubCount = clubs.count ?? 0;
  return {
    clubs: clubCount,
    conversations: conversations.count ?? 0,
    messages: messages.count ?? 0,
    restorable: clubCount, // only deactivated clubs are safely restorable today
  };
}
