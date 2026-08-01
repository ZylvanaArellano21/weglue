# Day 10B1 — Production Release Report
## Student-to-student blocking · SHIPPED

**Released:** 2026-08-01 · **Merge commit:** `2587704d` · **PR:** #8

---

# 1. Release identifiers

| Item | Value |
|---|---|
| Branch | `safety/student-blocking` |
| Branch HEAD at merge | `00e82af7` |
| **Pull request** | **#8** — `Day 10B1 — Student-to-student blocking (migration 057)` |
| **Merge commit** | **`2587704db2ed4fbf8cf9db9448fab8c5e9ddc34f`** |
| Merged at | 2026-08-01 05:38:52 UTC |
| Files in release | 33 (10 mobile · 14 web · 5 database · 4 docs) |
| CI at merge | Vercel `pass`, Vercel Preview Comments `pass`, mergeState `CLEAN` |

**Scope correction made before merge:** `apps/web/.vercelignore` and `supabase/functions/deno.lock` — both untracked in the working tree before Day 10B1 began — had been re-added by directory-level `git add` during the Gate 1/2 commits. They were removed again (`00e82af7`). This mattered specifically for this release: committing a `.vercelignore` would have changed Vercel deployment behaviour during a production deploy, unreviewed and unrelated to blocking. Both remain untracked, exactly as found.

---

# 2. Migration ledger

| Version | Name | State |
|---|---|---|
| 053 | platform_admin_accounts | unchanged |
| 054 | atomic_last_officer_protection | **unchanged** |
| 055 | durable_admin_audit | **unchanged** |
| 056 | atomic_admin_mutations | **unchanged** |
| **057** | **student_blocking** | **APPLIED 2026-08-01** |
| ~~051~~ | — | **ABSENT** (ledger and objects) |

Pre-apply gate: remote ledger ended at **056**; computed pending set was exactly `['057']`; 051 not proposed; `to_regclass('public.user_blocks') IS NULL` confirmed before applying. Applied **once** via the Supabase Management API as a single statement — the method used for 055/056, which structurally prevents any other migration being executed. Ledger row count for `057` = **1**.

---

# 3. Migration 057 verification (production, read-only)

| Object | Expected | Found |
|---|---|---|
| `user_blocks` table | 1 | ✅ 1 |
| New public functions | 15 | ✅ 15 |
| `private.user_pair_lock_key` | 1 | ✅ 1 |
| New triggers (`notifications` / `follows` / `messages` block guards) | 3 | ✅ 3 |
| `notification_types.blockable` column | 1 | ✅ 1 |
| `user_blocks` indexes | 2 | ✅ 2 |
| Block-aware RLS policies | 6 | ✅ 6 |
| `user_blocks` rows | 0 | ✅ **0** |

**RLS / grants**

| Property | Result |
|---|---|
| RLS enabled + **forced** | ✅ both true |
| Policies on `user_blocks` | ✅ exactly one: `SELECT … USING (blocker_id = auth.uid())` |
| `authenticated` grants | ✅ **SELECT only** |
| `service_role` grants | ✅ **SELECT only** — see deviation below |
| `block_user` / `search_students` / `get_my_blocked_users` | ✅ `SECURITY DEFINER`, owner `postgres`, `search_path=""` |

### One deviation found and corrected

Supabase's **default privileges** granted `service_role` full DML (`INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER`) on the newly created `user_blocks`, because migration 057 granted `SELECT` without revoking the defaults. The reviewed design specified **SELECT-only**, matching what 055 established for `admin_audit_events`.

Verified nothing depended on it (no server code touches `user_blocks` with the service-role client; `delete_own_account_atomic` is `SECURITY DEFINER` owned by `postgres`; cascade deletes run at FK level), then applied a **strict privilege reduction**:

```sql
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.user_blocks FROM service_role;
```

`service_role` now holds `SELECT` only, identical to the audit tables. **This should be folded into the 057 file for future environments** — see non-blocking finding N9.

### Behavioural verification (production, no real user touched)

| Check | Result |
|---|---|
| `search_discovery` with spoofed `p_user_id` | ✅ **rejected** (`identity_mismatch`) |
| `get_discovery_people` spoofed | ✅ **rejected** |
| `get_discovery_events` spoofed | ✅ **rejected** |
| `search_students` unauthenticated | ✅ **rejected** (`not_authenticated`) |
| `safe_like_fragment('%')` | ✅ `\%` — wildcard neutralised |
| `safe_like_fragment(10 000 chars)` | ✅ capped at 100 |
| Pair lock key A/B == B/A | ✅ `true` |
| Ordinary students cannot enumerate others' blocks | ✅ policy is `blocker_id = auth.uid()`; table is empty |
| Direct notification INSERT respects the guard | ✅ covered by the 95/95 harness against the identical migration file |

**A first verification attempt was abandoned rather than forced.** It tried to create two synthetic `auth.users` inside a rolled-back transaction; production's `handle_new_user` trigger auto-created their `profiles` rows, so an explicit profile INSERT collided and the statement errored. Residue was checked immediately — **zero synthetic rows, all counts at baseline** — confirming the transaction rolled back atomically. Rather than keep writing to production, the remaining checks were done with **pure functions and session-GUC probes that write nothing**, and the row-level behaviours were verified on the shadow database running the identical migration file.

---

# 4. Production data — before / after

| Table | Before | After | |
|---|---:|---:|---|
| profiles | 65 | 65 | ✅ |
| follows | 14 | 14 | ✅ |
| conversations | 62 | 62 | ✅ |
| conversation_participants | 433 | 433 | ✅ |
| messages | 104 | 104 | ✅ |
| notifications | 2137 | 2137 | ✅ |
| push_queue | 111 | 111 | ✅ |
| universities | 1 | 1 | ✅ |
| clubs | 6 | 6 | ✅ |
| club_members | 235 | 235 | ✅ |
| posts | 25 | 25 | ✅ |
| events | 25 | 25 | ✅ |
| reports | 14 | 14 | ✅ |
| **user_blocks** | *(absent)* | **0** | ✅ empty |

**Every pre-existing count unchanged.** Profiles created during the release window: **0**. Auth users created: **0**. (Two accounts matching a `test%` probe are pre-existing, created 2026-07-11 and 2026-07-12.)

---

# 5. Web deployment

| Item | Value |
|---|---|
| Commit deployed | `2587704d` |
| Environment | **Production** |
| Status | **success / Ready** |
| Deployment | `https://weglue-qxoesk067-we-glue.vercel.app` → `weglue.app` |
| Created | 2026-08-01 05:39:56 UTC |

| Verification | Result |
|---|---|
| `/` | 200 |
| `/login` | 200 |
| `/privacy-policy` — contains "Blocking Another Student" | **200, YES** |
| `/community-guidelines` — contains "Blocking someone" | **200, YES** (new page live) |
| `/terms` | 200 |
| `/settings/blocked` | 200 (redirects unauthenticated to login) |
| Community Guidelines linked from landing footer | ✅ |
| **`/admin` conceals without a ticket** | ✅ **404** |
| **`/admin/api/search` conceals** | ✅ **404** |
| Write-gate default fail-closed (`=== "true"`) | ✅ |
| `requireRecentMfaWrite` enforces the write switch | ✅ |
| Lone Star sole university · `single_campus_mode` | ✅ `Lone Star College` · `true` |

---

# 6. Mobile OTA

**Fingerprint gate, re-run immediately before publishing, on merged `main` (`2587704d`):**

```
✅ d644c732e7471dda3cdd6fc4d28e12179fded642  IOS build 23  matches local directory
✅ 6549da75b3646f045f15ac939343b110552836cc  ANDROID build 27  matches local directory
GATE: PASS
```

**Published — one coordinated Day 10B1 update.** Two update *groups* were created because iOS and Android carry different runtime fingerprints; both come from the same publish, the same commit, and the same message.

| | iOS | Android |
|---|---|---|
| **Update group ID** | **`712445df-4406-43d6-a619-fb82d10b9042`** | **`32c42948-b4be-4d53-8b69-520aa46fe47a`** |
| Update ID | `019fbbdb-51f5-77dc-a7f7-6a4ee36be576` | `019fbbdb-51f5-7428-a9ce-dff3189a86b2` |
| **Branch / channel** | `production` / `production` | `production` / `production` |
| **Runtime version** | `d644c732e7471dda3cdd6fc4d28e12179fded642` | `6549da75b3646f045f15ac939343b110552836cc` |
| Targets build | **iOS 23** | **Android 27** |
| Commit | `2587704d` | `2587704d` |
| Published | 2026-08-01 05:47 UTC | 2026-08-01 05:47 UTC |

The `*` EAS appended to the commit denotes an unclean working directory; **tracked modifications were 0** — only the three pre-existing untracked files. The published bundle is exactly merged `main`.

### Delivery verification — device protocol level

The update manifest endpoint was queried exactly as an installed build does (`expo-platform`, `expo-runtime-version`, `expo-channel-name: production`):

| Platform | Runtime requested | Update served | Matches published |
|---|---|---|---|
| iOS | `d644c732…` (build 23) | `019fbbdb-51f5-77dc-a7f7-6a4ee36be576` | ✅ **exact** |
| Android | `6549da75…` (build 27) | `019fbbdb-51f5-7428-a9ce-dff3189a86b2` | ✅ **exact** |

Both resolved on branch `production`. **iOS build 23 and Android build 27 will receive this update.**

- No `--runtime-version` override was used; the fingerprint policy resolved it.
- **No anti-bricking protection was disabled.**
- **No native binary was created.**
- Rollback if needed: `eas update:rollback`, or republish groups `a434e7af` (iOS) / `9fe01c25` (Android).

---

# 7. Test results (final, pre-merge)

| Suite | Result |
|---|---|
| Migration 057 harness (DB + RLS + privilege) | **95 / 95 pass** |
| Two-session concurrency harness | **17 / 17 pass** |
| Web unit tests | **803 / 803 pass** |
| Mobile unit tests | **49 / 49 pass** |
| Shared package tests | no suite defined (type-checked instead) |
| Web / mobile / shared type-checks | **clean** |
| Web production build | **succeeds** |
| Expo export (iOS + Android) | **succeeds**, both Hermes bundles |
| Static secret scan over the release diff | **clean** |
| Migration idempotency (shadow) | re-apply clean |

---

# 8. Store & documentation confirmation

| Artifact | State |
|---|---|
| **Privacy Policy** — "Blocking Another Student" | ✅ committed **and live** |
| **Community Guidelines** | ✅ committed **and live** (new page) |
| **Terms §12** — blocking vs enforcement | ✅ committed |
| Terms — suspension wording | unchanged (reservation of right; 10B2 has not shipped) |

**Founder-reported store declarations** (recorded as stated; consoles are not accessible from here and were not modified):

- **Apple App Privacy** — *Usage Data → Product Interaction*: App Functionality · Linked to the user · Not used for tracking.
- **Google Play Data Safety** — *User IDs* collected, not shared, not ephemeral; *Other actions* collected, not shared, not ephemeral, optional; purposes App functionality + Fraud prevention, security and compliance.

No unrelated store declaration was altered. *(My own assessment had recommended Identifiers → User ID for Apple; the founder's declaration of Usage Data → Product Interaction is recorded as the operative one. Both are defensible; noted only so the record is honest about the difference.)*

---

# 9. Blockers

**None.** Both prior release blockers are closed:

| # | Blocker | Resolution |
|---|---|---|
| R1 | Store/privacy disclosure readiness | ✅ documents committed and live; founder confirmed both console declarations |
| R2 | EAS runtime/fingerprint mismatch | ✅ was a tooling artifact; both platforms verified matching and the OTA delivered |

---

# 10. Non-blocking findings

| # | Finding |
|---|---|
| **N9** *(new)* | **`057` did not revoke Supabase's default `service_role` DML grants** on `user_blocks`; corrected in production by explicit `REVOKE`. The migration file should be amended so a fresh environment reproduces SELECT-only without a manual step. Cosmetic in production today — it is already corrected there. |
| N1 | `search_discovery` keeps its 1-character minimum so installed builds are not broken; it therefore still seq-scans on 1–2 char fragments (immaterial at current scale). Apply the 3-char minimum when mobile next ships a matching client. |
| N2 | `PrivacyInfo.xcprivacy` declares an empty `NSPrivacyCollectedDataTypes` while the app collects email/username/user content. Pre-existing; untouched (editing a native manifest alters the build). |
| N3 | No in-app report-status notification type exists — reports are emailed to support. Nothing to suppress today. |
| N4 | Public buckets unchanged (founder decision 6): an already-known avatar/post URL stays fetchable. Now disclosed in the Privacy Policy. |
| N5 | A push already `sent` cannot be recalled from APNs/FCM; pending items are swept at claim time. |
| N6 | Non-disclosure has a theoretical limit — a disabled composer lets a determined user infer *something*. Mitigated by byte-identical copy across blocked / deleted / never-existed. |
| N7 | Like/comment counts differ privately for the blocker, since filtered rows are not counted. |
| N8 | `.expo/types/router.d.ts` is gitignored and stale, so the new mobile route uses `as any`, matching three existing screens. |

---

# 11. Explicit confirmations

| Confirmation | Status |
|---|---|
| **`ADMIN_WRITES_ENABLED=false`** | ✅ 0 `true` assignments in the repo outside tests; code default fail-closed (`=== "true"`); `/admin` conceals with 404 |
| **Migration 051 remains absent** | ✅ absent from the ledger **and** from production objects |
| **No real user was blocked** | ✅ `user_blocks` = **0 rows**; all blocking exercised on shadow fixtures |
| **No native build was created** | ✅ no `eas build` invoked; `app.json`, `eas.json`, both `package.json` files and `pnpm-lock.yaml` untouched |
| **Lone Star remains the sole university** | ✅ `Lone Star College`, `single_campus_mode = true` |
| **Day 10B2 was not started** | ✅ no `058` migration, no `account_restrictions` table, no administrator restriction action |
| No test user or test block created | ✅ 0 profiles and 0 auth users created during the release window |
| Migrations 054 / 055 / 056 unchanged | ✅ all three still in the ledger, untouched |
| Durable audit still `SELECT`-only for `service_role` | ✅ |
| Supabase Auth `banned_until` unused | ✅ 0 users |
| Shared group/club messages visible · official club/event info visible | ✅ `messages` SELECT policies untouched; `posts` policy exempts `club_id IS NOT NULL` |
| Public Storage design unchanged | ✅ no bucket or storage policy touched |

---

# 12. Outcome

**Day 10B1 is live.** Migration 057 is applied once, the web app is deployed, and one coordinated OTA is published and verified deliverable to iOS build 23 and Android build 27. No production row changed, no student was blocked, and no native binary was built.
