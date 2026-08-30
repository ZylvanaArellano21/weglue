# Proposal: carry the verified session into We Glue instead of forcing a re-login

**Status: proposal for founder approval. Not implemented. No code changed.**

Prompted by the staging classroom / shared-IP capacity testing.

## The current flow

1. Student fills the signup form → `auth.signUp` (email confirmation is on, so
   **no session** comes back).
2. App routes to `auth/verify-email` — "after verifying, come back and tap Log in."
3. Student opens the email, taps the confirmation link.
4. If the link opens **in the app**, `useAuthDeepLink` runs `verifyOtp` /
   `setSession` and a real session is established. `auth/confirmed.tsx` then
   **deliberately calls `supabase.auth.signOut()`** and hands off to the Login
   screen, pre-filled, with a "verified" banner.
5. Student types their password again → `auth.signInWithPassword` → Home.

The stated reason for step 4's sign-out (from `confirmed.tsx`): the native
push-notification permission prompt "may only appear immediately after an
explicit email+password Log In," and an auto-authenticated path into the tabs
would let it fire too early.

## Why this matters for capacity

`auth.signUp` and `auth.signInWithPassword` **share one per-IP rate-limit
bucket** on the hosted Auth service (`over_request_rate_limit`, ~8 burst, not
customizable). The current flow spends that bucket **twice per student** — once
at signup, once at the forced re-login.

For a normal launch (students on their own phone networks) this is invisible —
each IP makes 2 requests, nowhere near 8. **But a classroom or dorm behind one
campus NAT** doing a signup rush and then a login rush draws the same shared
bucket down twice. Keeping the verification session would halve the per-IP auth
requests for exactly that population.

`verifyOtp({ type: 'signup', token_hash })` **already returns a full session**
(confirmed on staging) — the student is authenticated the moment they tap the
link. The re-login is redundant work, not a security boundary.

## Options

### A. Keep the verification session (recommended)

After a genuine first-time verification (`authLinkRecentlyConsumed()` is true),
**do not sign out**. Navigate straight to `/(tabs)` and fire the
push-permission prompt from the first Home render for a brand-new account,
gated by a one-time flag (this is essentially what `useFirstLoginPushPermission`
already does — verify it triggers on this path, or add the flag).

- Eliminates one per-IP auth request per student.
- Better UX — no re-typing the password.
- Only helps the **same-device, link-opens-in-app** case. When the link opens
  in a browser (common with some mail apps), the app never gets the session and
  the re-login is unavoidable — so this is an improvement, not a total fix.

Risk: the push-permission-prompt timing contract. Needs a careful check that the
prompt still fires exactly once, at the right moment, on this path.

### B. Keep the re-login but make it resilient

Leave the flow as-is, but on the post-verification Login screen: if
`signInWithPassword` returns `over_request_rate_limit`, auto-retry with backoff
and show "Signing you in…" instead of an error. The credentials are already in
hand (pre-filled email + the password the student just typed).

- No change to the push-prompt contract.
- Still spends the bucket twice; just recovers from the failure.

### C. Do nothing

Accept that a NAT'd classroom sees signup/login failures during a rush. They
recover in well under a minute and a retry works; the copy fix (committed,
`2daf34c4`) now tells the student to wait a moment rather than an hour.

## Recommendation

**Option A**, with Option B's resilient-login as a fallback for the
browser-link case. Bring the push-permission-prompt timing check into the same
change.

## What the classroom test will show (to be filled in)

- classroom-30: signup-wave 429s, verify-wave `session_established` count,
  login-wave 429s, retry success, recovery time.
- If the login wave 429s materially while the verify wave established sessions
  cleanly, that is the quantified case for Option A.
