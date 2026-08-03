// ============================================================================
// Admin Dashboard — Day 10C lifecycle read model (SERVER-ONLY)
// ============================================================================
// This module reads the narrow migration-063 view after passing the ordinary
// secure-admin gate. It never reads deleted bodies, captions, descriptions or
// media from the lifecycle table. Canonical detail screens may show canonical
// content while it still exists; creator-deleted and future-purged entries stay
// structural-only.
// ============================================================================

if (typeof window !== "undefined") {
  throw new Error("lifecycleData is server-only.");
}

import { createAdminClient } from "../supabase/admin";
import { PAGE_SIZE, type Paginated } from "./data";
import { requireSecureAdmin } from "./secureAdmin";
import type { AuditEventRow } from "./auditData";

export type LifecycleEntityType = "post" | "comment" | "event";
export type LifecycleState = "active" | "removed" | "creator_deleted" | "purge_pending" | "purge_failed" | "purged";
export type LifecycleDisplayStatus = LifecycleState | "restored";

export const LIFECYCLE_ENTITY_TYPES: Array<{ value: LifecycleEntityType; label: string }> = [
  { value: "post", label: "Posts" },
  { value: "comment", label: "Comments" },
  { value: "event", label: "Events" },
];

export const LIFECYCLE_STATUS_OPTIONS: Array<{ value: LifecycleDisplayStatus; label: string }> = [
  { value: "active", label: "Active (never removed)" },
  { value: "restored", label: "Restored (active)" },
  { value: "removed", label: "Removed by administrator" },
  { value: "creator_deleted", label: "Deleted by creator" },
  { value: "purge_pending", label: "Pending permanent purge" },
  { value: "purge_failed", label: "Purge needs review" },
  { value: "purged", label: "Permanently purged" },
];

interface LifecycleViewRow {
  entity_type: LifecycleEntityType;
  entity_id: string;
  owner_id: string | null;
  club_id: string | null;
  content_created_at: string | null;
  state: LifecycleState;
  removed_at: string | null;
  removed_by: string | null;
  removal_correlation_id: string | null;
  restored_at: string | null;
  restored_by: string | null;
  restoration_correlation_id: string | null;
  creator_deleted_at: string | null;
  purge_requested_at: string | null;
  purge_completed_at: string | null;
  lifecycle_updated_at: string | null;
}

export interface LifecycleCreator {
  id: string | null;
  name: string | null;
  username: string | null;
  avatarUrl: string | null;
}

export interface PurgeReadOnlyStatus {
  eligible: boolean;
  eligibilityReason: string;
  status: string;
}

export interface LifecycleRecord extends LifecycleViewRow {
  key: string;
  displayStatus: LifecycleDisplayStatus;
  creator: LifecycleCreator;
  purge: PurgeReadOnlyStatus;
}

export interface LifecycleAvailability {
  available: boolean;
  message: string | null;
}

export interface LifecycleListResult extends LifecycleAvailability {
  data: Paginated<LifecycleRecord>;
}

export interface LifecycleDetailResult extends LifecycleAvailability {
  record: LifecycleRecord | null;
  auditEvents: AuditEventRow[];
}

export interface ListLifecycleParams {
  entityType?: "all" | LifecycleEntityType;
  status?: "all" | LifecycleDisplayStatus;
  search?: string;
  page?: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIST_COLUMNS = "entity_type, entity_id, owner_id, club_id, content_created_at, state, removed_at, removed_by, removal_correlation_id, restored_at, restored_by, restoration_correlation_id, creator_deleted_at, purge_requested_at, purge_completed_at, lifecycle_updated_at";

function unavailable(error: unknown): LifecycleAvailability {
  const code = (error as { code?: string } | null)?.code;
  if (code === "42P01" || code === "PGRST205") {
    return {
      available: false,
      message: "Lifecycle management is not available until migration 063 is applied to this database.",
    };
  }
  return {
    available: false,
    message: "Lifecycle data could not be loaded. No content action is available until this is resolved.",
  };
}

function displayStatus(row: LifecycleViewRow): LifecycleDisplayStatus {
  return row.state === "active" && row.restored_at ? "restored" : row.state;
}

function lifecycleOrder(row: LifecycleViewRow): string {
  return row.lifecycle_updated_at ?? row.content_created_at ?? "";
}

async function profileMap(ids: Array<string | null>): Promise<Map<string, LifecycleCreator>> {
  const unique = Array.from(new Set(ids.filter((id): id is string => Boolean(id))));
  const map = new Map<string, LifecycleCreator>();
  if (unique.length === 0) return map;

  const admin = createAdminClient();
  const { data } = await admin
    .from("profiles")
    .select("id, full_name, username, avatar_url")
    .in("id", unique);
  for (const profile of (data ?? []) as any[]) {
    map.set(profile.id, {
      id: profile.id,
      name: profile.full_name ?? null,
      username: profile.username ?? null,
      avatarUrl: profile.avatar_url ?? null,
    });
  }
  return map;
}

async function unresolvedReportsByEntity(rows: LifecycleViewRow[]): Promise<Set<string>> {
  const reportable = rows.filter((row) => (row.entity_type === "post" || row.entity_type === "event") && row.state === "removed");
  if (reportable.length === 0) return new Set();
  const ids = Array.from(new Set(reportable.map((row) => row.entity_id)));
  const admin = createAdminClient();
  const { data } = await admin
    .from("reports")
    .select("entity_id")
    .in("entity_id", ids)
    .in("entity_type", ["post", "event"])
    .in("status", ["pending", "reviewing"]);
  return new Set((data ?? []).map((report: any) => report.entity_id).filter(Boolean));
}

function purgeStatus(row: LifecycleViewRow, unresolvedReportIds: Set<string>): PurgeReadOnlyStatus {
  if (row.state === "purged") {
    return { eligible: false, eligibilityReason: "Already permanently purged.", status: "Permanently purged" };
  }
  if (row.state === "purge_pending") {
    return { eligible: false, eligibilityReason: "A future purge workflow is already pending.", status: "Pending permanent purge" };
  }
  if (row.state === "purge_failed") {
    return { eligible: false, eligibilityReason: "A future purge workflow needs review.", status: "Purge needs review" };
  }
  if (row.state === "creator_deleted") {
    return {
      eligible: false,
      eligibilityReason: "Creator-deleted content is not eligible for the administrator purge queue.",
      status: "No administrator purge request exists",
    };
  }
  if (row.state !== "removed") {
    return {
      eligible: false,
      eligibilityReason: "Only administrator-removed content can be considered for a future permanent purge.",
      status: "No administrator purge request exists",
    };
  }
  if (unresolvedReportIds.has(row.entity_id)) {
    return {
      eligible: false,
      eligibilityReason: "Resolve the linked pending or reviewing report before a future purge can be considered.",
      status: "No administrator purge request exists",
    };
  }
  return {
    eligible: true,
    eligibilityReason: "Eligible for a future, separately approved purge workflow. Day 10C provides no purge action.",
    status: "No administrator purge request exists",
  };
}

async function hydrate(rows: LifecycleViewRow[]): Promise<LifecycleRecord[]> {
  const [creators, unresolvedReportIds] = await Promise.all([
    profileMap(rows.map((row) => row.owner_id)),
    unresolvedReportsByEntity(rows),
  ]);
  return rows.map((row) => ({
    ...row,
    key: `${row.entity_type}:${row.entity_id}`,
    displayStatus: displayStatus(row),
    creator: row.owner_id
      ? creators.get(row.owner_id) ?? { id: row.owner_id, name: null, username: null, avatarUrl: null }
      : { id: null, name: null, username: null, avatarUrl: null },
    purge: purgeStatus(row, unresolvedReportIds),
  }));
}

async function creatorSearchIds(term: string): Promise<string[]> {
  const admin = createAdminClient();
  // Use typed filters rather than interpolating a search phrase into a PostgREST
  // `or` expression. This keeps punctuation in a founder's search harmless.
  const pattern = `%${term}%`;
  const [names, usernames] = await Promise.all([
    admin.from("profiles").select("id").ilike("full_name", pattern).limit(500),
    admin.from("profiles").select("id").ilike("username", pattern).limit(500),
  ]);
  return Array.from(new Set([...(names.data ?? []), ...(usernames.data ?? [])].map((profile: any) => profile.id)));
}

/** Probe the actual connected database. This keeps the undeployed migration
 * state honest instead of treating every item as active. */
export async function getLifecycleAvailability(): Promise<LifecycleAvailability> {
  await requireSecureAdmin();
  const admin = createAdminClient();
  const { error } = await admin
    .from("admin_content_lifecycle_records")
    .select("entity_id", { head: true })
    .limit(1);
  return error ? unavailable(error) : { available: true, message: null };
}

export async function listContentLifecycle(params: ListLifecycleParams = {}): Promise<LifecycleListResult> {
  await requireSecureAdmin();
  const admin = createAdminClient();
  const page = Math.max(1, params.page ?? 1);
  const from = (page - 1) * PAGE_SIZE;
  const term = params.search?.trim() ?? "";

  let query = admin
    .from("admin_content_lifecycle_records")
    .select(LIST_COLUMNS, { count: "exact" });

  if (params.entityType && params.entityType !== "all") query = query.eq("entity_type", params.entityType);
  if (params.status && params.status !== "all") {
    if (params.status === "restored") {
      query = query.eq("state", "active").not("restored_at", "is", null);
    } else if (params.status === "active") {
      query = query.eq("state", "active").is("restored_at", null);
    } else {
      query = query.eq("state", params.status);
    }
  }

  if (term) {
    if (UUID_RE.test(term)) {
      query = query.or(`entity_id.eq.${term},owner_id.eq.${term}`);
    } else {
      const ids = await creatorSearchIds(term);
      if (ids.length === 0) {
        return { available: true, message: null, data: { rows: [], total: 0, page, pageSize: PAGE_SIZE } };
      }
      query = query.in("owner_id", ids);
    }
  }

  const { data, error, count } = await query
    .order("lifecycle_updated_at", { ascending: false, nullsFirst: false })
    .order("content_created_at", { ascending: false })
    .range(from, from + PAGE_SIZE - 1);
  if (error) {
    const status = unavailable(error);
    return { ...status, data: { rows: [], total: 0, page, pageSize: PAGE_SIZE } };
  }

  const rows = await hydrate((data ?? []) as LifecycleViewRow[]);
  return { available: true, message: null, data: { rows, total: count ?? rows.length, page, pageSize: PAGE_SIZE } };
}

export async function getContentLifecycleDetail(
  entityType: LifecycleEntityType,
  entityId: string
): Promise<LifecycleDetailResult> {
  await requireSecureAdmin();
  if (!UUID_RE.test(entityId)) return { available: true, message: null, record: null, auditEvents: [] };
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("admin_content_lifecycle_records")
    .select(LIST_COLUMNS)
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .maybeSingle();
  if (error) return { ...unavailable(error), record: null, auditEvents: [] };
  if (!data) return { available: true, message: null, record: null, auditEvents: [] };

  const [record] = await hydrate([data as LifecycleViewRow]);
  const { data: auditRows, error: auditError } = await admin
    .from("admin_audit_events")
    .select("id, occurred_at, actor_user_id, actor_email, action, target_type, target_id, reason, success, error_code, correlation_id")
    .eq("target_type", entityType)
    .eq("target_id", entityId)
    .order("occurred_at", { ascending: false })
    .limit(100);

  return {
    available: true,
    message: auditError ? "Lifecycle data loaded, but related audit events could not be loaded." : null,
    record: record ?? null,
    auditEvents: (auditRows ?? []) as AuditEventRow[],
  };
}

/** Batch helper for the existing post/comment/event lists. Missing lifecycle
 * rows mean active, never removed; query errors are returned for an honest UI
 * warning rather than silently presenting that conclusion as a fact. */
export async function getLifecycleRecordsForEntities(
  entityType: LifecycleEntityType,
  entityIds: string[]
): Promise<{ available: boolean; records: Map<string, LifecycleRecord> }> {
  await requireSecureAdmin();
  const ids = Array.from(new Set(entityIds.filter((id) => UUID_RE.test(id))));
  if (ids.length === 0) return { available: true, records: new Map() };
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("admin_content_lifecycle_records")
    .select(LIST_COLUMNS)
    .eq("entity_type", entityType)
    .in("entity_id", ids);
  if (error) return { available: false, records: new Map() };
  const records = await hydrate((data ?? []) as LifecycleViewRow[]);
  return { available: true, records: new Map(records.map((record) => [record.entity_id, record])) };
}

export function activeLifecycleRecord(entityType: LifecycleEntityType, entityId: string): LifecycleRecord {
  const row: LifecycleViewRow = {
    entity_type: entityType,
    entity_id: entityId,
    owner_id: null,
    club_id: null,
    content_created_at: null,
    state: "active",
    removed_at: null,
    removed_by: null,
    removal_correlation_id: null,
    restored_at: null,
    restored_by: null,
    restoration_correlation_id: null,
    creator_deleted_at: null,
    purge_requested_at: null,
    purge_completed_at: null,
    lifecycle_updated_at: null,
  };
  return {
    ...row,
    key: `${entityType}:${entityId}`,
    displayStatus: "active",
    creator: { id: null, name: null, username: null, avatarUrl: null },
    purge: purgeStatus(row, new Set()),
  };
}

export function displayLifecycleTimestamp(record: LifecycleRecord): string {
  return lifecycleOrder(record);
}
