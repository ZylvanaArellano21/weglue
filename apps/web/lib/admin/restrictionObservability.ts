// ============================================================================
// Administrator restriction-action operational telemetry (SERVER-ONLY)
// ============================================================================

if (typeof window !== "undefined") {
  throw new Error("lib/admin/restrictionObservability.ts is server-only.");
}

export type RestrictionActionName =
  | "suspend"
  | "unsuspend"
  | "block"
  | "unblock"
  | "adjustExpiry";

export type RestrictionActionStage =
  | "admin_authorization"
  | "write_switch"
  | "recent_mfa"
  | "input_validation"
  | "restriction_rpc"
  | "restriction_committed"
  | "revocation_attempt"
  | "revocation_outcome"
  | "revalidation"
  | "response_serialization";

export interface RestrictionDiagnostic {
  code?: string | null;
  sqlState?: string | null;
  message?: string | null;
}

export interface RestrictionLogRecord {
  correlationId: string;
  action: RestrictionActionName;
  stage: RestrictionActionStage;
  targetId?: string | null;
  administratorId?: string | null;
  success: boolean;
  diagnostic?: RestrictionDiagnostic | null;
  restrictionCommitted: boolean;
  sessionRevocationAttempted: boolean;
  sessionRevocationSucceeded: boolean | null;
  reconciliationRequired: boolean;
}

const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

export function maskRestrictionIdentifier(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.length <= 8 ? value : `${value.slice(0, 8)}…`;
}

function sanitizeMessage(value: string | null | undefined): string | null {
  if (!value) return null;
  return value
    .replace(UUID_PATTERN, (id) => `${id.slice(0, 8)}…`)
    .replace(EMAIL_PATTERN, "[redacted-email]")
    .replace(/\b(Bearer\s+)[^\s]+/gi, "$1[redacted]")
    .slice(0, 240);
}

/**
 * A single JSON line is intentionally used so Vercel log search can find the
 * founder-visible correlation id without emitting credentials or full IDs.
 */
export function logRestrictionAction(record: RestrictionLogRecord): void {
  // eslint-disable-next-line no-console
  console.info(
    JSON.stringify({
      tag: "admin_restriction_action",
      correlationId: record.correlationId,
      action: record.action,
      stage: record.stage,
      targetId: maskRestrictionIdentifier(record.targetId),
      administratorId: maskRestrictionIdentifier(record.administratorId),
      success: record.success,
      supabaseErrorCode: record.diagnostic?.code ?? null,
      postgresSqlState: record.diagnostic?.sqlState ?? null,
      errorMessage: sanitizeMessage(record.diagnostic?.message),
      restrictionCommitted: record.restrictionCommitted,
      sessionRevocationAttempted: record.sessionRevocationAttempted,
      sessionRevocationSucceeded: record.sessionRevocationSucceeded,
      reconciliationRequired: record.reconciliationRequired,
    })
  );
}

export function diagnosticFromUnknown(error: unknown): RestrictionDiagnostic {
  if (!error || typeof error !== "object") {
    return { message: error == null ? null : String(error) };
  }
  const candidate = error as { code?: unknown; message?: unknown };
  const code = typeof candidate.code === "string" ? candidate.code : null;
  return {
    code,
    sqlState: code && /^[0-9A-Z]{5}$/i.test(code) ? code : null,
    message: typeof candidate.message === "string" ? candidate.message : "Unknown error",
  };
}
