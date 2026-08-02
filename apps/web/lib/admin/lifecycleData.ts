// ============================================================================
// Admin Dashboard — Day 10C content lifecycle read access  (SERVER-ONLY)
// ============================================================================
//
// ONE canonical source: `public.content_lifecycle` (migration 061). There is no
// second copy of the state on `posts`, `post_comments` or `events`, so there is
// nothing here that can disagree with what students actually see.
//
// The absence of a row means `active`. That is the design, not a fallback: a
// row is created the first time content leaves the active state, so the table
// stays proportional to moderation activity rather than to content volume.
//
// This module is READ-ONLY and administrator-only:
//   • `requireSecureAdmin()` runs FIRST, before any query.
//   • the service-role client is used, because the table grants SELECT to
//     service_role and nothing at all to `authenticated` or `anon` — no student
//     session can reach this data through any path.
//   • `internal_reason` is deliberately NOT selected by the summary reader. The
//     reason belongs to the audit trail, which has its own page and its own
//     rules; duplicating it into content pages would widen the disclosure
//     surface for no gain.
// ============================================================================

if (typeof window !== "undefined") {
  throw new Error("lib/admin/lifecycleData.ts is server-only and must not be imported in the browser.");
}

import { createAdminClient } from "../supabase/admin";
import { requireSecureAdmin } from "./secureAdmin";

export type LifecycleState = "active" | "removed" | "purge_pending" | "purge_failed" | "purged";
export type LifecycleEntity = "post" | "comment" | "event";

export interface LifecycleSummary {
  state: LifecycleState;
  removedAt: string | null;
  restoredAt: string | null;
  purgeRequestedAt: string | null;
  purgeCompletedAt: string | null;
  purgeFailureCode: string | null;
  purgeAttempts: number;
  storageObjectsTotal: number;
  storageObjectsDeleted: number;
  reconciliationRequired: boolean;
}

const ACTIVE: LifecycleSummary = {
  state: "active",
  removedAt: null,
  restoredAt: null,
  purgeRequestedAt: null,
  purgeCompletedAt: null,
  purgeFailureCode: null,
  purgeAttempts: 0,
  storageObjectsTotal: 0,
  storageObjectsDeleted: 0,
  reconciliationRequired: false,
};

/**
 * The lifecycle state of ONE entity.
 *
 * On a read error this returns `active` — the state the content is actually in
 * from the student's point of view, since RLS only hides content when a row
 * says so. It never invents a `removed` state the database did not report,
 * which would show an operator a removal that never happened.
 */
export async function getLifecycleSummary(
  entity: LifecycleEntity,
  entityId: string
): Promise<LifecycleSummary> {
  await requireSecureAdmin();
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("content_lifecycle")
    .select(
      "state, removed_at, restored_at, purge_requested_at, purge_completed_at, purge_failure_code, purge_attempts, storage_objects_total, storage_objects_deleted, reconciliation_required"
    )
    .eq("entity_type", entity)
    .eq("entity_id", entityId)
    .maybeSingle();

  if (error || !data) return ACTIVE;

  return {
    state: (data.state as LifecycleState) ?? "active",
    removedAt: (data.removed_at as string | null) ?? null,
    restoredAt: (data.restored_at as string | null) ?? null,
    purgeRequestedAt: (data.purge_requested_at as string | null) ?? null,
    purgeCompletedAt: (data.purge_completed_at as string | null) ?? null,
    purgeFailureCode: (data.purge_failure_code as string | null) ?? null,
    purgeAttempts: (data.purge_attempts as number | null) ?? 0,
    storageObjectsTotal: (data.storage_objects_total as number | null) ?? 0,
    storageObjectsDeleted: (data.storage_objects_deleted as number | null) ?? 0,
    reconciliationRequired: Boolean(data.reconciliation_required),
  };
}

export interface LifecycleListRow {
  entityType: LifecycleEntity;
  entityId: string;
  state: LifecycleState;
  removedAt: string | null;
  purgeFailureCode: string | null;
  reconciliationRequired: boolean;
}

/**
 * Everything not in the `active` state, newest first — the queue an
 * administrator works from. Filterable by entity type and by state, because
 * "what is removed" and "what failed to purge" are different jobs.
 */
export async function listLifecycle(opts: {
  entity?: LifecycleEntity;
  state?: LifecycleState;
  limit?: number;
}): Promise<LifecycleListRow[]> {
  await requireSecureAdmin();
  const admin = createAdminClient();

  let query = admin
    .from("content_lifecycle")
    .select("entity_type, entity_id, state, removed_at, purge_failure_code, reconciliation_required")
    .neq("state", "active")
    .order("removed_at", { ascending: false, nullsFirst: false })
    .limit(Math.min(Math.max(opts.limit ?? 100, 1), 500));

  if (opts.entity) query = query.eq("entity_type", opts.entity);
  if (opts.state) query = query.eq("state", opts.state);

  const { data, error } = await query;
  if (error || !data) return [];

  return data.map((row) => ({
    entityType: row.entity_type as LifecycleEntity,
    entityId: row.entity_id as string,
    state: row.state as LifecycleState,
    removedAt: (row.removed_at as string | null) ?? null,
    purgeFailureCode: (row.purge_failure_code as string | null) ?? null,
    reconciliationRequired: Boolean(row.reconciliation_required),
  }));
}
