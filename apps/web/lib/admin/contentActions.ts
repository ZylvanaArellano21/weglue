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
import type { ActionResult } from "./actions";
import type { User } from "@supabase/supabase-js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}
async function fail(action: string, actor: User, error: string, target: Record<string, unknown>): Promise<{ ok: false; error: string }> {
  await adminAudit({ action, actorId: actor.id, actorEmail: actor.email, target, ok: false, error });
  return { ok: false, error };
}

const CAPTION_MAX = 2000;
const COMMENT_MAX = 2000;

// ── Posts ──────────────────────────────────────────────────────────────────────

/** Edit a post's caption (the only canonically-editable text field on posts). */
export async function editPostCaption(postId: string, caption: string): Promise<ActionResult> {
  const actor = await requireSecureAdmin({ write: true });
  const action = "post.editCaption";
  const target = { postId };
  if (!isUuid(postId)) return fail(action, actor, "Invalid post id.", target);
  const clean = (caption ?? "").trim();
  if (clean.length > CAPTION_MAX) return fail(action, actor, `Caption must be ${CAPTION_MAX} characters or fewer.`, target);

  const admin = createAdminClient();
  const { data: before } = await admin.from("posts").select("id, caption").eq("id", postId).maybeSingle();
  if (!before) return fail(action, actor, "Post not found.", target);

  const expected = clean.length ? clean : null;
  const { data: row, error } = await admin
    .from("posts")
    .update({ caption: expected })
    .eq("id", postId)
    .select("id, caption")
    .maybeSingle();
  if (error || !row) return fail(action, actor, "Could not update caption.", target);
  if ((row.caption ?? null) !== expected) return fail(action, actor, "Update did not take effect.", target);

  await adminAudit({ action, actorId: actor.id, actorEmail: actor.email, target, ok: true, before, after: row });
  return { ok: true, data: row };
}

/**
 * Remove a post from a club (canonical "unglue" — mirrors remove_post_from_club).
 * The post is untagged from the club and disappears from that club's feed/photos,
 * but is NOT deleted (it remains on the author's profile). This is the existing
 * hide-from-club behavior, not a new deletion model.
 */
export async function removePostFromClub(postId: string, clubId: string): Promise<ActionResult> {
  const actor = await requireSecureAdmin({ write: true });
  const action = "post.removeFromClub";
  const target = { postId, clubId };
  if (!isUuid(postId) || !isUuid(clubId)) return fail(action, actor, "Invalid post or club id.", target);

  const admin = createAdminClient();
  const { data: post } = await admin.from("posts").select("id, club_id").eq("id", postId).maybeSingle();
  if (!post) return fail(action, actor, "Post not found.", target);

  const { data: extraTag } = await admin
    .from("post_club_tags")
    .select("id")
    .eq("post_id", postId)
    .eq("club_id", clubId)
    .maybeSingle();
  const isPrimary = post.club_id === clubId;
  if (!isPrimary && !extraTag) {
    return fail(action, actor, "This post is not tagged to that club.", target);
  }

  // Primary tag lives on the post row itself.
  if (isPrimary) {
    const { error } = await admin.from("posts").update({ club_id: null }).eq("id", postId).eq("club_id", clubId);
    if (error) return fail(action, actor, "Could not remove the post from the club.", target);
  }
  // Extra tags + the club's Glue photo entry for THIS club only.
  await admin.from("post_club_tags").delete().eq("post_id", postId).eq("club_id", clubId);
  await admin.from("club_photos").delete().eq("post_id", postId).eq("club_id", clubId);

  // Read back: neither the primary tag nor an extra tag should remain for this club.
  const [{ data: after }, { data: stillTagged }] = await Promise.all([
    admin.from("posts").select("id, club_id").eq("id", postId).maybeSingle(),
    admin.from("post_club_tags").select("id").eq("post_id", postId).eq("club_id", clubId).maybeSingle(),
  ]);
  const cleared = after?.club_id !== clubId && !stillTagged;
  await adminAudit({ action, actorId: actor.id, actorEmail: actor.email, target, ok: cleared, before: post, after });
  return cleared
    ? { ok: true, data: { removed: true } }
    : { ok: false, error: "Removal did not take effect." };
}

// ── Comments ─────────────────────────────────────────────────────────────────

/** Edit a comment's text (the only canonically-editable field on post_comments). */
export async function editCommentContent(commentId: string, content: string): Promise<ActionResult> {
  const actor = await requireSecureAdmin({ write: true });
  const action = "comment.editContent";
  const target = { commentId };
  if (!isUuid(commentId)) return fail(action, actor, "Invalid comment id.", target);
  const clean = (content ?? "").trim();
  if (clean.length < 1) return fail(action, actor, "A comment cannot be empty.", target);
  if (clean.length > COMMENT_MAX) return fail(action, actor, `Comment must be ${COMMENT_MAX} characters or fewer.`, target);

  const admin = createAdminClient();
  const { data: before } = await admin.from("post_comments").select("id, content").eq("id", commentId).maybeSingle();
  if (!before) return fail(action, actor, "Comment not found.", target);

  const { data: row, error } = await admin
    .from("post_comments")
    .update({ content: clean })
    .eq("id", commentId)
    .select("id, content")
    .maybeSingle();
  if (error || !row) return fail(action, actor, "Could not update comment.", target);
  if ((row.content ?? "") !== clean) return fail(action, actor, "Update did not take effect.", target);

  await adminAudit({ action, actorId: actor.id, actorEmail: actor.email, target, ok: true, before, after: row });
  return { ok: true, data: row };
}

// ── Events ─────────────────────────────────────────────────────────────────────

const EVENT_VISIBILITY = ["everyone", "members", "specific"] as const;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/;

export interface EditEventFields {
  title?: string;
  description?: string;
  event_date?: string;
  start_time?: string;
  end_time?: string;
  location?: string;
  building?: string;
  room?: string;
  visibility?: string;
  emoji?: string;
}

/**
 * Edit supported event fields on the canonical `events` row (title, description,
 * date/time, location/building/room, visibility, emoji). Validates chronology
 * (start < end), date/time format, and the visibility enum against the MERGED
 * row so a single-field edit can't create an inconsistent event. Never creates a
 * competing event model. There is no hidden/archived column, so archive/restore
 * remains a disabled UI affordance.
 */
export async function editEvent(eventId: string, fields: EditEventFields): Promise<ActionResult> {
  const actor = await requireSecureAdmin({ write: true });
  const action = "event.edit";
  const target = { eventId, fields };
  if (!isUuid(eventId)) return fail(action, actor, "Invalid event id.", target);

  const admin = createAdminClient();
  const { data: before } = await admin
    .from("events")
    .select("id, title, description, event_date, start_time, end_time, location, building, room, visibility, emoji")
    .eq("id", eventId)
    .maybeSingle();
  if (!before) return fail(action, actor, "Event not found.", target);

  const update: Record<string, unknown> = {};

  if (fields.title !== undefined) {
    const t = fields.title.trim();
    if (t.length < 2 || t.length > 200) return fail(action, actor, "Title must be 2–200 characters.", target);
    update.title = t;
  }
  if (fields.description !== undefined) {
    const d = fields.description.trim();
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
    if (!TIME_RE.test(fields.end_time)) return fail(action, actor, "End time must be HH:MM.", target);
    update.end_time = fields.end_time;
  }
  for (const key of ["location", "building", "room"] as const) {
    if (fields[key] !== undefined) {
      const v = (fields[key] as string).trim();
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
    const e = fields.emoji.trim();
    if (e.length > 8) return fail(action, actor, "Emoji must be a single glyph.", target);
    update.emoji = e || null;
  }

  if (Object.keys(update).length === 0) return fail(action, actor, "No changes provided.", target);

  // Chronology check on the MERGED start/end (normalize to HH:MM:SS for compare).
  const norm = (t?: string | null) => (t ? (t.length === 5 ? `${t}:00` : t) : null);
  const mergedStart = norm((update.start_time as string) ?? before.start_time);
  const mergedEnd = norm((update.end_time as string) ?? before.end_time);
  if (mergedStart && mergedEnd && mergedStart >= mergedEnd) {
    return fail(action, actor, "Start time must be before end time.", target);
  }

  const { data: row, error } = await admin
    .from("events")
    .update(update)
    .eq("id", eventId)
    .select("id, title, description, event_date, start_time, end_time, location, building, room, visibility, emoji")
    .maybeSingle();
  if (error || !row) return fail(action, actor, "Could not update the event.", target);

  await adminAudit({ action, actorId: actor.id, actorEmail: actor.email, target, ok: true, before, after: row });
  return { ok: true, data: row };
}

// ── RSVPs ──────────────────────────────────────────────────────────────────────

const RSVP_STATUS = ["going", "cant"] as const;

/**
 * Add or update a user's RSVP to an event (canonical event_rsvps, UNIQUE
 * (event_id,user_id)). Duplicate rows are impossible: an existing RSVP is
 * updated in place. Counts stay correct because the admin reads them live and
 * Realtime fires on the table write — no cached count is touched.
 */
export async function upsertRsvp(eventId: string, userId: string, status: string): Promise<ActionResult> {
  const actor = await requireSecureAdmin({ write: true });
  const action = "rsvp.upsert";
  const target = { eventId, userId, status };
  if (!isUuid(eventId) || !isUuid(userId)) return fail(action, actor, "Invalid event or user id.", target);
  if (!RSVP_STATUS.includes(status as (typeof RSVP_STATUS)[number])) {
    return fail(action, actor, "RSVP status must be 'going' or 'cant'.", target);
  }

  const admin = createAdminClient();
  const [{ data: event }, { data: user }] = await Promise.all([
    admin.from("events").select("id").eq("id", eventId).maybeSingle(),
    admin.from("profiles").select("id").eq("id", userId).maybeSingle(),
  ]);
  if (!event) return fail(action, actor, "Event not found.", target);
  if (!user) return fail(action, actor, "User not found.", target);

  const { data: existing } = await admin
    .from("event_rsvps")
    .select("id, status")
    .eq("event_id", eventId)
    .eq("user_id", userId)
    .maybeSingle();

  if (existing) {
    if (existing.status !== status) {
      const { error } = await admin.from("event_rsvps").update({ status }).eq("id", existing.id);
      if (error) return fail(action, actor, "Could not update the RSVP.", target);
    }
  } else {
    const { error } = await admin.from("event_rsvps").insert({ event_id: eventId, user_id: userId, status });
    if (error) return fail(action, actor, "Could not add the RSVP.", target);
  }

  const { data: after } = await admin
    .from("event_rsvps")
    .select("id, event_id, user_id, status")
    .eq("event_id", eventId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!after || after.status !== status) return fail(action, actor, "RSVP did not take effect.", target);

  await adminAudit({ action, actorId: actor.id, actorEmail: actor.email, target, ok: true, before: existing ?? null, after });
  return { ok: true, data: after };
}

/** Remove/cancel a user's RSVP to an event (canonical event_rsvps delete). */
export async function removeRsvp(eventId: string, userId: string): Promise<ActionResult> {
  const actor = await requireSecureAdmin({ write: true });
  const action = "rsvp.remove";
  const target = { eventId, userId };
  if (!isUuid(eventId) || !isUuid(userId)) return fail(action, actor, "Invalid event or user id.", target);

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("event_rsvps")
    .select("id, status")
    .eq("event_id", eventId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!existing) return fail(action, actor, "This user has no RSVP for this event.", target);

  const { error } = await admin.from("event_rsvps").delete().eq("event_id", eventId).eq("user_id", userId);
  if (error) return fail(action, actor, "Could not remove the RSVP.", target);

  const { data: check } = await admin
    .from("event_rsvps")
    .select("id")
    .eq("event_id", eventId)
    .eq("user_id", userId)
    .maybeSingle();
  const removed = !check;
  await adminAudit({ action, actorId: actor.id, actorEmail: actor.email, target, ok: removed, before: existing, after: null });
  return removed ? { ok: true, data: { removed: true } } : { ok: false, error: "Removal did not take effect." };
}
