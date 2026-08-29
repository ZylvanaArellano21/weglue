import { describe, it, expect } from "vitest";
import { isClientTagConflict } from "@weglue/shared";

// ============================================================================
// isClientTagConflict — the write-idempotency discriminator
// ============================================================================
//
// A create carrying a stable client_tag can be retried safely: the retry hits
// the per-table partial unique index (migration 100) and the caller resolves
// the already-created row. This helper must fire ONLY for that index — a 23505
// from any other constraint is a real error the user must see.
// ============================================================================

describe("isClientTagConflict", () => {
  it("is true for a 23505 naming the table's client_tag index", () => {
    expect(
      isClientTagConflict(
        { code: "23505", message: 'duplicate key value violates unique constraint "uq_posts_author_client_tag"' },
        "uq_posts_author_client_tag"
      )
    ).toBe(true);
  });

  it("is true when the error only mentions client_tag generically", () => {
    expect(
      isClientTagConflict({ code: "23505", details: "Key (author_id, client_tag)=(...) already exists." }, "uq_posts_author_client_tag")
    ).toBe(true);
  });

  it("is FALSE for a 23505 from a different unique constraint", () => {
    expect(
      isClientTagConflict(
        { code: "23505", message: 'duplicate key value violates unique constraint "event_rsvps_pkey"' },
        "uq_events_created_by_client_tag"
      )
    ).toBe(false);
  });

  it("is FALSE for non-23505 errors and non-objects", () => {
    expect(isClientTagConflict({ code: "23503", message: "uq_posts_author_client_tag" }, "uq_posts_author_client_tag")).toBe(false);
    expect(isClientTagConflict({ status: 403 }, "uq_posts_author_client_tag")).toBe(false);
    expect(isClientTagConflict(null, "x")).toBe(false);
    expect(isClientTagConflict("23505", "x")).toBe(false);
  });

  it("accepts a numeric code too (defensive)", () => {
    expect(isClientTagConflict({ code: 23505, message: "client_tag" }, "x")).toBe(true);
  });
});
