import { expect, it, vi } from "vitest";

const fakeRealtime = vi.hoisted(() => {
  let broadcastHandler: ((payload: unknown) => void) | undefined;
  let statusHandler: ((status: string) => void) | undefined;
  const channel: any = {};
  channel.on = vi.fn((_kind: string, _config: unknown, handler: (payload: unknown) => void) => {
    broadcastHandler = handler;
    return channel;
  });
  channel.subscribe = vi.fn((handler: (status: string) => void) => {
    statusHandler = handler;
    return channel;
  });
  const client = {
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: "test-token" } } }) },
    realtime: { setAuth: vi.fn().mockResolvedValue(undefined) },
    channel: vi.fn(() => channel),
    removeChannel: vi.fn().mockResolvedValue(undefined),
  };
  return { client, broadcast: () => broadcastHandler, status: () => statusHandler };
});

vi.mock("../supabase-browser", () => ({
  getSupabaseBrowser: () => fakeRealtime.client,
}));

import { subscribeBroadcast } from "../realtime";

it("uses receipt and reconnect only to trigger canonical recovery", async () => {
  const recoverCanonically = vi.fn();
  const cleanup = subscribeBroadcast("sync:access:00000000-0000-4000-8000-000000000001", "invalidate", recoverCanonically, recoverCanonically);

  await vi.waitFor(() => expect(fakeRealtime.client.channel).toHaveBeenCalledTimes(1));
  fakeRealtime.status()?.("SUBSCRIBED");
  fakeRealtime.broadcast()?.({});
  fakeRealtime.broadcast()?.({});

  expect(recoverCanonically).toHaveBeenCalledTimes(3);
  cleanup();
  expect(fakeRealtime.client.removeChannel).toHaveBeenCalledTimes(1);
});
