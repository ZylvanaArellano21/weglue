// ============================================================================
// Admin Dashboard — audit payload sanitization + action registry (SERVER-ONLY)
// ============================================================================
//
// This module is the FIRST of two independent barriers protecting the audit
// trail. It is an ALLOWLIST, not a blocklist: a field reaches the database only
// because it was named here. Anything unrecognised is dropped silently, so a
// future action that starts passing a new field cannot leak it by accident.
//
// The SECOND barrier lives in the database (migration 055 §5): recursive
// forbidden-key and credential-value scans, plus an absolute ban on private
// message content for message-targeted rows. If this module were bypassed or
// broken, the database still refuses the row.
//
// Why two barriers rather than one: this file is the layer that knows WHICH
// fields are meaningful for each action, and the database is the layer that
// cannot be redeployed around. Neither alone is sufficient.
// ============================================================================

if (typeof window !== "undefined") {
  throw new Error(
    "lib/admin/auditSanitize.ts is server-only and must not be imported in the browser."
  );
}

// ── Controlled vocabulary ────────────────────────────────────────────────────
// MUST stay in lockstep with the admin_audit_actions catalog seeded by
// migration 055. `auditRegistry.test.ts` parses the migration and fails if the
// two ever drift.

export const AUDIT_TARGET_TYPES = [
  "user", "profile", "club", "club_member", "club_officer", "university",
  "post", "comment", "event", "rsvp", "gluemate",
  "conversation", "channel", "message", "notification",
  "report", "portal", "system",
] as const;

export type AuditTargetType = (typeof AUDIT_TARGET_TYPES)[number];
export type AuditSensitivity = "ordinary" | "sensitive" | "destructive";

interface AuditActionSpec {
  targetType: AuditTargetType;
  /** Key in the caller's `target` object holding the canonical target UUID. */
  targetIdKey: string | null;
  sensitivity: AuditSensitivity;
  /** Mirrors admin_audit_actions.requires_reason. Enforced in the database. */
  requiresReason: boolean;
  /** Allowlisted keys copied from `target` into metadata. */
  metadataKeys: readonly string[];
}

export const AUDIT_ACTIONS = {
  "membership.add":       { targetType: "club_member",  targetIdKey: "userId",         sensitivity: "ordinary",    requiresReason: false, metadataKeys: ["clubId", "userId"] },
  "membership.remove":    { targetType: "club_member",  targetIdKey: "userId",         sensitivity: "destructive", requiresReason: true,  metadataKeys: ["clubId", "userId"] },
  "officer.promote":      { targetType: "club_officer", targetIdKey: "userId",         sensitivity: "sensitive",   requiresReason: false, metadataKeys: ["clubId", "userId", "role"] },
  "officer.demote":       { targetType: "club_officer", targetIdKey: "userId",         sensitivity: "destructive", requiresReason: true,  metadataKeys: ["clubId", "userId", "role"] },
  "officer.add":          { targetType: "club_officer", targetIdKey: "userId",         sensitivity: "sensitive",   requiresReason: false, metadataKeys: ["clubId", "userId"] },
  "officer.editTitle":    { targetType: "club_officer", targetIdKey: "userId",         sensitivity: "ordinary",    requiresReason: false, metadataKeys: ["clubId", "userId"] },
  "gluemate.remove":      { targetType: "gluemate",     targetIdKey: "userAId",        sensitivity: "destructive", requiresReason: true,  metadataKeys: ["userAId", "userBId"] },
  "university.add":       { targetType: "university",   targetIdKey: null,             sensitivity: "sensitive",   requiresReason: true,  metadataKeys: ["name", "slug"] },
  "university.edit":      { targetType: "university",   targetIdKey: "id",             sensitivity: "sensitive",   requiresReason: false, metadataKeys: ["id"] },
  "university.setActive": { targetType: "university",   targetIdKey: "id",             sensitivity: "sensitive",   requiresReason: true,  metadataKeys: ["id", "isActive"] },
  "portal.lock":          { targetType: "portal",       targetIdKey: null,             sensitivity: "ordinary",    requiresReason: false, metadataKeys: [] },
  "post.editCaption":     { targetType: "post",         targetIdKey: "postId",         sensitivity: "ordinary",    requiresReason: false, metadataKeys: ["postId"] },
  "post.removeFromClub":  { targetType: "post",         targetIdKey: "postId",         sensitivity: "destructive", requiresReason: true,  metadataKeys: ["postId", "clubId"] },
  "comment.editContent":  { targetType: "comment",      targetIdKey: "commentId",      sensitivity: "ordinary",    requiresReason: false, metadataKeys: ["commentId"] },
  "event.edit":           { targetType: "event",        targetIdKey: "eventId",        sensitivity: "ordinary",    requiresReason: false, metadataKeys: ["eventId"] },
  "rsvp.upsert":          { targetType: "rsvp",         targetIdKey: "eventId",        sensitivity: "ordinary",    requiresReason: false, metadataKeys: ["eventId", "userId", "status"] },
  "rsvp.remove":          { targetType: "rsvp",         targetIdKey: "eventId",        sensitivity: "destructive", requiresReason: true,  metadataKeys: ["eventId", "userId"] },
  // Sensitive reads. NOTE what is absent from metadataKeys: there is no key
  // here through which message text could travel. Only ids, a byte length and
  // booleans are auditable — see the reveal action in messagingActions.ts.
  "message.revealBody":   { targetType: "message",      targetIdKey: "messageId",      sensitivity: "sensitive",   requiresReason: false, metadataKeys: ["messageId", "message_type", "content_len", "has_attachment", "deleted"] },
  "message.contentSearch":{ targetType: "message",      targetIdKey: null,             sensitivity: "sensitive",   requiresReason: false, metadataKeys: ["len", "results"] },
  "channel.create":       { targetType: "channel",      targetIdKey: null,             sensitivity: "ordinary",    requiresReason: false, metadataKeys: ["conversationId"] },
  "channel.rename":       { targetType: "channel",      targetIdKey: "channelId",      sensitivity: "ordinary",    requiresReason: false, metadataKeys: ["channelId"] },
  "channel.setPermission":{ targetType: "channel",      targetIdKey: "channelId",      sensitivity: "ordinary",    requiresReason: false, metadataKeys: ["channelId", "permission"] },
  "channel.deleteEmpty":  { targetType: "channel",      targetIdKey: "channelId",      sensitivity: "destructive", requiresReason: true,  metadataKeys: ["channelId"] },
  "notification.setRead": { targetType: "notification", targetIdKey: "notificationId", sensitivity: "ordinary",    requiresReason: false, metadataKeys: ["notificationId", "read"] },
  "report.setStatus":     { targetType: "report",       targetIdKey: "reportId",       sensitivity: "sensitive",   requiresReason: false, metadataKeys: ["reportId", "nextStatus", "entity_type", "entity_id"] },
  "deletedContent.reactivateClub": { targetType: "club", targetIdKey: "clubId",        sensitivity: "sensitive",   requiresReason: true,  metadataKeys: ["clubId"] },
} as const satisfies Record<string, AuditActionSpec>;

export type AuditAction = keyof typeof AUDIT_ACTIONS;

export function isAuditAction(v: unknown): v is AuditAction {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(AUDIT_ACTIONS, v);
}

export function auditActionRequiresReason(action: AuditAction): boolean {
  return AUDIT_ACTIONS[action].requiresReason;
}

/**
 * Pre-mutation guard for destructive actions.
 *
 * NOT yet wired into the existing action functions: Day 10A must not change how
 * they behave, and no UI collects a reason today. It exists so that the moment
 * a reason field ships, each destructive action can call this BEFORE mutating —
 * which is the only ordering that prevents "mutation committed, audit rejected
 * for want of a reason". See the review package's blocker list.
 */
export function assertAuditReason(action: AuditAction, reason: string | null | undefined): void {
  if (auditActionRequiresReason(action) && !reason?.trim()) {
    throw new Error(`Admin action "${action}" requires a reason.`);
  }
}

// ── Per-target-type state allowlists ─────────────────────────────────────────
// Which columns of a canonical row may appear in before_state / after_state.
//
// Read the omissions as carefully as the inclusions:
//   • message  — no `content`, no `attachment_url`, no poll text. Ever.
//   • report   — no `content_snapshot`, no `attachment_snapshot`, no `details`.
//                Those are reporter-supplied evidence about a third party and
//                are never duplicated into the audit trail.
//   • comment / post — `content` and `caption` ARE included. These are public
//                club content, and the before/after text is the entire point of
//                auditing a moderator edit. They are not private messages.

const STATE_FIELDS: Record<AuditTargetType, readonly string[]> = {
  user:         ["id", "created_at"],
  profile:      ["id", "username", "full_name", "major", "year", "university_id", "onboarding_completed", "updated_at"],
  club:         ["id", "name", "handle", "is_active", "university_id", "member_count", "updated_at"],
  club_member:  ["id", "club_id", "user_id", "role", "joined_at"],
  club_officer: ["id", "club_id", "user_id", "role_title", "display_order", "role", "roster"],
  university:   ["id", "name", "slug", "is_active", "created_at"],
  post:         ["id", "author_id", "club_id", "post_type", "caption", "linked_event_id", "created_at"],
  comment:      ["id", "post_id", "user_id", "content", "created_at"],
  event:        ["id", "club_id", "created_by", "title", "emoji", "description", "event_date",
                 "start_time", "end_time", "location", "building", "room", "visibility", "updated_at"],
  rsvp:         ["id", "event_id", "user_id", "status", "created_at"],
  gluemate:     ["id", "follower_id", "following_id", "status", "created_at"],
  conversation: ["id", "type", "club_id", "name", "created_by", "created_at", "deleted_at"],
  channel:      ["id", "conversation_id", "name", "display_order", "is_restricted", "is_default",
                 "kind", "post_permission", "created_at"],
  message:      ["id", "conversation_id", "channel_id", "sender_id", "message_type",
                 "created_at", "deleted_at", "deleted_by"],
  notification: ["id", "user_id", "type", "read", "read_at", "updated_at"],
  report:       ["id", "status", "entity_type", "entity_id", "reporter_id", "club_id", "created_at"],
  portal:       [],
  system:       [],
};

// ── Value-level scrubbing ────────────────────────────────────────────────────
// Mirrors the database scan so a credential is redacted here rather than
// causing the database to reject (and therefore lose) the whole audit row.

const JWT_RE = /^eyJ[A-Za-z0-9_-]{10,}\./;
const SIGNED_URL_RE = /(X-Amz-Signature|X-Amz-Credential|[?&]token=|Signature=)/i;
const MAX_STRING = 500;
const MAX_DEPTH = 4;
const MAX_ARRAY = 20;

export const REDACTED = "[redacted]";

function scrubString(v: string): string {
  if (JWT_RE.test(v) || SIGNED_URL_RE.test(v)) return REDACTED;
  return v.length > MAX_STRING ? v.slice(0, MAX_STRING) + "…" : v;
}

/** Scrub a value that has ALREADY passed an allowlist. */
function scrubValue(v: unknown, depth = 0): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return scrubString(v);
  if (typeof v === "number" || typeof v === "boolean") return v;
  if (v instanceof Date) return v.toISOString();
  if (depth >= MAX_DEPTH) return null;

  if (Array.isArray(v)) {
    return v.slice(0, MAX_ARRAY).map((item) => scrubValue(item, depth + 1));
  }
  if (typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      // Nested objects have no allowlist of their own, so apply the database's
      // forbidden-key rule here too rather than trusting the shape.
      if (isForbiddenKey(k)) continue;
      out[k] = scrubValue(val, depth + 1);
    }
    return out;
  }
  // Functions, symbols, bigints: nothing auditable.
  return null;
}

const FORBIDDEN_KEY_PARTS = [
  "password", "passwd", "secret", "token", "jwt", "apikey", "api_key",
  "servicerole", "service_role", "service_key", "anon_key", "cookie",
  "authorization", "auth_header", "totp", "otp", "mfa_code",
  "verification_code", "entry_path", "entry_phrase", "entry_ticket",
  "ticket", "signature", "private_key", "credential", "session_id",
] as const;

export function isForbiddenKey(key: string): boolean {
  const k = key.toLowerCase();
  return FORBIDDEN_KEY_PARTS.some((part) => k.includes(part));
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Reduce a canonical row to its allowlisted, scrubbed audit shape.
 * Returns null when there is nothing auditable, so the column stays NULL rather
 * than storing an empty object.
 */
export function sanitizeState(
  targetType: AuditTargetType,
  state: unknown
): Record<string, unknown> | null {
  if (state === null || state === undefined) return null;
  if (typeof state !== "object" || Array.isArray(state)) return null;

  const allowed = STATE_FIELDS[targetType];
  const src = state as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const field of allowed) {
    if (!(field in src)) continue;
    if (isForbiddenKey(field)) continue; // belt-and-braces
    out[field] = scrubValue(src[field]);
  }

  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Reduce a caller's `target` object to (targetId, metadata) using the action's
 * registry entry. Keys outside `metadataKeys` are dropped.
 */
export function sanitizeTarget(
  action: AuditAction,
  target: Record<string, unknown> | undefined
): { targetId: string | null; metadata: Record<string, unknown> } {
  const spec = AUDIT_ACTIONS[action];
  const src = target ?? {};

  const rawId = spec.targetIdKey ? src[spec.targetIdKey] : null;
  const targetId = isUuid(rawId) ? rawId : null;

  const metadata: Record<string, unknown> = {};
  for (const key of spec.metadataKeys) {
    if (!(key in src)) continue;
    if (isForbiddenKey(key)) continue;
    const scrubbed = scrubValue(src[key]);
    if (scrubbed !== null) metadata[key] = scrubbed;
  }

  return { targetId, metadata };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

/**
 * Normalize a free-text reason. Returns null for absent/blank input so the
 * database sees a real NULL and its reason requirement can fire.
 */
export function sanitizeReason(reason: string | null | undefined): string | null {
  const trimmed = reason?.trim();
  if (!trimmed) return null;
  return trimmed.length > 500 ? trimmed.slice(0, 500) : trimmed;
}

/**
 * Normalize an error into a short, stable code. Never carries user content or
 * internal detail — the operator-facing message already lives in the action's
 * return value.
 */
export function sanitizeErrorCode(error: string | null | undefined): string | null {
  const trimmed = error?.trim();
  if (!trimmed) return null;
  const scrubbed = scrubString(trimmed);
  return scrubbed.length > 200 ? scrubbed.slice(0, 200) : scrubbed;
}
