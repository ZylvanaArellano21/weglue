import { describe, expect, it } from "vitest";
import { getClubProfileHref, getUserProfileHref } from "../ClickableIdentity";

describe("canonical identity routes", () => {
  it("uses the profile row id rather than a username", () => {
    expect(getUserProfileHref("348fe28b-061a-423e-8736-47502a2ef0fd")).toBe("/u/348fe28b-061a-423e-8736-47502a2ef0fd");
    expect(getUserProfileHref("a_username")).toBe("/u/a_username");
  });

  it("keeps club routes separate from user routes", () => {
    expect(getClubProfileHref("club-123")).toBe("/club/club-123");
    expect(getClubProfileHref("club-123")).not.toBe(getUserProfileHref("club-123"));
  });
});
