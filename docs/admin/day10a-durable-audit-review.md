# Day 10A — Durable Admin Audit System · Review Package

**Branch:** `admin/durable-audit` (from `security/admin-session-and-officer-floor`)
**Status:** implemented, tested, **NOT merged · NOT deployed · migration 055 NOT applied to Production · writes still disabled**
**Date:** 2026-07-30

---

## 1. What changed, and what deliberately did not

Replaced the console-log-only audit mechanism with an append-only Supabase table. Every admin mutation and every sensitive read now writes a durable row.

**Untouched, as instructed:** `ADMIN_WRITES_ENABLED` (still unset = false) · migration 051 (still absent from this branch, still undeployed) · Lone Star as the only university · `launch_university_id` · student signup and onboarding · the private admin gateway, UUID allowlist, password, MFA, recent-MFA and session-age protections · **all of `apps/mobile` and `packages/`** — zero mobile or shared files were changed, so no OTA and no native build is required or warranted.

---

## 2. Files changed

**New**

| File | Purpose |
|---|---|
| `supabase/migrations/055_durable_admin_audit.sql` | The table, catalog, triggers, RPC, privileges |
| `supabase/scripts/test_055_durable_admin_audit.sql` | 70-assertion DB harness |
| `apps/web/lib/admin/auditSanitize.ts` | Action registry + allowlist sanitization |
| `apps/web/lib/admin/auditData.ts` | Read-only loaders for Audit History |
| `apps/web/app/admin/audit-history/[id]/page.tsx` | Event detail view |
| `apps/web/app/admin/audit-history/[id]/not-found.tsx` | Detail not-found state |
| `apps/web/lib/admin/__tests__/auditSanitize.test.ts` | 49 tests |
| `apps/web/lib/admin/__tests__/audit.test.ts` | 17 tests |
| `apps/web/lib/admin/__tests__/auditData.test.ts` | 20 tests |
| `apps/web/lib/admin/__tests__/singleCampus.test.ts` | 14 tests |

**Modified**

| File | Change |
|---|---|
| `apps/web/lib/admin/audit.ts` | Rewritten: durable RPC insert + retained operational logging; now async |
| `apps/web/lib/admin/actions.ts` | `await` audit; `fail()` async; **single-campus guard on `addUniversity`** |
| `apps/web/lib/admin/{contentActions,messagingActions,deletedContentActions,reportsActions}.ts` | `await` audit; `fail()` async |
| `apps/web/lib/admin/data2.ts` | New `getCampusMode()` |
| `apps/web/lib/admin/historyData.ts` | Removed obsolete `getAuditStatus()` (it asserted "no audit table exists", which stopped being true) |
| `apps/web/app/admin/audit-history/page.tsx` | Now reads the durable table |
| `apps/web/app/admin/universities/page.tsx` | Add University gated + single-campus banner |
| `apps/web/lib/admin/__tests__/{fakeAdmin,actions,history}.test.ts` | `.rpc()` + faithful `.or(...eq...)` support; fixture updates |

---

## 3. Migration 055 schema

`admin_audit_actions` — controlled vocabulary (26 rows): `action` PK, `target_type`, `sensitivity` (ordinary/sensitive/destructive), `requires_reason`, `description`.

`admin_audit_events` — the trail:

| Column | Notes |
|---|---|
| `id` | uuid PK |
| `occurred_at` | timestamptz, `default now()` — **server clock only** |
| `actor_user_id` | uuid **NOT NULL, no FK** |
| `actor_email` | text, preserved as historical evidence |
| `action` | FK → catalog, `ON DELETE RESTRICT` |
| `target_type` | CHECK against 18 values |
| `target_id` | uuid, **no FK** |
| `reason` | 3–500 chars |
| `before_state` / `after_state` / `metadata` | jsonb, allowlisted, ≤16 KB each |
| `success` / `error_code` | CHECK: success XOR error_code |
| `correlation_id` | uuid NOT NULL |

Six indexes (occurred_at, action, target, actor, correlation, partial-on-failure).

**Why no foreign keys to accounts:** deleting an administrator or a target account must never delete the evidence about them. This is asserted by test 1.1 so nobody "fixes" it later.

---

## 4. Append-only enforcement

RLS policies cannot deliver this, because `service_role` and `postgres` both hold `BYPASSRLS` in production (verified by querying `pg_roles`, not assumed). **Triggers fire for every role**, so they are the actual guarantee:

- `BEFORE UPDATE` → raise
- `BEFORE DELETE` → raise
- `BEFORE TRUNCATE` (statement-level — row triggers do not see TRUNCATE) → raise
- catalog `BEFORE DELETE` → raise, so history can never be orphaned

Plus revoked UPDATE/DELETE/TRUNCATE grants as defense in depth.

---

## 5. RLS and privilege model

| Role | Table SELECT | Table INSERT | UPDATE/DELETE | `admin_audit_log()` |
|---|---|---|---|---|
| `anon` | ✗ | ✗ | ✗ | ✗ |
| `authenticated` (incl. **founder's browser session**) | ✗ | ✗ | ✗ | ✗ |
| `service_role` | ✓ | **✗** | ✗ | ✓ |
| owner (`postgres`) | bypasses RLS | via definer fn | **✗ (trigger)** | ✓ |

RLS is ENABLED and FORCED with **zero policies** — that is the deny-all mechanism. Note the deliberate `service_role` INSERT revoke: **even the service-role key cannot write an arbitrary audit row**; it must go through `admin_audit_log()`, which validates the action against the catalog, enforces action↔target_type agreement, and rejects forbidden payloads. The founder reads the trail only server-side, through `requireSecureAdmin()`.

---

## 6. Server audit flow

```
requireSecureAdmin()  ──► authorized User (browser identity never trusted)
        │
        ▼
   mutation on canonical table
        │
        ▼
adminAudit({ action, actorId, actorEmail, target, before, after, ok, reason?, correlationId? })
        │
        ├─ action ∉ registry ────────────► log `admin_audit_unknown_action`, DO NOT construct
        │                                   the service-role client, return persisted:false
        ├─ sanitizeTarget()  → target_id + allowlisted metadata
        ├─ sanitizeState()   → allowlisted before/after
        ├─ createAdminClient()  (only now, after authorization)
        ├─ rpc admin_audit_log(...)
        │      ├─ ok    → log `admin_audit`, return persisted:true
        │      └─ error → log `admin_audit_persist_failed`, return persisted:false
        └─ never throws
```

---

## 7. Success/failure transaction semantics — stated honestly

> **SUPERSEDED for database-only mutations by the hardening pass (see §H4).**
> All 22 database-only mutations are now atomic with their audit record via
> migration 056. The description below still applies to the ONE cross-service
> operation (`portal.lock`), where a shared transaction is impossible.

**As originally shipped, the audit insert was NOT atomic with the mutation.** It is a separate PostgREST call in a separate transaction. This is documented in the migration and in `audit.ts` rather than glossed over:

- A `success` row means the mutation had already committed. **audit row present ⇒ mutation happened.**
- The converse does **not** hold. If the audit insert fails, the mutation has already committed and cannot be rolled back. The gap is **always detectable** — `admin_audit_persist_failed` is logged and `persisted:false` returned. Never silent.
- Because they are separate transactions, **a failed audit insert can never cause the mutation to partially commit.** That independence is what the design buys.

Genuine atomicity would require rewriting every admin mutation as an in-database function writing its own audit row in the same transaction — far larger than Day 10A, recorded as future work rather than faked.

**Durable vs operational-only failures**

- **Durable:** any failure after a validated admin session exists (validation, not-found, refused transitions, RPC statuses).
- **Operational-only:** authorization failures themselves (portal disabled, unauthenticated, non-founder, expired session, MFA required, writes disabled). These throw before an actor exists. **Deliberate** — if unauthorized callers could create rows, anyone who found the endpoint could flood the founder's own evidence table.

---

## 8. Sanitization design

Two independent barriers.

**Barrier 1 — application allowlist (`auditSanitize.ts`).** Per-action registry (target type, target-id key, sensitivity, reason requirement, metadata keys) plus per-target-type column allowlists. A field is stored **only because it was named**. Values are scrubbed for JWT-shaped strings and pre-signed URLs, truncated at 500 chars, depth-capped.

Read the omissions: `message` state carries **no** `content`/`attachment_url`/poll text; `report` carries **no** `content_snapshot`/`attachment_snapshot`/`details`. `post.caption` and `comment.content` **are** kept — those are public club content, and the before/after text is the entire point of auditing a moderator edit.

**Barrier 2 — database (`055 §5`).** Recursive forbidden-key scan (26 substrings: password, token, jwt, api_key, cookie, totp, entry_phrase, signature, credential, …), value-level JWT and signed-URL detection, and an absolute ban on message content for `target_type='message'`. A compromised or buggy server build still cannot persist a credential.

Safe reveal metadata (`message_id`, `conversation_id`, `content_len`, `has_attachment`) is explicitly accepted — proven by DB test 7.13.

---

## 9. Audit History UI

`/admin/audit-history` — timestamp · administrator (email + short UUID) · action · target type + ID · reason · success/failure · correlation ID. Summary tiles (total, last 24h, failures, distinct administrators). Filters: **date range, action, target type, success/failure**, plus correlation/actor/target scoping via query params. Server-paginated, `force-dynamic`, `force-no-store`.

`/admin/audit-history/[id]` — full record, reason, **before/after as typed key-value rows with changed-field count** (not a raw JSON dump), metadata, and the rest of the correlated operation as links.

**Read-only.** The module exports no mutation (asserted by test), and the database would refuse one anyway.

**Honest degradation:** when 055 is not applied — which is the case in Production right now — the page detects the missing table and says so plainly, stating that nothing was backfilled. It does not error and does not invent records.

---

## 10. Lone Star / Add University

- UI: Add University replaced by a disabled affordance while `single_campus_mode = true`, plus a banner naming Lone Star College and explaining the gate.
- Server: `addUniversity()` refuses on the same signal, **before** input validation.
- `getCampusMode()` **fails closed** to single-campus if `app_config` is unreadable.
- Edit and activate/deactivate remain available. `launch_university_id` and `single_campus_mode` are never written.

**Flagged for your call:** you asked for a *UI* correction. I also added the server-side refusal, because a UI-only hide is cosmetic — anyone reaching the action directly would bypass it. The capability is **gated, not removed**: flipping `single_campus_mode` off restores it with no code change. Say the word and I will drop the server guard and keep only the UI change.

---

## 11. Tests and results

**Database — `test_055_durable_admin_audit.sql`, run on Postgres 15 in Docker against a production-faithful role topology** (owner = non-superuser **with** `BYPASSRLS`, matching production's `postgres`, which I verified via `pg_roles` rather than assuming; a superuser owner would have passed for the wrong reason).

```
apply #1 exit=0 · apply #2 (idempotent) exit=0 · harness exit=0
70 assertions PASSED · 0 failures
```

| Group | Covers |
|---|---|
| 1 (6) | no FK to accounts, RLS enabled+forced, zero policies, catalog seeded, table starts empty |
| 2 (6) | anon: no SELECT/INSERT/UPDATE/DELETE, no catalog read, no RPC execute |
| 3 (6) | authenticated **and the founder's browser session**: no access, no direct insert, no RPC execute |
| 4 (7) | service_role **cannot** insert directly; **can** SELECT and call the RPC; identity recorded verbatim; `occurred_at` server-side; RPC structurally exposes no timestamp param |
| 5 (8) | append-only: owner and service_role blocked from UPDATE/DELETE/TRUNCATE; catalog rows permanent; trail intact after every tamper attempt |
| 6 (5) | unknown action rejected; action↔target_type mismatch rejected; NULL actor rejected; target_type and naming CHECKs |
| 7 (13) | password/access_token/service key/TOTP/entry-phrase/cookie keys rejected; JWT-shaped **values** and signed URLs rejected; recursive through objects+arrays; message body/attachment/poll text rejected; **safe reveal metadata accepted** |
| 8 (5) | reason required for destructive actions; blank reason rejected; **failure records stored without a reason** |
| 9 (4) | success-with-error and failure-without-error both rejected; failure records preserve their code |
| 10 (3) | correlation IDs group multi-step operations; distinct for unrelated ones |
| 11 (4) | **actor account deleted → history survives; target account deleted → history survives; historical email preserved** |
| 12 (2) | oversized state and reason rejected |
| 13 (1) | final row count exactly matches the accepted calls |

**Web**

```
vitest:      29 files, 701 tests passed (0 failed)   ← 100 of these are new
type-check:  exit 0
next build:  exit 0 — 53 pages, both audit routes present
secret scan: CLEAN
mobile/shared: 0 files changed
```

New web coverage: registry↔migration parity (fails if the TS registry and the SQL catalog ever drift), allowlist behavior, private-content exclusion, credential redaction, RPC-not-direct-insert, actor identity from the server session, unknown action does not construct the service-role client, persist-failure is loud and non-throwing, correlation threading, founder-only reads, honest degradation when 055 is absent, and the single-campus gate.

**Two real defects the tests caught and I fixed:**
1. `target_type` was CHECK-constrained on the events table but **not** on the catalog — an action could be registered with a target type that could never be recorded. Fixed in §2 of the migration.
2. The shared test fake treated `.or()` as a no-op, which silently made duplicate-detection assertions vacuous. Implemented faithful `eq`-only OR semantics.

---

## 12. True blockers

1. **Reason collection is not wired into the UI.** Nine destructive actions have `requires_reason = true` in the catalog. No UI collects a reason today. Writes are disabled, so nothing breaks now — but **before `ADMIN_WRITES_ENABLED` is turned on**, either a reason field must ship or those actions will mutate and then fail to audit. `assertAuditReason()` exists as the pre-mutation guard and is deliberately not yet wired, so behavior is unchanged this phase. **This must be closed before writes are enabled.**
2. **`message.revealBody` / `message.contentSearch` have `requires_reason = false`.** They are the only *live* (non-write-gated) sensitive actions, and turning the requirement on before the reveal UI collects a reason would break a working MFA-gated feature. Flipping them is a one-line catalog change, planned with the Phase 5 reveal-reason UI.
3. **Audit is not atomic with the mutation** (§7). Accepted and documented, not hidden.
4. **055 must be applied before the Audit History page shows anything.** Until then it renders the honest unavailable state.

---

## 13. Exact Production deployment sequence

Nothing below has been run. Steps 1–3 are yours to authorize.

```bash
# 0. PRE-FLIGHT — confirm the expected baseline
#    Expect: ...052, 053, 054  and NO 055, NO 051
psql "$PROD_URL" -c "select version from supabase_migrations.schema_migrations order by version desc limit 5;"

# 1. APPLY MIGRATION 055 (additive; creates 2 tables, 6 functions, 5 triggers,
#    6 indexes. Touches no existing table, column, policy, function or trigger.)
psql "$PROD_URL" -f supabase/migrations/055_durable_admin_audit.sql

# 2. VERIFY (all four must hold)
psql "$PROD_URL" -c "select count(*) from admin_audit_actions;"          -- expect 26
psql "$PROD_URL" -c "select count(*) from admin_audit_events;"           -- expect 0 (nothing backfilled)
psql "$PROD_URL" -c "select relrowsecurity, relforcerowsecurity from pg_class where relname='admin_audit_events';"  -- expect t|t
psql "$PROD_URL" -c "select count(*) from pg_policies where tablename='admin_audit_events';"                        -- expect 0
```

3. **Deploy the web branch to Vercel** (merge `admin/durable-audit` → `main`, or promote a preview). No environment variable changes are required. `ADMIN_WRITES_ENABLED` stays unset.

4. **Post-deploy check:** open `/admin/audit-history` as the founder. It should show the live table with **0 events** — an empty trail is the correct and honest starting state.

**No OTA. No native build.** Zero mobile or shared files changed; publishing one would ship an unchanged bundle.

**Rollback:** the migration file ends with a complete, ordered DROP sequence. Dropping the tables destroys the trail — export first.

---

## 14. Not started, as instructed

Restrictions · user blocking · content soft-delete · report enforcement · Realtime parity · deleted-message retention (051). All remain in the Phase 1 audit's proposed order.


---
---

# Day 10A — HARDENING PASS (addendum)

**Status:** implemented, tested, **NOT merged · NOT deployed · migrations 055/056 NOT applied to Production · writes still disabled · 051 still absent · Lone Star still the sole university**

## H1. New commits

| | |
|---|---|
| `a9a3dc7f` | migration 056 — atomic mutation + audit in one transaction (055 amended for `event_type`) |
| `00846efd` | route mutations through the atomic RPCs; add cross-service flow |
| `73b80997` | collect a required reason before destructive actions |
| `6efbd0b2` | reason enforcement, cross-service flow, atomic-RPC contract tests |

**Files changed:** `supabase/migrations/{055,056}` · `supabase/scripts/test_055_*`, `test_056_*`, `test_056_fixture_schema.sql` · `lib/admin/{atomicMutation,crossService,audit,actions,contentActions,messagingActions,reportsActions,deletedContentActions}.ts` · `components/admin/{ConfirmAction,MembershipControls,GluemateControls,PostActions,RsvpActions,ChannelActions,UniversityControls,DeletedContentActions}.tsx` · `app/admin/{universities/[id],clubs/[id],officers,memberships/[id]}/page.tsx` · 8 test files + `fakeAdminTx.ts`. **No mobile or shared files.**

## H2. The exact nine reason-required actions

| # | Action | Target | Sensitivity |
|---|---|---|---|
| 1 | `membership.remove` | club_member | destructive |
| 2 | `officer.demote` | club_officer | destructive |
| 3 | `gluemate.remove` | gluemate | destructive |
| 4 | `post.removeFromClub` | post | destructive |
| 5 | `rsvp.remove` | rsvp | destructive |
| 6 | `channel.deleteEmpty` | channel | destructive |
| 7 | `university.add` | university | sensitive |
| 8 | `university.setActive` | university | sensitive |
| 9 | `deletedContent.reactivateClub` | club | sensitive |

Enforced in **three independent places**: the dialog disables confirm without a valid reason; `runAtomicMutation()` rejects before the RPC; the 055 trigger raises inside the transaction, rolling the mutation back. Calling a server action directly — no dialog in the loop — is a tested bypass attempt and fails.

`message.revealBody` / `message.contentSearch` remain `requires_reason = false`: they are the only *live* (non-write-gated) sensitive actions, and turning it on before the reveal UI collects a reason would break a working MFA-gated feature. One-line catalog flip, planned with Phase 5.

## H3. Operation classification matrix

| Class | Count | Operations | Audit guarantee |
|---|---|---|---|
| **Database-only, transactionally auditable** | **22** | membership add/remove · member role set (promote/demote) · officer add/title · gluemate remove · university add/edit/setActive · post caption/removeFromClub · comment edit · event edit · rsvp upsert/remove · channel create/rename/setPermission/deleteEmpty · notification setRead · report setStatus · club reactivate | **Atomic** — mutation + audit in one transaction |
| **Auth API** | 1 | `portal.lock` (signOut) | attempt → outcome, correlated |
| **Storage** | 0 | — | pattern ready, unused |
| **Multi-service** | 0 | — | pattern ready, unused |
| **Read-only** | 3 | `message.revealBody`, `message.contentSearch` (step-up MFA), `testSupabaseConnection` | audited as sensitive reads |

## H4. Atomic database mutation architecture

```
requireSecureAdmin({write:true})        server: authorization
        ↓
assertAuditReason(action, reason)       server: BEFORE the DB — no reason, no round trip
        ↓
admin_tx_*(actor, email, reason, corr, …)   ── ONE TRANSACTION ──
        ├─ validate → business rejection: commit FAILURE audit, RETURN status (no mutation)
        ├─ snapshot before_state (allowlisted columns)
        ├─ mutate canonical table(s)   [054 RPCs called here for officer changes]
        ├─ snapshot after_state
        └─ admin_audit_log(...)  ── raises ⇒ EVERYTHING rolls back
```

`audit row present ⇔ mutation committed`, both directions. Business rejections **return** rather than raise, precisely so the failure record survives.

## H5. Cross-service audit architecture

1. durable **attempt** row → 2. **refuse to act** if it cannot be written → 3. external call → 4. **separate** success/failure row, same `correlation_id` → 5. attempt row never updated (append-only makes it impossible) → 6. **reconciliation_required** row if the outcome cannot be persisted.

**No cross-service atomicity is claimed.** What it buys: no external side-effect without a trace; "started" is always distinguishable from "completed" from "unknown". What it does not: it cannot guarantee the external effect matches the record — nothing short of a distributed transaction could.

## H6. Migration 055 changes

Amended in place (never applied anywhere, so this keeps deployment single-step):
- `event_type` column: `attempt | success | failure | reconciliation_required`, default `success`.
- `success` now nullable — only for `attempt` / `reconciliation_required`, where the outcome genuinely is not known. Recording those as `false` would assert a failure that has not happened.
- `admin_audit_events_outcome_chk` ties `(event_type, success, error_code)` together.
- `admin_audit_log` takes `p_event_type` and **validates rather than normalizes**: a caller asserting both "succeeded" and "here is the error" is refused, not silently half-discarded.
- Reason requirement now fires on `success` **and** `attempt`.
- Three new partial indexes (failures, reconciliation, unresolved attempts).
- Append-only enforcement unchanged and re-proven.

## H7. Test results

```
migration 055 harness   70/70   (fresh apply + idempotent re-apply, exit 0)
migration 056 harness   75/75   (real 054 applied over a schema fixture)
web vitest              750/750 (30 files; 49 new in reasonEnforcement.test.ts)
type-check              exit 0
next build              exit 0 — 53 pages
secret scan             CLEAN
mobile/shared           0 files changed
```

056 harness groups: privileges (5) · mutation+audit commit together for all 22 (24) · **forced audit failure rolls the mutation back (8)** · business rejection leaves no mutation and a durable failure record, including 054's floor still firing (10) · event model incl. attempt/outcome correlation and attempt rows being unmodifiable (12) · existing protections intact (16).

**Three real defects found and fixed by these tests:** the fixture's exception handler silently rolled back the whole seed (making assertions vacuous — caught by a control assertion); 056 blocked reopening resolved/dismissed reports, contradicting `REPORT_TRANSITIONS`; 056 was missing the Main-chat guard on permission changes.

## H8. Remaining blockers

1. **`message.revealBody` / `message.contentSearch` still have `requires_reason = false`** (H2). Deliberate; flip with the Phase 5 reveal-reason UI.
2. **Cross-service atomicity is impossible** and is not claimed. Reconciliation rows need a founder-facing queue when a cross-service action other than `portal.lock` ships.
3. **Browser QA has not been run** on the reason dialogs — they are asserted at source level, not through a DOM runner. Server and database enforcement do not depend on it.

## H9. Exact Production deployment sequence

Nothing below has been run.

```bash
# 0. PRE-FLIGHT — expect ...052, 053, 054 and NO 055, 056, 051
psql "$PROD_URL" -c "select version from supabase_migrations.schema_migrations order by version desc limit 5;"

# 1. APPLY, IN ORDER (055 first — 056 depends on admin_audit_log)
psql "$PROD_URL" -f supabase/migrations/055_durable_admin_audit.sql
psql "$PROD_URL" -f supabase/migrations/056_atomic_admin_mutations.sql

# 2. VERIFY (all five)
psql "$PROD_URL" -c "select count(*) from admin_audit_actions;"                                    -- 26
psql "$PROD_URL" -c "select count(*) from admin_audit_events;"                                     -- 0, nothing backfilled
psql "$PROD_URL" -c "select relrowsecurity, relforcerowsecurity from pg_class where relname='admin_audit_events';"  -- t|t
psql "$PROD_URL" -c "select count(*) from pg_policies where tablename='admin_audit_events';"       -- 0
psql "$PROD_URL" -c "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'admin\_tx\_%';"  -- 22
```

3. **Deploy the web branch to Vercel.** No env-var changes. `ADMIN_WRITES_ENABLED` stays unset.
4. **Post-deploy:** `/admin/audit-history` shows the live table with **0 events** — an empty trail is the correct starting state.
5. **Before ever enabling writes:** confirm H8.1 is resolved and run browser QA on the reason dialogs.

**No OTA. No native build.** Zero mobile or shared files changed.

**Rollback:** both migrations end with ordered DROP sequences. Dropping 056 reverts to the non-atomic 055 path without touching recorded history; dropping 055 destroys the trail — export first.

---
---

# Day 10A — FINAL PRE-DEPLOYMENT VALIDATION (2026-07-31)

**Branch HEAD:** `aff0c0c34a68564c2b9af69e706064d7b614bca8`
**Recommendation: GO** — conditional on the merge-scope decision in §V2. Writes stay disabled.

## V1. Independent diff review

Reviewed `main..HEAD` from source, not from prior notes.

| Check | Result |
|---|---|
| Student-facing functionality changed | **No** — every web change is under `app/admin`, `components/admin`, `lib/admin` |
| Mobile / shared / packages changed | **No** — 0 files |
| Signup / onboarding / auth-flow changed | **No** — 0 files |
| Messaging content behaviour changed | **No** — `revealMessageBody` and `searchMessageContent` are byte-identical after normalizing one added `await`; both still gated by `requireRecentMfa()` → `requireSecureAdmin()` |
| Migration 051 work included | **No** — only documentation references |
| Migration 054 unchanged | **Yes** — untouched by every Day-10A commit; byte-identical to `0781ab5d` |
| 055 / 056 ordered correctly | **Yes** — 056 calls `admin_audit_log`, `admin_audit_actions` (055) and `admin_set_club_member_role`, `admin_remove_club_member` (054, already live in prod) |
| Destructive backfill / unintended data mutation | **None** — 056 contains **zero** DML outside function bodies; 055's only top-level DML is the 26-row catalog seed into its own new table |
| Secrets / credentials / allowlists / private paths committed | **None** — real founder UUID and email allowlist values verified absent from the diff; the 2 JWT-shaped strings are test fixtures (`.abc.def`, `.payload`) with no signature |

## V2. Merge-scope finding — RETRACTED (was wrong)

> **CORRECTION (2026-07-31).** This finding was WRONG. It was based on a stale
> local `main` at `c7e1f74e`. After `git fetch origin`, `origin/main` is at
> `2583c9f9` — **PR #5 already merged `security/admin-session-and-officer-floor`**.
> Verified with `git merge-base --is-ancestor`: commits `762ff94f`, `0781ab5d`
> and `6a748236` are ALL already ancestors of `origin/main`; migration 054 is
> present there and byte-identical to the branch copy; the fail-closed matrix and
> the 15-minute session maximum are present too. The merge base is `6a748236`, so
> this PR contains **only Day 10A work** — there is no scope surprise and no
> decision to make. The original text is kept below for the record.

### Original (incorrect) finding

`admin/durable-audit` was branched from `security/admin-session-and-officer-floor`, which is **still unmerged**. Merging to main therefore also lands three earlier commits:

- `762ff94f` server-enforced absolute admin session max age
- `0781ab5d` migration 054 (atomic last-officer protection)
- `6a748236` fail-closed matrix over every privileged mutation

**Migration 054 is already applied in Production**, so re-running it is a no-op (`supabase_migrations` records 054). The *web code* for session max-age would newly deploy. This is real, reviewed work — but it rides along, and that should be a conscious choice rather than a surprise.

## V3. Browser QA — reason dialogs (all nine)

Method: temporary local Next route mounting the **real** `ConfirmAction` with the exact props of each real call site and a stubbed action recording invocations. No Supabase client, no database — Production could not be touched. Route deleted afterwards; tree clean, absent from the build, never committed.

All nine configurations passed every check:

| Check | Result |
|---|---|
| Dialog identifies correct action + target | ✅ 9/9 — distinct title and `TARGET` box per action |
| Reason field visible, marked required | ✅ 9/9 |
| Confirm disabled at 0 and 2 chars | ✅ 9/9 |
| Confirm enabled at 3 chars | ✅ 9/9 |
| Whitespace-only stays invalid | ✅ 9/9 |
| >500 rejected | ✅ 9/9 — exact boundary: 500 enabled, 501 disabled, 600 disabled; `maxLength=500` also caps typing |
| Cancel closes dialog | ✅ |
| Cancel clears the reason | ✅ — reopen showed empty field |
| Cancel invokes no server mutation | ✅ — 0 recorded calls |
| Reopen starts empty + confirm disabled | ✅ |
| Target stable while dialog open | ✅ |
| Native double-click cannot submit twice | ✅ — **exactly 1 call** |
| Loading state prevents duplicates | ✅ — "Working…", confirm **and** cancel disabled, mid-flight clicks produced no extra calls |
| Server error → clear error, no false success | ✅ — dialog stays open, error shown, reason preserved, confirm re-enabled, 1 call |
| Success closes / updates UI | ✅ |
| Correct action identifier + reason reach the action | ✅ 9/9 verified from recorded invocations |
| Long (500-char) reason layout | ✅ — dialog 440×388, no viewport overflow, no horizontal body scroll, textarea scrolls internally |

## V4. Writes-disabled behaviour

- 248/248 assertions in `writePathFailClosed.test.ts` — every privileged mutation rejected with `ADMIN_WRITES_ENABLED` unset.
- 26 mutations gated by `requireSecureAdmin({ write: true })`. The only three exports without it are intentional and verified: `lockAdminPortal` (session control — must always work), and the two message reads (gated by `requireRecentMfa()`, which chains `requireSecureAdmin()`).
- Reason dialogs cannot bypass the gate: the write check runs **before** the reason check, so a perfect reason still throws.
- Read-only loaders (`auditData`, `data`, `data2`) call `requireSecureAdmin()` without `write`.
- Loading a detail page or opening a dialog performs no mutation (browser QA: 0 calls until confirm).

## V5. Audit History UI

Validated at data + safety level: 20/20 `auditData.test.ts` (authorization, filters, detail, correlation siblings, summary, honest degradation when 055 is absent, read-only export surface). Structural safety: **no raw JSON dump** — the list page contains no `JSON.stringify`; the detail view renders typed key/value rows and only serializes a *nested* value. No message content, token, secret, password or MFA field is referenced by either page.

**Residual gap (nonblocking):** populated-state browser QA (pagination, date/action/target/outcome filters against real rows) could not be run — it needs a Supabase instance with 055 applied **and** a founder aal2 session, neither of which exists pre-deployment. Recommended as the first post-deploy check, where the expected state is 0 events.

## V6. Single-campus protection

- 14/14 `singleCampus.test.ts`.
- UI: Add University replaced by a disabled affordance; banner states single-campus mode and names Lone Star College.
- Server: `addUniversity()` refuses **before** name/slug validation and before any insert (`getCampusMode()` at the first statement).
- Fails closed if `app_config` is unreadable.
- Gate is config-driven: flipping `single_campus_mode=false` in an isolated test restores the capability with no code change (tested).
- Live Production setting untouched.

## V7. Atomicity regression — verbatim results

| Requirement | Assertion |
|---|---|
| Forced audit failure rolls back the mutation | `3.1b` membership still exists · `3.2b` RSVP still exists · `3.3b` club still inactive · `3.4b` event title unchanged (+ `3.4c` control proving non-vacuity) |
| Forced mutation failure creates no success event | `4.1c` no success record exists |
| Missing reason creates no mutation | `3.1a` raises · `3.1b` row intact |
| service_role arbitrary direct insert denied | `4.1` permission denied |
| UPDATE / DELETE / TRUNCATE denied | `5.1`–`5.4` (owner, trigger) · `5.6`/`5.7` (service_role) · `5.5` catalog permanent |
| History survives actor/target deletion | `11.2` actor · `11.3` target · `11.4` historical email preserved |
| Migration 054 last-officer protection active | `4.2a` fires through the atomic layer · `4.2b` last officer kept role |
| Correlation IDs correct | `10.1` shared across a transfer · `10.3` distinct for unrelated ops · `5.7` attempt+outcome share one |

## V8. Final test pass

```
055 harness            70/70    (fresh apply + idempotent re-apply, exit 0)
056 harness            75/75    (real 054 applied over schema fixture, exit 0)
web vitest             750/750  (30 files, exit 0)
type-check             exit 0
next build             exit 0 — 53 pages; QA harness absent from output
static secret scan     CLEAN
git status             clean (3 pre-existing untracked files, none from Day 10A)
```

## V9. Blockers and findings

**Blockers to applying 055/056 + deploying the web branch: NONE.**

**Nonblocking findings:**

1. **`onConfirm` has no re-entrancy guard.** Protection relies on React committing `pending` between clicks. A native double-click is safe (verified: 1 call), but three *synchronous programmatic* invocations in one tick produced 3 calls. Not reachable by a human; impact bounded (the second call would hit `not_member`-style rejection and be audited). Recommend a `useRef` in-flight guard before writes are enabled.
2. **`maxLength=500` caps typing, not programmatic values.** `reasonValid` and the database CHECK both reject >500, so the rule holds; the attribute is convenience only.
3. **Audit History populated-state browser QA deferred** — see §V5.
4. **`message.revealBody` / `message.contentSearch` remain `requires_reason=false`** — deliberate; flip with the Phase 5 reveal-reason UI.

**Before ADMIN_WRITES_ENABLED is ever turned on:** close findings 1 and 3, and decide on 4.

## V10. Confirmations (live-verified 2026-07-31)

- `ADMIN_WRITES_ENABLED` — unset (= false)
- 055 / 056 — **not applied to Production** (0 audit tables, 0 `admin_tx_*` functions; applied set is 054, 053, 052, 050)
- 051 — **absent** from the branch and from Production
- Nothing merged (branch not contained in main) · nothing deployed · no OTA
- **No Production row modified** — all Production access this session was read-only `SELECT`
- Lone Star College remains the only university, active, `single_campus_mode=true`, `launch_university_id` unchanged

## V11. Recommendation

**GO** to apply migration 055 then 056 to Production and deploy the web branch, with writes left disabled — conditional on an explicit founder decision about the merge scope in §V2. Deployment sequence and verification queries: §H9.

---
---

# Day 10A — PRODUCTION RELEASE REPORT (2026-07-31)

**Released.** Migrations 055 and 056 are live; the merged web app is deployed. Writes remain disabled.

## R1. Merge-scope resolution — my earlier finding was WRONG

I compared against a **stale local `main`** (`c7e1f74e`) and reported that the parent security branch was unmerged. You were right to challenge it.

After `git fetch origin`: `origin/main` was at `2583c9f9` — **PR #5 had already merged `security/admin-session-and-officer-floor`.**

| Check | Result |
|---|---|
| `762ff94f` (session maximum) ancestor of origin/main | **Yes** |
| `0781ab5d` (migration 054) ancestor of origin/main | **Yes** |
| `6a748236` (fail-closed matrix) ancestor of origin/main | **Yes** |
| Migration 054 on origin/main vs branch | **Byte-identical** |
| Fail-closed matrix on origin/main | Present |
| 15-minute session maximum on origin/main | Present (`ADMIN_SESSION_MAX_AGE_DEFAULT_MINUTES = 15`) |
| Merge base | `6a748236` |

So PR #6 contained **only Day 10A work** — no scope surprise, no decision required. The only file overlapping those protections was `writePathFailClosed.test.ts`, and its diff is purely additive argument passing for the new `reason` parameters: **same 25 mutation cases, nothing weakened**. Your three "keep" instructions were satisfied by leaving everything untouched. The incorrect §V2 finding is retracted in place (commit `6f732ed3`).

## R2. Re-entrancy guard

`useRef` latch checked and set **before any await**, released in `finally` (success and failure) and in `close()`. Dialog design unchanged — same layout, same "Working…", same disabled buttons.

**Browser-verified against the real component:** synchronous triple invocation now produces **exactly 1 call** (was 3). Reopening starts clean. A second submission still succeeds, proving the latch releases. Also applied to `UniversityForm`, which backs Add University — the one reason-required action not routed through `ConfirmAction`.

10 new tests (source contract + behavioural simulation). Commit `ce419c9e`.

## R3. Release identifiers

| Item | Value |
|---|---|
| Branch HEAD before merge | `c581946b` |
| Pull request | **#6** |
| Merge commit | **`219f295b`** |
| Production deployment | Vercel `DUg57ivcFaa2nMaAmAzTyx1MsYod` — success, site serving HTTP 200 |
| CI | Vercel check **pass**; PR state MERGEABLE / CLEAN |

## R4. Migrations applied

Applied **only** 055 then 056, as direct SQL through the Supabase Management API — which structurally guarantees no other migration could be proposed or executed. 054 was **not** re-run.

```
ledger before : 050, 052, 053, 054
ledger after  : 050, 052, 053, 054, 055, 056
055 applied exactly 1 time   056 applied exactly 1 time   051 absent
```

055 → 26 catalog rows, 0 events, RLS enabled **and forced**, **0 policies**, 4 triggers, `admin_audit_log` present.
056 → 22 `admin_tx_*` functions, 9 private helpers; `service_role` may execute 22, `anon`/`authenticated` may execute **0**.

## R5. Production row-count comparison

| Table | Before | After | |
|---|---|---|---|
| profiles | 65 | 65 | unchanged |
| clubs | 6 | 6 | unchanged |
| club_members | 235 | 235 | unchanged |
| posts | 25 | 25 | unchanged |
| events | 25 | 25 | unchanged |
| messages | 104 | 104 | unchanged |
| reports | 14 | 14 | unchanged |
| universities | 1 (1 active) | 1 (1 active) | unchanged |

`single_campus_mode = true`; `launch_university_id = 174a1779-0281-4d20-9b0d-a075c17fc01f` = Lone Star's id, unchanged. Zero test universities, zero test clubs, zero audit events.

## R6. Append-only verification (non-residual)

My first pass returned "allowed" for UPDATE and DELETE — that was **vacuous**: the table was empty, so the row-level triggers never fired. Re-run properly inside a transaction with a real row present, then rolled back:

```
approved_path_insert = OK          (SECURITY DEFINER route works; rows_now=1)
UPDATE  = DENIED  (admin_audit_events is append-only: UPDATE is not permitted)
DELETE  = DENIED  (admin_audit_events is append-only: DELETE is not permitted)
residue after rollback = 0 rows
```

Plus, directly against production: service_role direct INSERT **denied** · authenticated INSERT **denied** · authenticated SELECT **denied** · anon SELECT **denied** · anon and authenticated EXECUTE of `admin_audit_log` **denied** · TRUNCATE **denied** · catalog DELETE **denied** · anon and authenticated EXECUTE of `admin_tx_*` **denied** · anon REST `GET /admin_audit_events` → **401**.

`admin_audit_log()` is confirmed the only insertion route. No legitimate audit event was altered or deleted — the table held zero, and holds zero.

## R7. Deployed-app verification

Private gateway concealment intact — `/admin`, `/admin/login`, `/admin/users`, `/admin/audit-history` all return **404** unauthenticated. Student surfaces unaffected — `/`, `/login`, `/privacy-policy`, `/terms`, `/child-safety-standards` all **200**.

Dashboard read path confirmed working: `service_role` SELECT on both audit tables succeeds, so `isAuditTableAvailable()` now returns true and Audit History will render the live empty state (0 events) rather than the "not applied" notice.

## R8. Test results

```
web vitest  760/760 (30 files)   type-check  pass   next build  pass (53 pages)
secret scan clean                055 harness 70/70   056 harness 75/75
```

## R9. Confirmations

- **`ADMIN_WRITES_ENABLED` = false** — unset in the repo; code default is fail-closed (`=== "true"`). No environment variable was added or changed.
- **Migration 051 remains absent** — not in the repo, not in the ledger, no 051 objects in Production.
- **No Production application row was modified** — every count identical; the only writes were DDL creating new objects, plus two ledger rows.
- **Lone Star College remains the sole university**, active, with `single_campus_mode=true` and `launch_university_id` unchanged.
- **Migration 054 byte-identical**, not re-executed.
- **No OTA published. No iOS or Android build created.** Zero mobile/shared files changed.
- **Day 10B not started.**

## R10. Blockers

**None.** The release is complete and verified.

## R11. Nonblocking findings / founder follow-ups

1. **Two Part-6 checks require founder credentials and could not be performed by me** — entering the private entry phrase, the founder Gmail password and a TOTP code is something I must not do. Both are quick for you:
   - **Audit History through the secured founder path** — confirm it loads, shows the empty state, and that filters render. The data layer is verified (service_role SELECT works, 20/20 unit tests) but the authenticated page render is unconfirmed.
   - **Live writes-disabled behaviour** — confirm a mutation is rejected in the real dashboard. The logic is deployed and covered by 248/248 fail-closed assertions.
2. **`ADMIN_WRITES_ENABLED` in the Vercel dashboard could not be read from here** (no Vercel CLI/token). Unset is the desired state and is what the code assumes; worth an eyeball in Vercel → Settings → Environment Variables.
3. **`message.revealBody` / `message.contentSearch` remain `requires_reason=false`** — deliberate; flip with the Phase 5 reveal-reason UI.
4. Audit History's populated-state QA (pagination, filters against real rows) will only be meaningful once real events exist — i.e. after writes are enabled.
