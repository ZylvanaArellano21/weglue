// ─── Administrator restriction: pure routing decision (iOS + Android) ───────
//
// Day 10B2. Extends the containment shape proven by `lib/platformAdmin.ts`:
// a pure, unit-testable function decides what the root layout renders, and the
// restricted shell is returned INSTEAD of the navigator — never over it. With
// no <Stack> mounted, no tab, feed, recommendation or realtime host is ever
// created for a restricted account.
//
// TWO DIFFERENT SOURCES, DELIBERATELY:
//   • platform-admin containment reads `app_metadata` off the SESSION, so it is
//     known synchronously and cannot be stale.
//   • an administrator restriction lives in the DATABASE, so it must be
//     fetched. That is what `my_access_state()` is for.
//
// This module is the JavaScript half. It is not the control — migration 058 is.
// Even if this file were bypassed entirely, RLS and the RPC guards deny a
// restricted account, so the worst case is a screen that looks wrong, never one
// that does something it should not.

/** Exactly what `my_access_state()` may return to a student client. */
export interface AccessStatePayload {
  /**
   * 'restricted' is deliberately generic. The database never tells a client
   * that the internal classification was `platform_blocked`, so the UI cannot
   * leak how severe the enforcement was.
   */
  state: 'active' | 'suspended' | 'restricted' | 'deletion_pending';
  /** Present only for a time-limited suspension. */
  suspended_until: string | null;
  violation_category?: string | null;
  public_reason?: string | null;
  scheduled_deletion_at?: string | null;
  appeal_deadline?: string | null;
  support_email: string;
}

export type AccessRoute = 'student' | 'suspended' | 'restricted' | 'deletion_pending';

/**
 * What the root layout should render for a resolved access state.
 *
 * FAILS OPEN, ON PURPOSE. An unknown or missing payload resolves to 'student',
 * because a network blip must not lock a healthy student out of the app they
 * paid nothing for and did nothing wrong in. This is safe precisely because the
 * server is the real control: a restricted account that slips past this
 * function still cannot read or write anything.
 */
export function resolveAccessRoute(
  payload: AccessStatePayload | null | undefined
): AccessRoute {
  if (!payload) return 'student';
  if (payload.state === 'suspended') return 'suspended';
  if (payload.state === 'restricted') return 'restricted';
  if (payload.state === 'deletion_pending') return 'deletion_pending';
  return 'student';
}

export function isRestrictedRoute(route: AccessRoute): boolean {
  return route === 'suspended' || route === 'restricted' || route === 'deletion_pending';
}

/**
 * Copy for the restricted shell.
 *
 * NEVER contains an internal reason, an administrator identity, or the words
 * "platform blocked" — the database does not send them, and this module could
 * not render them even if it wanted to.
 */
export function restrictionCopy(payload: AccessStatePayload | null): {
  title: string;
  body: string;
  until: string | null;
  scheduledDeletionAt: string | null;
} {
  const until = payload?.suspended_until ?? null;
  if (payload?.state === 'suspended') {
    return {
      title: 'Your We Glue access is temporarily suspended.',
      body:
        'You can’t use We Glue right now. Your account and everything in it — your posts, ' +
        'messages, clubs and events — are still here and have not been deleted.',
      until, scheduledDeletionAt: null,
    };
  }
  if (payload?.state === 'deletion_pending') return {
    title: 'Your We Glue account is scheduled for permanent deletion.',
    body: 'Your account is blocked from normal We Glue use while this deletion is pending.',
    until: null,
    scheduledDeletionAt: payload.scheduled_deletion_at ?? null,
  };
  return {
    title: 'Your access to We Glue has been restricted.',
    body:
      'You can’t use We Glue right now. Your account and everything in it — your posts, ' +
      'messages, clubs and events — are still here and have not been deleted.',
    until: null, scheduledDeletionAt: null,
  };
}

/** Human date for a suspension end, or null when there is no expiry. */
export function formatSuspensionEnd(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
