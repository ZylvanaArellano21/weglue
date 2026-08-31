# BE-7 logout fix — physical-device session QA

**Build under test:** one internal `development` dev-client build (iOS + Android),
`eas build --profile development --platform all`, from the exact
`claude/rollout-reliability-frontend` checkout (tip `b6dfbf80`, contains BE-7
commit `5e6c1420`). Internal distribution, `development` channel only — no
TestFlight, no store, no production channel, no OTA.

**What the fix does (`5e6c1420`):**
- `apps/mobile/lib/supabase.ts` — one module-scope `AppState` listener:
  `active` → `supabase.auth.startAutoRefresh()`, otherwise `stopAutoRefresh()`.
  Idempotent. So the refresh timer does **not** tick while the app is
  backgrounded/suspended, which is where iOS could kill the process after a
  refresh-token rotation but before the rotated token was persisted → next
  launch presents a stale token → GoTrue `400 Invalid Refresh Token: Already
  Used` → `SIGNED_OUT`.
- `apps/mobile/hooks/useAuthDeepLink.ts` — every credential branch checks the
  returned error and is wrapped; malformed / expired / already-consumed links
  route to the resend screen and **never mutate the current session**. A signup
  confirmation link is not consumed when a real session is already active.
- `apps/mobile/app/auth/confirmed.tsx` — the confirm screen's session exists
  only to consume the token; it signs out and hands off to Login (deliberate,
  per the frozen onboarding journey).

**Required outcome:** ordinary backgrounding, suspension, network loss,
reopening, or multi-device use must **not** unexpectedly sign the user out.
Explicit logout and legitimate session invalidation (password change, revoke)
must still work.

---

## How to run it

1. Install the dev-client build on the device (iOS via the EAS internal
   distribution link / QR; Android via the APK link).
2. On this Mac, from the `claude/rollout-reliability-frontend` checkout:
   `cd /Users/zylvanaarellanocampos/weglue-fe/apps/mobile && npx expo start --dev-client`
   (add `--tunnel` if the phone is not on the same LAN).
3. Open the dev-client app, connect to the Metro server, load the bundle.
4. Confirm at the top of the JS logs you see the `applyAutoRefreshForAppState`
   path run on foreground/background transitions (optional sanity check).
5. Run every row of the matrix on **iOS** and on **Android**.

For "background beyond token lifetime": the Supabase access token TTL is ~1 h.
Background the app for **> 65 minutes** of real wall-clock time (screen off,
other apps used, or device idle), then foreground.

---

## Session matrix — record PASS / FAIL + notes per row, per platform

| # | Scenario | Steps | PASS = |
| --- | --- | --- | --- |
| 1 | Normal login → reopen | Log in with email+password. Fully close the app from the switcher. Reopen. | Still logged in, lands in Home. |
| 2 | Repeated background/foreground | Background and foreground the app ~15–20 times over a few minutes (home button / app switcher, not force-close). | Never signed out. No spinner-to-login. |
| 3 | Force-close → reopen | From Home, force-quit via the app switcher. Wait 30 s. Reopen. Repeat 5×. | Still logged in every time. |
| 4 | Background beyond token lifetime | Log in. Background the app. Leave it backgrounded/suspended for **> 65 min** (use the phone normally for other things). Foreground. | Still logged in. The session silently refreshes on foreground; no logout, no re-auth prompt. |
| 5 | Wi-Fi loss / recovery | While logged in and foregrounded, turn Wi-Fi off for ~2 min (no cellular, or cellular too), use the app (scroll, tap), then turn Wi-Fi back on. | Requests fail gracefully while offline; on reconnect the app recovers; **not** signed out. |
| 6 | Airplane mode / recovery | Enable airplane mode for ~5 min with the app open, then background it, wait 2 min, disable airplane mode, foreground. | Recovers to a working logged-in state; no logout. |
| 7 | Phone + web simultaneously | Log in on the phone. Log in to the **same account** on the web app in a browser. Use both for ~10 min (post, RSVP, read). Background/foreground the phone a few times. | Both stay logged in. Neither session kicks the other out. (A new sign-in does not revoke the old refresh token on Supabase's default config.) |
| 8 | Same account on multiple devices | If a second phone is available: log the same account in on device A and device B. Background/foreground and force-close each independently over ~15 min. | Both devices stay logged in independently. |
| 9 | Explicit logout | From the profile/settings screen, tap Log out. | Returns to the login screen. Reopening the app does **not** auto-log back in. On the other device/web (scenario 7/8), that session is **unaffected** (explicit logout is per-device). |
| 10 | Stale / expired verification-link behavior | Sign up a fresh test account (do not verify). While that unverified state exists, tap an **old** or already-used confirmation link (e.g. re-tap a link from a previous signup, or a hand-mangled link). Separately: while **already logged in**, tap a signup-confirmation deep link. | Old/used/expired link → routed to the resend screen, **current session untouched**. Confirmation link while logged in → **not consumed**, session stays as-is. No crash, no logout. |

### Extra observations to note

- Any `SIGNED_OUT` that appears in the Metro console during scenarios 1–8 (there
  should be none from ordinary behavior).
- Time-to-interactive on foreground after scenario 4 (should be normal, the
  refresh is quick).
- Whether the app-icon badge / unread state is correct after each reopen.

---

## Result

- **PASS** requires: scenarios 1–8 and 10 show **no spontaneous logout** on
  either platform; scenario 9 (explicit logout) works and is per-device.
- Any spontaneous `SIGNED_OUT` from ordinary background/network/reopen behavior
  is a **FAIL** — capture the Metro console around it and the exact steps.

After QA: STOP. Then the mandatory `WE_GLUE_BEFORE_DONE_RULES.md` triple-check,
then the production decision for migration 105 + the frontend reliability stack.
