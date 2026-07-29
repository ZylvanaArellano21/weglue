// ============================================================================
// Admin Dashboard — structured audit logging  (SERVER-ONLY)
// ============================================================================
//
// Day 2 introduces privileged writes. Every admin mutation emits a structured
// audit record so there is a durable trail of who changed what.
//
// TEMPORARY: there is no canonical `admin_audit` table yet (greenfield — see
// docs/product/admin-dashboard.md). Until that table ships (planned Day 5), we
// emit a single-line JSON record to the server log. This is a real, greppable
// audit trail in Vercel logs; it is intentionally NOT a client-visible surface.
// When the audit table exists, `adminAudit()` becomes the one place to also
// INSERT the row — callers do not change.
// ============================================================================

if (typeof window !== "undefined") {
  throw new Error("lib/admin/audit.ts is server-only and must not be imported in the browser.");
}

export interface AdminAuditEntry {
  action: string;
  actorId: string;
  actorEmail?: string | null;
  target: Record<string, unknown>;
  before?: unknown;
  after?: unknown;
  ok: boolean;
  error?: string;
}

export function adminAudit(entry: AdminAuditEntry): void {
  const record = {
    tag: "admin_audit",
    ts: new Date().toISOString(),
    ...entry,
  };
  // Single structured line → greppable in server logs.
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(record));
}
