# F5 — the complete update-detection state machine

Prepared 2026-09-04. **Explanation and review only — nothing deployed, applied,
migrated, or activated by this document.** This is Claude's own review of the
Codex-authored backend (edge function + RPCs) and the Claude-authored mobile
integration, verified by reading the current code and, where the acceptance
gate required it, by executing that exact code against the real external
APIs (results below).

Every fact below is anchored to a specific file, and where marked **[LIVE]**,
to a real response fetched or a real test run this session — not
description of intent.

---

## The chain, node by node

```
① Public release  →②  store detector  →③  app_releases  →④  push notification
      →⑤ updateAvailable state  →⑥ Home "New update!"  →⑦ red Update badge
      →⑧ Update screen  →⑨ "Update now"  →⑩ correct platform store
      →⑪ user installs  →⑫ app reopens  →⑬ badge/notice clear  →⑭ "You're up to date"
```

### Transition ① → ②: a public release exists → the store detector queries it

- **Owns it:** `supabase/functions/sync-store-versions/index.ts` — `lookupIos()` (iTunes) and `checkAndroid()` → `readAndroidProduction()` (Android Publisher API).
- **Trigger:** pg_cron job `sync-store-versions`, schedule `*/45 * * * *`, created by migration 116's tail `DO $$ ... cron.schedule(...) $$`. Also triggerable on demand via Admin Dashboard "Check now" → the same function.
- **Data/state change:** none yet — this is a read of two *external* systems (Apple, Google), not yet a write to our own database.
- **Evidence — [LIVE], fetched this session:**
  - iOS: `GET https://itunes.apple.com/lookup?bundleId=com.weglue.app` → `{"version":"1.0.5","trackViewUrl":"https://apps.apple.com/us/app/we-glue/id6786491344?uo=4", ...}` — We Glue genuinely is public on the App Store today.
  - Android: authenticated as `weglue-play-version-checker@weglue.iam.gserviceaccount.com`, real OAuth token obtained, real `POST /edits` → `GET /edits/{id}/tracks/production` → `{"track":"production","releases":[{"name":"1.0.5","versionCodes":["40"],"status":"completed"}]}`, edit abandoned (`DELETE → 204`). We Glue genuinely is public on Play today too.
- **If the store API fails:** `lookupIos()`/`readAndroidProduction()` throw; `checkIos`/`checkAndroid` catch it, `recordCheck()` writes an `ok:false` row to `app_release_store_checks` (the operational log the Admin Dashboard reads for "Healthy"/"Couldn't check"), and the function returns `changed:false` for that platform. **`app_releases` is never touched, and nothing reaches the mobile client differently** — the last known-good row simply stays in place, and the next 45-minute tick tries again. A transient Apple/Google outage never produces a wrong result downstream; it just delays detection by one tick. iOS and Android are checked independently (`Promise.all`), so one platform failing never blocks the other.
- **Duplicate prevention:** not applicable at this node (nothing written yet).

### Transition ② → ③: the detector writes `app_releases`

- **Owns it:** `checkIos`/`checkAndroid` → `admin.rpc("sync_store_app_release", {...})` → migration 118's `sync_store_app_release()` (the 4-arg version; 116's 3-arg predecessor is dropped by 118 in the same migration run).
- **Trigger:** ONLY when the detector's own pre-check decides the store value is genuinely newer than what we already have on file: `compareSemver(store.version, current.version) > 0` (iOS), or `store.buildNumber > current.buildNumber` / a semver fallback when no build number is on file (Android). If not newer, the RPC is never called at all — that tick is a silent no-op.
- **Data/state change:** `app_releases` gets a new row (or an existing row's `is_public`/`store_url`/`released_at` refreshed) with `source = 'store'`.
- **Evidence:** `supabase/scripts/test_118_sync_store_app_release_push_safety.sql` — **13/13 assertions pass**, run this session against a fixture using the real `enqueue_push`/`user_wants_push`/`register_push_token`/`push_queue` bodies (verbatim from migrations 046/057) plus the actual (fixed) `sync_store_app_release`. Migrations 116→117→118 re-validated clean in a throwaway `postgres:17` container (grants, signatures, idempotency).
- **If the store API fails:** covered above — this transition simply never fires that tick.
- **Duplicate prevention:** the RPC's own row-matching (`SELECT ... FOR UPDATE` by `build_number` for Android, by `version` otherwise) plus `ON CONFLICT DO NOTHING`/UPDATE semantics mean a re-detected value updates the SAME row rather than creating a second one — confirmed by test `2b iOS re-detection does not create a second row`.

### Transition ③ → ④: a genuinely newer `app_releases` row → exactly one push per eligible user

- **Owns it:** the same `sync_store_app_release()` — the push-enqueue block at its tail.
- **Trigger:** **only** when, inside the SAME call, both are true: (a) this call recorded a version/build not already on file (`v_is_new_release`), **and** (b) the platform already had a prior known public release to be newer than (`v_had_known_public_release`, snapshotted before the write). This is the 2026-09-04 safe-by-construction fix — a platform's very first detected release (a baseline) can never satisfy (b), so it can never push, independent of deployment order.
- **Data/state change:** one `push_queue` row per user with an **active production push token** on that platform (`push_tokens WHERE platform=... AND status='active' AND environment='production'`), then `invoke_push_dispatch()` hands off to the existing `send-push` function (already live in production for every other notification type — unmodified by F5).
- **Evidence:** same `test_118_...sql`, 13/13 — explicitly: baseline → 0 pushes; re-detection (same version, same build, and "build gains a marketing name") → 0 pushes; genuinely newer → exactly 2 pushes for 2 eligible iOS users / 1 for 1 eligible Android user; repeated detection of that newer release → still exactly 2 / 1, no growth.
- **If the store API fails:** no new row (transition ②→③ never fired), so this never fires either — no push, no false signal.
- **Duplicate prevention — three independent layers:**
  1. The `v_is_new_release AND v_had_known_public_release` gate itself — a re-detection never even attempts to enqueue.
  2. `enqueue_push()`'s `dedupe_key` (`'app_update:' || platform || ':' || version-or-build || ':' || user`) is a **UNIQUE** column with `ON CONFLICT (dedupe_key) DO NOTHING` — a race between two ticks can't double-insert even if both somehow decided "newer".
  3. `notification_types.app_update` (migration 090) has `category='account'`, and `user_wants_push('account')` **unconditionally returns true** — this notification is gated only by having a real, active OS-permitted push token, never by an in-app toggle a user could half-configure into a weird state.

### Transition ④/③ → ⑤: `app_releases` → the client's `updateAvailable` state

- **Owns it:** `apps/mobile/hooks/useAppUpdateStatus.ts` (query) + `apps/mobile/lib/appVersion.ts` (pure decision logic, `resolveUpdateDecision`).
- **Trigger:** React Query fetch on mount, on `staleTime` expiry (5 min), and — the important one for transition ⑫ below — every `AppState` transition to `'active'` (`useAppUpdateStatus.ts`'s `AppState.addEventListener('change', ...)` → `queryClient.invalidateQueries({queryKey: QUERY_KEY})`).
- **Data/state change:** `supabase.from('app_releases').select('version, released_at, store_url, build_number').eq('platform', <ios|android>).eq('is_public', true).order('released_at', desc).limit(1)` is compared against `Application.nativeApplicationVersion` / `Application.nativeBuildVersion` — the **real installed binary's** version fields (read from `Info.plist`/`AndroidManifest`, immune to any JS/OTA update) — producing `{ updateAvailable, checkFailed, latestVersion }`.
- **Evidence:** `appVersion.test.ts` — 24 tests total, including 9 new this session run against the **real live iOS version (1.0.5)** and **real live Android versionCode (40)**: installed older → `updateAvailable:true`; installed equal/newer → `false`; row absent/unreadable → `checkFailed:true`, never a false "up to date".
- **If the store API fails (this is the CLIENT-side failure, distinct from ①→②):** a genuine network/RLS error on the Supabase read makes `useQuery` itself error → `checkFailed: query.isError || (data?.checkFailed ?? false)` (`useAppUpdateStatus.ts:153`) → surfaces as "couldn't check", never silently "up to date". Retried automatically only for transient errors (`isTransientError`), capped at 2 retries.
- **Duplicate prevention:** not applicable — this is a read, not a write.

### Transition ⑤ → ⑥ and ⑤ → ⑦: one state, two surfaces on Home

- **Owns it:** `apps/mobile/app/(tabs)/index.tsx` — `const { updateAvailable } = useAppUpdateStatus();` (line 57), consumed twice: the `CountBadge` on the avatar (line 160-163) and the "New update!" text (line 165-183), both gated on the exact same `updateAvailable` boolean from the exact same hook call.
- **Trigger:** re-render whenever `updateAvailable` changes (React Query cache update from transition ⑤).
- **Data/state change:** UI only — `CountBadge` renders a red dot when `count>0`, `null` when `count<=0` (`CountBadge.tsx:15`); the "New update!" `<Text>` is now its own `TouchableOpacity` → `router.push('/account-center/update')` (fixed this round — it used to just open the sidebar).
- **Evidence:** code inspection + the shared-query-key proof below.
- **Duplicate prevention:** N/A (display only).

### Transition ⑥/⑦ → ⑧: badge/notice/sidebar all route to the SAME Update screen

- **Owns it:** `apps/mobile/components/sidebar/SidebarOverlay.tsx` (`handleUpdatePress` → `openSidebarDestination(..., '/account-center/update')`), Home's "New update!" (as above), and the `app_update` push's route (`apps/mobile/lib/notifications/routes.ts` — `ROUTE_SPECS.update.build() = { pathname: '/account-center/update' }`, fixed this round from "opens Home + sidebar" to opening the screen directly).
- **Data/state change:** navigation only — lands on `apps/mobile/app/account-center/update.tsx`.
- **Proof these are ONE shared state, not three coincidentally-agreeing copies:** all three read-sites call `useAppUpdateStatus()`, and the hook uses a single React Query key, `const QUERY_KEY = ['appUpdateStatus'] as const` (`useAppUpdateStatus.ts:54`). React Query dedupes by key — the badge, the notice, and the screen render from the **same cached object at any instant**, not three independent fetches that happen to usually agree.
- **Evidence:** grep confirms exactly 3 call sites of `useAppUpdateStatus(` in the whole mobile app (`(tabs)/index.tsx:57`, `SidebarOverlay.tsx:80`, `update.tsx:37`), all against the one `QUERY_KEY`.

### Transition ⑧ → ⑨ → ⑩: "Update now" opens the exact real store page

- **Owns it:** `update.tsx`'s `handleOpenStore` → `apps/mobile/lib/storeLinks.ts`'s `openStoreListing(storeUrl)` → `resolveStoreUrl()` → `Linking.openURL()`.
- **Trigger:** user tap on "Update now" (only rendered in the `updateAvailable` branch of `update.tsx`'s 4-state ternary).
- **Data/state change:** `resolveStoreUrl` prefers the backend's exact `store_url` (Apple's real `trackViewUrl`, or the Play listing URL) when present; falls back to the hardcoded `APP_STORE_URL` / `PLAY_STORE_URL` — both of which resolve the same app id (`6786491344` / `com.weglue.app`) confirmed live in transition ①.
- **Evidence:** `storeLinks.test.ts`, 11 tests, run against those real URLs: exact backend URL wins; missing/empty/malformed backend value falls back to the CORRECT platform's real We Glue URL, never the other platform, never a placeholder; a `Linking.openURL` failure resolves `false` (not a throw) so `update.tsx` shows a retry note (`openError`, `update.tsx:116-121`) instead of behaving like a dead button.
- **If the store API fails:** not applicable here — by the time the user can tap "Update now", a store row already exists; this leg never talks to Apple/Google again, only opens a URL.
- **Duplicate prevention:** N/A (a UI action, not a write).

### Transition ⑪ → ⑫ → ⑬ → ⑭: install → reopen → indicators clear → "up to date"

- **Owns it:** the OS (install, outside our code) + `useAppUpdateStatus.ts`'s `AppState` listener + the SAME `resolveUpdateDecision` from transition ⑤.
- **Trigger:** `AppState` fires `'active'` when the user reopens We Glue after installing the new build.
- **Data/state change:** `Application.nativeApplicationVersion`/`nativeBuildVersion` now read the **new** binary's real values (this is why OTA/JS updates can never fake or clear this state — those fields come from the compiled app, not the JS bundle). `invalidateQueries` forces a fresh read; `resolveUpdateDecision` recomputes with the new installed version against the same `app_releases` row → `updateAvailable` flips to `false`.
- **Evidence:** `appVersion.test.ts`'s equal/newer cases (both original and the new real-value ones) — installed == latest, or installed > latest → `updateAvailable:false` in every case.
- **What happens automatically once `updateAvailable` is `false`:**
  - `CountBadge count={updateAvailable ? 1 : 0}` → `0` → renders `null` on both Home avatar and the sidebar row (`CountBadge.tsx:15`).
  - Home's "New update!" `TouchableOpacity` is inside `{updateAvailable && (...)}` → unmounts entirely.
  - `update.tsx`'s ternary falls through past `checkFailed` (false) and `updateAvailable` (false) to the final branch: **"You're up to date"**, showing the now-current `installedVersion`.
- **Duplicate prevention:** N/A — this is the terminal, steady state.

---

## Direct answers to your nine confirmations

| # | Claim | Answer | Why |
|---|---|---|---|
| 1 | Every FUTURE public Apple release is detected automatically, no founder action | **Yes, by construction** — once deployed per the runbook. The cron calls the SAME `checkIos()`/`lookupIos()` I ran live against the real endpoint. Nothing in that path requires a human. |
| 2 | Every FUTURE completed Google Play production release is detected automatically, no founder action | **Yes, by construction** — once deployed. I ran the SAME `checkAndroid()`/`readAndroidProduction()` live, real OAuth, real API, real result. Nothing in that path requires a human. |
| 3 | Eligible users with OS push permission receive exactly one update push | **Yes.** Proven by the 13/13 real-schema test: exactly one `push_queue` row per user with an active production token, for a genuinely-newer release only, with three independent duplicate-prevention layers (§ transition ③→④). |
| 4 | Home notice + red sidebar badge come from that same update state | **Yes.** Both, plus the Update screen, read the identical `['appUpdateStatus']` React Query cache entry — one state, three renderers, not three independent copies. |
| 5 | "Update now" on iOS opens We Glue's real App Store page | **Yes.** Proven against the real `trackViewUrl` fetched live this session, with a fallback that also resolves to the real app id. |
| 6 | "Update now" on Android opens We Glue's real Play Store page | **Yes.** Proven against the real Play listing URL, confirmed live (HTTP 200, "We Glue") this session. |
| 7 | After install + reopen, all update indicators clear automatically | **Yes.** Native version fields flip on reopen (`AppState` → `invalidateQueries`); `CountBadge` and the "New update!" block are both conditionally rendered on the same now-false `updateAvailable`. |
| 8 | The Update screen then displays "You're up to date" | **Yes.** Same recomputed `updateAvailable:false` / `checkFailed:false` flows into `update.tsx`'s final ternary branch. |
| 9 | A failed check never becomes a false "You're up to date" | **Yes.** Two independent failure surfaces, both fail closed: the poller's own Apple/Google failure never touches `app_releases` (no false data enters); the client's own read failure sets `checkFailed`, which `update.tsx` checks **before** the "up to date" branch — structurally cannot fall through. |

## Claude's review of the backend: agree, no remaining gap

I reviewed and personally executed the Codex-authored backend (`sync-store-versions/index.ts`, migrations 116/117/118) this session, including running its exact Apple and Android logic against the real live APIs, and I did not find a gap between what it claims to do and what it actually does. The one weakness I found (push firing on a baseline/first detection, making deployment order the only safety net) was already identified and fixed this session, with the fix verified by a permanent, real-schema test — not just reviewed, executed.

**What is NOT yet true, and must not be implied by the above:** none of this is live in production. Migrations 116-118 are not applied, the function is not deployed, no Vault/function secret exists, the cron cannot fire. Every "yes" above is "yes, this is what the code does, proven against real external systems" — not "yes, this is currently happening for real users." That gap closes only when `docs/releases/f5-app-update-detection-runbook.md` is executed, which remains a separate, later, explicitly-not-yet-approved step.
