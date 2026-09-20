import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakeRealtime = vi.hoisted(() => {
  type Channel = {
    topic: string;
    on: ReturnType<typeof vi.fn>;
    subscribe: ReturnType<typeof vi.fn>;
    status?: (status: string, error?: Error) => void;
    broadcast?: (payload: unknown) => void;
  };
  let channels: Channel[] = [];
  const channel = vi.fn((topic: string) => {
    const ch = { topic } as Channel;
    ch.on = vi.fn((_kind, _config, handler) => {
      ch.broadcast = handler;
      return ch;
    });
    ch.subscribe = vi.fn((handler) => {
      ch.status = handler;
      return ch;
    });
    channels.push(ch);
    return ch;
  });
  const removeChannel = vi.fn(async (ch: Channel) => {
    channels = channels.filter((candidate) => candidate !== ch);
    return 'ok';
  });
  const client = {
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'test-token' } } }) },
    realtime: { setAuth: vi.fn().mockResolvedValue(undefined) },
    channel,
    getChannels: () => channels,
    removeChannel,
  };
  return {
    client,
    reset: () => { channels = []; channel.mockClear(); removeChannel.mockClear(); },
  };
});

vi.mock('../supabase-browser', () => ({ getSupabaseBrowser: () => fakeRealtime.client }));

import { createSafeChannel, removeSafeChannel, subscribeBroadcast, subscribeBroadcastEvents } from '../realtime';

beforeEach(() => fakeRealtime.reset());

async function subscribe(kind: 'single' | 'events') {
  const received = vi.fn();
  const cleanup = kind === 'single'
    ? subscribeBroadcast('sync:access:user', 'invalidate', received, received)
    : subscribeBroadcastEvents('sync:access:user', { invalidate: received }, received);
  await vi.waitFor(() => expect(fakeRealtime.client.getChannels()).toHaveLength(1));
  return { channel: fakeRealtime.client.getChannels()[0]!, cleanup, received };
}

describe('realtime cleanup', () => {
  it('removes a normal channel without leaving a zombie or removing another channel', async () => {
    const first = createSafeChannel('first', []);
    const second = createSafeChannel('second', []);
    expect(fakeRealtime.client.getChannels()).toHaveLength(2);
    removeSafeChannel(first);
    await vi.waitFor(() => expect(fakeRealtime.client.getChannels()).toEqual([second]));
    removeSafeChannel(second);
    await vi.waitFor(() => expect(fakeRealtime.client.getChannels()).toHaveLength(0));
  });

  it('makes repeated cleanup and cleanup after an external removal safe', async () => {
    const channel = createSafeChannel('once', [])!;
    removeSafeChannel(channel);
    removeSafeChannel(channel);
    await vi.waitFor(() => expect(fakeRealtime.client.removeChannel).toHaveBeenCalledTimes(1));
    removeSafeChannel(channel);
    expect(fakeRealtime.client.removeChannel).toHaveBeenCalledTimes(1);

    const external = createSafeChannel('external', [])!;
    await fakeRealtime.client.removeChannel(fakeRealtime.client.getChannels()[0]!);
    removeSafeChannel(external);
    expect(fakeRealtime.client.removeChannel).toHaveBeenCalledTimes(2);
    expect(fakeRealtime.client.getChannels()).toHaveLength(0);
  });

  it('does not issue duplicate leaves while removal is in flight', async () => {
    const channel = createSafeChannel('pending', [])!;
    let finish!: () => void;
    fakeRealtime.client.removeChannel.mockImplementationOnce((ch) => new Promise((resolve) => {
      finish = () => {
        fakeRealtime.client.getChannels().splice(fakeRealtime.client.getChannels().indexOf(ch), 1);
        resolve('ok');
      };
    }));
    removeSafeChannel(channel);
    removeSafeChannel(channel);
    expect(fakeRealtime.client.removeChannel).toHaveBeenCalledTimes(1);
    finish();
    await vi.waitFor(() => expect(fakeRealtime.client.getChannels()).toHaveLength(0));
  });

  it('uses receipt and reconnect only to trigger canonical recovery', async () => {
    const { channel, cleanup, received } = await subscribe('single');
    channel.status?.('SUBSCRIBED');
    channel.broadcast?.({});
    channel.broadcast?.({});
    expect(received).toHaveBeenCalledTimes(3);
    cleanup();
    await vi.waitFor(() => expect(fakeRealtime.client.getChannels()).toHaveLength(0));
  });
});

describe.each(['single', 'events'] as const)('%s private broadcast', (kind) => {
  it.each(['CHANNEL_ERROR', 'TIMED_OUT'])('tears down permanently on unauthorized %s', async (status) => {
    const { channel, cleanup } = await subscribe(kind);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      channel.status?.(status, new Error('Unauthorized'));
      await vi.waitFor(() => expect(fakeRealtime.client.getChannels()).toHaveLength(0));
      channel.status?.(status, new Error('Unauthorized'));
      cleanup();
      expect(fakeRealtime.client.removeChannel).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('will not retry'));
    } finally {
      warn.mockRestore();
    }
  });

  it.each(['CHANNEL_ERROR', 'TIMED_OUT'])('keeps transient %s retryable', async (status) => {
    const { channel, cleanup } = await subscribe(kind);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      channel.status?.(status, new Error('temporary network failure'));
      expect(fakeRealtime.client.getChannels()).toEqual([channel]);
      expect(fakeRealtime.client.removeChannel).not.toHaveBeenCalled();
      cleanup();
      await vi.waitFor(() => expect(fakeRealtime.client.getChannels()).toHaveLength(0));
    } finally {
      warn.mockRestore();
    }
  });
});

it('handles a rejected web removeChannel promise and permits a retry', async () => {
  const channel = createSafeChannel('rejection', [])!;
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    fakeRealtime.client.removeChannel.mockRejectedValueOnce(new Error('network failure'));
    removeSafeChannel(channel);
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith('[realtime] removeChannel failed', expect.any(Error)));
    expect(fakeRealtime.client.getChannels()).toEqual([channel]);
    removeSafeChannel(channel);
    await vi.waitFor(() => expect(fakeRealtime.client.getChannels()).toHaveLength(0));
    expect(fakeRealtime.client.removeChannel).toHaveBeenCalledTimes(2);
  } finally {
    warn.mockRestore();
  }
});
