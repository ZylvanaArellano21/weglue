# Day 10B2 — Administrator Account Restrictions
## Review package · `safety/admin-restrictions`

**Date:** 2026-08-01 · **Base:** `origin/main` @ `a50dc0e5` · **Unmerged. Migration 058 NOT applied to production. Nothing deployed.**

---

# 1. Branch and commits

| # | Commit | What |
|---|---|---|
| 1 | `b7ee84a6` | `feat(safety)` — migration 058: model, predicates, enforcement, RPC gating, atomic admin mutations |
| 2 | `df6588a6` | `feat(admin)` — restriction server actions, session revocation, Access panel |
| 3 | `a9b86430` | `feat(safety)` — restricted shells for iOS, Android, student web |
| 4 | `e2c5dc9d` | `docs(safety)` — founder decisions 9–15; 058 idempotency fix |
| 5 | *(this)* | `docs(safety)` — public-document updates + review package |

## Files changed

**Database (2)** — `supabase/migrations/058_admin_restrictions.sql`, `supabase/scripts/test_058_admin_restrictions.sql` (+ `test_057_fixture_schema.sql` extended with the real `delete_own_account_atomic`, `deletion_requests`, and a production-shaped `club_officers`).

**Web (11)** — new: `lib/admin/restrictionActions.ts`, `lib/admin/restrictionTypes.ts`, `lib/admin/restrictionData.ts`, `lib/auth/restrictionGuard.ts`, `components/admin/RestrictionControls.tsx`, `app/restricted/page.tsx`, `app/restricted/RestrictedActions.tsx`, `lib/admin/__tests__/restrictionActions.test.ts`, `lib/__tests__/restrictionGuard.test.ts`; edited: `middleware.ts`, `app/admin/users/[id]/page.tsx`, `lib/admin/auditSanitize.ts`, `lib/admin/atomicMutation.ts`, `app/privacy-policy/page.tsx`, `app/community-guidelines/page.tsx`, two tests.

**Mobile (4)** — new: `lib/accessState.ts`, `services/accessService.ts`, `components/auth/RestrictedAccountShell.tsx`, `lib/__tests__/accessState.test.ts`; edited: `app/_layout.tsx`.

**Shared (1)** — `packages/shared/src/legal/termsAndConditions.ts`.

---

# 2. Migration 058 — schema and predicates

```sql
account_restrictions(
  id, user_id, restriction_type, status, internal_reason,
  created_at, created_by, suspended_until,
  lifted_at, lifted_by, lift_reason, correlation_id)
```

| Requirement | How |
|---|---|
| At most one active restriction | `UNIQUE INDEX … (user_id) WHERE status='active'` (partial — holds only restricted accounts) |
| History survives lifting | lift **updates** the row (`status='lifted'` + evidence); nothing is deleted |
| A new restriction is a NEW row | insert, never overwrite a completed one |
| Block supersedes a suspension atomically | one transaction lifts the suspension and inserts the block |
| Platform admins / founder cannot be targeted | no `profiles` row (053) + explicit `is_platform_admin_auth` check |
| Ordinary students cannot read reasons or history | **RLS forced, ZERO policies**, no `authenticated` grant at all |
| Restricted students cannot alter their restriction | same — there is no path |
| Server-generated timestamps | `DEFAULT now()`; no client value is trusted |
| Strict constrained values | CHECKs on type, status, reason length, block-has-no-expiry, lift consistency, expiry-forward |
| Indexes for access checks | partial active index + `(user_id, created_at DESC)` + correlation |
| No FK deletes audit history | **no FK at all** on `user_id` — same rule 055 applies |
| Restriction survives profile edits | separate table; nothing in the profile write path touches it |

**Predicates** — `get_account_access_state(uuid)`, `is_account_restricted(uuid)`, `can_student_access_app(uuid)` (all `service_role` only), `current_student_can_access_app()` and `my_access_state()` (argument-free, `authenticated`), `restricted_user_ids()` (InitPlan array). All `STABLE`, `SECURITY DEFINER`, `search_path=''`.

**Expiry is deterministic and job-free.** `suspended_until IS NULL` → active until lifted; `> now()` → active; `<= now()` → **no longer access-restricting**, even while the row still reads `status='active'`. Proven by T16: the row stays `active`, and access returns anyway.

---

# 3. RLS enforcement matrix

| Surface | How enforced |
|---|---|
| **54 student-write policies across 33 tables** (profiles, posts, comments, likes, follows, user_blocks, events, RSVPs, conversations, channels, messages, polls, notifications, push tokens, club/officer mutations, media metadata, …) | a programmatic pass appends `(SELECT public.current_student_can_access_app())` to every policy granted to `authenticated` for a writing command — **exhaustive by construction**, with one justified exemption |
| **Protected reads** — messages, conversations, conversation_participants | predicate added to the SELECT policies |
| **profiles SELECT** | two questions, both answered: a restricted student cannot browse others, **and** a restricted student disappears from others' view (`restricted_user_ids()`), while always being able to read **their own** row so the shell and deletion work |
| **49 SECURITY DEFINER student RPCs** | rename-and-wrap guard (see §4) |
| **Exempt, deliberately** | `deletion_requests` INSERT; `delete_own_account_atomic()`; `my_access_state()`; signup-flow RPCs |

Test **T38** asserts that **no** student-write policy is missing the predicate — a coverage check that fails the moment a future table is added ungated.

---

# 4. The gap tests found: SECURITY DEFINER bypasses RLS

Section 4 gates tables. A `SECURITY DEFINER` function runs as its owner and **bypasses RLS entirely**. The harness caught it concretely: a **suspended student successfully called `block_user()`**. `FORCE ROW LEVEL SECURITY` is no answer either — production's `postgres` role is `BYPASSRLS`, which overrides it.

**Rename-and-wrap**, applied to 49 student RPCs:

```
block_user(uuid)  →  renamed to block_user__inner  (body NEVER copied)
                     new block_user(uuid) = guard → block_user__inner(...)
```

Public signature unchanged, original logic preserved verbatim (so a later migration touching that body is not silently frozen), and `__inner` has its EXECUTE revoked from `authenticated` so the guard cannot be stepped around.

### Two client-breaking bugs in the first wrapper — both caught by running the Day 10B1 harness against 058

1. **Defaults were stripped.** `pg_get_function_identity_arguments()` omits `DEFAULT`s, so `get_my_blocked_users()` and `search_students('bob')` stopped resolving entirely. Fixed by declaring wrappers with `pg_get_function_arguments()`.
2. **The unauthenticated error contract changed.** The guard raised `account_restricted` for callers with no session, replacing the `not_authenticated` every client already handles. Fixed so the guard fires only for a signed-in, restricted caller.

Neither was visible by reading the code. Both would have shipped.

---

# 5. Valid-transition matrix

| From → To | Result |
|---|---|
| active → suspended | ✅ `restriction.suspend` |
| suspended → active | ✅ `restriction.unsuspend` |
| active → platform_blocked | ✅ `restriction.block` |
| suspended → platform_blocked | ✅ atomic supersede in one transaction |
| platform_blocked → active | ✅ `restriction.unblock` |
| **platform_blocked → suspended** | ❌ `invalid_transition` — unblock first, as a separate audited action |
| suspended → suspended | ❌ `already_suspended` |
| platform_blocked → platform_blocked | ❌ `already_blocked` |
| active → unsuspend / unblock | ❌ `not_restricted` |
| self-target | ❌ `self_target` |
| platform-admin target | ❌ `platform_admin_target` / `user_not_found` |
| past or malformed expiry | ❌ `invalid_expiry` |
| reason < 3 or > 500 chars | ❌ rejected in three independent places |

---

# 6. Administrator RPCs and atomic audit

`admin_tx_restriction_suspend / unsuspend / block / unblock / adjust_expiry` — each `service_role` only, each taking a per-account advisory lock, each returning `private.admin_tx_ok(...)` or `private.admin_tx_fail(...)` so **the restriction row and its durable audit event commit together or neither does**. Sanitized `before_state`/`after_state` deliberately **exclude** the internal reason, which lives in `admin_audit_events.reason`.

Six new catalog actions, all `requires_reason = TRUE` **including the lifts** — undoing an enforcement decision deserves a recorded justification too. The registry parity test now reads migrations **055 + 058**, so server and catalog cannot drift.

Server-action order (`requireRecentMfaWrite`): portal → authenticated → founder allowlist → session max age → aal2 → **ADMIN_WRITES_ENABLED** → recent MFA.

---

# 7. Auth revocation and reconciliation

Database first, always:

```
1. admin_tx_restriction_* commits (restriction + audit, atomic)
2. durable ATTEMPT audit row              ← if it cannot persist, Auth is NOT touched
3. admin.auth.admin.signOut(userId, 'global')
4. separate SUCCESS or FAILURE row, SAME correlation id
5. the attempt row is never updated — 055 makes it append-only
6. if the outcome cannot persist → reconciliation_required row
```

**Ordering is deliberate.** Auth-first would risk signing a student out with no record of why. This ordering degrades instead to "restriction in force, old token dies of old age" — which the UI reports honestly:

| Outcome | Meaning |
|---|---|
| `applied` | restriction committed, sessions revoked |
| `sessionsFailed` | committed; revocation failed. **Access is still denied by the database.** |
| `reconcile` | committed and revoked, outcome unrecorded — flagged |
| `rejected` | nothing changed |

**No `banned_until`.** Lifting never creates a session; the student signs in again themselves.

---

# 8. Restricted shells

| | Mobile (iOS + Android) | Student web |
|---|---|---|
| Containment | shell returned **instead of** the `<Stack>` — no tab, feed, recommendation, realtime or push host is ever created | middleware on **every** request, so deep links, client navigation and refresh all land on `/restricted` |
| Detection | `my_access_state()` at bootstrap **and** on every `AppState` foreground | one self-scoped RPC per signed-in request |
| Release | fresh check after lift/expiry | next request; no client timer |
| Fail mode | **fails open** on an unreadable state — a blip must not lock out a healthy student; safe because the server is the real control |
| Contents | generic notice · suspension end date · support contact · Privacy Policy · Terms · Community Guidelines · **Delete my account** · Sign out |
| Internal reason | structurally unavailable — `my_access_state()` cannot return it |

**Two implementation forcings, caught before shipping:**
- middleware first called `get_account_access_state(uuid)`, which is `service_role`-only (anti-enumeration) and would have failed on every request as `authenticated`;
- the mobile shell replaces the navigator, so `router.push()` to the deletion screen would have silently done nothing — a dead 5.1.1(v) button. Deletion now runs **inline**, reusing the same typed-confirmation gate and the same edge-function call.

---

# 9. Account deletion

**Unchanged, and verified reachable while restricted.**

`delete_own_account_atomic()` is `SECURITY DEFINER`, so table RLS cannot reach it; 058 adds no predicate to it and leaves its `authenticated` EXECUTE grant intact (T13, T13b). The edge function calls it **as the user**, and with no `banned_until` a restricted student can always sign in far enough to reach it. `deletion_requests` INSERT is the one exempted write policy, so the lost-access form also still works.

---

# 10. Day 10B1 compatibility

| Check | Result |
|---|---|
| 057 harness with 058 applied | **95/95 pass** |
| 057 concurrency harness with 058 applied | **17/17 pass** |
| An unrestricted student can still block | ✅ T35 |
| Existing `user_blocks` rows survive a restriction | ✅ T36 |
| …and survive the lift | ✅ T36b — nothing deleted, nothing recreated |
| A restricted student cannot create a block | ✅ T09 |
| Shared group/club messages, official club/event info | untouched |

---

# 11. Test results

| Suite | Result |
|---|---|
| **Migration 058 harness** (against the REAL 055/056/057, not stubs) | **74 / 74** |
| **Migration 057 regression** | **95 / 95** |
| **057 two-session concurrency** | **17 / 17** |
| **Web unit tests** | **838 / 838** (+34) |
| **Mobile unit tests** | **63 / 63** (+14) |
| Web / mobile / shared type-checks | clean |
| Next.js production build | succeeds, incl. `/restricted` |
| Expo export (iOS + Android) | both Hermes bundles |
| 058 idempotency | apply, re-apply, harness still 74/74 |
| Static secret scan | clean |

---

# 12. Fingerprint / OTA assessment

```
✅ d644c732…  iOS build 23      matches local directory
✅ 6549da75…  Android build 27  matches local directory
```

`app.json`, `eas.json`, both `package.json` files and `pnpm-lock.yaml` are **untouched**. No native module, config plugin or permission added. **Day 10B2 is OTA-compatible.** No OTA was published and no native build was created.

---

# 13. Store and policy assessment

**Public documents updated on this branch (drafts — not deployed):**
- **Privacy Policy** — new "Account Restrictions and Enforcement Records" section covering exactly what is stored (account ID, restriction type, timestamps, administrator/audit identifiers, internal reason), that the internal reason is never shown, the purposes (safety, policy enforcement, security, compliance), that **restriction does not delete content**, that deletion stays available, and — stated plainly rather than glossed — that **enforcement and audit records may be retained after account deletion**, reduced to identifiers and timestamps.
- **Community Guidelines** — new "If we restrict an account" section.
- **Terms §12** — a restriction is an access decision, separate from a user block, and does not by itself delete content.

**Store forms — no field changes required.**

| Store | Assessment |
|---|---|
| **Apple App Privacy** | **No change.** A restriction record adds no new data *category*: it is identifiers plus timestamps plus an administrator-authored note about an account, all under existing App Functionality collection. Nothing here is advertising, tracking, contacts, or location. |
| **Google Play Data Safety** | **No change.** Already declared *User IDs* and *Other actions*, collected, not shared, not ephemeral, for **App functionality** and **Fraud prevention, security and compliance** — which is precisely what enforcement records are for. |

No new category is invented. Review-notes updates are **not** required until this ships; the feature must not be described as live in public documentation before release.

---

# 14. True blockers

**None for the code.** Three release-gating items, all founder decisions rather than defects:

| # | Item |
|---|---|
| **B1** | **`ADMIN_WRITES_ENABLED` must be turned on for these controls to do anything.** They are inert today by design, and that is a separate, deliberate decision. |
| **B2** | **Deploy the public-document updates before, or with, the release** — the Privacy Policy retention language is a material disclosure. |
| **B3** | **Independent review of migration 058 before it touches production** — the pattern that caught the SECDEF gap here and 7 blockers on 051. |

---

# 15. Non-blocking findings

| # | Finding |
|---|---|
| **N10** | The 49-RPC wrapper list is explicit. A future student RPC is **not** automatically gated — it must be added. The T38 policy check has no equivalent for functions; a periodic audit of `SECURITY DEFINER` + `authenticated` functions is the mitigation. |
| **N11** | Middleware adds one RPC per signed-in request. It rides the partial active index and is a single indexed lookup, but it is not free; if it ever matters, cache it in a signed cookie with a short TTL rather than removing it. |
| **N12** | An expired-but-un-lifted row stays `status='active'`. Harmless (the predicate ignores it), and `unreconciledExpiredCount()` surfaces the queue. A tidy-up job is optional, never required for correctness. |
| **N13** | `restricted_user_ids()` hides restricted students from other students' profile reads. Their *content* stays visible where it is public club content, which matches the "restriction is not deletion" rule but means a restricted officer's club posts still appear. Deliberate. |
| N1–N9 | Carried forward from Day 10B1 (search_discovery minimum, `PrivacyInfo.xcprivacy`, public buckets, push recall, etc.). |

---

# 16. Exact production release sequence

**Nothing below has been performed.**

1. Founder review of this package and migration 058.
2. **Independent (Codex) review of `058_admin_restrictions.sql`** — B3.
3. Merge `safety/admin-restrictions` → `main` via PR, CI green.
4. **Apply migration 058** through the Supabase Management API as a single statement (the method used for 055/056/057), then record it in `supabase_migrations.schema_migrations`.
   *Immediately after: confirm `account_restrictions` is EMPTY, confirm the policy count moved as expected, and confirm all baseline table counts are unchanged.*
5. Deploy web to Vercel. Verify `/restricted` redirects correctly for an unrestricted student (it should send them to `/home`), and that `/admin` still conceals.
6. `eas update --branch production` after re-running **both** `fingerprint:compare` commands.
7. **Only then**, as a separate decision: set `ADMIN_WRITES_ENABLED=true` and exercise one suspension end-to-end on a provisioned test account — never a real student.
8. Day 10C is **not** started.

---

# 17. Constraint confirmation

| Constraint | Status |
|---|---|
| Not merged | ✅ branch is 5 commits ahead, unmerged |
| Migration 058 **not applied** to production | ✅ verified by live query — `account_restrictions` absent |
| Web not deployed | ✅ built locally only |
| No OTA published | ✅ exported locally only |
| No native build created | ✅ no `eas build`; no native-affecting file touched |
| `ADMIN_WRITES_ENABLED` still false | ✅ 0 `true` assignments outside tests |
| Migration 051 remains absent | ✅ |
| No real user restricted | ✅ all restriction exercised on shadow fixtures; `account_restrictions` does not exist in production |
| 054 / 055 / 056 / 057 unchanged | ✅ |
| No Supabase Auth `banned_until` | ✅ 0 uses; 0 production users banned |
| Lone Star sole university, `single_campus_mode=true` | ✅ |
| Day 10C not started | ✅ |

---

# 18. Recommendation

## **GO** for merge and production release of migration 058, subject to B1–B3.

The work is complete against every phase, and in three places the evidence changed the design rather than confirming it:

1. **`SECURITY DEFINER` bypasses RLS.** Gating 54 write policies looked like the job was done; a test then showed a **suspended student calling `block_user()` successfully**. That is the whole feature failing quietly. The rename-and-wrap pass closes it across 49 RPCs without copying a single function body.

2. **The first wrapper broke callers twice**, and both breaks were invisible to inspection: stripped `DEFAULT` arguments (so `get_my_blocked_users()` stopped resolving) and a changed error contract for unauthenticated callers. Running the **Day 10B1 harness against 058** is what caught them — regression-testing the previous phase against the new one earned its keep here.

3. **The mobile shell would have shipped a dead "Delete my account" button**, because it replaces the navigator and `router.push` had nothing to push onto. That is the exact App Store 5.1.1(v) failure mode, produced by an otherwise-correct containment pattern.

What I would flag for judgement rather than assume: **N10**. The RPC guard list is explicit, so a student RPC added later is not automatically protected. The policy coverage check (T38) has no equivalent for functions, and I would rather say so than let it look fully self-defending.

**NO-GO**, stated so neither is assumed:

- **No-go on enabling `ADMIN_WRITES_ENABLED` as part of the same change.** Applying 058 is safe and inert — the predicates go live, no restriction can exist, and behaviour is unchanged. Turning writes on is a separate decision that deserves its own verification pass.
- **No-go on releasing before the Privacy Policy retention language is live.** "Audit records may be retained after account deletion" is a material disclosure, and shipping enforcement before disclosing it would be the wrong order.

**Day 10C has not been started.**
