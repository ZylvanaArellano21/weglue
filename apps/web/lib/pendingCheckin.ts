// ─── Deferred check-in destination (web) ────────────────────────────────────
// Mirrors lib/pendingInvite.ts's contract: a student who opens the permanent
// attendance link while signed out has to survive Login (or Create an Account
// → verify email → back to Login) and still land on that exact event's
// check-in screen, not Home. localStorage is origin-scoped and untouched by
// those navigations, so persisting the target there is what actually survives
// the whole detour — resumed once, right in login/page.tsx's success path,
// next to the existing pending-invite check.

const KEY = "weglue-pending-checkin";

interface PendingCheckin {
  clubId: string;
  /** Absent when the link was the club-level resolver (event not yet chosen)
   *  — resume then returns to the resolver, which re-resolves the active
   *  event(s) itself rather than trusting a stale eventId. */
  eventId?: string;
}

export function setPendingCheckin(target: PendingCheckin): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(target));
  } catch {
    // A storage failure must never break the login/signup flow.
  }
}

export function getPendingCheckin(): PendingCheckin | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.clubId === "string" && (parsed.eventId === undefined || typeof parsed.eventId === "string")) {
      return parsed as PendingCheckin;
    }
    return null;
  } catch {
    return null;
  }
}

export function clearPendingCheckin(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

/** The path to redirect to for a pending checkin, or null if there is none. */
export function resumePendingCheckinPath(): string | null {
  const target = getPendingCheckin();
  if (!target) return null;
  clearPendingCheckin();
  return target.eventId ? `/checkin/${target.clubId}/${target.eventId}` : `/checkin/${target.clubId}`;
}
