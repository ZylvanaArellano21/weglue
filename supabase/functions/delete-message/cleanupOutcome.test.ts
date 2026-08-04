import assert from "node:assert/strict";
import test from "node:test";

import { attachmentCleanupOutcomeWithoutLease } from "./cleanupOutcome.ts";

test("cleanup claim failures stay pending and return 202", () => {
  assert.deepEqual(
    attachmentCleanupOutcomeWithoutLease("deletion_pending_attachment_cleanup", true),
    { attachmentCleanup: "pending", status: 202 },
  );
});

test("a concurrent or unknown lease remains pending", () => {
  assert.deepEqual(
    attachmentCleanupOutcomeWithoutLease("deletion_pending_attachment_cleanup", false),
    { attachmentCleanup: "pending", status: 202 },
  );
  assert.deepEqual(
    attachmentCleanupOutcomeWithoutLease("already_deleted", false),
    { attachmentCleanup: "pending", status: 202 },
  );
});

test("only the canonical text-only deletion state proves complete cleanup", () => {
  assert.deepEqual(
    attachmentCleanupOutcomeWithoutLease("deleted", false),
    { attachmentCleanup: "complete", status: 200 },
  );
});
