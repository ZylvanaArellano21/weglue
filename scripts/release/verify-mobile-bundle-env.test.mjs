// Tests for scripts/release/verify-mobile-bundle-env.mjs
// Run: node --test scripts/release/

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PRODUCTION_SUPABASE_REF,
  PRODUCTION_SUPABASE_URL,
  VerificationError,
  validateEnv,
  verifyBundle,
  writeManifest,
  checkManifest,
  main,
} from "./verify-mobile-bundle-env.mjs";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
const jwt = (payload) => `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}.c2lnbmF0dXJlLXNpZ25hdHVyZQ`;

const ANON_KEY = jwt({ iss: "supabase", ref: PRODUCTION_SUPABASE_REF, role: "anon", iat: 1, exp: 2 });
const SERVICE_KEY = jwt({ iss: "supabase", ref: PRODUCTION_SUPABASE_REF, role: "service_role", iat: 1, exp: 2 });
const OTHER_REF = "abcdefghijklmnopqrst";
const OTHER_ANON_KEY = jwt({ iss: "supabase", ref: OTHER_REF, role: "anon", iat: 1, exp: 2 });
const PUBLISHABLE_KEY = "sb_publishable_AbCdEfGhIjKlMnOpQrStUv_123";
const SECRET_KEY = "sb_secret_AbCdEfGhIjKlMnOpQrStUv_123";

const prodEnv = (overrides = {}) => ({
  EXPO_PUBLIC_SUPABASE_URL: PRODUCTION_SUPABASE_URL,
  EXPO_PUBLIC_SUPABASE_ANON_KEY: ANON_KEY,
  EXPO_PUBLIC_META_APP_ID: "1234567890",
  ...overrides,
});

const bundleText = (url = PRODUCTION_SUPABASE_URL, key = ANON_KEY) =>
  `\u0000HBC\u0001createClient${url}\u0000${key}\u0000https://apps.apple.com/app/id1\u0000`;

/** Build a minimal `expo export` output directory. */
function makeDist({ ios = bundleText(), android = bundleText(), extraFiles = {}, platforms = ["ios", "android"] } = {}) {
  const dist = mkdtempSync(join(tmpdir(), "weglue-verify-"));
  mkdirSync(join(dist, "_expo/static/js/ios"), { recursive: true });
  mkdirSync(join(dist, "_expo/static/js/android"), { recursive: true });
  mkdirSync(join(dist, "assets"), { recursive: true });
  writeFileSync(join(dist, "_expo/static/js/ios/entry-a.hbc"), ios, "latin1");
  writeFileSync(join(dist, "_expo/static/js/android/entry-b.hbc"), android, "latin1");
  writeFileSync(join(dist, "assets/logo"), "\x89PNG-binary", "latin1");
  const fileMetadata = {};
  if (platforms.includes("ios")) {
    fileMetadata.ios = { bundle: "_expo/static/js/ios/entry-a.hbc", assets: [{ path: "assets/logo", ext: "png" }] };
  }
  if (platforms.includes("android")) {
    fileMetadata.android = { bundle: "_expo/static/js/android/entry-b.hbc", assets: [{ path: "assets/logo", ext: "png" }] };
  }
  writeFileSync(join(dist, "metadata.json"), JSON.stringify({ version: 0, bundler: "metro", fileMetadata }));
  for (const [name, contents] of Object.entries(extraFiles)) writeFileSync(join(dist, name), contents, "latin1");
  return dist;
}

function expectFailure(fn, pattern) {
  let error;
  try {
    fn();
  } catch (e) {
    error = e;
  }
  assert.ok(error instanceof VerificationError, `expected VerificationError, got ${error ? error.message : "no error"}`);
  assert.match(error.message, pattern);
  // The full key must never appear in any failure output.
  for (const secret of [ANON_KEY, SERVICE_KEY, OTHER_ANON_KEY, SECRET_KEY]) {
    assert.ok(!error.message.includes(secret), "failure message leaked a full key");
  }
  return error;
}

// ─── env ──────────────────────────────────────────────────────────────────────

describe("validateEnv — valid production", () => {
  test("production URL + anon JWT passes", () => {
    const { summary } = validateEnv(prodEnv());
    assert.match(summary, new RegExp(`${PRODUCTION_SUPABASE_REF}\\.supabase\\.co`));
    assert.match(summary, /JWT role=anon/);
    assert.ok(!summary.includes(ANON_KEY), "summary must not print the full key");
  });

  test("production URL with trailing slash passes", () => {
    validateEnv(prodEnv({ EXPO_PUBLIC_SUPABASE_URL: `${PRODUCTION_SUPABASE_URL}/` }));
  });

  test("sb_publishable_ key passes", () => {
    const { summary } = validateEnv(prodEnv({ EXPO_PUBLIC_SUPABASE_ANON_KEY: PUBLISHABLE_KEY }));
    assert.match(summary, /publishable key/);
    assert.ok(!summary.includes(PUBLISHABLE_KEY));
  });
});

describe("validateEnv — fail closed", () => {
  const cases = [
    ["URL absent", { EXPO_PUBLIC_SUPABASE_URL: undefined }, /EXPO_PUBLIC_SUPABASE_URL is absent/],
    ["URL empty", { EXPO_PUBLIC_SUPABASE_URL: "  " }, /EXPO_PUBLIC_SUPABASE_URL is absent/],
    ["key absent", { EXPO_PUBLIC_SUPABASE_ANON_KEY: undefined }, /EXPO_PUBLIC_SUPABASE_ANON_KEY is absent/],
    ["wrong project ref", { EXPO_PUBLIC_SUPABASE_URL: `https://${OTHER_REF}.supabase.co` }, /not the production project/],
    ["localhost URL", { EXPO_PUBLIC_SUPABASE_URL: "http://localhost:54321" }, /localhost found/],
    ["127.0.0.1 URL", { EXPO_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" }, /127\.x loopback found/],
    ["10.0.2.2 URL", { EXPO_PUBLIC_SUPABASE_URL: "http://10.0.2.2:54321" }, /10\.0\.2\.2 Android emulator host found/],
    ["host.docker.internal URL", { EXPO_PUBLIC_SUPABASE_URL: "http://host.docker.internal:54321" }, /host\.docker\.internal found/],
    ["192.168.x LAN URL", { EXPO_PUBLIC_SUPABASE_URL: "http://192.168.1.20:54321" }, /RFC1918 192\.168\.x found/],
    ["172.16-31.x LAN URL", { EXPO_PUBLIC_SUPABASE_URL: "http://172.20.0.5:8000" }, /RFC1918 172\.16-31\.x found/],
    ["10.x LAN URL", { EXPO_PUBLIC_SUPABASE_URL: "http://10.1.2.3:8000" }, /RFC1918 10\.x found/],
    ["local Supabase :54321", { EXPO_PUBLIC_SUPABASE_URL: "http://supabase.test:54321" }, /:54321 found/],
    ["service_role JWT as key", { EXPO_PUBLIC_SUPABASE_ANON_KEY: SERVICE_KEY }, /role is "service_role"/],
    ["sb_secret_ as key", { EXPO_PUBLIC_SUPABASE_ANON_KEY: SECRET_KEY }, /sb_secret_ credential/],
    ["JWT ref mismatch", { EXPO_PUBLIC_SUPABASE_ANON_KEY: OTHER_ANON_KEY }, /JWT ref "abcdefghijklmnopqrst" does not match production/],
    ["unrecognised key format", { EXPO_PUBLIC_SUPABASE_ANON_KEY: "not-a-key" }, /neither a JWT nor an sb_publishable_ key/],
    ["other EXPO_PUBLIC_ var points at localhost", { EXPO_PUBLIC_API_URL: "http://localhost:3000" }, /EXPO_PUBLIC_API_URL: localhost found/],
    ["other EXPO_PUBLIC_ var carries service_role", { EXPO_PUBLIC_ADMIN: SERVICE_KEY }, /EXPO_PUBLIC_ADMIN: service_role JWT found/],
  ];
  for (const [name, overrides, pattern] of cases) {
    test(name, () => {
      const env = prodEnv(overrides);
      for (const [k, v] of Object.entries(overrides)) if (v === undefined) delete env[k];
      expectFailure(() => validateEnv(env), pattern);
    });
  }
});

// ─── bundle ───────────────────────────────────────────────────────────────────

describe("verifyBundle — valid production", () => {
  test("bundles containing exactly the injected values pass", () => {
    const dist = makeDist();
    try {
      const { platforms } = verifyBundle(dist, prodEnv());
      assert.deepEqual(platforms.sort(), ["android", "ios"]);
    } finally {
      rmSync(dist, { recursive: true, force: true });
    }
  });

  test("local-host strings in non-shipped source maps do not fail", () => {
    const dist = makeDist({ extraFiles: { "entry.hbc.map": '{"sourcesContent":["http://localhost:8081/"]}' } });
    try {
      verifyBundle(dist, prodEnv());
    } finally {
      rmSync(dist, { recursive: true, force: true });
    }
  });
});

describe("verifyBundle — fail closed", () => {
  const cases = [
    ["env absent (Secret vars not injected)", {}, { EXPO_PUBLIC_SUPABASE_URL: undefined, EXPO_PUBLIC_SUPABASE_ANON_KEY: undefined }, /is absent/],
    ["bundle lacks injected URL", { ios: bundleText("https://example.invalid") }, {}, /ios: bundle does not contain the injected production Supabase URL/],
    ["bundle lacks injected key", { android: bundleText(PRODUCTION_SUPABASE_URL, "eyJstale.key") }, {}, /android: bundle does not contain the injected anon\/publishable key/],
    ["bundle built with different values than injected", { ios: bundleText(`https://${OTHER_REF}.supabase.co`, OTHER_ANON_KEY) }, {}, /non-production Supabase project ref "abcdefghijklmnopqrst"/],
    ["foreign Supabase ref in bundle", { ios: bundleText() + `https://${OTHER_REF}.supabase.co` }, {}, /non-production Supabase project ref/],
    ["service_role JWT in bundle", { android: bundleText() + SERVICE_KEY }, {}, /service_role JWT found/],
    ["foreign-ref JWT in bundle", { android: bundleText() + OTHER_ANON_KEY }, {}, /JWT for non-production ref/],
    ["sb_secret_ in bundle", { ios: bundleText() + SECRET_KEY }, {}, /sb_secret_ credential found/],
    ["localhost in bundle", { ios: bundleText() + "http://localhost:8081/" }, {}, /localhost found/],
    ["127.0.0.1 in bundle", { ios: bundleText() + "http://127.0.0.1:54321" }, {}, /127\.x loopback found/],
    ["10.0.2.2 in bundle", { android: bundleText() + "http://10.0.2.2:8081" }, {}, /10\.0\.2\.2 Android emulator host found/],
    ["host.docker.internal in bundle", { android: bundleText() + "http://host.docker.internal" }, {}, /host\.docker\.internal found/],
    ["LAN address in bundle", { ios: bundleText() + "http://192.168.0.10:8081" }, {}, /RFC1918 192\.168\.x found/],
    [":54321 in bundle", { ios: bundleText() + "http://supabase.test:54321" }, {}, /:54321 found/],
    ["sb_secret_ in a non-shipped file", { extraFiles: { "entry.hbc.map": SECRET_KEY } }, {}, /entry\.hbc\.map: sb_secret_ credential found/],
    ["android bundle missing from export", { platforms: ["ios"] }, {}, /metadata\.json has no android bundle/],
  ];
  for (const [name, distOpts, envOverrides, pattern] of cases) {
    test(name, () => {
      const dist = makeDist(distOpts);
      try {
        const env = prodEnv(envOverrides);
        for (const [k, v] of Object.entries(envOverrides)) if (v === undefined) delete env[k];
        expectFailure(() => verifyBundle(dist, env), pattern);
      } finally {
        rmSync(dist, { recursive: true, force: true });
      }
    });
  }

  test("export directory without metadata.json fails", () => {
    const dist = mkdtempSync(join(tmpdir(), "weglue-verify-"));
    try {
      expectFailure(() => verifyBundle(dist, prodEnv()), /metadata\.json not found/);
    } finally {
      rmSync(dist, { recursive: true, force: true });
    }
  });
});

// ─── manifest ─────────────────────────────────────────────────────────────────

describe("bundle hash manifest", () => {
  const withDist = (fn) => {
    const dist = makeDist();
    const manifest = join(mkdtempSync(join(tmpdir(), "weglue-manifest-")), "verified-manifest.json");
    try {
      fn(dist, manifest);
    } finally {
      rmSync(dist, { recursive: true, force: true });
    }
  };

  test("unchanged bundle passes", () =>
    withDist((dist, manifest) => {
      const written = writeManifest(dist, manifest);
      assert.equal(checkManifest(dist, manifest).root, written.root);
    }));

  test("modified bundle fails", () =>
    withDist((dist, manifest) => {
      writeManifest(dist, manifest);
      appendFileSync(join(dist, "_expo/static/js/ios/entry-a.hbc"), "tampered");
      expectFailure(() => checkManifest(dist, manifest), /changed after verification: _expo\/static\/js\/ios\/entry-a\.hbc/);
    }));

  test("added file fails", () =>
    withDist((dist, manifest) => {
      writeManifest(dist, manifest);
      writeFileSync(join(dist, "eas-update-metadata.json"), "{}");
      expectFailure(() => checkManifest(dist, manifest), /changed after verification: eas-update-metadata\.json/);
    }));

  test("removed file fails", () =>
    withDist((dist, manifest) => {
      writeManifest(dist, manifest);
      rmSync(join(dist, "assets/logo"));
      expectFailure(() => checkManifest(dist, manifest), /changed after verification: assets\/logo/);
    }));

  test("missing manifest fails", () =>
    withDist((dist) => {
      expectFailure(() => checkManifest(dist, join(dist, "..", "nope.json")), /bundle was never verified/);
    }));
});

// ─── CLI ──────────────────────────────────────────────────────────────────────

describe("CLI", () => {
  test("env command passes for production values", () => {
    main(["env"], prodEnv());
  });

  test("env command fails when values are absent", () => {
    expectFailure(() => main(["env"], {}), /is absent/);
  });

  test("bundle then check-manifest round-trip", () => {
    const dist = makeDist();
    const manifest = join(mkdtempSync(join(tmpdir(), "weglue-manifest-")), "m.json");
    try {
      main(["bundle", "--dist", dist, "--manifest", manifest], prodEnv());
      main(["check-manifest", "--dist", dist, "--manifest", manifest], prodEnv());
    } finally {
      rmSync(dist, { recursive: true, force: true });
    }
  });

  test("unknown command is rejected", () => {
    assert.throws(() => main(["publish"], prodEnv()), /Unknown command/);
  });

  test("missing flag value is rejected", () => {
    assert.throws(() => main(["bundle", "--dist"], prodEnv()), /Missing value for --dist/);
  });
});
