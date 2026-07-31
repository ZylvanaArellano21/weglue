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

**The audit insert is NOT atomic with the mutation.** It is a separate PostgREST call in a separate transaction. This is documented in the migration and in `audit.ts` rather than glossed over:

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
