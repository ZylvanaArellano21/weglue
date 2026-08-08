import { describe, expect, it } from "vitest";
import { permissionSelectValue, postingPermissionOptions, type PostingPermission } from "../messages/service";

/**
 * Bug 7 — Officers chats stop offering a distinction that never existed.
 *
 * Everyone inside an Officers conversation is already an officer, so "All
 * officers" and "Only officers" selected an identical set of people. The
 * Officers model is therefore "Everyone in this chat" (default) or "Certain
 * people", while the Members model keeps its genuine role-based options.
 */
describe("posting permission options", () => {
  const officers = postingPermissionOptions(true);
  const members = postingPermissionOptions(false);
  const values = (options: Array<[PostingPermission, string, string]>) => options.map(([value]) => value);
  const labels = (options: Array<[PostingPermission, string, string]>) => options.map(([, label]) => label);

  it("offers an Officers chat exactly Everyone in this chat and Certain people", () => {
    expect(values(officers)).toEqual(["everyone", "certain"]);
    expect(labels(officers)).toEqual(["Everyone in this chat", "Certain people"]);
  });

  it("defaults an Officers chat to Everyone in this chat", () => {
    expect(officers[0][0]).toBe("everyone");
  });

  it("never offers a redundant officers-only option inside an Officers chat", () => {
    expect(values(officers)).not.toContain("officers");
    for (const label of labels(officers)) {
      expect(label).not.toMatch(/only officers/i);
      expect(label).not.toMatch(/all officers/i);
    }
  });

  it("leaves the Members chat model untouched", () => {
    expect(values(members)).toEqual(["everyone", "officers", "certain"]);
    expect(labels(members)).toEqual(["Everyone", "Only officers", "Certain people"]);
  });

  it("allows switching back from Certain people to Everyone in this chat", () => {
    // Both directions are reachable because both remain in the option set.
    expect(values(officers)).toContain("everyone");
    expect(values(officers)).toContain("certain");
  });

  /**
   * No migration is required, so channels seeded or previously saved as
   * 'officers' still exist. Inside an Officers conversation they must render as
   * the everyone option rather than leaving the control with no matching value.
   * The stored value is only normalised when the officer saves.
   */
  describe("display of an existing stored value", () => {
    it("shows an Officers-chat channel stored as officers as the everyone option", () => {
      expect(permissionSelectValue("officers", true)).toBe("everyone");
      expect(values(officers)).toContain(permissionSelectValue("officers", true));
    });

    it("leaves every other stored value exactly as it is", () => {
      expect(permissionSelectValue("everyone", true)).toBe("everyone");
      expect(permissionSelectValue("certain", true)).toBe("certain");
    });

    it("never rewrites a Members chat, where officers-only is a real state", () => {
      expect(permissionSelectValue("officers", false)).toBe("officers");
      expect(permissionSelectValue("everyone", false)).toBe("everyone");
      expect(permissionSelectValue("certain", false)).toBe("certain");
    });

    it("always resolves to an option the control actually offers", () => {
      for (const isOfficersChat of [true, false]) {
        const offered = values(postingPermissionOptions(isOfficersChat));
        for (const stored of ["everyone", "officers", "certain"] as PostingPermission[]) {
          expect(offered).toContain(permissionSelectValue(stored, isOfficersChat));
        }
      }
    });
  });
});
