# Day 10B — Restriction-Enforcement Hotfix (migration 059) — Review Package

**Status:** implementation complete, **NOT merged, NOT applied**.
**Branch:** `safety/admin-restrictions-hotfix` · HEAD `3d5efc3f` · 1 commit ahead of `origin/main` (`cf3d2107`).

Controlled Production validation remains **NO-GO** until 059 is applied. Day 10C not started.

---

## 1. Branch and commits

| | |
|---|---|
| Branch | `safety/admin-restrictions-hotfix` (pushed) |
| Base | `origin/main` @ `cf3d2107` |
| HEAD | `3d5efc3f` — *fix(security): close two restriction-enforcement gaps left by migration 058* |
| Files | 4 (2 new, 2 modified) |

```
supabase/migrations/059_restriction_enforcement_hotfix.sql   NEW
supabase/scripts/test_059_restriction_hotfix.sql             NEW
supabase/scripts/test_057_fixture_schema.sql                 +159
supabase/scripts/test_058_secdef_coverage.sql                +120
```

Migration 058 is **byte-unchanged** — it is already applied to production, and editing an applied migration would make the file disagree with the database it produced. Untracked `.vercelignore`, `apps/web/.vercelignore`, `supabase/functions/deno.lock` and the App Store screenshots were deliberately left unstaged.

---

## 2. Catalog-derived `create_poll` signature

Read from production `pg_proc` (oid `19581`), not transcribed from any report:

```
public.create_poll(
  p_conversation_id uuid,
  p_channel_id      uuid,
  p_question        text,
  p_options         text[],
  p_allow_multiple  boolean     DEFAULT false,
  p_start_at        timestamptz DEFAULT NULL,
  p_end_at          timestamptz DEFAULT NULL,
  p_client_tag      uuid        DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql · SECURITY DEFINER · VOLATILE · SET search_path=public
pronargs=8 · pronargdefaults=4
```

**Exactly one overload exists** (`proname LIKE 'create_poll%'` returned a single row), so the intended target was unambiguous and 059 did not have to guess. 058's target string named five parameters, so `('public.'||target)::regprocedure` raised `undefined_function` and the loop's `EXCEPTION … CONTINUE` skipped it in silence. The function originates in migration 040 and is replaced in 041 — both with eight parameters — so the five-parameter target was wrong from the day it was written.

---

## 3. Before/after grant matrix

Verified in a shadow database built from the real 055 → 056 → 057 → 058 → 059 sequence.

| Function | | PUBLIC | anon | authenticated | service_role |
|---|---|---|---|---|---|
| `create_poll` | before | ✅ `=X/` | ✅ | ✅ | ✅ |
| | **after** | ❌ | ❌ | ✅ | ✅ |
| `create_poll__inner` | after | ❌ | ❌ | ❌ | ✅ |
| `check_club_inactivity` | before | ✅ `=X/` | ✅ | ✅ | ✅ |
| | **after** | ❌ | ❌ | ❌ | ✅ |

`create_poll` keeps `8 args / 4 defaults / RETURNS json` and its exact parameter names, so no client sees a changed contract.

Production's pre-fix ACLs, for the record:

```
create_poll            =X/postgres | postgres=X/postgres | authenticated=X/postgres | service_role=X/postgres
check_club_inactivity  =X/postgres | postgres=X/postgres | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres
```

The bare `=X/postgres` is an **explicit grant to PUBLIC** — which includes `anon`. An audit that only inspects named grantees and `proacl IS NULL` misses it entirely; that is precisely how this survived.

---

## 4. `check_club_inactivity` caller analysis

Every channel the founder listed was checked against production:

| Candidate caller | Result |
|---|---|
| pg_cron | Installed, **2 jobs**: `process_event_reminders()` (*/5), `invoke_push_dispatch()` (* * * * *). **Neither calls it.** |
| Another SECURITY DEFINER function | None — no `pg_proc.prosrc` references it |
| Trigger / event trigger | None |
| Edge Function | None |
| service-role application code | None |
| Server-only job | None |
| Student client | None — the only repository hit is a generated type in `packages/database/src/types.ts`, not a call site |

**There is no legitimate caller today.** Migration 006 tried to schedule it (`'0 9 * * *'`) but wrapped `cron.schedule` in `EXCEPTION WHEN OTHERS THEN NULL`; that scheduling silently failed and the job is absent from `cron.job` — the same silent-failure anti-pattern as defect 1, in a different place.

Revoking client access therefore removes attack surface without removing behaviour anything depends on. `service_role` retains EXECUTE so a server-side job or a future `pg_cron` entry can run it; `postgres` owns it and is unaffected.

**Blast radius if it had been called:** today 0 of 6 clubs would be touched (all have recent activity). That is incidental, not a safety property — the moment any club goes 30 days quiet, an unauthenticated caller could warn it, notify its officers, and two days later deactivate it.

**Not done, deliberately:** 059 does **not** schedule the cron job. Turning on club soft-deletion is a product decision, not a security fix, and with 6 clubs on one campus it should be your call — flagged in §9.

---

## 5. Migration 059 — what it does

Three sections, all inside one transaction.

**1. `create_poll` rename-and-wrap** — identical architecture to the 49 RPCs 058 wrapped successfully:
- resolves the target **by name**, not by a handwritten signature;
- **RAISES** if 0 overloads exist, and **RAISES** if more than one does;
- derives `pg_get_function_identity_arguments` (for `ALTER`/`REVOKE`/`GRANT`) and `pg_get_function_arguments` (**defaults kept**, for the wrapper declaration) — confusing these is what broke `get_my_blocked_users()` during 058;
- asserts the derived parameter-name count equals `pronargs`, so an argument list this migration cannot parse reliably fails loudly instead of producing a wrapper that calls the inner function with wrong arguments;
- renames to `create_poll__inner`, revokes it from PUBLIC/anon/authenticated;
- recreates `public.create_poll` with the guard, then delegates — **the body is never copied**;
- idempotent: re-running re-asserts the wrapper and grants without double-wrapping.

The guard, byte-identical to 058's:

```sql
IF (SELECT auth.uid()) IS NOT NULL
   AND NOT public.current_student_can_access_app() THEN
  RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
END IF;
RETURN public.create_poll__inner(...);
```

Authentication is checked **first**: an unauthenticated caller still receives the original `not_authenticated` from the inner function, never `account_restricted`.

**2. `check_club_inactivity` grants** — three separate `REVOKE`s (PUBLIC, anon, authenticated) plus `GRANT … TO service_role`. Separate on purpose: `REVOKE … FROM PUBLIC` removes only the `=X/owner` entry and leaves Supabase's explicit `authenticated=X/owner` intact, which would look fixed while remaining fully student-callable.

**3. Self-verifying post-conditions** — 059 reads the catalog back and aborts the transaction unless every invariant holds: wrapper signature preserved (8/4/json), guard present, delegation present, wrapper reachable by `authenticated` and not by PUBLIC/anon, inner unreachable by every client role, `check_club_inactivity` internal-only with `service_role` intact.

---

## 6. The fail-closed replacement for the silent `CONTINUE`

The defect was not the wrong signature — it was that **being wrong was survivable**. Four changes make it unsurvivable:

1. **059 contains no handwritten signature.** Every one is read from `pg_proc` at run time.
2. **Targets resolve by name**, and an unresolvable target `RAISE`s. `EXCEPTION WHEN undefined_function … CONTINUE` appears nowhere in 059.
3. **059 verifies its own outcome** (§5.3) and rolls back rather than reporting a success it did not achieve.
4. **A migration-time coverage invariant**: any SECURITY DEFINER function that writes and is student-reachable must invoke the guard, delegate to a `__inner` twin, or appear in a justified exception list. Anything else aborts the migration.

The permanent version lives in `test_058_secdef_coverage.sql`, now extended with **four independent discovery mechanisms** — explicit `authenticated`, explicit `anon`, **explicit PUBLIC (`=X/`)**, and `proacl IS NULL` (which in PostgreSQL *means* EXECUTE-to-PUBLIC). Mechanism three is the one that was missing. New assertions:

| | |
|---|---|
| `S7b` | every student-reachable SECDEF **writer** is guarded or justified |
| `S7c` | no SECDEF writer is executable by PUBLIC or anon |
| `S7d` | `create_poll` is wrapped, student-callable, not PUBLIC/anon |
| `S7e` | `check_club_inactivity` is unreachable by PUBLIC, anon and authenticated |

Trigger functions are excluded by return type (`pg_catalog.trigger`) rather than by name, since they cannot be invoked through PostgREST whatever their grants say.

**Root cause of the test's own blind spot, stated plainly:** the coverage test inventories the live catalog, but the catalog it saw came from `test_057_fixture_schema.sql` — and that fixture never contained `create_poll` at all. A test that can only see what the fixture creates cannot find what the fixture omits. The fixture now reproduces both functions verbatim from production, including their **defective pre-059 grants**, so the negative control is genuine rather than staged.

---

## 7. Negative-control results

Both suites were run against a **pre-059** database (fixture + 057 + 055 + 056 + 058) and then against post-059.

**Coverage test — pre-059: 5 failures, both defects named**

```
S1  *FAIL* every student-reachable SECDEF function is classified
           create_poll(p_conversation_id uuid, … p_client_tag uuid)
S7b *FAIL* every student-reachable SECDEF WRITER is guarded or justified
           create_poll(…); check_club_inactivity()
S7c *FAIL* no SECDEF writer is executable by PUBLIC or anon
           create_poll [explicit PUBLIC anon]; check_club_inactivity [explicit PUBLIC anon]
S7d *FAIL* create_poll is wrapped … → create_poll__inner ABSENT
S7e *FAIL* check_club_inactivity … → still reachable: explicit PUBLIC anon authenticated
```

**059 harness — pre-059: 15 failures, including proof of live exploitation**

```
C1/C2 *FAIL* SUSPENDED participant cannot create a poll
C5/C6 *FAIL* PLATFORM-BLOCKED participant cannot create a poll
C7    *FAIL* refused calls left ZERO rows behind
             → polls named "should never exist": 3
E5    *FAIL* authenticated student call is refused at runtime → EXECUTED
E6    *FAIL* refused call modified ZERO club rows
```

The restricted student **actually created three polls**, and the student call to `check_club_inactivity` **executed and changed club rows**. That is the defect demonstrated, not argued.

**The findings disappear for the right reason, not because discovery stopped:**

| | pre-059 | post-059 |
|---|---|---|
| student-reachable SECDEF inventoried | 32 | 31 |
| …of which writers | 3 | **1** (`delete_own_account_atomic`, justified) |
| `create_poll` in inventory | ✅ **UNCLASSIFIED** | ✅ **`guarded_wrapper`** |
| `check_club_inactivity` reachable | ✅ yes | ❌ no |
| `check_club_inactivity` exists in catalog | ✅ | ✅ **still exists** |
| coverage result | **5 failed** | **19/19 passed** |

`create_poll` is *still inventoried* after the fix — it did not vanish from the sweep, it became correctly classified. `check_club_inactivity` *still exists* — it was not deleted, it became unreachable.

---

## 8. Test results

| Suite | Result | Notes |
|---|---|---|
| `test_059_restriction_hotfix.sql` | **49 / 49** | new |
| `test_058_secdef_coverage.sql` | **19 / 19** | extended (was 15) |
| `test_058_admin_restrictions.sql` | **87 / 87** | against post-059, incl. expired-suspension lifecycle L1–L13 |
| `test_057_student_blocking.sql` | **95 / 95** | against post-059 |
| `test_057_concurrency.sh` | **17 / 17** | against post-059 |
| Web (vitest) | **838 / 838** | 34 files |
| Mobile (vitest) | **63 / 63** | 6 files |
| Type-checks | **4 / 4** | shared, database, mobile, web |
| `next build` | **pass** | full route table emitted |
| Expo export iOS | **pass** | 6.47 MB bundle |
| Expo export Android | **pass** | 6.48 MB bundle |
| Migration idempotency | **pass** | 059 run 3× — one wrapper, one inner, no drift |
| Static secret scan | **clean** | no tokens/keys/JWTs; all emails synthetic |

The 059 harness covers every path the founder listed: message/poll/option creation, notification behaviour, channel vs direct/group conversations, scheduled start/end, multiple-choice, **all five short call forms (4–8 args)**, named-argument calls, `client_tag` idempotency, every original error string (`not_authenticated`, `not_a_participant`, `question_required`, `need_two_options`, `end_before_start`, `channel_mismatch`), suspended and blocked denial, non-participant denial, zero partial rows after a refused call, wrapper student-callable, and inner **not** student-callable — including a direct call to `create_poll__inner` being denied.

**Two honest notes on the run:**
- The web type-check initially failed on a **stale `.next/types` artifact** referencing `app/messages/page.js`, a directory that has never existed in git. Removing `.next/types` cleared it; no source change was involved.
- The concurrency harness first reported 9/17 — **my own setup error**. Its documented run order requires `test_057_student_blocking.sql` (which seeds users A/B/C) before the script. With the correct order it is 17/17. I verified this was not a 059 regression by reproducing the same 9/17 against pre-059 *and* against the unmodified fixture from `origin/main`.

---

## 9. True blockers

**None for merging and applying migration 059.**

Two items are flagged for your decision, neither blocking:

1. **`check_club_inactivity` has no scheduler.** 006's `cron.schedule` silently failed, so club inactivity processing has never run. 059 deliberately does not switch it on — that would begin warning and soft-deleting real clubs, which is a product decision. Say the word and it becomes its own small migration.
2. **The `EXCEPTION WHEN OTHERS THEN NULL` pattern in migration 006** is the same silent-failure class as defect 1. It is not touched here (006 is long applied), but it is worth a sweep of older migrations for the same shape.

---

## 10. Production release sequence *(for after review approval — not performed)*

1. Merge the reviewed hotfix PR.
2. Verify the Production ledger ends at **058**.
3. Confirm **059 is the only pending migration**.
4. Confirm migration **051 is absent**.
5. Confirm `ADMIN_WRITES_ENABLED=false`.
6. Capture read-only baselines: `account_restrictions`=0, `admin_audit_events`=2, `user_blocks`=0, `banned_until`=0, `profiles`=65, clubs warned=0, clubs inactive=0.
7. Apply migration 059 **exactly once**.
8. Verify corrected grants through Production catalogs (the §3 matrix).
9. Confirm `account_restrictions` remains empty.
10. Confirm ordinary application row counts unchanged.
11. Confirm no audit event claims a student was restricted.
12. **No OTA, no native build** — zero application code changed and both fingerprints are untouched.
13. Re-run the controlled-validation preparation.
14. **Stop for founder approval** before enabling administrator writes.

The controlled restriction validation is **not** part of the 059 release.

---

## 11. Recommendation

# GO — merge and apply migration 059

The two defects are reproduced, fixed, and proven fixed by tests that **demonstrably fail without the fix and pass with it**, with the pre-059 run showing real polls created by a restricted student and a real club mutation by an unauthenticated-tier caller. The client contract for `create_poll` is unchanged down to parameter names and default arguments. No application code changed, so no OTA or native build is involved. 058 remains byte-unchanged, and a fresh environment reaches the same corrected state through the normal 055 → 056 → 057 → 058 → 059 sequence.

Controlled Production validation stays **NO-GO until 059 is applied** — after which the Day 10B validation package can be re-run against enforcement that is actually complete.
