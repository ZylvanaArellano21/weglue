"use server";

// ============================================================================
// Admin Dashboard — Day-3 content write actions  (SERVER-ONLY)
// posts, comments, events, RSVPs
// ============================================================================
// Same hardened contract as actions.ts:
//   1. requireSecureAdmin({ write: true })  — portal + allowlist + aal2 + write switch
//   2. strict validation on FIXED canonical fields
//   3. mutation on a fixed canonical table (no generic endpoint, no new columns)
//   4. read the changed record back
//   5. structured audit (success AND failure)
//   6. { ok } result — never throws to the client
//
// SAFE, CANONICAL operations only — no new deletion/soft-delete model is
// introduced (posts/comments have no status/deleted_at column in the schema):
//   • editPostCaption      — UPDATE posts.caption (the only editable text field)
//   • removePostFromClub   — the canonical "unglue" (remove_post_from_club):
//                            club_id→NULL + post_club_tags + club_photos cleanup.
//                            The post survives on the author's profile; this is
//                            the existing product hide-from-club behavior, not a
//                            delete. We replicate the RPC's writes directly with
//                            the service-role client (the RPC authorizes the
//                            CALLER as an officer via auth.uid(), which admin is
//                            not); DB triggers still fire on the table writes.
//   • editCommentContent   — UPDATE post_comments.content
//
// Permanent deletion, global hide, and media removal remain DISABLED (surfaced
// as clearly-labeled unavailable actions in the UI). Comments are never
// physically deleted here — no approved comment deletion lifecycle exists yet.
// ============================================================================

import { createAdminClient } from "../supabase/admin";
import { requireSecureAdmin } from "./secureAdmin";
import { adminAudit } from "./audit";
import { runAtomicMutation } from "./atomicMutation";
import type { ActionResult } from "./actions";
import type { User } from "@supabase/supabase-js";

const EVENT_VISIBILITY = ["everyone", "members", "specific"] as const;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}
async function fail(action: string, actor: User, error: string, target: Record<string, unknown>): Promise<{ ok: false; error: string }> {
  await adminAudit({ action, actorId: actor.id, actorEmail: actor.email, target, ok: false, error });
  return { ok: false, error };
}

export async function disableExternalShare(entityType: "post" | "event", entityId: string): Promise<ActionResult> {
  const actor = await requireSecureAdmin({ write: true });
  const action = "externalShare.disable";
  const target = { entityType, entityId };
  if ((entityType !== "post" && entityType !== "event") || !isUuid(entityId)) {
    return fail(action, actor, "Invalid external share target.", target);
  }

  const admin = createAdminClient();
  const disabledAt = new Date().toISOString();
  const { data, error } = await admin
    .from("external_share_settings")
    .update({ enabled: false, disabled_at: disabledAt, updated_at: disabledAt })
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .select("entity_type, entity_id, enabled, disabled_at, updated_at")
    .maybeSingle();

  if (error) return fail(action, actor, error.message, target);
  if (!data || data.enabled !== false) return fail(action, actor, "External sharing setting not found.", target);

  await adminAudit({ action, actorId: actor.id, actorEmail: actor.email, target, ok: true });
  return { ok: true, data: null };
}

const CAPTION_MAX = 2000;
const COMMENT_MAX = 2000;

// ── Posts ──────────────────────────────────────────────────────────────────────

/** Edit a post's caption (the only canonically-editable text field on posts). */
export async function editPostCaption(postId: string, caption: string): Promise<ActionResult> {
  const actor = await requireSecureAdmin({ write: true });
  if (!isUuid(postId)) return fail("post.editCaption", actor, "Invalid post id.", { postId });
  return runAtomicMutation({
    action: "post.editCaption",
    actor,
    rpc: "admin_tx_post_caption_set",
    args: { p_post_id: postId, p_caption: caption ?? "" },
    target: { postId },
  });
}

/**
 * Un-tag a post from ONE club. Destructive, so a reason is required.
 * The 056 function clears the primary tag, the extra tag row and the club's
 * Glue-photo entry in a single transaction — a post can never be left partly
 * detached.
 */
export async function removePostFromClub(postId: string, clubId: string, reason: string): Promise<ActionResult> {
  const actor = await requireSecureAdmin({ write: true });
  if (!isUuid(postId) || !isUuid(clubId)) {
    return fail("post.removeFromClub", actor, "Invalid post or club id.", { postId, clubId });
  }
  return runAtomicMutation({
    action: "post.removeFromClub",
    actor,
    reason,
    rpc: "admin_tx_post_remove_from_club",
    args: { p_post_id: postId, p_club_id: clubId },
    target: { postId, clubId },
  });
}

// ── Comments ─────────────────────────────────────────────────────────────────

/** Edit a comment's text (the only canonically-editable field on post_comments). */
export async function editCommentContent(commentId: string, content: string): Promise<ActionResult> {
  const actor = await requireSecureAdmin({ write: true });
  if (!isUuid(commentId)) return fail("comment.editContent", actor, "Invalid comment id.", { commentId });
  return runAtomicMutation({
    action: "comment.editContent",
    actor,
    rpc: "admin_tx_comment_content_set",
    args: { p_comment_id: commentId, p_content: content ?? "" },
    target: { commentId },
  });
}

// ── Events ───────────────────────────────────────────────────────────────────

export interface EditEventFields {
  title?: string;
  emoji?: string | null;
  description?: string | null;
  event_date?: string;
  start_time?: string;
  end_time?: string | null;
  location?: string | null;
  building?: string | null;
  room?: string | null;
  visibility?: string;
}

/** Edit supported event fields. Only allowlisted keys are applied. */
export async function editEvent(eventId: string, fields: EditEventFields): Promise<ActionResult> {
  const actor = await requireSecureAdmin({ write: true });
  const action = "event.edit";
  const target = { eventId };
  if (!isUuid(eventId)) return fail(action, actor, "Invalid event id.", target);

  // Normalized, allowlisted field set actually sent to the database.
  const update: Record<string, unknown> = {};

  // Field validation stays in the server layer, BEFORE the database is touched.
  // A malformed date or an invalid visibility should never reach a transaction
  // at all — and these are presentation rules, not data invariants.
  if (fields.title !== undefined) {
    const t = fields.title.trim();
    if (t.length < 2 || t.length > 200) return fail(action, actor, "Title must be 2–200 characters.", target);
    update.title = t;
  }
  if (fields.description !== undefined) {
    const d = (fields.description ?? "").trim();
    if (d.length > 5000) return fail(action, actor, "Description must be 5000 characters or fewer.", target);
    update.description = d || null;
  }
  if (fields.event_date !== undefined) {
    if (!DATE_RE.test(fields.event_date) || Number.isNaN(Date.parse(fields.event_date))) {
      return fail(action, actor, "Event date must be a valid YYYY-MM-DD date.", target);
    }
    update.event_date = fields.event_date;
  }
  if (fields.start_time !== undefined) {
    if (!TIME_RE.test(fields.start_time)) return fail(action, actor, "Start time must be HH:MM.", target);
    update.start_time = fields.start_time;
  }
  if (fields.end_time !== undefined) {
    if (fields.end_time !== null && !TIME_RE.test(fields.end_time)) {
      return fail(action, actor, "End time must be HH:MM.", target);
    }
    update.end_time = fields.end_time;
  }
  for (const key of ["location", "building", "room"] as const) {
    if (fields[key] !== undefined) {
      const v = ((fields[key] ?? "") as string).trim();
      if (v.length > 200) return fail(action, actor, `${key} must be 200 characters or fewer.`, target);
      update[key] = v || null;
    }
  }
  if (fields.visibility !== undefined) {
    if (!EVENT_VISIBILITY.includes(fields.visibility as (typeof EVENT_VISIBILITY)[number])) {
      return fail(action, actor, "Invalid visibility value.", target);
    }
    update.visibility = fields.visibility;
  }
  if (fields.emoji !== undefined) {
    const e = (fields.emoji ?? "").trim();
    if (e.length > 8) return fail(action, actor, "Emoji must be a single glyph.", target);
    update.emoji = e || null;
  }

  // Chronology is checked on the MERGED start/end, so changing only one of the
  // two cannot produce an event that ends before it starts.
  const admin = createAdminClient();
  const { data: before } = await admin
    .from("events")
    .select("start_time, end_time")
    .eq("id", eventId)
    .maybeSingle();
  if (!before) return fail(action, actor, "Event not found.", target);

  const norm = (t?: string | null) => (t ? (t.length === 5 ? `${t}:00` : t) : null);
  const mergedStart = norm((update.start_time as string) ?? (before as any).start_time);
  const mergedEnd = norm((update.end_time as string) ?? (before as any).end_time);
  if (mergedStart && mergedEnd && mergedStart >= mergedEnd) {
    return fail(action, actor, "Start time must be before end time.", target);
  }

  return runAtomicMutation({
    action,
    actor,
    rpc: "admin_tx_event_edit",
    args: { p_event_id: eventId, p_fields: update },
    target,
  });
}

// ── RSVPs ────────────────────────────────────────────────────────────────────

/** Create or change one RSVP. */
export async function upsertRsvp(eventId: string, userId: string, status: string): Promise<ActionResult> {
  const actor = await requireSecureAdmin({ write: true });
  if (!isUuid(eventId) || !isUuid(userId)) {
    return fail("rsvp.upsert", actor, "Invalid event or user id.", { eventId, userId, status });
  }
  return runAtomicMutation({
    action: "rsvp.upsert",
    actor,
    rpc: "admin_tx_rsvp_upsert",
    args: { p_event_id: eventId, p_user_id: userId, p_status: status },
    target: { eventId, userId, status },
  });
}

/** Remove one RSVP. Destructive, so a reason is required. */
export async function removeRsvp(eventId: string, userId: string, reason: string): Promise<ActionResult> {
  const actor = await requireSecureAdmin({ write: true });
  if (!isUuid(eventId) || !isUuid(userId)) {
    return fail("rsvp.remove", actor, "Invalid event or user id.", { eventId, userId });
  }
  return runAtomicMutation({
    action: "rsvp.remove",
    actor,
    reason,
    rpc: "admin_tx_rsvp_remove",
    args: { p_event_id: eventId, p_user_id: userId },
    target: { eventId, userId },
  });
}
