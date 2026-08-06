import assert from "node:assert/strict";
import test from "node:test";

import { parseDeleteMessageRequest } from "./requestValidation.ts";

test("accepts standard UUID message and idempotency identifiers", () => {
  assert.deepEqual(
    parseDeleteMessageRequest({
      messageId: "a6800000-0000-4000-8000-0000000000b1",
      idempotencyKey: "a6800000-0000-4000-8000-0000000000d1",
    }),
    {
      messageId: "a6800000-0000-4000-8000-0000000000b1",
      idempotencyKey: "a6800000-0000-4000-8000-0000000000d1",
    },
  );
});

test("rejects missing, malformed, and non-string delete request identifiers", () => {
  assert.equal(parseDeleteMessageRequest(null), null);
  assert.equal(parseDeleteMessageRequest({ messageId: "not-a-uuid", idempotencyKey: "also-not-a-uuid" }), null);
  assert.equal(parseDeleteMessageRequest({ messageId: 42, idempotencyKey: "a6800000-0000-4000-8000-0000000000d1" }), null);
});
