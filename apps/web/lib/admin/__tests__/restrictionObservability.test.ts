import { afterEach, describe, expect, it, vi } from "vitest";
import { logRestrictionAction, maskRestrictionIdentifier } from "../restrictionObservability";

describe("restriction operational telemetry", () => {
  afterEach(() => vi.restoreAllMocks());

  it("keeps the correlation id searchable while masking identifiers and redacting secrets", () => {
    const sink = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const correlationId = "98032490-a068-47a4-923b-5e9ae9d00a95";
    const targetId = "2b2c0aee-1234-4567-8901-234567890123";
    const administratorId = "00000001-0000-0000-0000-000000000001";

    logRestrictionAction({
      correlationId,
      action: "suspend",
      stage: "restriction_rpc",
      targetId,
      administratorId,
      success: false,
      diagnostic: {
        code: "PGRST202",
        message: `Bearer secret-token for founder@weglue.app failed for ${targetId}`,
      },
      restrictionCommitted: false,
      sessionRevocationAttempted: false,
      sessionRevocationSucceeded: null,
      reconciliationRequired: false,
    });

    const line = String(sink.mock.calls[0]![0]);
    expect(line).toContain(correlationId);
    expect(line).toContain("2b2c0aee…");
    expect(line).toContain("[redacted-email]");
    expect(line).toContain("Bearer [redacted]");
    expect(line).not.toContain(targetId);
    expect(line).not.toContain(administratorId);
    expect(line).not.toContain("secret-token");
    expect(maskRestrictionIdentifier(targetId)).toBe("2b2c0aee…");
  });
});
