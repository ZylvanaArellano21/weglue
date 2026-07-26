"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { lockAdminPortal } from "../../lib/admin/actions";
import { ADMIN_INACTIVITY_TIMEOUT_MS } from "../../lib/admin/adminEnv";

const WARN_BEFORE_MS = 60 * 1000; // surface a countdown in the final minute
const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "scroll", "touchstart", "click"] as const;

/**
 * Admin session protection: an obvious "Lock Admin Portal" control plus an
 * inactivity auto-lock. Locking signs the session out (server action), so the
 * next visit needs a fresh login AND MFA re-challenge — the portal cannot sit
 * unattended at aal2. Activity anywhere on the page resets the idle timer.
 */
export function AdminSessionGuard() {
  const router = useRouter();
  const lastActivity = useRef<number>(Date.now());
  const [remainingMs, setRemainingMs] = useState<number>(ADMIN_INACTIVITY_TIMEOUT_MS);
  const [locking, setLocking] = useState(false);
  const lockedRef = useRef(false);

  const lock = useCallback(async () => {
    if (lockedRef.current) return;
    lockedRef.current = true;
    setLocking(true);
    try {
      await lockAdminPortal();
    } catch {
      /* proceed to login regardless */
    }
    router.replace("/login?next=/admin");
    router.refresh();
  }, [router]);

  // Record activity (throttled via ref, no re-render on every event).
  useEffect(() => {
    const onActivity = () => {
      lastActivity.current = Date.now();
    };
    for (const ev of ACTIVITY_EVENTS) {
      window.addEventListener(ev, onActivity, { passive: true });
    }
    return () => {
      for (const ev of ACTIVITY_EVENTS) window.removeEventListener(ev, onActivity);
    };
  }, []);

  // Tick once a second: compute remaining idle budget, warn, then lock.
  useEffect(() => {
    const id = setInterval(() => {
      const idle = Date.now() - lastActivity.current;
      const remaining = ADMIN_INACTIVITY_TIMEOUT_MS - idle;
      setRemainingMs(remaining);
      if (remaining <= 0) void lock();
    }, 1000);
    return () => clearInterval(id);
  }, [lock]);

  const showWarning = remainingMs <= WARN_BEFORE_MS && remainingMs > 0 && !locking;
  const secondsLeft = Math.max(0, Math.ceil(remainingMs / 1000));

  return (
    <>
      <button
        onClick={() => void lock()}
        disabled={locking}
        title="Sign out and require MFA to return"
        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
      >
        <span aria-hidden>🔒</span>
        {locking ? "Locking…" : "Lock portal"}
      </button>

      {showWarning ? (
        <div className="fixed inset-x-0 top-0 z-50 flex justify-center px-4 pt-2">
          <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800 shadow-sm">
            <span>
              Locking for inactivity in <span className="font-semibold tabular-nums">{secondsLeft}s</span>.
            </span>
            <button
              onClick={() => {
                lastActivity.current = Date.now();
                setRemainingMs(ADMIN_INACTIVITY_TIMEOUT_MS);
              }}
              className="rounded-md bg-amber-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-700"
            >
              Stay signed in
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
