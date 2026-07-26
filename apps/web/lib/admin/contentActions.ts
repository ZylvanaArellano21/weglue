"use server";

// ============================================================================
// Admin Dashboard — Day-3 content write actions: posts + comments (SERVER-ONLY)
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
function fail(action: string, actor: User, error: string, target: Record<string, unknown>): { ok: false; error: string } {
  adminAudit({ action, actorId: actor.id, actorEmail: actor.email, target, ok: false, error });
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

  adminAudit({ action, actorId: actor.id, actorEmail: actor.email, target, ok: true, before, after: row });
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
  adminAudit({ action, actorId: actor.id, actorEmail: actor.email, target, ok: cleared, before: post, after });
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

  adminAudit({ action, actorId: actor.id, actorEmail: actor.email, target, ok: true, before, after: row });
  return { ok: true, data: row };
}
