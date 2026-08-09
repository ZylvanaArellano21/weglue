import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Bug 1 — a failed unsend must REJECT, so the caller rolls the message back and
 * explains what happened. Found by interactive QA: with the delete-message
 * function unavailable the gateway answers 502, the message vanished from the
 * thread, nothing was restored and no explanation was shown.
 */
const invoke = vi.fn();
vi.mock("../supabase-browser", () => ({
  getSupabaseBrowser: () => ({ functions: { invoke: (...a: unknown[]) => invoke(...a) } }),
}));

const { unsendMessage, UnsendError } = await import("../messages/service");

/** What @supabase/functions-js actually returns for a non-2xx response. */
class FunctionsHttpError extends Error {
  context: Response;
  constructor(status: number) {
    super("Edge Function returned a non-2xx status code");
    this.name = "FunctionsHttpError";
    this.context = { status } as Response;
  }
}

describe("unsendMessage failure mapping", () => {
  beforeEach(() => invoke.mockReset());

  it("resolves when the function succeeds", async () => {
    invoke.mockResolvedValue({ data: { state: "deleted" }, error: null });
    await expect(unsendMessage("m1")).resolves.toBeUndefined();
  });

  it.each([
    [502, "unknown"],
    [500, "unknown"],
    [503, "unknown"],
    [401, "not_permitted"],
    [403, "not_permitted"],
    [409, "already_gone"],
  ])("rejects on HTTP %i so the message can be restored", async (status, kind) => {
    invoke.mockResolvedValue({ data: null, error: new FunctionsHttpError(status) });
    await expect(unsendMessage("m1")).rejects.toMatchObject({ cause_kind: kind });
  });

  it("rejects when the request never completed", async () => {
    invoke.mockResolvedValue({ data: null, error: new Error("Failed to fetch") });
    await expect(unsendMessage("m1")).rejects.toBeInstanceOf(UnsendError);
  });

  /**
   * 404 is the ONLY status treated as success, because the canonical RPC uses it
   * for "this message is already unavailable" — the outcome the person wanted.
   */
  it("treats 404 as the message already being gone", async () => {
    invoke.mockResolvedValue({ data: null, error: new FunctionsHttpError(404) });
    await expect(unsendMessage("m1")).resolves.toBeUndefined();
  });
});
