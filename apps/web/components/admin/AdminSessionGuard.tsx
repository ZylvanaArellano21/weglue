"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { lockAdminPortal } from "../../lib/admin/actions";
import { ADMIN_INACTIVITY_TIMEOUT_MS } from "../../lib/admin/adminEnv";

const WARN_BEFORE_MS = 60 * 1000; // surface a countdown in the final minute
const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "scroll", "touchstart", "click"] as const;

/**
 * Admin session protection: an obvious "Lock Admin Portal" control, an
 * inactivity auto-lock, AND an honest countdown to the server's absolute session
 * deadline. Locking signs the session out (server action), so the next visit
 * needs a fresh login AND MFA re-challenge — the portal cannot sit unattended
 * at aal2. Activity anywhere on the page resets the idle timer.
 *
 * NONE of this is a security control. The server rejects an over-age session in
 * `requireSecureAdmin()` whatever this component does or does not do — killing
 * the timer in devtools, or freezing the clock, changes nothing server-side.
 * `sessionExpiresAtMs` is here so the UI stops at the same moment the server
 * does, instead of leaving a dead dashboard on screen.
 */
export function AdminSessionGuard({
  sessionExpiresAtMs = null,
}: {
  sessionExpiresAtMs?: number | null;
}) {
  const router = useRouter();
  const lastActivity = useRef<number>(Date.now());
  const [remainingMs, setRemainingMs] = useState<number>(ADMIN_INACTIVITY_TIMEOUT_MS);
  const [expiredLock, setExpiredLock] = useState(false);
  const [locking, setLocking] = useState(false);
  const lockedRef = useRef(false);

  const lock = useCallback(
    async (reason: "idle" | "expired" = "idle") => {
      if (lockedRef.current) return;
      lockedRef.current = true;
      setLocking(true);
      try {
        await lockAdminPortal();
      } catch {
        /* proceed to login regardless */
      }
      // The dashboard's OWN sign-in page, not the student /login (which belongs
      // to the .edu onboarding funnel and ignores ?next=).
      router.replace(`/admin/login?next=/admin${reason === "expired" ? "&expired=1" : ""}`);
      router.refresh();
    },
    [router]
  );

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

  // Tick once a second: whichever deadline comes first — idle budget or the
  // server's absolute session deadline — drives the warning and the lock.
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      const idleRemaining = ADMIN_INACTIVITY_TIMEOUT_MS - (now - lastActivity.current);
      const absoluteRemaining =
        sessionExpiresAtMs === null ? Number.POSITIVE_INFINITY : sessionExpiresAtMs - now;
      const remaining = Math.min(idleRemaining, absoluteRemaining);
      setRemainingMs(remaining);
      if (absoluteRemaining <= 0) {
        setExpiredLock(true);
        void lock("expired");
      } else if (idleRemaining <= 0) {
        void lock("idle");
      }
    }, 1000);
    return () => clearInterval(id);
  }, [lock, sessionExpiresAtMs]);

  const showWarning = remainingMs <= WARN_BEFORE_MS && remainingMs > 0 && !locking;
  const secondsLeft = Math.max(0, Math.ceil(remainingMs / 1000));
  // Inside the final minute of the absolute deadline, "Stay signed in" cannot
  // help — only a fresh sign-in can — so the copy must not promise otherwise.
  const atAbsoluteDeadline =
    expiredLock ||
    (sessionExpiresAtMs !== null && sessionExpiresAtMs - Date.now() <= WARN_BEFORE_MS);

  return (
    <>
      <button
        onClick={() => void lock("idle")}
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
              {atAbsoluteDeadline ? "Session ends in " : "Locking for inactivity in "}
              <span className="font-semibold tabular-nums">{secondsLeft}s</span>
              {atAbsoluteDeadline ? ". Sign in again to continue." : "."}
            </span>
            {atAbsoluteDeadline ? null : (
              <button
                onClick={() => {
                  lastActivity.current = Date.now();
                  setRemainingMs(ADMIN_INACTIVITY_TIMEOUT_MS);
                }}
                className="rounded-md bg-amber-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-700"
              >
                Stay signed in
              </button>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
