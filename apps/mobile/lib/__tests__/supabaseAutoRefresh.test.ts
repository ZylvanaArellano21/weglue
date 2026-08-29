import { describe, it, expect, vi, beforeEach } from "vitest";

// ============================================================================
// Supabase token-refresh lifecycle (iOS + Android) — rollout task 4
// ============================================================================
//
// Root-cause fix for the unexpected mobile logout: `autoRefreshToken` alone
// keeps the refresh timer ticking while the app is backgrounded, where iOS can
// suspend the app before the rotated refresh token is persisted. Supabase's
// React Native guidance is to drive start/stopAutoRefresh from AppState.
//
// These pin the state machine:
//   • foreground  -> startAutoRefresh
//   • background / inactive -> stopAutoRefresh
//   • no duplicate start/stop on repeated same-state transitions
//   • a background launch stops the timer the client started at init
//   • exactly one AppState listener is registered
// ============================================================================

let appStateCurrent = "active";
const addEventListener = vi.hoisted(() => vi.fn());
const startAutoRefresh = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const stopAutoRefresh = vi.hoisted(() => vi.fn(() => Promise.resolve()));

vi.mock("react-native", () => ({
  AppState: {
    get currentState() {
      return appStateCurrent;
    },
    addEventListener: (...a: unknown[]) => addEventListener(...a),
  },
}));
vi.mock("@react-native-async-storage/async-storage", () => ({ default: {} }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ auth: { startAutoRefresh, stopAutoRefresh } }),
}));

async function loadModule(launchState: string) {
  appStateCurrent = launchState;
  vi.resetModules();
  vi.clearAllMocks();
  return import("../supabase");
}

describe("module load", () => {
  it("a normal active launch does not double-start the timer or register twice", async () => {
    await loadModule("active");
    expect(startAutoRefresh).not.toHaveBeenCalled();
    expect(stopAutoRefresh).not.toHaveBeenCalled();
    expect(addEventListener).toHaveBeenCalledTimes(1);
    expect(addEventListener.mock.calls[0][0]).toBe("change");
  });

  it("a background launch stops the timer the client started at init", async () => {
    await loadModule("background");
    expect(stopAutoRefresh).toHaveBeenCalledTimes(1);
    expect(startAutoRefresh).not.toHaveBeenCalled();
  });
});

describe("applyAutoRefreshForAppState transitions", () => {
  beforeEach(async () => {
    await loadModule("active");
  });

  it("stops on background, starts on return to foreground", async () => {
    const { applyAutoRefreshForAppState } = await import("../supabase");

    applyAutoRefreshForAppState("background");
    expect(stopAutoRefresh).toHaveBeenCalledTimes(1);

    applyAutoRefreshForAppState("active");
    expect(startAutoRefresh).toHaveBeenCalledTimes(1);
  });

  it("treats 'inactive' as a stop", async () => {
    const { applyAutoRefreshForAppState } = await import("../supabase");
    applyAutoRefreshForAppState("inactive");
    expect(stopAutoRefresh).toHaveBeenCalledTimes(1);
  });

  it("does not fire duplicate start/stop on repeated same-state transitions", async () => {
    const { applyAutoRefreshForAppState } = await import("../supabase");

    applyAutoRefreshForAppState("active"); // already running -> no-op
    applyAutoRefreshForAppState("active");
    expect(startAutoRefresh).not.toHaveBeenCalled();

    applyAutoRefreshForAppState("background");
    applyAutoRefreshForAppState("background");
    applyAutoRefreshForAppState("inactive");
    expect(stopAutoRefresh).toHaveBeenCalledTimes(1);

    applyAutoRefreshForAppState("active");
    applyAutoRefreshForAppState("active");
    expect(startAutoRefresh).toHaveBeenCalledTimes(1);
  });

  it("the registered listener IS applyAutoRefreshForAppState", async () => {
    const mod = await import("../supabase");
    expect(addEventListener.mock.calls[0][1]).toBe(mod.applyAutoRefreshForAppState);
  });
});
