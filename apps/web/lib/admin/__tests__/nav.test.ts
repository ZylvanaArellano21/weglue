import { describe, it, expect } from "vitest";
import { ADMIN_NAV, findNavItem } from "../nav";

describe("admin navigation", () => {
  it("marks every shipped section through Day 10C as ready", () => {
    const ready = ADMIN_NAV.filter((i) => i.ready).map((i) => i.href).sort();
    expect(ready).toEqual([
      "/admin",
      "/admin/app-releases",
      "/admin/audit-history",
      "/admin/channels",
      "/admin/clubs",
      "/admin/comments",
      "/admin/content-lifecycle",
      "/admin/conversations",
      "/admin/data-health",
      "/admin/deleted-content",
      "/admin/edit-history",
      "/admin/events",
      "/admin/gluemates",
      "/admin/memberships",
      "/admin/messages",
      "/admin/notifications",
      "/admin/officers",
      "/admin/posts",
      "/admin/reports",
      "/admin/restrictions",
      "/admin/rsvps",
      "/admin/settings",
      "/admin/universities",
      "/admin/users",
    ]);
  });

  it("every section is ready by the end of Day 10C", () => {
    for (const item of ADMIN_NAV) {
      expect(item.ready).toBe(true);
      expect(item.day).toBeLessThanOrEqual(10);
    }
  });

  it("resolves a detail route to its section (longest-prefix wins over Overview)", () => {
    expect(findNavItem("/admin/users/abc-123")?.label).toBe("Users");
    expect(findNavItem("/admin/clubs/xyz")?.label).toBe("Clubs");
  });

  it("resolves the overview root exactly", () => {
    expect(findNavItem("/admin")?.label).toBe("Overview");
  });

  it("resolves the moderation sections (now live)", () => {
    const item = findNavItem("/admin/reports");
    expect(item?.label).toBe("Reports");
    expect(item?.ready).toBe(true);
    expect(findNavItem("/admin/deleted-content/anything")?.label).toBe("Deleted Content");
  });

  it("every nav href is unique", () => {
    const hrefs = ADMIN_NAV.map((i) => i.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});
