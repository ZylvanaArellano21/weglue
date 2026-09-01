import assert from "node:assert/strict";
import test from "node:test";

import { messageAttachmentPaths } from "./messageAttachmentPaths.ts";

/**
 * Minimal fake of the parts of the supabase-js client this helper touches:
 *   admin.from("message_attachments").select(cols).eq(col, val)[.limit(n)]
 * Backed by an in-memory `message_attachments` table.
 */
function fakeAdmin(rows: Array<{ message_id: string; storage_path: string }>) {
  let calls = 0;
  const make = (filters: Array<[string, unknown]>) => {
    const applied = () =>
      rows.filter((r) => filters.every(([c, v]) => (r as Record<string, unknown>)[c] === v));
    const builder: Record<string, unknown> = {
      eq(col: string, val: unknown) {
        return make([...filters, [col, val]]);
      },
      limit(n: number) {
        return Promise.resolve({ data: applied().slice(0, n), error: null });
      },
      then(resolve: (v: { data: unknown; error: null }) => unknown) {
        return resolve({ data: applied(), error: null });
      },
    };
    return builder;
  };
  return {
    calls: () => calls,
    from(table: string) {
      assert.equal(table, "message_attachments");
      calls += 1;
      return { select: (_cols: string) => make([]) };
    },
  } as unknown as Parameters<typeof messageAttachmentPaths>[0];
}

test("legacy single attachment (no normalized rows) returns only the anchor path", async () => {
  const admin = fakeAdmin([]);
  const paths = await messageAttachmentPaths(admin, "conv-1/legacy.jpg");
  assert.deepEqual(paths, ["conv-1/legacy.jpg"]);
});

test("1-photo grouped message returns exactly its one path", async () => {
  const admin = fakeAdmin([{ message_id: "m1", storage_path: "conv-1/m1-0.jpg" }]);
  const paths = await messageAttachmentPaths(admin, "conv-1/m1-0.jpg");
  assert.deepEqual(paths.sort(), ["conv-1/m1-0.jpg"]);
});

for (const n of [2, 3, 4, 5]) {
  test(`${n}-photo message returns every sibling path (anchor + positions 1..${n - 1})`, async () => {
    const rows = Array.from({ length: n }, (_, i) => ({
      message_id: "m1",
      storage_path: `conv-1/m1-${i}.jpg`,
    }));
    const admin = fakeAdmin(rows);
    const paths = await messageAttachmentPaths(admin, "conv-1/m1-0.jpg");
    assert.deepEqual(
      paths.sort(),
      rows.map((r) => r.storage_path).sort(),
    );
    assert.equal(paths.length, n);
  });
}

test("never returns an attachment belonging to a different message", async () => {
  const admin = fakeAdmin([
    { message_id: "m1", storage_path: "conv-1/m1-0.jpg" },
    { message_id: "m1", storage_path: "conv-1/m1-1.jpg" },
    { message_id: "m2", storage_path: "conv-1/m2-0.jpg" },
    { message_id: "m2", storage_path: "conv-1/m2-1.jpg" },
  ]);
  const paths = await messageAttachmentPaths(admin, "conv-1/m1-0.jpg");
  assert.deepEqual(paths.sort(), ["conv-1/m1-0.jpg", "conv-1/m1-1.jpg"]);
  assert.ok(!paths.includes("conv-1/m2-0.jpg"));
  assert.ok(!paths.includes("conv-1/m2-1.jpg"));
});

test("anchor path is always included and the result is de-duplicated", async () => {
  const admin = fakeAdmin([
    { message_id: "m1", storage_path: "conv-1/m1-0.jpg" },
    { message_id: "m1", storage_path: "conv-1/m1-1.jpg" },
  ]);
  const paths = await messageAttachmentPaths(admin, "conv-1/m1-0.jpg");
  assert.equal(paths.filter((p) => p === "conv-1/m1-0.jpg").length, 1);
  assert.ok(paths.includes("conv-1/m1-0.jpg"));
});

test("propagates a lookup error instead of silently cleaning nothing", async () => {
  const admin = {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                limit() {
                  return Promise.resolve({ data: null, error: new Error("db down") });
                },
              };
            },
          };
        },
      };
    },
  } as unknown as Parameters<typeof messageAttachmentPaths>[0];
  await assert.rejects(() => messageAttachmentPaths(admin, "conv-1/x.jpg"), /db down/);
});
