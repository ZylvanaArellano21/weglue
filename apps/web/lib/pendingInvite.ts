// ─── Deferred chat invitation token (web) ───────────────────────────────────
// Feature 3 — a desktop invite has to survive: redirecting to Login, going
// off to Create an Account, completing signup + email verification, and
// returning to Login. localStorage is origin-scoped and untouched by any of
// those page navigations, so persisting the token there — rather than
// threading it through every onboarding step's query params — is what
// actually survives the whole detour. Mirrors apps/mobile/lib/pendingInvite.ts's
// contract; the token itself carries no permissions, same as there.

const KEY = "weglue-pending-invite-token";

export function setPendingInvite(token: string): void {
  try {
    window.localStorage.setItem(KEY, token);
  } catch {
    // A storage failure must never break the login/signup flow.
  }
}

export function getPendingInvite(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function clearPendingInvite(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
