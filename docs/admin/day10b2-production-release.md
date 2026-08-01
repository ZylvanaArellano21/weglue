# Day 10B2 — Administrator Account Restrictions
## Production release report · SHIPPED 2026-08-01

---

# 1. Documentation release (Stage 3 — shipped FIRST, by design)

| Item | Value |
|---|---|
| PR | **#9** — *Disclose account restrictions and enforcement-record retention (documentation only)* |
| Merge commit | **`00cb5100`** |
| Merged | 2026-08-01 14:54:59 UTC |
| Deployment | Vercel Production, sha `00cb5100`, **success** |

**Public verification (all confirmed live before any 058 work):**

`/privacy-policy` 200 · `/terms` 200 · `/community-guidelines` 200

Every required phrase verified present in the live HTML: *"Account Restrictions and Enforcement Records"*, *"internal reason"*, *"never shown publicly"*, *"does not delete your content"*, *"kept after an account is deleted"*, *"not indefinitely as a matter of course"*, *"account-ban mechanism"*, *"contents of private messages"*, *"If we restrict an account"*, *"restriction is not deletion"*, *"including while restricted"*, and the Terms restriction clause.

At that moment `/admin` returned **404** and `/restricted` returned **404** — the capability was not yet live, so no unreleased interface was exposed and no secret appeared in the served HTML.

---

# 2. Day 10B2 release

| Item | Value |
|---|---|
| Branch | `safety/admin-restrictions` |
| Final branch HEAD | **`a018fe25`** |
| PR | **#10** — *Day 10B2 — Administrator account restrictions (migration 058)* |
| Merge commit | **`7bb2ecb6`** |
| Merged | 2026-08-01 15:01:45 UTC |
| Post-merge fix commit on `main` | **`d780e33b`** (see §5) |
| Files in release | 26 (all Day 10B2; the two pre-existing untracked files were removed again) |
| CI at merge | Vercel **pass**, mergeState **CLEAN** |

## Migration ledger

| Version | Name | State |
|---|---|---|
| 054 | atomic_last_officer_protection | unchanged |
| 055 | durable_admin_audit | unchanged |
| 056 | atomic_admin_mutations | unchanged |
| 057 | student_blocking | unchanged |
| **058** | **admin_restrictions** | **APPLIED 2026-08-01, exactly once** |
| ~~051~~ | — | **ABSENT** from ledger and objects |

Pre-apply gate: ledger ended at **057**; computed pending set was exactly `['058']`; 051 not proposed; `account_restrictions` confirmed absent; `ADMIN_WRITES_ENABLED` confirmed false.

---

# 3. Migration 058 verification (production, read-only)

| Check | Result |
|---|---|
| Applied exactly once | ✅ 1 ledger row |
| `account_restrictions` schema exists | ✅ |
| Active restrictions | ✅ **0** |
| Historical restrictions | ✅ **0** |
| Predicates present | ✅ 6 / 6 |
| Administrator RPCs present | ✅ 5 / 5 |
| Guarded wrappers installed | ✅ **47** |
| Policies carrying the access predicate | ✅ **58** |
| RLS policies on `account_restrictions` | ✅ **0** (no student path at all) |
| `authenticated` privileges on `account_restrictions` | ✅ **none** |
| `service_role` on `account_restrictions` | ✅ **SELECT only** |
| `__inner` functions reachable by any client role | ✅ **0** |
| `admin_tx_*` reachable by authenticated/anon | ✅ **0** |
| Original public RPC signatures resolvable **with DEFAULTs** | ✅ e.g. `get_my_blocked_users(p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)`, `search_students(p_query text, p_limit integer DEFAULT 10)`, `get_discovery_clubs(… DEFAULT NULL, DEFAULT 20, DEFAULT 0)` |
| `my_access_state()` student-callable | ✅ |
| `delete_own_account_atomic()` student-callable | ✅ |
| Unknown account resolves to `active` | ✅ |

---

# 4. Production data — before / after

| Table | Before | After | |
|---|---:|---:|---|
| auth users | 66 | 66 | ✅ |
| profiles | 65 | 65 | ✅ |
| **account restrictions** | *(absent)* | **0** | ✅ |
| user blocks | 0 | 0 | ✅ |
| follows | 14 | 14 | ✅ |
| clubs | 6 | 6 | ✅ |
| memberships | 235 | 235 | ✅ |
| posts | 25 | 25 | ✅ |
| comments | 0 | 0 | ✅ |
| events | 25 | 25 | ✅ |
| RSVPs | 12 | 12 | ✅ |
| conversations | 62 | 62 | ✅ |
| participants | 433 | 433 | ✅ |
| messages | 104 | 104 | ✅ |
| notifications | 2137 | 2137 | ✅ |
| reports | 14 | 14 | ✅ |
| **audit events** | **2** | **2** | ✅ no audit event falsely claims a restriction |
| universities | 1 | 1 | ✅ |

Profiles created during the release window: **0**. Auth users created: **0**.

---

# 5. Two real security findings, both closed

## 5.1 `insert_notification_once` was open to PUBLIC, anon and authenticated

Found by the **Stage 1 coverage test on its first run**. The function is `SECURITY DEFINER` and inserts straight into `notifications`; production's ACL granted EXECUTE to `PUBLIC`, `anon` **and** `authenticated`. Any caller could forge a notification to **any** account attributed to **any** other account — and because `trg_notifications_push` fires on insert, that produced a real **push** too. It predated Day 10B2 entirely.

Verified safe before revoking: no client code calls it, and its only three callers are `SECURITY DEFINER` functions owned by `postgres`, which keep access. Migration 058 revokes it and locks the remaining push internals to `service_role`. Confirmed after applying: `authenticated` can no longer execute it, and the follow-notification trigger path still works.

## 5.2 Per-user restriction probes stayed callable by students

Found by **checking grants on production after applying 058** — the shadow database could not have caught it.

Supabase configures `ALTER DEFAULT PRIVILEGES` so every new function in `public` receives an **explicit** EXECUTE grant for `anon`, `authenticated` and `service_role`. An explicit grant is **not** removed by `REVOKE … FROM PUBLIC`. So although 058 revoked from PUBLIC and anon, production retained `authenticated=X/postgres` on:

```
get_account_access_state(uuid)
is_account_restricted(uuid)
can_student_access_app(uuid)
```

Any signed-in student could have passed an arbitrary uuid and enumerated whether that account was suspended or blocked — exactly the enumeration these were made `service_role`-only to prevent.

**Closed in production** (`REVOKE … FROM authenticated`), and the migration and fixture were both corrected in `d780e33b`:
- 058 now names `authenticated` explicitly;
- the shadow fixture now **reproduces Supabase's default privileges**, so this whole class of mistake fails locally instead of surfacing only in production.

**Negative control run to prove the test has teeth:** against the pre-fix migration the coverage test **fails and names all three functions**; against the fixed migration it passes.

Verified after: all three `false` for `authenticated`, `service_role` retains access, and the argument-free self-checks (`my_access_state`, `current_student_can_access_app`, `restricted_user_ids`) are untouched — RLS policy expressions evaluate them as the caller.

---

# 6. SECURITY DEFINER coverage test (Stage 1)

**15 / 15 pass · 30 functions inventoried**, added to the regression suite.

It does not trust a list: it inventories `pg_proc` after all migrations and requires every `SECURITY DEFINER` function `authenticated` can execute — via an explicit grant **or** an inherited PUBLIC grant — to be classified as **guarded_wrapper** (discovered from the catalog by its `__inner` twin), **shell_allowlisted**, or **internal** with a written justification. Anything unclassified fails.

It also asserts: overloads inventoried independently · wrappers preserve parameter types, order, **DEFAULTs**, return type and set-returning shape · no `__inner` reachable by authenticated/anon/PUBLIC · privileged internals and `admin_tx_*` are `service_role` only · the shell allowlist is exactly **three** operations (`my_access_state`, `current_student_can_access_app`, `delete_own_account_atomic`) with no legal/support page requiring an RPC · a **restricted** student is refused by every sampled guarded RPC (7/7) while an **active** student keeps access · a platform admin is never an active student.

**A future migration that exposes an unguarded student RPC now fails automatically.**

---

# 7. Expired-suspension lifecycle (Stage 2)

**13 / 13 pass (L1–L13).**

**Design chosen and documented:** the **next administrator mutation atomically closes the expired row** before creating the new restriction. The alternative — encoding expiry into the partial unique index — was rejected because an index predicate must be `IMMUTABLE`, so `now()` is not permitted there, and an index cannot re-evaluate itself as the clock moves. **L13 asserts the index carries no volatile predicate.** No cron job exists or is needed.

Verified: a live temporary suspension restricts → access resumes the moment it lapses with **no job** → the historical row survives as `status='active'` bookkeeping → the student really can use the app again → **no misleading unsuspend is required** (it correctly reports `not_restricted`) → a new suspension **and** a new platform block both succeed despite the stale row → exactly one active row remains → the stale row is reconciled to `expired`, not deleted → the reconciliation is audited under the new action's correlation id → full history preserved.

A dashboard inconsistency this surfaced was also fixed: `restrictionSummary` read the raw `status`, so a lapsed row would have rendered "Applied / By / Internal reason" beside an **Active** badge. It now mirrors the predicate and surfaces the bookkeeping separately.

---

# 8. Web deployment

| Item | Value |
|---|---|
| Commit | `d780e33b` |
| Environment | **Production**, status **success** |

| Verification | Result |
|---|---|
| `/` · `/login` | 200 · 200 |
| `/privacy-policy` · `/terms` · `/community-guidelines` | 200 · 200 · 200 |
| **`/restricted`** | **200** (now live) |
| **`/admin`** | **404** — still concealed without the entry ticket |
| **`/admin/api/search`** | **404** |
| Restriction controls while writes disabled | inert (`disabled={!writesEnabled}`) |
| Opening a dialog / picking a date | **no mutation** — local state only |
| Lone Star sole university · `single_campus_mode` | ✅ · `true` |

---

# 9. Mobile OTA

**Fingerprint gate re-run immediately before publishing, on merged `main` (`d780e33b`):**

```
✅ d644c732e7471dda3cdd6fc4d28e12179fded642  IOS build 23      matches
✅ 6549da75b3646f045f15ac939343b110552836cc  ANDROID build 27  matches
GATE: PASS
```

| | iOS | Android |
|---|---|---|
| **Update group** | **`39286c07-5d3b-4583-95e1-7cc342b85f5b`** | **`9919ed88-4de0-4e6a-8486-ba33b6699e39`** |
| Update ID | `019fbdde-3094-7825-9315-8b309f55798e` | `019fbdde-3094-7964-80b0-a07f7f629823` |
| **Runtime** | `d644c732…` | `6549da75…` |
| Branch / channel | `production` / `production` | `production` / `production` |
| Targets build | **iOS 23** | **Android 27** |
| Commit | `d780e33b` | `d780e33b` |

### Delivery verification — device protocol level

The manifest endpoint was queried exactly as an installed build does:

| Platform | Runtime requested | Update served | |
|---|---|---|---|
| iOS | `d644c732…` (build 23) | `019fbdde-3094-7825-9315-8b309f55798e` | ✅ **exact** |
| Android | `6549da75…` (build 27) | `019fbdde-3094-7964-80b0-a07f7f629823` | ✅ **exact** |

Both resolved on branch `production`. **Both installed builds will receive this update.**

### Bundle contents verified

| | iOS | Android |
|---|---|---|
| Restricted-shell copy present | ✅ | ✅ |
| "Delete my account" present | ✅ | ✅ |
| `my_access_state` RPC present | ✅ | ✅ |
| **Admin-only fields leaked** (`internal_reason`, `platform_blocked`, `lift_reason`, `account_restrictions`) | **0** ✅ | **0** ✅ |

No `--runtime-version` override. **No anti-bricking protection disabled. No native binary created.**

---

# 10. Complete test results

| Suite | Result |
|---|---|
| Migration 058 harness (against the REAL 055/056/057) | **87 / 87** |
| Migration 057 regression | **95 / 95** |
| Day 10B1 concurrency harness | **17 / 17** |
| **SECURITY DEFINER coverage test** | **15 / 15** (30 inventoried) |
| **Expired-suspension lifecycle** | **13 / 13** |
| Web unit tests | **838 / 838** |
| Mobile unit tests | **63 / 63** |
| Shared tests | no suite (type-checked) |
| Web / mobile / shared type-checks | clean |
| Next.js production build | succeeds |
| Expo iOS + Android export | both Hermes bundles |
| 058 idempotency | apply, re-apply, harness still passes |
| Static secret scan | clean |
| Git tracked/untracked review | only the 7 pre-existing untracked files |

---

# 11. Blockers

**None.** All three pre-release conditions were met:

| # | Condition | Status |
|---|---|---|
| B1 | `ADMIN_WRITES_ENABLED` stays false | ✅ untouched; controls inert by design |
| B2 | Documentation live before enforcement | ✅ PR #9 shipped and verified **first** |
| B3 | Focused security review before production | ✅ Stage 1 coverage test — which found two real exposures |

---

# 12. Non-blocking findings

| # | Finding |
|---|---|
| **N14** *(new)* | **Supabase default privileges are an ongoing trap.** Every new function in `public` gets an explicit `authenticated` grant, so `REVOKE … FROM PUBLIC` is never sufficient. The fixture now reproduces this and the coverage test catches it, but any future migration adding a `service_role`-only function must name `authenticated` in its REVOKE. |
| **N15** *(new)* | The wrapper list in 058 remains explicit (47 wrappers in production). The coverage test now **fails** if a new student-reachable SECDEF function is unclassified, which converts N10 from "remember to do this" into an enforced check — but the classification table still has to be updated deliberately when a function is added. |
| N12 | An expired-but-un-lifted row stays `status='active'`. Harmless — the predicate ignores it, the dashboard says so explicitly, and the next mutation closes it. |
| N13 | `restricted_user_ids()` hides restricted students from other students' profile reads; their **public club content** stays visible, matching "restriction is not deletion". |
| N11 | Middleware adds one self-scoped RPC per signed-in request; a single indexed lookup on a partial index. |
| N1–N9 | Carried forward from Day 10B1. |

---

# 13. Explicit confirmations

| Confirmation | Status |
|---|---|
| **`ADMIN_WRITES_ENABLED=false`** | ✅ 0 `true` assignments outside tests; code default fail-closed; `/admin` 404s; controls render inert |
| **Migration 051 remains absent** | ✅ absent from the ledger **and** from production objects |
| **No real user was restricted** | ✅ `account_restrictions` = **0 rows**; 0 restriction audit events |
| **No real session was revoked** | ✅ revocation runs only inside a restriction action; none was performed |
| **No `banned_until` was used** | ✅ 0 production users have it set; the mechanism is used nowhere in this feature |
| **No native build was created** | ✅ no `eas build`; `app.json`, `eas.json`, both `package.json` files and `pnpm-lock.yaml` untouched |
| **Lone Star remains the sole university** | ✅ `single_campus_mode = true` |
| **Day 10C was not started** | ✅ no `059+` migration, no Day 10C work of any kind |
| Migrations 054–057 unchanged | ✅ |
| Day 10B1 student blocking unchanged | ✅ `user_blocks` intact, `block_user`/`unblock_user` present, 95/95 + 17/17 regression |
| Account deletion available from the restricted shell | ✅ verified in code, in tests, and in the shipped bundle |
| Internal reasons hidden from students | ✅ zero RLS policies on the table; zero admin fields in either client bundle |
| No synthetic identity inserted into production | ✅ 0 profiles and 0 auth users created; behavioural checks used non-existent uuids in a rolled-back transaction |

---

# 14. Outcome and what happens next

**Day 10B2 is live.** Migration 058 is applied once, the web app is deployed, and one coordinated OTA is published and verified deliverable to iOS build 23 and Android build 27. No production row changed, no student was restricted, no session was revoked, and no native binary was built.

**The capability is deliberately dormant.** With `ADMIN_WRITES_ENABLED` false, every restriction control is inert: the predicates are live, no restriction can exist, and student behaviour is unchanged. That is the intended end state of this pass.

**Enabling administrator writes and performing the first controlled restriction validation is a separate, founder-approved pass.** It has not been started, and should include: turning the switch on, exercising one suspension end-to-end against a **provisioned test account** (never a real student), confirming the restricted shell and account deletion on both platforms, and lifting it again.
