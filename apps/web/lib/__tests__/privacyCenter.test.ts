import { beforeEach, describe, expect, it, vi } from "vitest";

// `user_privacy` has no row until a student first touches a privacy control, so
// the read path has to supply the schema defaults itself. Getting this wrong is
// a privacy bug in one direction (a private account rendering as Public) and a
// confusing one in the other, so it is pinned here — the same defaults mobile
// uses in apps/mobile/services/privacyService.ts.

const maybeSingle = vi.fn();
const eq = vi.fn(() => ({ maybeSingle }));
const select = vi.fn(() => ({ eq }));
const upsert = vi.fn(async () => ({ error: null }));
const from = vi.fn(() => ({ select, upsert }));

vi.mock("../supabase-browser", () => ({
  getSupabaseBrowser: () => ({ from }),
}));

const { getPrivacySettings } = await import("../hooks/usePrivacyCenter");

describe("getPrivacySettings", () => {
  beforeEach(() => {
    maybeSingle.mockReset();
    from.mockClear();
  });

  it("defaults every flag to false when the student has no privacy row yet", async () => {
    maybeSingle.mockResolvedValue({ data: null });

    await expect(getPrivacySettings("user-1")).resolves.toEqual({
      is_private: false,
      hide_interests: false,
      hide_events: false,
    });
    expect(from).toHaveBeenCalledWith("user_privacy");
  });

  it("returns the stored values when a row exists", async () => {
    maybeSingle.mockResolvedValue({
      data: { is_private: true, hide_interests: false, hide_events: true },
    });

    await expect(getPrivacySettings("user-1")).resolves.toEqual({
      is_private: true,
      hide_interests: false,
      hide_events: true,
    });
  });

  it("fills in only the missing columns, never overriding a stored true", async () => {
    // A partial row (older account, column added later) must not silently
    // downgrade a flag that IS set.
    maybeSingle.mockResolvedValue({ data: { is_private: true } });

    await expect(getPrivacySettings("user-1")).resolves.toEqual({
      is_private: true,
      hide_interests: false,
      hide_events: false,
    });
  });
});
