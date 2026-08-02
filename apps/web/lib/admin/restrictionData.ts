// ============================================================================
// Administrator account restrictions — read path  (SERVER-ONLY)
// ============================================================================
//
// Same contract as every other admin loader: requireSecureAdmin() FIRST, then
// the service-role client. A non-founder / aal1 / portal-off request can never
// cause the service-role key to be constructed.
//
// This is the ONLY place the internal reason is read, and it is read into a
// server-rendered page behind the private gateway. It is never sent to a
// student client, and `my_access_state()` (migration 058) is structurally
// incapable of returning it.
// ============================================================================

if (typeof window !== "undefined") {
  throw new Error("lib/admin/restrictionData.ts is server-only.");
}

import { createAdminClient } from "../supabase/admin";
import { requireSecureAdmin } from "./secureAdmin";

export type AccessState = "active" | "suspended" | "platform_blocked" | "deletion_pending";

export interface RestrictionRow {
  id: string;
  user_id: string;
  restriction_type: "suspended" | "platform_blocked";
  status: "active" | "lifted" | "expired";
  internal_reason: string;
  violation_category: string | null;
  public_reason: string | null;
  created_at: string;
  created_by: string;
  suspended_until: string | null;
  lifted_at: string | null;
  lifted_by: string | null;
  lift_reason: string | null;
  correlation_id: string;
}

export interface RestrictionSummary {
  /** Effective state, computed by the database predicate (expiry-aware). */
  accessState: AccessState;
  /** The currently active row, if any. */
  active: RestrictionRow | null;
  /** Newest first, including lifted and expired rows. */
  history: RestrictionRow[];
  /**
   * Rows still marked `active` whose suspension has already lapsed. They
   * restrict nobody — the predicate ignores them — and the next administrator
   * mutation closes them atomically. Surfaced only so the dashboard can say so
   * rather than looking inconsistent.
   */
  expiredUnreconciled: RestrictionRow[];
  deletionCase: {
    id: string; state: string; scheduled_deletion_at: string; appeal_deadline: string;
    violation_category: string; public_reason: string; internal_reason: string; basis: string;
    evidence_attached: boolean; correlation_id: string; cancellation_reason: string | null;
    finalized_at: string | null; finalization_error: string | null;
  } | null;
  /** Legacy event summary retained solely for historic records. */
  sessionRevocation: {
    attempted: boolean;
    succeeded: boolean;
    failed: boolean;
    reconciliationRequired: boolean;
    correlationId: string | null;
  };
}

/**
 * Effective access state for one account.
 *
 * Uses the SAME database predicate the enforcement layer uses, rather than
 * re-deriving it in TypeScript. Two implementations of "is this account
 * restricted?" would eventually disagree, and the dashboard would then show
 * something different from what the database enforces.
 */
export async function accessStateFor(userId: string): Promise<AccessState> {
  await requireSecureAdmin();
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("get_account_access_state", { p_user: userId });
  if (error) throw error;
  return (data ?? "active") as AccessState;
}

export async function restrictionSummary(userId: string): Promise<RestrictionSummary> {
  await requireSecureAdmin();
  const admin = createAdminClient();

  const [{ data: state }, { data: rows }, { data: deletionRows }] = await Promise.all([
    admin.rpc("get_account_access_state", { p_user: userId }),
    admin
      .from("account_restrictions")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50),
    admin.from("account_deletion_cases")
      .select("id,state,scheduled_deletion_at,appeal_deadline,violation_category,public_reason,internal_reason,basis,evidence_references,correlation_id,cancellation_reason,finalized_at,finalization_error")
      .eq("user_id", userId).order("created_at", { ascending: false }).limit(1),
  ]);

  const history = (rows ?? []) as RestrictionRow[];

  // "Currently restricting" is NOT the same as `status = 'active'`.
  //
  // A suspension whose `suspended_until` has passed stops restricting
  // immediately (the database predicate evaluates the timestamp), but its row
  // legitimately stays `status='active'` until the next administrator mutation
  // reconciles it — that is bookkeeping, not access. Reading the raw status
  // here would make the dashboard show "Applied / By / Internal reason" for a
  // restriction that is not restricting anyone, directly contradicting the
  // Active badge beside it. Mirroring the predicate keeps the two honest.
  const nowMs = Date.now();
  const active =
    history.find(
      (r) =>
        r.status === "active" &&
        (r.restriction_type === "platform_blocked" ||
          !r.suspended_until ||
          new Date(r.suspended_until).getTime() > nowMs)
    ) ?? null;

  /** Rows still marked active whose suspension has already lapsed. */
  const expiredUnreconciled = history.filter(
    (r) =>
      r.status === "active" &&
      r.restriction_type === "suspended" &&
      !!r.suspended_until &&
      new Date(r.suspended_until).getTime() <= nowMs
  );

  // Session-revocation outcome for the ACTIVE restriction, correlated by id.
  let sessionRevocation: RestrictionSummary["sessionRevocation"] = {
    attempted: false, succeeded: false, failed: false,
    reconciliationRequired: false, correlationId: active?.correlation_id ?? null,
  };

  if (active?.correlation_id) {
    const { data: events } = await admin
      .from("admin_audit_events")
      .select("event_type, action")
      .eq("correlation_id", active.correlation_id)
      .eq("action", "restriction.revokeSessions");

    const list = (events ?? []) as { event_type: string }[];
    sessionRevocation = {
      attempted: list.some((e) => e.event_type === "attempt"),
      succeeded: list.some((e) => e.event_type === "success"),
      failed: list.some((e) => e.event_type === "failure"),
      reconciliationRequired: list.some((e) => e.event_type === "reconciliation_required"),
      correlationId: active.correlation_id,
    };
  }

  type DeletionDbRow = NonNullable<RestrictionSummary["deletionCase"]> & { evidence_references?: string | null };
  const deletion = (deletionRows?.[0] ?? null) as DeletionDbRow | null;
  return {
    accessState: (state ?? "active") as AccessState,
    active,
    history,
    expiredUnreconciled,
    deletionCase: deletion ? { ...deletion, evidence_attached: !!deletion.evidence_references?.trim() } : null,
    sessionRevocation,
  };
}

/**
 * Restrictions whose suspension has lapsed but whose row is still `active`.
 *
 * These are NOT an access problem — the predicate already treats them as
 * inactive, which is why no cron job is required for correctness. They are a
 * bookkeeping queue, surfaced so an administrator can tidy them deliberately.
 */
export async function unreconciledExpiredCount(): Promise<number> {
  await requireSecureAdmin();
  const admin = createAdminClient();
  const { count } = await admin
    .from("account_restrictions")
    .select("id", { count: "exact", head: true })
    .eq("status", "active")
    .eq("restriction_type", "suspended")
    .lt("suspended_until", new Date().toISOString());
  return count ?? 0;
}

/** Platform-wide counts for the Restrictions queue page. */
export async function restrictionCounts(): Promise<{
  suspended: number;
  blocked: number;
  expiringSoon: number;
}> {
  await requireSecureAdmin();
  const admin = createAdminClient();
  const nowIso = new Date().toISOString();
  const weekIso = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

  const [s, b, e] = await Promise.all([
    admin.from("account_restrictions").select("id", { count: "exact", head: true })
      .eq("status", "active").eq("restriction_type", "suspended")
      .or(`suspended_until.is.null,suspended_until.gt.${nowIso}`),
    admin.from("account_restrictions").select("id", { count: "exact", head: true })
      .eq("status", "active").eq("restriction_type", "platform_blocked"),
    admin.from("account_restrictions").select("id", { count: "exact", head: true })
      .eq("status", "active").eq("restriction_type", "suspended")
      .gt("suspended_until", nowIso).lt("suspended_until", weekIso),
  ]);

  return { suspended: s.count ?? 0, blocked: b.count ?? 0, expiringSoon: e.count ?? 0 };
}
