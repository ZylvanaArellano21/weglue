"use server";

// ============================================================================
// Admin Dashboard — Day-4 messaging actions + sensitive reveal  (SERVER-ONLY)
// ============================================================================
// Two kinds of exports, both hardened:
//
//   READS behind step-up MFA (return data, mutate nothing):
//     • revealMessageBody(id)     — the full private body of ONE currently-visible
//                                   message. requireRecentMfa + no content in
//                                   logs/URLs/browser storage; deleted rows are
//                                   ALWAYS denied (retained history never served).
//     • searchMessageContent(q)   — active-message text search. requireRecentMfa,
//                                   minimum query length, server-side result cap,
//                                   no content logged, no deleted content.
//
//   WRITES (canonical, safe lifecycle only — every one: requireSecureAdmin({write})
//   → strict validation → fixed canonical table → read-back → audit → {ok}):
//     • createChannel / renameChannel / setChannelPermission
//     • deleteEmptyChannel  (Main chat + ANY channel with a message row are
//                            refused — no message cascade, no hard message delete)
//     • setNotificationRead (mark read/unread; notifications.read + read_at)
//
// EXPLICITLY NOT EXPORTED (disabled in the UI with reasons):
//   • direct message UPDATE/DELETE/redact/restore — the Day 10F privacy
//     lifecycle permits only its dedicated server-authorized deletion path;
//     this dashboard never bypasses it or restores content.
//   • notification removal / resend — push_queue.notification_id CASCADEs, so a
//     removal would corrupt pending delivery state; no admin resend fn exists.
//
// Officer authority is club_members.role='officer' (is_club_officer). The
// canonical channel RPCs (041) authorize the CALLER via auth.uid() as an
// officer, which the admin service-role client is not — so, exactly like
// actions.ts/contentActions.ts, we replicate their fixed writes directly with
// the service-role client AFTER our own founder + relationship validation. DB
// triggers still fire on the table writes.
// ============================================================================

import { createAdminClient } from "../supabase/admin";
import { requireSecureAdmin, requireRecentMfa } from "./secureAdmin";
import { adminAudit } from "./audit";
import { runAtomicMutation } from "./atomicMutation";
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

// Never log message CONTENT. The audit target for content operations records
// only ids and metadata (byte length), never the text itself.

// ── Sensitive reveal: one currently-visible message body ─────────────────────

export interface RevealedMessage {
  id: string;
  message_type: string;
  content: string | null;
  attachment: { name: string | null; size: number | null; mime: string | null } | null;
  poll_question: string | null;
}

/**
 * Reveal the full body of a single, currently-visible message. Requires a
 * FRESH MFA verification on top of aal2. A deleted/redacted message is always
 * denied — retained original content is never served from this branch.
 *
 * The caller (a Route Handler wrapper) must return this with `no-store`. This
 * function itself: constructs the service-role client only after authorization,
 * never logs the content, never returns anything but the one requested row.
 */
export async function revealMessageBody(messageId: string): Promise<ActionResult<RevealedMessage>> {
  // requireRecentMfa throws SecureAdminError (mfa_required / stepup_required /
  // portal_disabled / denied) which propagates to the Route Handler as 401/403.
  const actor = await requireRecentMfa();
  const action = "message.revealBody";
  const target = { messageId };
  if (!isUuid(messageId)) return fail(action, actor, "Invalid message id.", target);

  const admin = createAdminClient();
  const { data: msg } = await admin
    .from("messages")
    .select("id, message_type, content, attachment_name, attachment_size, attachment_mime, attachment_url, deleted_at")
    .eq("id", messageId)
    .maybeSingle();
  if (!msg) return fail(action, actor, "Message not found.", target);
  const m = msg as any;

  // Retained-evidence protection: deleted rows never reveal original content.
  if (m.deleted_at) {
    await adminAudit({ action, actorId: actor.id, actorEmail: actor.email, target: { messageId, deleted: true }, ok: false, error: "deleted_denied" });
    return { ok: false, error: "This message is deleted. Only pre-captured evidence may be available through its protected report." };
  }

  let pollQuestion: string | null = null;
  if (m.message_type === "poll") {
    const { data: poll } = await admin.from("polls").select("question").eq("message_id", messageId).maybeSingle();
    pollQuestion = (poll as any)?.question ?? null;
  }

  // Audit records the reveal happened + content byte length — NEVER the content.
  await adminAudit({
    action,
    actorId: actor.id,
    actorEmail: actor.email,
    target: { messageId, message_type: m.message_type, content_len: (m.content ?? "").length, has_attachment: !!m.attachment_url },
    ok: true,
  });

  return {
    ok: true,
    data: {
      id: m.id,
      message_type: m.message_type,
      content: m.content ?? null,
      attachment: m.attachment_url ? { name: m.attachment_name ?? null, size: m.attachment_size ?? null, mime: m.attachment_mime ?? null } : null,
      poll_question: pollQuestion,
    },
  };
}

// ── Sensitive reveal: active-message content search ──────────────────────────

export interface MessageContentHit {
  id: string;
  conversation_id: string;
  sender_username: string;
  message_type: string;
  preview: string;
  created_at: string;
}

const MESSAGE_SEARCH_MIN = 3;
const MESSAGE_SEARCH_LIMIT = 25;

/**
 * Search the text of CURRENTLY-VISIBLE messages. Requires fresh MFA, a minimum
 * query length, and returns at most MESSAGE_SEARCH_LIMIT rows. Deleted messages
 * are excluded. The query term and the matched content are never logged.
 */
export async function searchMessageContent(query: string): Promise<ActionResult<MessageContentHit[]>> {
  const actor = await requireRecentMfa();
  const action = "message.contentSearch";
  const term = (query ?? "").trim();
  if (term.length < MESSAGE_SEARCH_MIN) {
    return fail(action, actor, `Enter at least ${MESSAGE_SEARCH_MIN} characters to search message content.`, { len: term.length });
  }

  const admin = createAdminClient();
  const like = `%${term}%`;
  const { data, error } = await admin
    .from("messages")
    .select("id, conversation_id, sender_id, message_type, content, created_at")
    .eq("message_type", "text")
    .is("deleted_at", null)
    .ilike("content", like)
    .order("created_at", { ascending: false })
    .limit(MESSAGE_SEARCH_LIMIT);
  if (error) return fail(action, actor, "Search failed.", { len: term.length });

  const rows = (data ?? []) as any[];
  const senderIds = Array.from(new Set(rows.map((r) => r.sender_id)));
  const senders = new Map<string, string>();
  if (senderIds.length) {
    const { data: profs } = await admin.from("profiles").select("id, username").in("id", senderIds);
    for (const p of (profs ?? []) as any[]) senders.set(p.id, p.username);
  }

  // Audit records the search happened + result count — NEVER the term/content.
  await adminAudit({ action, actorId: actor.id, actorEmail: actor.email, target: { len: term.length, results: rows.length }, ok: true });

  const hits: MessageContentHit[] = rows.map((r) => {
    const t = (r.content ?? "").trim();
    return {
      id: r.id,
      conversation_id: r.conversation_id,
      sender_username: senders.get(r.sender_id) ?? "",
      message_type: r.message_type,
      preview: t.length > 140 ? `${t.slice(0, 140)}…` : t,
      created_at: r.created_at,
    };
  });
  return { ok: true, data: hits };
}

// ── Channel management (safe canonical lifecycle) ────────────────────────────

const CHANNEL_NAME_MAX = 60;
// `certain` is deliberately absent: that mode is driven by channel_posters
// rows, managed in-app, and must never be set from the dashboard.
const CHANNEL_PERMISSIONS = ["everyone", "officers"] as const;

/** Normalize a channel name exactly like the canonical create/rename RPCs (041). */
function cleanChannelName(raw: string): string {
  let v = raw.trim().toLowerCase().replace(/\s+/g, "-");
  v = v.replace(/[^a-z0-9\-_]/g, "");
  return v;
}

async function loadConversationForChannelOp(admin: ReturnType<typeof createAdminClient>, conversationId: string) {
  const { data } = await admin.from("conversations").select("id, type, club_id, deleted_at").eq("id", conversationId).maybeSingle();
  return (data as any) ?? null;
}

/**
 * Create a hashtag channel under an existing club/officer/custom-group
 * conversation. Never creates a Main chat; verifies the conversation exists and
 * (for club conversations) belongs to a real club; reads the row back; audits.
 */
export async function createChannel(conversationId: string, name: string): Promise<ActionResult> {
  const actor = await requireSecureAdmin({ write: true });
  const target = { conversationId };
  if (!isUuid(conversationId)) return fail("channel.create", actor, "Invalid conversation id.", target);
  const clean = cleanChannelName(name ?? "");
  if (clean.length < 1) return fail("channel.create", actor, "Channel name must contain letters or numbers.", target);
  if (clean.length > CHANNEL_NAME_MAX) {
    return fail("channel.create", actor, `Channel name must be ${CHANNEL_NAME_MAX} characters or fewer.`, target);
  }

  // Conversation-shape rules are a product concern, checked before the
  // transaction: channels exist only on club and custom-group conversations.
  const admin = createAdminClient();
  const { data: conv } = await admin
    .from("conversations")
    .select("id, type, club_id, deleted_at")
    .eq("id", conversationId)
    .maybeSingle();
  if (!conv) return fail("channel.create", actor, "Conversation not found.", target);
  if ((conv as any).deleted_at) {
    return fail("channel.create", actor, "Cannot add a channel to an archived conversation.", target);
  }
  if (!["club_group", "officer_chat", "group"].includes((conv as any).type)) {
    return fail("channel.create", actor, "Channels are only supported on club and custom-group conversations.", target);
  }
  if (["club_group", "officer_chat"].includes((conv as any).type) && !(conv as any).club_id) {
    return fail("channel.create", actor, "Club conversation is missing its club relationship.", target);
  }

  return runAtomicMutation({
    action: "channel.create",
    actor,
    rpc: "admin_tx_channel_create",
    args: { p_conversation_id: conversationId, p_name: clean },
    target: { conversationId },
  });
}

/** Rename a channel. The Main chat cannot be renamed. */
export async function renameChannel(channelId: string, name: string): Promise<ActionResult> {
  const actor = await requireSecureAdmin({ write: true });
  if (!isUuid(channelId)) return fail("channel.rename", actor, "Invalid channel id.", { channelId });
  return runAtomicMutation({
    action: "channel.rename",
    actor,
    rpc: "admin_tx_channel_rename",
    args: { p_channel_id: channelId, p_name: cleanChannelName(name ?? "") },
    target: { channelId },
  });
}

/** Change who may post in a channel. */
export async function setChannelPermission(channelId: string, permission: string): Promise<ActionResult> {
  const actor = await requireSecureAdmin({ write: true });
  const target = { channelId, permission };
  if (!isUuid(channelId)) return fail("channel.setPermission", actor, "Invalid channel id.", target);
  // `certain` is managed in-app through channel_posters, never set from here.
  if (!CHANNEL_PERMISSIONS.includes(permission as (typeof CHANNEL_PERMISSIONS)[number])) {
    return fail("channel.setPermission", actor, "Permission must be 'everyone' or 'officers'.", target);
  }
  return runAtomicMutation({
    action: "channel.setPermission",
    actor,
    rpc: "admin_tx_channel_set_permission",
    args: { p_channel_id: channelId, p_permission: permission },
    target: { channelId, permission },
  });
}

/**
 * Delete a channel that holds NO messages. Destructive, so a reason is required.
 * The emptiness check happens inside the transaction, so a message arriving
 * concurrently cannot slip past a check made moments earlier.
 */
export async function deleteEmptyChannel(channelId: string, reason: string): Promise<ActionResult> {
  const actor = await requireSecureAdmin({ write: true });
  if (!isUuid(channelId)) return fail("channel.deleteEmpty", actor, "Invalid channel id.", { channelId });
  return runAtomicMutation({
    action: "channel.deleteEmpty",
    actor,
    reason,
    rpc: "admin_tx_channel_delete_empty",
    args: { p_channel_id: channelId },
    target: { channelId },
  });
}

// ── Notification read-state (canonical, safe) ────────────────────────────────

/** Mark a single notification read/unread (notifications.read + read_at). */
export async function setNotificationRead(notificationId: string, read: boolean): Promise<ActionResult> {
  const actor = await requireSecureAdmin({ write: true });
  if (!isUuid(notificationId)) {
    return fail("notification.setRead", actor, "Invalid notification id.", { notificationId, read });
  }
  return runAtomicMutation({
    action: "notification.setRead",
    actor,
    rpc: "admin_tx_notification_set_read",
    args: { p_notification_id: notificationId, p_read: !!read },
    target: { notificationId, read },
  });
}
