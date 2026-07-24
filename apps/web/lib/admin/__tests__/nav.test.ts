import { describe, it, expect } from "vitest";
import { ADMIN_NAV, findNavItem } from "../nav";

describe("admin navigation", () => {
  it("marks only the Day-1 sections as ready", () => {
    const ready = ADMIN_NAV.filter((i) => i.ready).map((i) => i.href).sort();
    expect(ready).toEqual(["/admin", "/admin/clubs", "/admin/users"]);
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
