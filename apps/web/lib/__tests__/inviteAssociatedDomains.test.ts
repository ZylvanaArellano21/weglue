import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// Update 1 — iOS Universal Links for /invite were never declared in AASA;
// this is the exact production-facing contract, so assert against the real
// served file, not a copy.
describe("apple-app-site-association — /invite path", () => {
  const aasa = JSON.parse(
    readFileSync(
      path.join(__dirname, "../../public/.well-known/apple-app-site-association"),
      "utf8",
    ),
  );

  it("declares /invite/* alongside the existing paths", () => {
    const paths: string[] = aasa.applinks.details[0].paths;
    expect(paths).toContain("/invite/*");
    // Regression guard: the fix must be additive, not a replacement.
    expect(paths).toContain("/auth/confirm");
    expect(paths).toContain("/event/*");
    expect(paths).toContain("/post/*");
  });
});

describe("Invite page — real App Store ID", () => {
  const src = readFileSync(path.join(__dirname, "../../app/invite/[token]/page.tsx"), "utf8");

  it("does not use the placeholder App Store ID", () => {
    expect(src).not.toMatch(/id0000000000/);
  });

  it("uses the real App Store Connect ascAppId from eas.json (6786491344)", () => {
    expect(src).toMatch(/id6786491344/);
  });
});
