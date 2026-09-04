import assert from "node:assert/strict";
import test from "node:test";

import { authorizedServiceCaller, presentedKey, timingSafeEqual } from "./auth.ts";

const KEY = "sb_secret_test_0000000000000000000000";

test("accepts the exact key in the apikey header", () => {
  assert.equal(authorizedServiceCaller(new Headers({ apikey: KEY }), KEY), true);
});

test("accepts the key via an Authorization: Bearer fallback", () => {
  assert.equal(
    authorizedServiceCaller(new Headers({ Authorization: `Bearer ${KEY}` }), KEY),
    true,
  );
});

test("rejects a missing, wrong, empty, or truncated key", () => {
  assert.equal(authorizedServiceCaller(new Headers(), KEY), false);
  assert.equal(authorizedServiceCaller(new Headers({ apikey: "" }), KEY), false);
  assert.equal(authorizedServiceCaller(new Headers({ apikey: "wrong" }), KEY), false);
  assert.equal(authorizedServiceCaller(new Headers({ apikey: KEY.slice(0, -1) }), KEY), false);
  assert.equal(authorizedServiceCaller(new Headers({ apikey: `${KEY}x` }), KEY), false);
});

test("stays closed when STORE_SYNC_API_KEY is not configured", () => {
  assert.equal(authorizedServiceCaller(new Headers({ apikey: KEY }), undefined), false);
  assert.equal(authorizedServiceCaller(new Headers({ apikey: KEY }), ""), false);
});

test("does not accept a legacy service_role JWT shape as the key", () => {
  const jwtish = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.sig";
  assert.equal(authorizedServiceCaller(new Headers({ apikey: jwtish }), KEY), false);
  assert.equal(
    authorizedServiceCaller(new Headers({ Authorization: `Bearer ${jwtish}` }), KEY),
    false,
  );
});

test("presentedKey prefers apikey, falls back to Bearer, else empty", () => {
  assert.equal(presentedKey(new Headers({ apikey: "a", Authorization: "Bearer b" })), "a");
  assert.equal(presentedKey(new Headers({ Authorization: "Bearer b" })), "b");
  assert.equal(presentedKey(new Headers({ Authorization: "b" })), "b");
  assert.equal(presentedKey(new Headers()), "");
});

test("timingSafeEqual compares whole strings", () => {
  assert.equal(timingSafeEqual("abc", "abc"), true);
  assert.equal(timingSafeEqual("abc", "abd"), false);
  assert.equal(timingSafeEqual("abc", "ab"), false);
  assert.equal(timingSafeEqual("", ""), true);
});
