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
// DAY 8 — every membership/officer change now goes through the migration-054
// administrator RPCs (admin_set_club_member_role / admin_remove_club_member /
// admin_transfer_club_officer) instead of separate table writes from here.
// Reasons, in order of importance:
//   1. The last-officer rule is enforced atomically in the database, under a
//      per-club advisory lock, instead of by a check-then-write in this file —
//      which two concurrent requests could interleave through, leaving a club
//      with NO officers (proven reproducible; see the migration header).
//   2. The authority row and the display roster move in ONE transaction, so a
//      failure part-way cannot leave an officer with no roster entry.
//   3. `club_members` also carries a table-level backstop trigger, so the floor
//      holds even for a write that never goes through these actions.
// The RPCs are executable by `service_role` only — never by anon/authenticated.
// ============================================================================

import { createAdminClient } from "../supabase/admin";
import { createClient as createServerClient } from "../supabase/server";
import { requireSecureAdmin } from "./secureAdmin";
import { adminAudit } from "./audit";
import { clearEntryTicketCookie } from "./entryTicketCookie";
import type { User } from "@supabase/supabase-js";

export type ActionResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

function fail(action: string, actor: User, error: string, target: Record<string, unknown>): { ok: false; error: string } {
  adminAudit({ action, actorId: actor.id, actorEmail: actor.email, target, ok: false, error });
  return { ok: false, error };
}

/**
 * Status codes returned by the migration-054 officer RPCs, mapped to founder-
 * facing wording. Deliberately plain: no SQLSTATE, no function name, no internal
 * detail — the founder is told what happened and what to do about it.
 */
const OFFICER_RPC_MESSAGE: Record<string, string> = {
  not_member: "This user is not a member of this club.",
  not_officer: "This member is not an officer.",
  last_officer:
    "This club would be left without any officer. Promote another member to officer first, or transfer the role.",
  invalid_role: "Invalid role.",
  invalid_role_title: "Officer title must be 2–40 characters.",
  club_not_found: "Club not found.",
  user_not_found: "User not found.",
  different_university: "User belongs to a different university than this club.",
  same_user: "Choose a different member to receive the officer role.",
  from_not_officer: "That member is not currently an officer of this club.",
};

/** Human wording for an officer-RPC status, with a safe fallback. */
function officerRpcMessage(status: string | null | undefined): string {
  return (status && OFFICER_RPC_MESSAGE[status]) || "Could not complete this change.";
}

// ── Memberships ──────────────────────────────────────────────────────────────

/** Add an existing user to a club as an ordinary member (canonical: club_members). */
export async function addMembership(clubId: string, userId: string): Promise<ActionResult> {
  const actor = await requireSecureAdmin({ write: true });
  const action = "membership.add";
  const target = { clubId, userId };
  if (!isUuid(clubId) || !isUuid(userId)) return fail(action, actor, "Invalid club or user id.", target);

  const admin = createAdminClient();
  const [{ data: club }, { data: user }] = await Promise.all([
    admin.from("clubs").select("id, name, university_id").eq("id", clubId).maybeSingle(),
    admin.from("profiles").select("id, university_id").eq("id", userId).maybeSingle(),
  ]);
  if (!club) return fail(action, actor, "Club not found.", target);
  if (!user) return fail(action, actor, "User not found.", target);

  // Same-campus guard, mirroring add_club_member_by_officer.
  if (club.university_id && user.university_id && club.university_id !== user.university_id) {
    return fail(action, actor, "User belongs to a different university than this club.", target);
  }

  const { data: existing } = await admin
    .from("club_members")
    .select("id")
    .eq("club_id", clubId)
    .eq("user_id", userId)
    .maybeSingle();
  if (existing) return fail(action, actor, "This user is already a member of this club.", target);

  const { error: insErr } = await admin.from("club_members").insert({ club_id: clubId, user_id: userId, role: "member" });
  if (insErr) return fail(action, actor, "Could not add member.", target);

  const { data: row } = await admin
    .from("club_members")
    .select("id, club_id, user_id, role, joined_at")
    .eq("club_id", clubId)
    .eq("user_id", userId)
    .maybeSingle();

  adminAudit({ action, actorId: actor.id, actorEmail: actor.email, target, ok: true, after: row });
  return { ok: true, data: row };
}

/** Remove an ordinary member from a club. Officers must be demoted first. */
export async function removeMembership(clubId: string, userId: string): Promise<ActionResult> {
  const actor = await requireSecureAdmin({ write: true });
  const action = "membership.remove";
  const target = { clubId, userId };
  if (!isUuid(clubId) || !isUuid(userId)) return fail(action, actor, "Invalid club or user id.", target);

  const admin = createAdminClient();
  const { data: member } = await admin
    .from("club_members")
    .select("id, role")
    .eq("club_id", clubId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!member) return fail(action, actor, "This user is not a member of this club.", target);
  // Unchanged dashboard rule: officers are demoted (or transferred) first, so
  // removal never doubles as an implicit demotion. The RPC below enforces the
  // officer floor regardless of what this pre-check allows through.
  if (member.role === "officer") {
    return fail(action, actor, "Demote this officer to member before removing them.", target);
  }

  const { data: status, error: rpcErr } = await admin.rpc("admin_remove_club_member", {
    p_club_id: clubId,
    p_user_id: userId,
  });
  if (rpcErr) return fail(action, actor, "Could not remove member.", target);
  if (status !== "ok") return fail(action, actor, officerRpcMessage(status as string), target);

  const { data: check } = await admin
    .from("club_members")
    .select("id")
    .eq("club_id", clubId)
    .eq("user_id", userId)
    .maybeSingle();
  const removed = !check;

  adminAudit({ action, actorId: actor.id, actorEmail: actor.email, target, ok: removed, before: member, after: null });
  return removed ? { ok: true, data: { removed: true } } : { ok: false, error: "Removal did not take effect." };
}

// ── Officer management (via club_members.role + club_officers roster) ────────

async function upsertOfficerRoster(
  admin: ReturnType<typeof createAdminClient>,
  clubId: string,
  userId: string,
  roleTitle: string
): Promise<void> {
  const { data: profile } = await admin
    .from("profiles")
    .select("full_name, username, avatar_url")
    .eq("id", userId)
    .maybeSingle();
  const displayName = (profile?.full_name?.trim() || profile?.username || "Officer") as string;
  const avatarUrl = profile?.avatar_url ?? null;

  const { data: existing } = await admin
    .from("club_officers")
    .select("id")
    .eq("club_id", clubId)
    .eq("user_id", userId)
    .maybeSingle();

  if (existing) {
    await admin
      .from("club_officers")
      .update({ role_title: roleTitle, display_name: displayName, avatar_url: avatarUrl })
      .eq("id", existing.id);
  } else {
    await admin
      .from("club_officers")
      .insert({ club_id: clubId, user_id: userId, role_title: roleTitle, display_name: displayName, avatar_url: avatarUrl });
  }
}

/**
 * Promote a member to officer OR demote an officer to member.
 * - promote: club_members.role='officer' + club_officers roster upsert
 * - demote:  last-officer protection, then role='member' + roster delete
 */
export async function setMembershipRole(
  clubId: string,
  userId: string,
  role: "member" | "officer",
  roleTitle?: string
): Promise<ActionResult> {
  const actor = await requireSecureAdmin({ write: true });
  const action = role === "officer" ? "officer.promote" : "officer.demote";
  const target = { clubId, userId, role };
  if (!isUuid(clubId) || !isUuid(userId)) return fail(action, actor, "Invalid club or user id.", target);
  if (role !== "member" && role !== "officer") return fail(action, actor, "Invalid role.", target);

  const admin = createAdminClient();
  const { data: member } = await admin
    .from("club_members")
    .select("id, role")
    .eq("club_id", clubId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!member) return fail(action, actor, "This user is not a member of this club.", target);

  const title = role === "officer" ? (roleTitle ?? "Officer").trim() : "Officer";
  if (role === "officer" && (title.length < 2 || title.length > 40)) {
    return fail(action, actor, "Officer title must be 2–40 characters.", target);
  }

  // One transaction in the database: role + roster together, and — for a demote —
  // the officer floor checked atomically under the club's advisory lock rather
  // than by a count read moments earlier in this process.
  const { data: status, error: rpcErr } = await admin.rpc("admin_set_club_member_role", {
    p_club_id: clubId,
    p_user_id: userId,
    p_role: role,
    p_role_title: title,
  });
  if (rpcErr) {
    return fail(
      action,
      actor,
      role === "officer" ? "Could not promote member." : "Could not demote officer.",
      target
    );
  }
  if (status !== "ok") return fail(action, actor, officerRpcMessage(status as string), target);

  // Read back authoritative role + roster.
  const [{ data: after }, { data: roster }] = await Promise.all([
    admin.from("club_members").select("id, role").eq("id", member.id).maybeSingle(),
    admin.from("club_officers").select("role_title").eq("club_id", clubId).eq("user_id", userId).maybeSingle(),
  ]);

  adminAudit({ action, actorId: actor.id, actorEmail: actor.email, target, ok: true, before: member, after: { role: after?.role, roster } });
  return { ok: true, data: { role: after?.role, roleTitle: roster?.role_title ?? null } };
}

/**
 * Add an officer by searching any user (mirrors add_club_officer): upsert the
 * membership as officer + the display roster. Works whether or not the user is
 * already a member.
 */
export async function addOfficer(clubId: string, userId: string, roleTitle: string): Promise<ActionResult> {
  const actor = await requireSecureAdmin({ write: true });
  const action = "officer.add";
  const target = { clubId, userId };
  if (!isUuid(clubId) || !isUuid(userId)) return fail(action, actor, "Invalid club or user id.", target);
  const title = (roleTitle ?? "Officer").trim();
  if (title.length < 2 || title.length > 40) return fail(action, actor, "Officer title must be 2–40 characters.", target);

  const admin = createAdminClient();

  // Membership row + display roster in ONE transaction (p_add_if_missing), so a
  // failure part-way cannot leave an officer without a roster entry. Club/user
  // existence and the same-campus rule are enforced inside the RPC.
  const { data: status, error: rpcErr } = await admin.rpc("admin_set_club_member_role", {
    p_club_id: clubId,
    p_user_id: userId,
    p_role: "officer",
    p_role_title: title,
    p_add_if_missing: true,
  });
  if (rpcErr) return fail(action, actor, "Could not add officer.", target);
  if (status !== "ok") return fail(action, actor, officerRpcMessage(status as string), target);

  const { data: after } = await admin
    .from("club_members")
    .select("id, role")
    .eq("club_id", clubId)
    .eq("user_id", userId)
    .maybeSingle();
  adminAudit({ action, actorId: actor.id, actorEmail: actor.email, target, ok: true, after });
  return { ok: true, data: { role: after?.role, roleTitle: title } };
}

/** Edit an existing officer's display title (canonical: club_officers roster). */
export async function editOfficerTitle(clubId: string, userId: string, roleTitle: string): Promise<ActionResult> {
  const actor = await requireSecureAdmin({ write: true });
  const action = "officer.editTitle";
  const target = { clubId, userId };
  if (!isUuid(clubId) || !isUuid(userId)) return fail(action, actor, "Invalid club or user id.", target);
  const title = (roleTitle ?? "").trim();
  if (title.length < 2 || title.length > 40) return fail(action, actor, "Officer title must be 2–40 characters.", target);

  const admin = createAdminClient();
  const { data: member } = await admin
    .from("club_members")
    .select("role")
    .eq("club_id", clubId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!member || member.role !== "officer") return fail(action, actor, "This user is not an officer of this club.", target);

  await upsertOfficerRoster(admin, clubId, userId, title);
  const { data: roster } = await admin
    .from("club_officers")
    .select("role_title")
    .eq("club_id", clubId)
    .eq("user_id", userId)
    .maybeSingle();

  adminAudit({ action, actorId: actor.id, actorEmail: actor.email, target, ok: true, after: roster });
  return { ok: true, data: { roleTitle: roster?.role_title ?? title } };
}

// ── Gluemates (mutual follows) ───────────────────────────────────────────────

/** Dissolve a mutual-follow (gluemate) relationship by deleting both directions. */
export async function removeGluemate(userAId: string, userBId: string): Promise<ActionResult> {
  const actor = await requireSecureAdmin({ write: true });
  const action = "gluemate.remove";
  const target = { userAId, userBId };
  if (!isUuid(userAId) || !isUuid(userBId)) return fail(action, actor, "Invalid user id.", target);
  if (userAId === userBId) return fail(action, actor, "A user cannot be their own gluemate.", target);

  const admin = createAdminClient();
  // Delete both directed follow rows so the pair is no longer mutual.
  const { error } = await admin
    .from("follows")
    .delete()
    .or(
      `and(follower_id.eq.${userAId},following_id.eq.${userBId}),and(follower_id.eq.${userBId},following_id.eq.${userAId})`
    );
  if (error) return fail(action, actor, "Could not remove the relationship.", target);

  const { data: remaining } = await admin
    .from("follows")
    .select("id")
    .or(
      `and(follower_id.eq.${userAId},following_id.eq.${userBId}),and(follower_id.eq.${userBId},following_id.eq.${userAId})`
    );
  const cleared = (remaining ?? []).length === 0;

  adminAudit({ action, actorId: actor.id, actorEmail: actor.email, target, ok: cleared, after: { remaining: remaining?.length ?? 0 } });
  return cleared ? { ok: true, data: { removed: true } } : { ok: false, error: "Relationship not fully removed." };
}

// ── Universities ─────────────────────────────────────────────────────────────

/** Create a new university (canonical: universities). */
export async function addUniversity(name: string, slug: string): Promise<ActionResult> {
  const actor = await requireSecureAdmin({ write: true });
  const action = "university.add";
  const cleanName = (name ?? "").trim();
  const cleanSlug = (slug ?? "").trim().toLowerCase();
  const target = { name: cleanName, slug: cleanSlug };
  if (cleanName.length < 2 || cleanName.length > 100) return fail(action, actor, "Name must be 2–100 characters.", target);
  if (!SLUG_RE.test(cleanSlug) || cleanSlug.length > 60) return fail(action, actor, "Slug must be lowercase words separated by hyphens.", target);

  const admin = createAdminClient();
  const { data: dupe } = await admin
    .from("universities")
    .select("id")
    .or(`name.eq.${cleanName},slug.eq.${cleanSlug}`)
    .maybeSingle();
  if (dupe) return fail(action, actor, "A university with that name or slug already exists.", target);

  const { data: row, error } = await admin
    .from("universities")
    .insert({ name: cleanName, slug: cleanSlug, is_active: true })
    .select("id, name, slug, is_active, created_at")
    .maybeSingle();
  if (error || !row) return fail(action, actor, "Could not create university.", target);

  adminAudit({ action, actorId: actor.id, actorEmail: actor.email, target, ok: true, after: row });
  return { ok: true, data: row };
}

/** Edit supported university fields (name, slug). */
export async function editUniversity(id: string, fields: { name?: string; slug?: string }): Promise<ActionResult> {
  const actor = await requireSecureAdmin({ write: true });
  const action = "university.edit";
  const target = { id, fields };
  if (!isUuid(id)) return fail(action, actor, "Invalid university id.", target);

  const update: Record<string, string> = {};
  if (fields.name !== undefined) {
    const n = fields.name.trim();
    if (n.length < 2 || n.length > 100) return fail(action, actor, "Name must be 2–100 characters.", target);
    update.name = n;
  }
  if (fields.slug !== undefined) {
    const s = fields.slug.trim().toLowerCase();
    if (!SLUG_RE.test(s) || s.length > 60) return fail(action, actor, "Slug must be lowercase words separated by hyphens.", target);
    update.slug = s;
  }
  if (Object.keys(update).length === 0) return fail(action, actor, "No changes provided.", target);

  const admin = createAdminClient();
  const { data: row, error } = await admin
    .from("universities")
    .update(update)
    .eq("id", id)
    .select("id, name, slug, is_active, created_at")
    .maybeSingle();
  if (error || !row) return fail(action, actor, "Could not update university (name/slug may be taken).", target);

  adminAudit({ action, actorId: actor.id, actorEmail: actor.email, target, ok: true, after: row });
  return { ok: true, data: row };
}

/** Activate or deactivate a university (canonical: universities.is_active). */
export async function setUniversityActive(id: string, isActive: boolean): Promise<ActionResult> {
  const actor = await requireSecureAdmin({ write: true });
  const action = "university.setActive";
  const target = { id, isActive };
  if (!isUuid(id)) return fail(action, actor, "Invalid university id.", target);
  if (typeof isActive !== "boolean") return fail(action, actor, "Invalid status.", target);

  const admin = createAdminClient();
  const { data: row, error } = await admin
    .from("universities")
    .update({ is_active: isActive })
    .eq("id", id)
    .select("id, name, slug, is_active")
    .maybeSingle();
  if (error || !row) return fail(action, actor, "Could not update status.", target);

  adminAudit({ action, actorId: actor.id, actorEmail: actor.email, target, ok: true, after: row });
  return { ok: true, data: row };
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
  try {
    await supabase.auth.signOut();
  } catch {
    // Best-effort — cookies may already be cleared.
  }
  // Revoke the entry ticket regardless of whether the sign-out succeeded: the
  // concealment must never outlive an explicit lock.
  clearEntryTicketCookie();
  if (user) {
    adminAudit({ action: "portal.lock", actorId: user.id, actorEmail: user.email, target: {}, ok: true });
  }
  return { ok: true, data: { locked: true } };
}
