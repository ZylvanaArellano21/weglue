// ============================================================================
// Admin Dashboard — durable audit trail READ access  (SERVER-ONLY)
// ============================================================================
//
// Reads `admin_audit_events` (migration 055) for the Audit History page. Every
// loader goes through requireSecureAdmin() BEFORE the service-role client is
// constructed, exactly like every other admin data module.
//
// This module is READ-ONLY by construction — it exports no mutation, and the
// database would refuse one anyway (append-only triggers, and service_role
// holds no INSERT/UPDATE/DELETE grant on the table).
//
// What is safe to display here has already been decided upstream: rows were
// written through an allowlist (auditSanitize.ts) and validated again by the
// database. There is no private message content, no secret and no raw request
// body in this table to leak. The UI still renders before/after as typed
// key/value pairs rather than a raw JSON dump — a blob is unreadable, and
// unreadable output is where mistakes hide.
// ============================================================================

if (typeof window !== "undefined") {
  throw new Error("lib/admin/auditData.ts is server-only and must not be imported in the browser.");
}

import { createAdminClient } from "../supabase/admin";
import { requireSecureAdmin } from "./secureAdmin";
import { PAGE_SIZE, type Paginated } from "./data";
import { AUDIT_TARGET_TYPES, type AuditTargetType } from "./auditSanitize";

export interface AuditEventRow {
  id: string;
  occurred_at: string;
  actor_user_id: string;
  actor_email: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  reason: string | null;
  success: boolean;
  error_code: string | null;
  correlation_id: string;
}

export interface AuditEventDetail extends AuditEventRow {
  before_state: Record<string, unknown> | null;
  after_state: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  sensitivity: string | null;
  description: string | null;
  /** Other events sharing this correlation id (the rest of the operation). */
  related: AuditEventRow[];
}

export interface AuditActionOption {
  action: string;
  target_type: string;
  sensitivity: string;
  requires_reason: boolean;
  description: string | null;
}

export interface ListAuditParams {
  action?: string;
  targetType?: string;
  /** "all" | "success" | "failure" */
  outcome?: string;
  dateFrom?: string;
  dateTo?: string;
  correlationId?: string;
  actorId?: string;
  targetId?: string;
  page?: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

const LIST_COLUMNS =
  "id, occurred_at, actor_user_id, actor_email, action, target_type, target_id, reason, success, error_code, correlation_id";

/**
 * True once migration 055 has been applied to the connected database.
 *
 * The page uses this to render an honest "not yet deployed" state instead of an
 * error, because 055 is deliberately NOT applied to production during Day 10A.
 * Detected by probing the table rather than by reading a flag, so the answer is
 * always about the database actually in use.
 */
export async function isAuditTableAvailable(): Promise<boolean> {
  await requireSecureAdmin();
  const admin = createAdminClient();
  const { error } = await admin.from("admin_audit_events").select("id", { head: true, count: "exact" }).limit(1);
  // PGRST205 / 42P01: the table (or its PostgREST schema entry) does not exist.
  if (error && (error.code === "42P01" || error.code === "PGRST205")) return false;
  return !error;
}

export async function listAuditActions(): Promise<AuditActionOption[]> {
  await requireSecureAdmin();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("admin_audit_actions")
    .select("action, target_type, sensitivity, requires_reason, description")
    .order("action", { ascending: true });

  if (error) return [];
  return (data ?? []) as AuditActionOption[];
}

export async function listAuditEvents(params: ListAuditParams = {}): Promise<Paginated<AuditEventRow>> {
  await requireSecureAdmin();
  const admin = createAdminClient();

  const page = Math.max(1, params.page ?? 1);
  const from = (page - 1) * PAGE_SIZE;

  let query = admin
    .from("admin_audit_events")
    .select(LIST_COLUMNS, { count: "exact" })
    .order("occurred_at", { ascending: false })
    .range(from, from + PAGE_SIZE - 1);

  // Every filter is validated against a closed set or a UUID shape before it
  // reaches the query — no caller-supplied column names or operators.
  if (params.action && params.action !== "all") query = query.eq("action", params.action);

  if (params.targetType && params.targetType !== "all") {
    if ((AUDIT_TARGET_TYPES as readonly string[]).includes(params.targetType)) {
      query = query.eq("target_type", params.targetType as AuditTargetType);
    }
  }

  if (params.outcome === "success") query = query.eq("success", true);
  else if (params.outcome === "failure") query = query.eq("success", false);

  if (params.dateFrom) query = query.gte("occurred_at", params.dateFrom);
  // Inclusive end-of-day: a bare date means "through the end of that day".
  if (params.dateTo) {
    const to = /^\d{4}-\d{2}-\d{2}$/.test(params.dateTo) ? `${params.dateTo}T23:59:59.999Z` : params.dateTo;
    query = query.lte("occurred_at", to);
  }

  if (isUuid(params.correlationId)) query = query.eq("correlation_id", params.correlationId);
  if (isUuid(params.actorId)) query = query.eq("actor_user_id", params.actorId);
  if (isUuid(params.targetId)) query = query.eq("target_id", params.targetId);

  const { data, error, count } = await query;
  if (error) return { rows: [], total: 0, page, pageSize: PAGE_SIZE };

  return {
    rows: (data ?? []) as AuditEventRow[],
    total: count ?? 0,
    page,
    pageSize: PAGE_SIZE,
  };
}

export async function getAuditEventDetail(id: string): Promise<AuditEventDetail | null> {
  await requireSecureAdmin();
  if (!isUuid(id)) return null;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("admin_audit_events")
    .select(`${LIST_COLUMNS}, before_state, after_state, metadata`)
    .eq("id", id)
    .maybeSingle();

  if (error || !data) return null;
  const row = data as any;

  const [{ data: catalog }, { data: related }] = await Promise.all([
    admin
      .from("admin_audit_actions")
      .select("sensitivity, description")
      .eq("action", row.action)
      .maybeSingle(),
    admin
      .from("admin_audit_events")
      .select(LIST_COLUMNS)
      .eq("correlation_id", row.correlation_id)
      .neq("id", id)
      .order("occurred_at", { ascending: true })
      .limit(25),
  ]);

  return {
    ...(row as AuditEventRow),
    before_state: (row.before_state ?? null) as Record<string, unknown> | null,
    after_state: (row.after_state ?? null) as Record<string, unknown> | null,
    metadata: (row.metadata ?? null) as Record<string, unknown> | null,
    sensitivity: (catalog as any)?.sensitivity ?? null,
    description: (catalog as any)?.description ?? null,
    related: ((related ?? []) as AuditEventRow[]),
  };
}

export interface AuditSummary {
  total: number;
  failures: number;
  last24h: number;
  earliest: string | null;
  latest: string | null;
  distinctActors: number;
}

export async function getAuditSummary(): Promise<AuditSummary> {
  await requireSecureAdmin();
  const admin = createAdminClient();

  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [totalRes, failRes, dayRes, boundsRes] = await Promise.all([
    admin.from("admin_audit_events").select("id", { head: true, count: "exact" }),
    admin.from("admin_audit_events").select("id", { head: true, count: "exact" }).eq("success", false),
    admin.from("admin_audit_events").select("id", { head: true, count: "exact" }).gte("occurred_at", dayAgo),
    admin.from("admin_audit_events").select("occurred_at, actor_user_id").order("occurred_at", { ascending: true }),
  ]);

  const all = (boundsRes.data ?? []) as { occurred_at: string; actor_user_id: string }[];

  return {
    total: totalRes.count ?? 0,
    failures: failRes.count ?? 0,
    last24h: dayRes.count ?? 0,
    earliest: all[0]?.occurred_at ?? null,
    latest: all[all.length - 1]?.occurred_at ?? null,
    distinctActors: new Set(all.map((r) => r.actor_user_id)).size,
  };
}
