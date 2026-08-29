import { describe, expect, it, vi, beforeEach } from 'vitest';

// ============================================================================
// registerPushTokenIfPermitted — the RPC-stampede guard must be IDENTITY-aware
// ============================================================================
//
// The guard skips re-registration when (token, user, age<6h) all match. The
// property under test: a DIFFERENT user signing in on the SAME device (Expo
// token unchanged, previous registration <6h old) still re-registers, so the
// server row moves to the new account. Deactivate-on-logout is best-effort and
// can be skipped offline, so this guard is the backstop.
// ============================================================================

const h = vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
  return {
    state: { currentUserId: 'user-A' as string | null, permissionState: 'granted' },
    rpc: vi.fn(() => Promise.resolve({ error: null })),
    token: 'ExponentPushToken[fixed-device-token]',
  };
});

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('expo-device', () => ({ isDevice: true, brand: 'Apple', modelName: 'iPhone' }));
vi.mock('expo-constants', () => ({
  default: { expoConfig: { extra: { eas: { projectId: 'proj-1' } } } },
}));
vi.mock('expo-notifications', () => ({
  getExpoPushTokenAsync: vi.fn(() => Promise.resolve({ data: h.token })),
}));
vi.mock('../permissions', () => ({
  getPermissionState: () => Promise.resolve(h.state.permissionState),
}));
vi.mock('../../supabase', () => ({
  supabase: {
    auth: {
      getSession: () =>
        Promise.resolve({
          data: { session: h.state.currentUserId ? { user: { id: h.state.currentUserId } } : null },
        }),
    },
    rpc: h.rpc,
  },
}));

import { registerPushTokenIfPermitted } from '../registerPush';

beforeEach(() => {
  h.rpc.mockClear();
  h.state.currentUserId = 'user-A';
  h.state.permissionState = 'granted';
});

describe('registerPushTokenIfPermitted identity-aware skip', () => {
  it('registers on first call for a user', async () => {
    await registerPushTokenIfPermitted();
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.rpc).toHaveBeenCalledWith('register_push_token', expect.objectContaining({ p_token: h.token }));
  });

  it('skips the immediate repeat call for the SAME user + token', async () => {
    await registerPushTokenIfPermitted();
    expect(h.rpc).not.toHaveBeenCalled(); // still within 6h of the previous test's registration
  });

  it('re-registers when a different user signs in on the same device within 6h', async () => {
    h.state.currentUserId = 'user-B';
    await registerPushTokenIfPermitted();
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.rpc).toHaveBeenCalledWith('register_push_token', expect.objectContaining({ p_token: h.token }));
  });

  it('then skips the repeat for user-B too', async () => {
    h.state.currentUserId = 'user-B';
    await registerPushTokenIfPermitted();
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it('does nothing when there is no session', async () => {
    h.state.currentUserId = null;
    await registerPushTokenIfPermitted();
    expect(h.rpc).not.toHaveBeenCalled();
  });
});
