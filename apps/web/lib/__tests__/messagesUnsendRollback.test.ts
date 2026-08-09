import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";

/**
 * Bug 1 — the optimistic-unsend contract, as verified in interactive QA.
 *
 * QA drove a real failure by taking the delete-message function offline. The
 * gateway answered 503 and the message vanished from the thread. Two things had
 * to be true for that to be acceptable, and only one of them was:
 *
 *   • the message must come back                     — it did;
 *   • the person must be told why                    — it was NOT.
 *
 * The explanation used to be attached as `.catch()` on the promise inside the
 * message's own component. That component is unmounted the instant the
 * optimistic removal takes effect, so the rejection had nowhere to surface and
 * the message silently reappeared with no word of why. Reporting now happens
 * inside the hook, which belongs to the conversation and stays mounted for the
 * whole operation.
 */
const queryClientRef: { current: QueryClient | null } = { current: null };
const unsendMessage = vi.fn();

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return { ...actual, useQueryClient: () => queryClientRef.current! };
});
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, useCallback: (fn: unknown) => fn };
});
vi.mock("../messages/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../messages/service")>();
  return { ...actual, unsendMessage: (id: string) => unsendMessage(id) };
});
// The hook module also pulls in realtime helpers it does not need here.
vi.mock("../realtime", () => ({
  createSafeChannel: () => null,
  removeSafeChannel: () => {},
  subscribeBroadcast: () => () => {},
}));

const { useUnsendMessage, messageKeys } = await import("../messages/hooks");

const CONVERSATION = "11111111-1111-4111-8111-111111111111";
const CHANNEL = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";
const threadKey = [...messageKeys.thread(CONVERSATION, CHANNEL), USER];

const page = () => ({
  messages: [
    { id: "keep-1", content: "still here" },
    { id: "doomed", content: "unsend me" },
    { id: "keep-2", content: "also here" },
  ],
  next_cursor: null,
});
const idsNow = (client: QueryClient) =>
  (client.getQueryData(threadKey) as ReturnType<typeof page>).messages.map((m) => m.id);

describe("optimistic unsend", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    unsendMessage.mockReset();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(threadKey, page());
    queryClientRef.current = queryClient;
  });

  it("removes the message and keeps it gone when the backend succeeds", async () => {
    unsendMessage.mockResolvedValue(undefined);
    const onError = vi.fn();

    await useUnsendMessage(CONVERSATION, CHANNEL, USER, onError)("doomed");

    expect(idsNow(queryClient)).toEqual(["keep-1", "keep-2"]);
    expect(onError).not.toHaveBeenCalled();
  });

  it("restores the message AND explains why when the backend fails", async () => {
    unsendMessage.mockRejectedValue(new Error("gateway 503"));
    const onError = vi.fn();

    await useUnsendMessage(CONVERSATION, CHANNEL, USER, onError)("doomed");

    expect(idsNow(queryClient)).toEqual(["keep-1", "doomed", "keep-2"]);
    expect(onError).toHaveBeenCalledTimes(1);
    const said = onError.mock.calls[0]![0] as string;
    expect(said).toMatch(/still in the chat|can still see it|already been removed/i);
    expect(said).not.toMatch(/something went wrong/i);
    expect(said).not.toMatch(/\b\d{3}\b/);
  });

  it("settles rather than rejecting, so a failure cannot become an unhandled rejection", async () => {
    unsendMessage.mockRejectedValue(new Error("gateway 503"));
    await expect(
      useUnsendMessage(CONVERSATION, CHANNEL, USER, vi.fn())("doomed")
    ).resolves.toBeUndefined();
  });
});
