import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

import {
  AUDIT_ACTIONS,
  AUDIT_TARGET_TYPES,
  isAuditAction,
  auditActionRequiresReason,
  assertAuditReason,
  sanitizeState,
  sanitizeTarget,
  sanitizeReason,
  sanitizeErrorCode,
  isForbiddenKey,
  REDACTED,
} from "../auditSanitize";

const MIGRATION = [
  "055_durable_admin_audit.sql",
  "058_admin_restrictions.sql",
]
  .map((f) => readFileSync(join(__dirname, "../../../../../supabase/migrations/", f), "utf8"))
  .join("\n");

// ── The registry and the migration must never drift ──────────────────────────
// The database is the enforcer; this file is what the server believes. If they
// disagree, audit writes fail at runtime — so the disagreement is caught here.

describe("registry ↔ migration 055 parity", () => {
  /** Parse the catalog seed rows out of the migration's INSERT statement. */
  function parseCatalog(): Record<string, { targetType: string; sensitivity: string; requiresReason: boolean }> {
    const out: Record<string, { targetType: string; sensitivity: string; requiresReason: boolean }> = {};
    const re = /\(\s*'([a-zA-Z.]+)',\s*'([a-z_]+)',\s*'(ordinary|sensitive|destructive)',\s*(TRUE|FALSE)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(MIGRATION)) !== null) {
      out[m[1]!] = { targetType: m[2]!, sensitivity: m[3]!, requiresReason: m[4] === "TRUE" };
    }
    return out;
  }

  const catalog = parseCatalog();

  it("parses all 32 catalog rows from migrations 055 + 058", () => {
    expect(Object.keys(catalog)).toHaveLength(32);
  });

  it("registers exactly the same action names as the migration", () => {
    expect(Object.keys(AUDIT_ACTIONS).sort()).toEqual(Object.keys(catalog).sort());
  });

  it("agrees with the migration on target_type, sensitivity and requires_reason", () => {
    for (const [action, spec] of Object.entries(AUDIT_ACTIONS)) {
      const row = catalog[action]!;
      expect(`${action}:${spec.targetType}`).toBe(`${action}:${row.targetType}`);
      expect(`${action}:${spec.sensitivity}`).toBe(`${action}:${row.sensitivity}`);
      expect(`${action}:${spec.requiresReason}`).toBe(`${action}:${row.requiresReason}`);
    }
  });

  it("uses only target types the database CHECK constraint permits", () => {
    for (const spec of Object.values(AUDIT_ACTIONS)) {
      expect(AUDIT_TARGET_TYPES).toContain(spec.targetType);
    }
  });

  it("requires a reason for every destructive action", () => {
    for (const [action, spec] of Object.entries(AUDIT_ACTIONS)) {
      if (spec.sensitivity === "destructive") {
        expect(`${action}=${spec.requiresReason}`).toBe(`${action}=true`);
      }
    }
  });
});

describe("isAuditAction", () => {
  it("accepts registered actions", () => {
    expect(isAuditAction("membership.add")).toBe(true);
    expect(isAuditAction("message.revealBody")).toBe(true);
  });

  it("rejects unregistered or malicious values", () => {
    expect(isAuditAction("totally.madeUp")).toBe(false);
    expect(isAuditAction("__proto__")).toBe(false);
    expect(isAuditAction("constructor")).toBe(false);
    expect(isAuditAction(null)).toBe(false);
    expect(isAuditAction(42)).toBe(false);
  });
});

describe("forbidden keys", () => {
  it.each([
    "password", "user_password", "access_token", "refreshToken", "apiKey", "api_key",
    "service_role_key", "cookie", "Authorization", "totp_code", "mfa_code",
    "entry_phrase", "entry_ticket", "signature", "private_key", "session_id",
  ])("flags %s", (key) => {
    expect(isForbiddenKey(key)).toBe(true);
  });

  it.each(["content_len", "has_attachment", "club_id", "role_title", "status", "notificationId"])(
    "does not flag the legitimate field %s",
    (key) => {
      expect(isForbiddenKey(key)).toBe(false);
    }
  );
});

describe("sanitizeState — allowlist, not blocklist", () => {
  it("keeps only allowlisted columns for the target type", () => {
    const out = sanitizeState("club_member", {
      id: "a", club_id: "b", user_id: "c", role: "officer", joined_at: "t",
      // Not in the allowlist -> dropped, even though it is harmless.
      internal_note: "should not appear",
    });
    expect(out).toEqual({ id: "a", club_id: "b", user_id: "c", role: "officer", joined_at: "t" });
    expect(out).not.toHaveProperty("internal_note");
  });

  it("NEVER carries message content, attachments or poll text", () => {
    const out = sanitizeState("message", {
      id: "m1",
      conversation_id: "c1",
      sender_id: "s1",
      content: "PRIVATE MESSAGE TEXT",
      attachment_url: "https://x/y.png",
      poll_question: "PRIVATE POLL",
    });
    expect(out).toEqual({ id: "m1", conversation_id: "c1", sender_id: "s1" });
    expect(JSON.stringify(out)).not.toContain("PRIVATE");
    expect(JSON.stringify(out)).not.toContain("attachment_url");
  });

  it("NEVER carries report evidence snapshots", () => {
    const out = sanitizeState("report", {
      id: "r1",
      status: "resolved",
      entity_type: "post",
      content_snapshot: "REPORTED PRIVATE TEXT",
      attachment_snapshot: { url: "https://x/y" },
      details: "REPORTER FREE TEXT",
    });
    expect(out).toEqual({ id: "r1", status: "resolved", entity_type: "post" });
    expect(JSON.stringify(out)).not.toContain("REPORT");
  });

  it("DOES keep public club content, which is the point of auditing an edit", () => {
    expect(sanitizeState("comment", { id: "c", content: "a rude comment" })).toEqual({
      id: "c",
      content: "a rude comment",
    });
    expect(sanitizeState("post", { id: "p", caption: "old caption" })).toEqual({
      id: "p",
      caption: "old caption",
    });
  });

  it("redacts credential-bearing VALUES even under allowlisted keys", () => {
    const out = sanitizeState("post", {
      id: "p",
      caption: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc.def",
    });
    expect(out!.caption).toBe(REDACTED);
  });

  it("redacts pre-signed media URLs", () => {
    const out = sanitizeState("post", {
      id: "p",
      caption: "https://x.supabase.co/o/p.jpg?token=abc&X-Amz-Signature=deadbeef",
    });
    expect(out!.caption).toBe(REDACTED);
  });

  it("truncates very long strings", () => {
    const out = sanitizeState("event", { id: "e", description: "x".repeat(5000) });
    expect((out!.description as string).length).toBeLessThanOrEqual(501);
  });

  it("strips forbidden keys nested inside an allowlisted object value", () => {
    const out = sanitizeState("club_officer", {
      id: "o",
      roster: { name: "A", access_token: "LEAK" },
    });
    expect(JSON.stringify(out)).not.toContain("LEAK");
    expect(JSON.stringify(out)).not.toContain("access_token");
  });

  it("returns null rather than an empty object when nothing is auditable", () => {
    expect(sanitizeState("club_member", { nothing: "useful" })).toBeNull();
    expect(sanitizeState("club_member", null)).toBeNull();
    expect(sanitizeState("club_member", undefined)).toBeNull();
    expect(sanitizeState("portal", { anything: 1 })).toBeNull();
  });
});

describe("sanitizeTarget", () => {
  it("derives target_id from the action's declared key", () => {
    const { targetId, metadata } = sanitizeTarget("membership.add", {
      clubId: "00000000-0000-4000-8000-00000000000c",
      userId: "00000000-0000-4000-8000-00000000000d",
    });
    expect(targetId).toBe("00000000-0000-4000-8000-00000000000d");
    expect(metadata).toEqual({
      clubId: "00000000-0000-4000-8000-00000000000c",
      userId: "00000000-0000-4000-8000-00000000000d",
    });
  });

  it("returns a null target_id when the value is not a UUID", () => {
    expect(sanitizeTarget("membership.add", { userId: "not-a-uuid" }).targetId).toBeNull();
  });

  it("returns a null target_id for actions that have no single target", () => {
    expect(sanitizeTarget("portal.lock", {}).targetId).toBeNull();
    expect(sanitizeTarget("message.contentSearch", { len: 5, results: 2 }).targetId).toBeNull();
  });

  it("drops target keys outside the action's metadata allowlist", () => {
    const { metadata } = sanitizeTarget("post.editCaption", {
      postId: "00000000-0000-4000-8000-00000000000e",
      caption: "SHOULD NOT TRAVEL VIA TARGET",
      password: "hunter2",
    });
    expect(metadata).toEqual({ postId: "00000000-0000-4000-8000-00000000000e" });
    expect(JSON.stringify(metadata)).not.toContain("SHOULD NOT TRAVEL");
    expect(JSON.stringify(metadata)).not.toContain("hunter2");
  });

  it("permits ONLY safe metadata for a sensitive message reveal", () => {
    const { targetId, metadata } = sanitizeTarget("message.revealBody", {
      messageId: "00000000-0000-4000-8000-00000000000f",
      message_type: "text",
      content_len: 142,
      has_attachment: true,
      content: "THE ACTUAL PRIVATE MESSAGE",
    });
    expect(targetId).toBe("00000000-0000-4000-8000-00000000000f");
    expect(metadata).toEqual({
      messageId: "00000000-0000-4000-8000-00000000000f",
      message_type: "text",
      content_len: 142,
      has_attachment: true,
    });
    expect(JSON.stringify(metadata)).not.toContain("ACTUAL PRIVATE");
  });
});

describe("reason and error handling", () => {
  it("normalizes blank reasons to null so the database requirement can fire", () => {
    expect(sanitizeReason(undefined)).toBeNull();
    expect(sanitizeReason(null)).toBeNull();
    expect(sanitizeReason("   ")).toBeNull();
    expect(sanitizeReason("  because  ")).toBe("because");
  });

  it("caps reason and error length to the database constraints", () => {
    expect(sanitizeReason("r".repeat(900))!.length).toBe(500);
    expect(sanitizeErrorCode("e".repeat(900))!.length).toBeLessThanOrEqual(200);
  });

  it("redacts a credential accidentally passed as an error", () => {
    expect(sanitizeErrorCode("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.x.y")).toBe(REDACTED);
  });
});

describe("assertAuditReason — the pre-mutation guard", () => {
  it("throws for a destructive action with no reason", () => {
    expect(() => assertAuditReason("membership.remove", null)).toThrow(/requires a reason/);
    expect(() => assertAuditReason("channel.deleteEmpty", "  ")).toThrow(/requires a reason/);
  });

  it("passes for a destructive action with a reason", () => {
    expect(() => assertAuditReason("membership.remove", "Spam account")).not.toThrow();
  });

  it("passes for ordinary actions regardless", () => {
    expect(() => assertAuditReason("notification.setRead", null)).not.toThrow();
    expect(auditActionRequiresReason("notification.setRead")).toBe(false);
  });
});
