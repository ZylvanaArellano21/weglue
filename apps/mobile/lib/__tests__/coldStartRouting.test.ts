import { describe, it, expect } from "vitest";
import { isContentDeepLinkUrl } from "../coldStartRouting";

// WelcomeScreen (app/index.tsx) must defer to expo-router — and NOT run its
// redirect-to-Home — whenever the app was cold-started by a link into a real
// content screen. Getting this wrong is the "club profile flashes then bounces
// to Home" bug on iOS.
describe("isContentDeepLinkUrl", () => {
  it("matches a club Universal Link with the QR marker", () => {
    expect(
      isContentDeepLinkUrl("https://weglue.app/club/abc-123?source=qr"),
    ).toBe(true);
  });

  it("matches a club link with no query string", () => {
    expect(isContentDeepLinkUrl("https://weglue.app/club/abc-123")).toBe(true);
  });

  it("matches the custom-scheme club form", () => {
    expect(isContentDeepLinkUrl("weglue://club/abc-123")).toBe(true);
  });

  it("matches a post link", () => {
    expect(isContentDeepLinkUrl("https://weglue.app/post/xyz-789")).toBe(true);
  });

  it("does NOT match a normal launch (no URL)", () => {
    expect(isContentDeepLinkUrl(null)).toBe(false);
    expect(isContentDeepLinkUrl(undefined)).toBe(false);
    expect(isContentDeepLinkUrl("")).toBe(false);
  });

  it("does NOT match the app root or store links", () => {
    expect(isContentDeepLinkUrl("https://weglue.app/")).toBe(false);
    expect(isContentDeepLinkUrl("https://weglue.app/download")).toBe(false);
    expect(isContentDeepLinkUrl("weglue://")).toBe(false);
  });

  it("does NOT match auth or invite links (handled by their own controllers)", () => {
    expect(
      isContentDeepLinkUrl("https://weglue.app/auth/confirm?token_hash=t&type=signup"),
    ).toBe(false);
    expect(isContentDeepLinkUrl("https://weglue.app/invite/some-token")).toBe(false);
  });

  it("requires a path segment after /club or /post, not a bare prefix", () => {
    expect(isContentDeepLinkUrl("https://weglue.app/clubs")).toBe(false);
    expect(isContentDeepLinkUrl("https://weglue.app/club")).toBe(false);
  });
});
