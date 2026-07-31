// ============================================================================
// Admin Dashboard — Day-5 Edit History + Audit History status  (SERVER-ONLY)
// ============================================================================
// EDIT HISTORY
// ------------
// The current production schema has NO before/after version tables. The only
// canonical edit signal is an `updated_at` that has advanced past `created_at`
// on a handful of tables (profiles, clubs, events, messages — migration 001).
// So Edit History honestly surfaces "this entity was edited at <updated_at>"
// and states plainly that FULL HISTORICAL VALUES WERE NOT RECORDED. It never
// fabricates before/after values from current state.
//
// Message rows are metadata-only and never include the body; deleted messages
// are excluded entirely (their retained history is privacy-locked; migration
// 051 is not deployed and is not queried here).
//
// AUDIT HISTORY
// -------------
// Moved out of this module in Day 10A. The append-only `admin_audit_events`
// table (migration 055) is now the audit trail, and it is read through
// lib/admin/auditData.ts. This module retains ONLY edit history, which remains
// a derived, best-effort view and is a different thing entirely: edit history
// says "something changed at this time", audit history says "this administrator
// did this, for this reason".
// ============================================================================

if (typeof window !== "undefined") {
  throw new Error("lib/admin/historyData.ts is server-only and must not be imported in the browser.");
}

import { createAdminClient } from "../supabase/admin";
import { requireSecureAdmin } from "./secureAdmin";
import { PAGE_SIZE } from "./data";
import type { Paginated } from "./data";

type Admin = ReturnType<typeof createAdminClient>;

export type EditEntityType = "profile" | "club" | "event" | "message";

export const EDIT_ENTITY_TYPES: { value: EditEntityType; label: string }[] = [
  { value: "event", label: "Events" },
  { value: "club", label: "Clubs" },
  { value: "profile", label: "Profiles" },
  { value: "message", label: "Messages" },
];

// Ignore sub-2s gaps: many rows get updated_at == created_at (or within the same
// transaction), which is not a user edit.
const EDIT_GAP_MS = 2000;

export interface EditHistoryRow {
  key: string;
  entity_type: EditEntityType;
  entity_type_label: string;
  id: string;
  identity: string;
  detail_href: string | null;
  created_at: string;
  updated_at: string;
  /** Always false in the current schema — no editor is recorded. */
  editor_known: false;
  /** Always false — no before/after values are stored. */
  before_after_recorded: false;
}

export interface ListEditHistoryParams {
  type?: "all" | EditEntityType;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  dir?: "asc" | "desc";
  page?: number;
}

const TYPE_LABEL: Record<EditEntityType, string> = {
  profile: "Profile",
  club: "Club",
  event: "Event",
  message: "Message",
};

function editedGap(created_at: string, updated_at: string): boolean {
  if (!created_at || !updated_at) return false;
  return new Date(updated_at).getTime() - new Date(created_at).getTime() > EDIT_GAP_MS;
}

const MERGE_CAP = 200;

async function loadEditedProfiles(admin: Admin, search?: string): Promise<EditHistoryRow[]> {
  let q = admin.from("profiles").select("id, full_name, username, created_at, updated_at").order("updated_at", { ascending: false }).limit(MERGE_CAP);
  if (search) q = q.or(`full_name.ilike.%${search}%,username.ilike.%${search}%`);
  const { data } = await q;
  return ((data ?? []) as any[])
    .filter((p) => editedGap(p.created_at, p.updated_at))
    .map((p) => ({
      key: `profile:${p.id}`,
      entity_type: "profile" as const,
      entity_type_label: TYPE_LABEL.profile,
      id: p.id,
      identity: `${p.full_name || p.username} (@${p.username})`,
      detail_href: `/admin/users/${p.id}`,
      created_at: p.created_at,
      updated_at: p.updated_at,
      editor_known: false as const,
      before_after_recorded: false as const,
    }));
}

async function loadEditedClubs(admin: Admin, search?: string): Promise<EditHistoryRow[]> {
  let q = admin.from("clubs").select("id, name, handle, created_at, updated_at").order("updated_at", { ascending: false }).limit(MERGE_CAP);
  if (search) q = q.or(`name.ilike.%${search}%,handle.ilike.%${search}%`);
  const { data } = await q;
  return ((data ?? []) as any[])
    .filter((c) => editedGap(c.created_at, c.updated_at))
    .map((c) => ({
      key: `club:${c.id}`,
      entity_type: "club" as const,
      entity_type_label: TYPE_LABEL.club,
      id: c.id,
      identity: `${c.name} (@${c.handle})`,
      detail_href: `/admin/clubs/${c.id}`,
      created_at: c.created_at,
      updated_at: c.updated_at,
      editor_known: false as const,
      before_after_recorded: false as const,
    }));
}

async function loadEditedEvents(admin: Admin, search?: string): Promise<EditHistoryRow[]> {
  let q = admin.from("events").select("id, title, created_at, updated_at").order("updated_at", { ascending: false }).limit(MERGE_CAP);
  if (search) q = q.ilike("title", `%${search}%`);
  const { data } = await q;
  return ((data ?? []) as any[])
    .filter((e) => editedGap(e.created_at, e.updated_at))
    .map((e) => ({
      key: `event:${e.id}`,
      entity_type: "event" as const,
      entity_type_label: TYPE_LABEL.event,
      id: e.id,
      identity: e.title,
      detail_href: `/admin/events/${e.id}`,
      created_at: e.created_at,
      updated_at: e.updated_at,
      editor_known: false as const,
      before_after_recorded: false as const,
    }));
}

async function loadEditedMessages(admin: Admin, search?: string): Promise<EditHistoryRow[]> {
  // METADATA ONLY. Never select content. Exclude deleted rows (privacy-locked).
  let senderFilter: string[] | null = null;
  if (search) {
    const { data: p } = await admin.from("profiles").select("id").or(`full_name.ilike.%${search}%,username.ilike.%${search}%`).limit(500);
    senderFilter = (p ?? []).map((x: any) => x.id);
    if (senderFilter.length === 0) return [];
  }
  let q = admin
    .from("messages")
    .select("id, sender_id, conversation_id, message_type, created_at, updated_at")
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(MERGE_CAP);
  if (senderFilter) q = q.in("sender_id", senderFilter);
  const { data } = await q;
  const rows = ((data ?? []) as any[]).filter((m) => editedGap(m.created_at, m.updated_at));
  const senderIds = Array.from(new Set(rows.map((m) => m.sender_id).filter(Boolean)));
  const usernames = new Map<string, string>();
  if (senderIds.length) {
    const { data: ps } = await admin.from("profiles").select("id, username").in("id", senderIds as string[]);
    for (const p of (ps ?? []) as any[]) usernames.set(p.id, p.username);
  }
  return rows.map((m) => ({
    key: `message:${m.id}`,
    entity_type: "message" as const,
    entity_type_label: TYPE_LABEL.message,
    id: m.id,
    identity: `${m.message_type} message from @${usernames.get(m.sender_id) ?? "unknown"}`,
    detail_href: `/admin/messages/${m.id}`,
    created_at: m.created_at,
    updated_at: m.updated_at,
    editor_known: false as const,
    before_after_recorded: false as const,
  }));
}

export async function listEditHistory(params: ListEditHistoryParams = {}): Promise<Paginated<EditHistoryRow>> {
  await requireSecureAdmin();
  const admin = createAdminClient();

  const page = Math.max(1, params.page ?? 1);
  const dir = params.dir ?? "desc";
  const search = params.search?.trim();
  const type = params.type ?? "all";

  const sources: Promise<EditHistoryRow[]>[] = [];
  if (type === "all" || type === "event") sources.push(loadEditedEvents(admin, search));
  if (type === "all" || type === "club") sources.push(loadEditedClubs(admin, search));
  if (type === "all" || type === "profile") sources.push(loadEditedProfiles(admin, search));
  if (type === "all" || type === "message") sources.push(loadEditedMessages(admin, search));

  let rows = (await Promise.all(sources)).flat();

  if (params.dateFrom) rows = rows.filter((r) => r.updated_at >= params.dateFrom!);
  if (params.dateTo) rows = rows.filter((r) => r.updated_at <= params.dateTo!);

  rows.sort((a, b) => (dir === "asc" ? a.updated_at.localeCompare(b.updated_at) : b.updated_at.localeCompare(a.updated_at)));

  const total = rows.length;
  const from = (page - 1) * PAGE_SIZE;
  return { rows: rows.slice(from, from + PAGE_SIZE), total, page, pageSize: PAGE_SIZE };
}

// ── Audit History ────────────────────────────────────────────────────────────
// Audit History now reads the DURABLE table (migration 055) through
// lib/admin/auditData.ts. The former getAuditStatus() helper — which reported
// "no canonical audit table exists" — was removed rather than left in place,
// because that statement stopped being true and a helper that misdescribes the
// system is worse than no helper at all.
