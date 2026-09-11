"use server";

// ============================================================================
// Admin Dashboard — privileged write server actions  (Day 2, Day-3 hardened)
// ============================================================================
//
// Every write action follows the same contract:
//   1. requireSecureAdmin({ write: true })     — portal + allowlist + aal2 MFA +
//                                                 write kill switch, all fail-closed
//   2. strict input validation                 — fixed shapes, no arbitrary cols
//   3. mutation on a FIXED canonical table      — no generic mutation endpoint
//   4. read the changed record back
//   5. structured audit log (success AND failure)
//   6. structured { ok } result — never throws to the client
//
// Client identity is NEVER trusted: the actor is the server-validated founder
// from requireSecureAdmin(). The service-role client is constructed only AFTER
// authorization passes. With ADMIN_WRITES_ENABLED unset/false, EVERY action
// here throws before touching data — the dashboard stays safely read-only.
//
// Officer authority is `club_members.role = 'officer'` (via is_club_officer).
// `club_officers` is the DISPLAY roster only. Promote/demote therefore writes
// club_members.role (authority + officer-chat trigger) AND keeps the
// club_officers roster in sync, exactly as the canonical add_club_officer /
// remove_club_officer RPCs do. We cannot call THOSE RPCs, because they authorize
// the CALLER via auth.uid() as an officer, which the admin service-role client
// is not — the DB triggers (member count, officer chat membership, join/leave
// cleanup) fire on the underlying table writes regardless.
//
// DAY 10A — every mutation in this file now runs through a migration-056
// `admin_tx_*` function: the canonical change and its audit row commit in ONE
// database transaction, or neither does. A refused audit write (missing reason,
// forbidden payload) ROLLS THE MUTATION BACK, so a destructive change can no
// longer happen and then fail to be recorded.
//
// Migration 054 remains authoritative for the officer floor — the 056 functions
// CALL admin_set_club_member_role / admin_remove_club_member rather than
// reimplementing them, so the per-club advisory lock and the club_members
// backstop trigger are untouched.
//
// The `fail()` helper is still used for input validation that happens BEFORE
// the database is reached; those failures are durable audit records written
// outside any transaction, which is safe because no mutation occurred.
// ============================================================================

import { createAdminClient } from "../supabase/admin";
import { createClient as createServerClient } from "../supabase/server";
import { requireSecureAdmin } from "./secureAdmin";
import { adminAudit } from "./audit";
import { runAtomicMutation } from "./atomicMutation";
import { runCrossServiceOperation } from "./crossService";
import { getCampusMode } from "./data2";
import { clearEntryTicketCookie } from "./entryTicketCookie";
import type { User } from "@supabase/supabase-js";

export type ActionResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

async function fail(action: string, actor: User, error: string, target: Record<string, unknown>): Promise<{ ok: false; error: string }> {
  await adminAudit({ action, actorId: actor.id, actorEmail: actor.email, target, ok: false, error });
  return { ok: false, error };
}

// ── Clubs ───────────────────────────────────────────────────────────────────

export interface ClubMeetingScheduleEntry {
  day: string;
  start: string | null;
  end: string | null;
}

/** Fields the Admin Dashboard may provide when creating a club. */
export interface CreateClubInput {
  name: string;
  description: string;
  university_id?: string | null;
  avatar_url?: string | null;
  cover_image_url?: string | null;
  banner_url?: string | null;
  meeting_day?: string | null;
  meeting_time_start?: string | null;
  meeting_time_end?: string | null;
  meeting_location?: string | null;
  meeting_building?: string | null;
  meeting_room?: string | null;
  meeting_schedule?: ClubMeetingScheduleEntry[] | null;
}

/** Supported partial fields for editing an existing club. */
export type ClubPatch = Partial<CreateClubInput> & { is_active?: boolean };

const CLUB_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;

function cleanNullableText(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return typeof value === "string" ? value.trim() || null : undefined;
}

function isValidMeetingSchedule(value: unknown): value is ClubMeetingScheduleEntry[] | null {
  if (value === null) return true;
  if (!Array.isArray(value) || value.length > 14) return false;
  return value.every((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const row = entry as Record<string, unknown>;
    return (
      typeof row.day === "string" &&
      row.day.trim().length > 0 &&
      (row.start === null || typeof row.start === "string") &&
      (row.end === null || typeof row.end === "string") &&
      (row.start === null || CLUB_TIME_RE.test(row.start)) &&
      (row.end === null || CLUB_TIME_RE.test(row.end))
    );
  });
}

function normalizeClubFields(input: unknown): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Club fields are required." };
  }
  const source = input as Record<string, unknown>;
  const value: Record<string, unknown> = {};

  for (const key of Object.keys(source)) {
    if (source[key] !== undefined) value[key] = source[key];
  }

  if ("name" in value) {
    if (typeof value.name !== "string" || value.name.trim().length < 2 || value.name.trim().length > 120) {
      return { ok: false, error: "Club name must be 2–120 characters." };
    }
    value.name = value.name.trim();
  }
  if ("description" in value) {
    if (typeof value.description !== "string" || value.description.trim().length < 1 || value.description.trim().length > 5000) {
      return { ok: false, error: "Description must be 1–5000 characters." };
    }
    value.description = value.description.trim();
  }
  if ("university_id" in value && value.university_id !== null && !isUuid(value.university_id)) {
    return { ok: false, error: "Invalid university id." };
  }
  for (const key of [
    "avatar_url", "cover_image_url", "banner_url", "meeting_day", "meeting_location",
    "meeting_building", "meeting_room",
  ]) {
    if (key in value) {
      const clean = cleanNullableText(value[key]);
      if (value[key] !== null && value[key] !== undefined && clean === undefined) {
        return { ok: false, error: `Invalid ${key.replace(/_/g, " ")}.` };
      }
      value[key] = clean;
    }
  }
  for (const key of ["meeting_time_start", "meeting_time_end"]) {
    if (key in value) {
      const clean = cleanNullableText(value[key]);
      if (clean !== null && clean !== undefined && !CLUB_TIME_RE.test(clean)) {
        return { ok: false, error: `${key.replace(/_/g, " ")} must be a valid time.` };
      }
      value[key] = clean;
    }
  }
  if ("meeting_schedule" in value && !isValidMeetingSchedule(value.meeting_schedule)) {
    return { ok: false, error: "Meeting schedule is invalid." };
  }
  if ("is_active" in value && typeof value.is_active !== "boolean") {
    return { ok: false, error: "is_active must be a boolean." };
  }

  return { ok: true, value };
}

/** Create a club through the server-only atomic admin RPC. */
export async function createClub(input: CreateClubInput): Promise<ActionResult> {
  const actor = await requireSecureAdmin({ write: true });
  const normalized = normalizeClubFields(input);
  const target = {};
  if (!normalized.ok) return fail("club.create", actor, normalized.error, target);
  const createAllowed = new Set([
    "name", "description", "university_id", "avatar_url", "cover_image_url", "banner_url",
    "meeting_day", "meeting_time_start", "meeting_time_end", "meeting_location", "meeting_building",
    "meeting_room", "meeting_schedule",
  ]);
  if (Object.keys(normalized.value).some((key) => !createAllowed.has(key))) {
    return fail("club.create", actor, "The submitted club fields are not supported.", target);
  }
  if (!("name" in normalized.value) || !("description" in normalized.value)) {
    return fail("club.create", actor, "Name and description are required.", target);
  }

  const v = normalized.value;
  return runAtomicMutation({
    action: "club.create",
    actor,
    rpc: "admin_tx_club_create",
    args: {
      p_name: v.name,
      p_description: v.description,
      p_university_id: v.university_id ?? null,
      p_avatar_url: v.avatar_url ?? null,
      p_cover_image_url: v.cover_image_url ?? null,
      p_banner_url: v.banner_url ?? null,
      p_meeting_day: v.meeting_day ?? null,
      p_meeting_time_start: v.meeting_time_start ?? null,
      p_meeting_time_end: v.meeting_time_end ?? null,
      p_meeting_location: v.meeting_location ?? null,
      p_meeting_building: v.meeting_building ?? null,
      p_meeting_room: v.meeting_room ?? null,
      p_meeting_schedule: v.meeting_schedule ?? null,
    },
    target,
  });
}

/** Edit the allowlisted club information fields through the atomic admin RPC. */
export async function updateClub(clubId: string, patch: ClubPatch): Promise<ActionResult> {
  const actor = await requireSecureAdmin({ write: true });
  if (!isUuid(clubId)) return fail("club.edit", actor, "Invalid club id.", { clubId });
  const normalized = normalizeClubFields(patch);
  if (!normalized.ok) return fail("club.edit", actor, normalized.error, { clubId });
  const allowed = new Set([
    "name", "description", "university_id", "avatar_url", "cover_image_url", "banner_url",
    "meeting_day", "meeting_time_start", "meeting_time_end", "meeting_location", "meeting_building",
    "meeting_room", "meeting_schedule", "is_active",
  ]);
  const keys = Object.keys(normalized.value);
  if (keys.length === 0 || keys.some((key) => !allowed.has(key))) {
    return fail("club.edit", actor, keys.length === 0 ? "Choose at least one club field to update." : "The submitted club fields are not supported.", { clubId });
  }

  return runAtomicMutation({
    action: "club.edit",
    actor,
    rpc: "admin_tx_club_update",
    args: { p_club_id: clubId, p_patch: normalized.value },
    target: { clubId },
  });
}

// ── Memberships ──────────────────────────────────────────────────────────────
//
// DAY 10A HARDENING — every mutation below now runs through a migration-056
// `admin_tx_*` function, which performs the canonical change AND writes its
// audit row in ONE database transaction. If the audit write is refused, the
// mutation is rolled back with it; if the mutation fails, no success record can
// exist. The migration-054 officer floor is still authoritative — the 056
// functions CALL the 054 RPCs rather than reimplementing them.
//
// Actions marked `reason` in the audit catalog take a required `reason`
// argument, validated by runAtomicMutation() BEFORE the database is touched.

/** Add an existing user to a club as an ordinary member (canonical: club_members). */
export async function addMembership(clubId: string, userId: string): Promise<ActionResult> {
  const actor = await requireSecureAdmin({ write: true });
  if (!isUuid(clubId) || !isUuid(userId)) {
    return fail("membership.add", actor, "Invalid club or user id.", { clubId, userId });
  }
  return runAtomicMutation({
    action: "membership.add",
    actor,
    rpc: "admin_tx_membership_add",
    args: { p_club_id: clubId, p_user_id: userId },
    target: { clubId, userId },
  });
}

/** Remove a member from a club. Requires a reason (destructive). */
export async function removeMembership(clubId: string, userId: string, reason: string): Promise<ActionResult> {
  const actor = await requireSecureAdmin({ write: true });
  if (!isUuid(clubId) || !isUuid(userId)) {
    return fail("membership.remove", actor, "Invalid club or user id.", { clubId, userId });
  }
  // Product policy, unchanged from Day 2: an officer must be demoted first, so
  // removal is never a silent way to drop someone's authority. Migration 054
  // would ALLOW it while another officer remains — this is the stricter rule,
  // and it is checked here rather than in the database because it is a UI
  // workflow decision, not a data invariant.
  const admin = createAdminClient();
  const { data: member } = await admin
    .from("club_members")
    .select("role")
    .eq("club_id", clubId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!member) {
    return fail("membership.remove", actor, "This user is not a member of this club.", { clubId, userId });
  }
  if ((member as { role: string }).role === "officer") {
    return fail("membership.remove", actor, "Demote this officer to member before removing them.", { clubId, userId });
  }

  return runAtomicMutation({
    action: "membership.remove",
    actor,
    reason,
    rpc: "admin_tx_membership_remove",
    args: { p_club_id: clubId, p_user_id: userId },
    target: { clubId, userId },
  });
}

// ── Officer management (via club_members.role + club_officers roster) ────────

/**
 * Promote to officer or demote to member. Demotion is destructive and requires
 * a reason; promotion does not. The 056 function derives the audit action from
 * the role, so a demotion can never be filed as a promotion.
 */
export async function setMembershipRole(
  clubId: string,
  userId: string,
  role: "member" | "officer",
  roleTitle?: string,
  reason?: string
): Promise<ActionResult> {
  const actor = await requireSecureAdmin({ write: true });
  const action = role === "officer" ? "officer.promote" : "officer.demote";
  if (!isUuid(clubId) || !isUuid(userId)) {
    return fail(action, actor, "Invalid club or user id.", { clubId, userId, role });
  }
  if (role !== "member" && role !== "officer") {
    return fail(action, actor, "Invalid role.", { clubId, userId, role });
  }
  return runAtomicMutation({
    action,
    actor,
    reason,
    rpc: "admin_tx_member_role_set",
    args: {
      p_club_id: clubId,
      p_user_id: userId,
      p_role: role,
      p_role_title: role === "officer" ? (roleTitle ?? "Officer").trim() : "Officer",
    },
    target: { clubId, userId, role },
  });
}

/** Set the authoritative club_members role for an existing club member. */
export async function setOfficerRole(
  clubId: string,
  userId: string,
  role: "member" | "officer",
  roleTitle = "Officer",
  reason?: string
): Promise<ActionResult> {
  const actor = await requireSecureAdmin({ write: true });
  const action = role === "officer" ? "officer.promote" : "officer.demote";
  if (!isUuid(clubId) || !isUuid(userId)) {
    return fail(action, actor, "Invalid club or user id.", { clubId, userId, role });
  }
  if (role !== "member" && role !== "officer") {
    return fail(action, actor, "Invalid role.", { clubId, userId, role });
  }
  const cleanTitle = (roleTitle ?? "Officer").trim();
  if (cleanTitle.length < 2 || cleanTitle.length > 40) {
    return fail(action, actor, "Officer title must be 2–40 characters.", { clubId, userId, role });
  }
  return runAtomicMutation({
    action,
    actor,
    reason,
    rpc: "admin_tx_member_role_set",
    args: {
      p_club_id: clubId,
      p_user_id: userId,
      p_role: role,
      p_role_title: role === "officer" ? cleanTitle : "Officer",
    },
    target: { clubId, userId, role },
  });
}

/** Remove officer authority and roster membership while retaining ordinary membership. */
export async function removeOfficer(clubId: string, userId: string, reason: string): Promise<ActionResult> {
  const actor = await requireSecureAdmin({ write: true });
  if (!isUuid(clubId) || !isUuid(userId)) {
    return fail("officer.demote", actor, "Invalid club or user id.", { clubId, userId });
  }
  return runAtomicMutation({
    action: "officer.demote",
    actor,
    reason,
    rpc: "admin_tx_member_role_set",
    args: {
      p_club_id: clubId,
      p_user_id: userId,
      p_role: "member",
      p_role_title: "Officer",
    },
    target: { clubId, userId, role: "member" },
  });
}

/** Add an officer, creating the membership row if the user is not yet a member. */
export async function addOfficer(clubId: string, userId: string, roleTitle: string): Promise<ActionResult> {
  const actor = await requireSecureAdmin({ write: true });
  if (!isUuid(clubId) || !isUuid(userId)) {
    return fail("officer.add", actor, "Invalid club or user id.", { clubId, userId });
  }
  return runAtomicMutation({
    action: "officer.add",
    actor,
    rpc: "admin_tx_officer_add",
    args: { p_club_id: clubId, p_user_id: userId, p_role_title: (roleTitle ?? "Officer").trim() },
    target: { clubId, userId },
  });
}

/** Edit an officer's display title on the roster. */
export async function editOfficerTitle(clubId: string, userId: string, roleTitle: string): Promise<ActionResult> {
  const actor = await requireSecureAdmin({ write: true });
  if (!isUuid(clubId) || !isUuid(userId)) {
    return fail("officer.editTitle", actor, "Invalid club or user id.", { clubId, userId });
  }
  return runAtomicMutation({
    action: "officer.editTitle",
    actor,
    rpc: "admin_tx_officer_title_set",
    args: { p_club_id: clubId, p_user_id: userId, p_role_title: (roleTitle ?? "").trim() },
    target: { clubId, userId },
  });
}

// ── Gluemates (mutual follows) ───────────────────────────────────────────────

/** Remove a mutual-follow relationship (both directions). Requires a reason. */
export async function removeGluemate(userAId: string, userBId: string, reason: string): Promise<ActionResult> {
  const actor = await requireSecureAdmin({ write: true });
  if (!isUuid(userAId) || !isUuid(userBId)) {
    return fail("gluemate.remove", actor, "Invalid user id.", { userAId, userBId });
  }
  if (userAId === userBId) {
    return fail("gluemate.remove", actor, "Choose two different users.", { userAId, userBId });
  }
  return runAtomicMutation({
    action: "gluemate.remove",
    actor,
    reason,
    rpc: "admin_tx_gluemate_remove",
    args: { p_user_a: userAId, p_user_b: userBId },
    target: { userAId, userBId },
  });
}

// ── Universities ─────────────────────────────────────────────────────────────

/**
 * Create a new university.
 *
 * SINGLE-CAMPUS GUARD (Day 10A): while `app_config.single_campus_mode` is true,
 * this refuses. We Glue runs on exactly one campus, and nothing downstream —
 * signup, discovery, recommendations, the iOS/Android apps — routes across
 * campuses yet, so a second row would be inert at best and misleading at worst.
 *
 * The capability is GATED, not removed: flipping single_campus_mode off in
 * app_config restores it with no code change. The Universities screen hides the
 * Add control on the same signal, so the UI and the server agree rather than the
 * rule living only in the interface.
 */
export async function addUniversity(name: string, slug: string, reason: string): Promise<ActionResult> {
  const actor = await requireSecureAdmin({ write: true });
  const cleanName = (name ?? "").trim();
  const cleanSlug = (slug ?? "").trim().toLowerCase();
  const target = { name: cleanName, slug: cleanSlug };

  const campus = await getCampusMode();
  if (campus.singleCampusMode) {
    return fail(
      "university.add",
      actor,
      "We Glue is in single-campus mode. Adding a university is disabled until single_campus_mode is turned off.",
      target
    );
  }

  return runAtomicMutation({
    action: "university.add",
    actor,
    reason,
    rpc: "admin_tx_university_add",
    args: { p_name: cleanName, p_slug: cleanSlug },
    target,
  });
}

/** Edit supported university fields (name, slug). */
export async function editUniversity(id: string, fields: { name?: string; slug?: string }): Promise<ActionResult> {
  const actor = await requireSecureAdmin({ write: true });
  if (!isUuid(id)) return fail("university.edit", actor, "Invalid university id.", { id });
  return runAtomicMutation({
    action: "university.edit",
    actor,
    rpc: "admin_tx_university_edit",
    args: {
      p_id: id,
      p_name: fields?.name?.trim() ?? null,
      p_slug: fields?.slug?.trim().toLowerCase() ?? null,
    },
    target: { id },
  });
}

/** Activate or deactivate a university. Requires a reason (sensitive). */
export async function setUniversityActive(id: string, isActive: boolean, reason: string): Promise<ActionResult> {
  const actor = await requireSecureAdmin({ write: true });
  if (!isUuid(id)) return fail("university.setActive", actor, "Invalid university id.", { id, isActive });
  return runAtomicMutation({
    action: "university.setActive",
    actor,
    reason,
    rpc: "admin_tx_university_set_active",
    args: { p_id: id, p_is_active: !!isActive },
    target: { id, isActive },
  });
}

// ── Portal lock (session control) ─────────────────────────────────────────────

/**
 * Lock the admin portal: sign out the current administrator session so the next
 * visit requires a fresh login AND a fresh MFA challenge (the session drops back
 * to aal1). Backs both the explicit "Lock Admin Portal" control and the
 * inactivity auto-lock. Ending one's own session needs no write privilege, so
 * this is intentionally NOT gated by ADMIN_WRITES_ENABLED — it must always work.
 *
 * This is the single combined Lock-portal / Sign-out action for the dashboard, so
 * it is also the one place that must revoke the private entry-gate ticket. After
 * it runs, /admin returns an ordinary 404 again and the private entry gateway
 * must be passed a second time — on top of Gmail/password and TOTP MFA, which
 * remain required exactly as before.
 */
export async function lockAdminPortal(): Promise<ActionResult> {
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // No signed-in session to end: nothing external happens, so nothing is
  // recorded. Still clear the entry ticket — concealment must not outlive a
  // lock request under any circumstances.
  if (!user) {
    clearEntryTicketCookie();
    return { ok: true, data: { locked: true } };
  }

  // CROSS-SERVICE: signing out is a Supabase AUTH operation, which cannot share
  // a transaction with the audit insert. It therefore uses the attempt→outcome
  // correlated pattern instead of the migration-056 atomic path, and makes no
  // claim of atomicity. See lib/admin/crossService.ts.
  const outcome = await runCrossServiceOperation({
    action: "portal.lock",
    actor: user,
    target: {},
    perform: async () => {
      try {
        await supabase.auth.signOut();
      } catch {
        // Best-effort — cookies may already be cleared. Treated as success:
        // the goal is that the session is not usable afterwards, and the
        // entry-ticket revocation below is what actually guarantees re-entry
        // requires the full gate again.
      }
      clearEntryTicketCookie();
      return { locked: true };
    },
  });

  // Locking must ALWAYS succeed from the operator's point of view — refusing to
  // lock because a record could not be written would leave a live admin session
  // open, which is strictly worse. The audit trail still tells the truth: an
  // attempt with no outcome, or a reconciliation_required row, is visible in
  // Audit History.
  if (!outcome.ok) {
    clearEntryTicketCookie();
  }
  return { ok: true, data: { locked: true } };
}
