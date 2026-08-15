import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// Fix 5 — the hub screen must fire the second sanctioned permission call
// site ONLY when reached via a successful invitation join, and it must
// reuse the existing permission infra (getPermissionState / requestPermission
// FromUserAction / onPermissionDecision / registerPushTokenIfPermitted) —
// scope explicitly excludes "redesigning the existing notification
// permission UI." Matches this repo's existing convention of asserting
// against source text for RN hook/screen wiring that a full render harness
// isn't set up for (see unreadCategories.test.ts).
const source = (relativePath: string) =>
  readFileSync(decodeURIComponent(new URL(relativePath, import.meta.url).pathname), 'utf8');

describe('useInvitePushPermission — reuses existing permission infra, gated on OS status', () => {
  const hookSrc = source('../useInvitePushPermission.ts');

  it('reads OS-level permission state rather than gating on the new-account-only DB flag', () => {
    expect(hookSrc).toMatch(/getPermissionState/);
    // The DB flag may be mentioned in a comment contrasting it with the other
    // call site, but it must never appear as a condition this hook checks.
    expect(hookSrc).not.toMatch(/profile\.push_permission_prompt_pending/);
  });

  it('only requests when status is undetermined', () => {
    expect(hookSrc).toMatch(/state !== 'undetermined'/);
  });

  it('reuses the same request/decision/registration functions as the Home flow (no new permission UI)', () => {
    expect(hookSrc).toMatch(/requestPermissionFromUserAction/);
    expect(hookSrc).toMatch(/onPermissionDecision/);
    expect(hookSrc).toMatch(/registerPushTokenIfPermitted/);
  });

  it('fires at most once per mount via a ref guard, not on every re-render', () => {
    expect(hookSrc).toMatch(/attempted\.current/);
  });
});

describe('Members sub-channels hub — permission call site wiring', () => {
  const hubSrc = source('../../app/chat/[chatId]/index.tsx');

  it('calls useInvitePushPermission gated on fromInvite AND the content actually being loaded (not a bare spinner)', () => {
    expect(hubSrc).toMatch(/useInvitePushPermission\(fromInvite && !detailsLoading\)/);
  });
});
