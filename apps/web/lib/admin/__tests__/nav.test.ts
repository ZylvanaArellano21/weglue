import { describe, it, expect } from "vitest";
import { ADMIN_NAV, findNavItem } from "../nav";

describe("admin navigation", () => {
  it("marks Day-1, Day-2 and Day-3 content sections as ready", () => {
    const ready = ADMIN_NAV.filter((i) => i.ready).map((i) => i.href).sort();
    expect(ready).toEqual([
      "/admin",
      "/admin/clubs",
      "/admin/comments",
      "/admin/gluemates",
      "/admin/memberships",
      "/admin/officers",
      "/admin/posts",
      "/admin/restrictions",
      "/admin/universities",
      "/admin/users",
    ]);
  });

  it("every ready section has a corresponding built route intent", () => {
    for (const item of ADMIN_NAV.filter((i) => i.ready)) {
      expect(item.day).toBeLessThanOrEqual(3);
    }
  });

  it("resolves a detail route to its section (longest-prefix wins over Overview)", () => {
    expect(findNavItem("/admin/users/abc-123")?.label).toBe("Users");
    expect(findNavItem("/admin/clubs/xyz")?.label).toBe("Clubs");
  });

  it("resolves the overview root exactly", () => {
    expect(findNavItem("/admin")?.label).toBe("Overview");
  });

  it("resolves an unbuilt single-segment section", () => {
    const item = findNavItem("/admin/reports");
    expect(item?.label).toBe("Reports");
    expect(item?.ready).toBe(false);
  });

  it("every nav href is unique", () => {
    const hrefs = ADMIN_NAV.map((i) => i.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});
