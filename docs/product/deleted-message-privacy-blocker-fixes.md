# Deleted-Message Privacy — Codex Blocker Fixes (Review Package)

Reviewer: **Codex** · Implementer: **Claude** · Branch: **`backend/deleted-message-privacy`**

Status: **fixed, validated locally, NOT deployed.** Migration 051, the Edge
Functions, Cron, Storage changes, backfills, and OTA are all **held** pending
Codex re-review + founder approval.

This package resolves the seven production-blockers Codex raised against the v9
deleted-message-privacy implementation. The approved architecture is unchanged;
only the concrete implementation was corrected. All fixes land in the **existing
undeployed** migration `051_deleted_message_privacy.sql` (reconciliation state:
`next = 051`), plus the reconcile-deletions Edge worker and a new regression
suite.

---

## 1. Files changed

| File | Change |
| --- | --- |
| `supabase/migrations/051_deleted_message_privacy.sql` | All seven DB-side blocker fixes (below). |
| `supabase/functions/reconcile-deletions/index.ts` | B6 — resume unexpected/failed state via `failRetry` instead of a silent no-op hold. |
| `supabase/tests/deleted_message_privacy_blockers_test.sql` | **New.** 68-check regression suite, one per blocker requirement. |
| `docs/product/deleted-message-privacy-blocker-fixes.md` | **New.** This review package. |

`supabase/functions/delete-message/index.ts` needed no change: its inline saga
only ever drives a freshly-created `pending` attempt, and the claim RPC now
normalizes resume state for it too.

---

## 2. Blocker → fix table

| # | Blocker | Fix | Verified by |
| --- | --- | --- | --- |
| 1 | Sender could UPDATE own message with no `deleted_at IS NULL` guard → clear `deleted_at`, rehydrate content/attachments. | No client message-edit feature exists (app never UPDATEs `messages`). **Dropped** `messages: senders can update own` and **`REVOKE UPDATE ON messages FROM anon, authenticated`**. All mutation is via SECURITY DEFINER RPCs (owned by `postgres`, bypass RLS). Restoration only via `admin_restore_message`. | B1.1–B1.5 |
| 2 | `report_message` wrote `content_snapshot`/`attachment_snapshot` into reporter-readable `reports`; 051 backfilled but never nulled them. | Hardened `report_message` to write evidence to deny-all `report_evidence` only; reporter row is **workflow-only**. Backfill → **coverage assertion** → **NULL** both reporter columns in this release (not deferred). Columns marked DEPRECATED. | B2.1–B2.8 |
| 3 | `delete_conversation_channel` hard-deleted messages via `ON DELETE CASCADE`; `delete_group_conversation`/`clear_official_chat` only set `deleted_at` (no redaction). | Retargeted message parent FKs (`channel_id`, composite, `conversation_id`) to **`ON DELETE RESTRICT`**; dropped the client channel-DELETE policy; routed all three ops through the canonical lifecycle via `_dmp_bulk_secure_delete` (`entry_point='bulk'`). Channel is redacted-then-detached-then-removed; group/official-chat redact then soft-delete/hide. | B3.1–B3.14 |
| 4 | `chat-attachments: uploader can delete` let an uploader physically delete the original before retention. | **Dropped** the policy. Attachment removal is service-role-only (Edge). Retention bucket stays deny-all. | B4.1–B4.3 |
| 5 | Legacy permissive `poll_votes`/`polls`/`poll_options` policies OR-combined and bypassed `cast_poll_vote`. | Dropped `poll_votes: authenticated can vote` / `users can remove own vote` / `users manage own`, `polls: participants can read` (unguarded dup), `poll_options: poll creator can insert`. `poll_votes` is now **SELECT-only** for clients; all writes go through `cast_poll_vote` (deleted-poll guarded). | B5.1–B5.8 |
| 6 | `fail_deletion_attempt` collapsed to `failed_requires_reconciliation`; worker had no resume branch → infinite no-op reclaim; CAS transitions rejected the failed state. | Added `last_completed_step`; CAS transitions record it; `claim_*` **normalize** a failed attempt back to `pending`/`retained`/`original_removed` via `_dmp_resume_state`, so the existing CAS applies. Worker fails-retryably on any unexpected state instead of holding the lease. | B6.1–B6.19 |
| 7 | `preflight` returned `already_deleted` **before** authorization; helper functions were an existence/deletion/conversation-id oracle for arbitrary UUIDs. | Reordered `preflight`/`begin` so **authz precedes** the already-deleted signal. **Revoked** raw oracles (`is_deleted_message`, `message_conversation_id`, `is_deleted_attachment`, `is_deleted_poll`) from every client role; folded them into opaque, entitlement-gated helpers (`can_see_message`, `can_see_poll`, `can_manage_poll[_message]`, `chat_attachment_readable`) granted only to `authenticated`. | B7.1–B7.11 |

> **Why the oracles couldn't just be revoked:** verified empirically that
> PostgreSQL enforces `EXECUTE` on functions called inside RLS policy
> expressions against the *querying* role. Revoking the raw helpers would break
> the poll/storage policies, so they are wrapped in combined helpers that return
> `true` only for a row the caller is entitled to and `false` — identically —
> for deleted/foreign/nonexistent inputs (no distinguishable signal).

---

## 3. Final policy matrix (post-051, verified live)

| Table | Policy | Cmd | Final behavior | Disposition |
| --- | --- | --- | --- | --- |
| `public.messages` | participants can read | SELECT | `deleted_at IS NULL AND participant` | tightened (051) |
| | non-member club preview | SELECT | `deleted_at IS NULL AND …preview` | tightened (051) |
| | participants can insert | INSERT | unchanged | retained |
| | *(senders can update own)* | UPDATE | **removed** — no client UPDATE; `REVOKE UPDATE` | **dropped (B1)** |
| | *(no DELETE policy)* | DELETE | `REVOKE DELETE` | already closed |
| `public.polls` | conversation participants can read | SELECT | `can_see_message(message_id)` | rewritten (B5/B7) |
| | *(participants can read)* | SELECT | duplicate, unguarded | **dropped (B5)** |
| | message senders can manage | ALL | `can_manage_poll_message(message_id)` | rewritten |
| | participants can insert | INSERT | unchanged (creation via `create_poll`) | retained |
| `public.poll_options` | participants can read | SELECT | `can_see_poll(poll_id)` | rewritten |
| | poll creator can manage | ALL | `can_manage_poll(poll_id)` | rewritten |
| | *(poll creator can insert)* | INSERT | unguarded legacy | **dropped (B5)** |
| `public.poll_votes` | participants can read | SELECT | `can_see_poll(poll_id)` | rewritten |
| | *(authenticated can vote)* | INSERT | direct write | **dropped (B5)** |
| | *(users can remove own vote)* | DELETE | direct write | **dropped (B5)** |
| | *(users manage own)* | ALL | direct write | **dropped (B5)** |
| `storage.objects` (`chat-attachments`) | participants can read | SELECT | `chat_attachment_readable(name)` | rewritten (B4/B7) |
| | participants can upload | INSERT | unchanged | retained |
| | *(uploader can delete)* | DELETE | client physical delete | **dropped (B4)** |
| `storage.objects` (`deleted-message-retention`) | *(none)* | — | RLS deny-all | retained |
| `conversation_channels` | participants can read | SELECT | `is_conversation_participant` | retained |
| | non-members see club group channels | SELECT | club-group visibility | retained |
| | *(participants can manage)* | ALL | direct participant INSERT/UPDATE/DELETE | **dropped (R1)** |
| | *(officers can create)* | INSERT | vestigial (creation via RPC) | **dropped (R1)** |
| | *(officers can delete)* | DELETE | client physical delete | **dropped (B3)** |
| `public.reports` | (existing workflow policies) | — | snapshot columns forced NULL | evidence moved (B2) |
| `report_evidence`, `message_deletion_attempts`, `message_attachment_map`, `deleted_message_history`, `data_health_diagnostics` | *(none)* | — | RLS enabled, deny-all | service-role only |

## 4. Final function / grant matrix (verified live)

| Function | anon | authenticated | service_role | Notes |
| --- | :-: | :-: | :-: | --- |
| `is_deleted_message`, `message_conversation_id`, `is_deleted_attachment`, `is_deleted_poll` | ✗ | ✗ | ✗ | raw oracles; internal-only (definer callers) |
| `can_see_message`, `can_see_poll`, `can_manage_poll_message`, `can_manage_poll`, `chat_attachment_readable` | ✗ | ✓ | ✗ | opaque RLS helpers |
| `_dmp_resume_state`, `_dmp_backoff`, `_dmp_bulk_secure_delete` | ✗ | ✗ | ✗ | internal |
| `cast_poll_vote`, `unsend_message`, `report_message` | ✗ | ✓ | ✗ | client entry points |
| `delete_conversation_channel`, `delete_group_conversation`, `clear_official_chat` | ✗ | ✓ | ✗ | tightened (`REVOKE FROM PUBLIC`) |
| `preflight_message_deletion`, `begin_message_deletion`, `claim_*`, `mark_*`, `finalize_*`, `fail_*`, `heartbeat_*`, `admin_*`, `record_unmappable_*`, `scrub_message_pushes`, `enqueue_push` | ✗ | ✗ | ✓ | Edge/worker only |

---

## 5. Design decisions

**Bulk deletion (B3):** Approach A — every message is routed through the
canonical first-transaction lifecycle (`begin_message_deletion`, `entry_point='bulk'`):
snapshot → attachment map → redact → `deleted_at` → push scrub → state
`pending` (managed; worker retains+removes Storage async) or `completed`. FKs are
RESTRICT so no cascade can physically erase a message. `delete_conversation_channel`
redacts, then NULLs `channel_id` on the redacted rows (history already holds the
original), then removes the now-empty channel container. `delete_group_conversation`
and `clear_official_chat` redact then soft-delete/hide the parent (never physical).
Bound: redaction is one transaction (cheap, no in-txn Storage); the physical
Storage work is bounded + resumable in the worker. A chunked variant can page by
`created_at` if a channel ever grows past single-transaction comfort.

**Worker resume-state model (B6):** durable `last_completed_step ∈
{created, retained, original_removed}` is written by the CAS transitions.
`_dmp_resume_state(state, step)` maps a `failed_requires_reconciliation` attempt
to its resumable active state; `claim_*` apply it atomically on claim so the
existing CAS transitions accept it. Crash-after-copy resumes at delete; crash-
after-delete resumes at finalize (never restoring unsafe access, never
finalizing before retention). Dead-lettered / retry-limit / stale-token /
duplicate-worker cases remain excluded.

**Report evidence (B2):** confidential content/attachment snapshots live only in
deny-all `report_evidence` (one-to-many). Existing snapshots are backfilled, a
coverage assertion aborts the migration if any would be lost, then the reporter-
readable columns are nulled in the same release. Rollback leaves the NULLs in
place, so it can never re-grant reporter access to retained evidence.

**Storage policy (B4):** no ordinary DELETE on managed chat attachments; removal
is service-role-only. Retention bucket is deny-all. New signed URLs for a deleted
attachment are denied (`chat_attachment_readable`); previously-issued URLs stay
honest until the original is physically removed by the worker.

**Oracle protections (B7):** authorization precedes any existence/deletion
signal; raw helpers are not client-executable; edge responses remain minimal.
Unauthorized callers get one opaque `not_found_or_not_authorized` for
deleted/foreign/nonexistent/unauthorized alike.

---

## 5b. Round-2 blocker fixes

**R1 — channel mutation policy (`conversation_channels`).** Migration 001's FOR
ALL `conv_channels: participants can manage` OR-combined with the officer
policies, so an ordinary participant could directly INSERT/UPDATE/DELETE channels.
All channel mutation is server-controlled via SECURITY DEFINER RPCs
(`create_conversation_channel` authorizes club officers *and* group participants;
`rename_conversation_channel`, `set_channel_*`, `delete_conversation_channel`),
which bypass RLS as owner and need no client write policy. Dropped `participants
can manage` (FOR ALL) and the now-vestigial `officers can create` (INSERT). Final
effective set = **two SELECT policies only** (see §3). No FOR ALL / INSERT /
UPDATE / DELETE policy remains for ordinary participants; participant SELECT is
preserved; officer/group RPC creation still works.

**R2 — retry-limit manual recovery.** `admin_manual_retry_deletion` cleared the
dead-letter flags but left `retry_count` at the limit, and the claim requires
`retry_count < 8`, so an attempt dead-lettered at the limit could never be
retried. Added a one-shot `manual_retry_override` the claim honors and consumes,
plus `manual_retry_count` for audit; `retry_count` is preserved as the lifetime
automatic-failure total.

State transition (attempt dead-lettered at the limit):

```
retry_count=8, requires_manual_reconciliation=true, dead_lettered_at=set,
manual_retry_override=false
   │  admin_manual_retry_deletion(reason)   [service-role only, audited]
   ▼
retry_count=8 (preserved), requires_manual_reconciliation=false,
dead_lettered_at=NULL, manual_retry_override=TRUE, manual_retry_count+=1,
next_retry_at=now(), claim_token=NULL
   │  claim_deletion_attempt / claim_specific   [honors override despite cap]
   ▼
claimed once; manual_retry_override=FALSE (consumed)  → exactly ONE controlled retry
   │  success → completed        │  failure → fail_deletion_attempt: (8+1)>=8
   ▼                             ▼
completed                        dead-lettered again (needs another manual retry)
```

Automatic workers still cannot claim dead-lettered attempts; stale tokens and
duplicate workers remain rejected; the action is REVOKE'd from anon/authenticated.

## 6. Tests & exact results

Run against the local shadow DB (`supabase db reset --local` first):

```
docker exec -i supabase_db_weglue psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -f supabase/tests/deleted_message_privacy_test.sql          # 73 passed / 0 failed / 73
docker exec -i supabase_db_weglue psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -f supabase/tests/deleted_message_privacy_blockers_test.sql # 89 passed / 0 failed / 89
```

The blocker suite now includes the two round-2 fixes (R1 channel-mutation
policy, R2 retry-limit manual recovery) and the officer-denial evidence check
(B2.9).

| Check | Command | Result |
| --- | --- | --- |
| Migrations apply clean | `supabase db reset --local` | ✅ 001→051, no errors |
| Original privacy suite | psql `deleted_message_privacy_test.sql` | ✅ 73/73 |
| Blocker regression suite | psql `deleted_message_privacy_blockers_test.sql` | ✅ 89/89 |
| Account deletion under RESTRICT | simulated `delete_own_account_atomic()` | ✅ shared kept + anonymized, solo hard-deleted |
| Edge type-check | `deno check delete-message reconcile-deletions` | ✅ |
| Edge lint | `deno lint …` | ✅ |
| Edge format | `deno fmt --check …` | ✅ |
| Mobile unit | `npx vitest run` (apps/mobile) | ✅ 33/33 |
| Mobile typecheck / lint | `npx tsc --noEmit` (== `lint` script) | ✅ 0 errors |
| Static hard-delete scanner | vitest `messageDeletion.test.ts` | ✅ 7/7, 0 offenders |

---

## 7. Isolated Storage integration test (run only after static fixes pass)

The static + SQL suites do not exercise real Storage object copy/delete. Run this
against a **disposable** local Storage or an **isolated non-production** project —
never production:

1. Start a throwaway stack (`supabase start` on a scratch project) and apply
   migrations through 051.
2. Upload an active object to `chat-attachments/<conv>/<uuid>.jpg`; confirm an
   ordinary participant can read it and an ordinary client **cannot** DELETE it
   (policy gone).
3. Invoke `delete-message` (service-role) for the owning message; assert:
   retention copy exists + size/SHA-256 match; original removed and
   trusted-absence-verified; a signed URL issued *before* removal still resolves,
   a *new* signed URL is denied; the retained object is unreadable by
   anon/authenticated.
4. Worker resume: kill the function after the copy and after the original delete;
   re-run `reconcile-deletions`; assert it resumes to `completed` without
   re-exposing content; duplicate invocation is idempotent.
5. **Failure before retention copy:** fail the download/copy step; assert the
   attempt returns to `pending` (via `last_completed_step='created'`), the
   original object is untouched, and no partial retained object remains.
6. **Retry-limit dead-letter:** force repeated copy failures until
   `retry_count = 8`; assert the attempt is dead-lettered
   (`requires_manual_reconciliation = true`), the Cron worker no longer claims
   it, and content stays redacted.
7. **Manual-retry recovery:** call `admin_manual_retry_deletion`; assert exactly
   one worker claim then succeeds (override consumed), the retained copy + original
   removal complete, and a fresh signed URL for the original is denied.
8. Delete all disposable objects/buckets.

---

## 8. Deployment order (held — do NOT execute yet)

1. Apply migration `051` (`supabase db push`) — additive + the two intended
   destructive steps (report-column null, FK retarget) run inside it with the
   coverage assertion.
2. Deploy Edge Functions `delete-message`, `reconcile-deletions`.
3. Create the reconcile Cron (1–2 min) with `RECONCILE_SECRET`.
4. Confirm the retention bucket exists (created by 051) and is private.
5. No OTA/native build required (backend + Edge only; client contracts unchanged).

## 9. Rollback plan

- **Migration:** 051 is self-contained. To roll back, drop the new tables/
  functions/policies and restore the pre-051 policy set. The nulled
  `reports.content_snapshot`/`attachment_snapshot` values stay NULL (evidence
  already moved), so rollback **cannot** re-expose reporter evidence. FK actions
  can be restored to CASCADE only if the bulk RPCs are also reverted together.
- **Edge/Cron:** disable the Cron, redeploy prior function versions. In-flight
  attempts remain safe (content already redacted); they simply stop advancing
  Storage retention until re-enabled.
- **No client rollback** needed — the app already routes through the secure path
  and RPCs whose signatures are unchanged.

---

## 10. Remaining risks

- **Single-transaction bulk redaction** for very large channels/conversations
  (thousands of messages) is one big transaction. Cheap (no in-txn Storage) but a
  chunked, resumable variant is the follow-up if scale demands it.
- **Deno not on PATH by default** on the build host (`~/.deno/bin`); CI must add
  it for edge checks.
- **Storage integration** is unverified in this pass (no live Storage in the SQL
  harness) — §7 must run on a disposable project before deploy.
- Report-evidence moderation read path is a **future audited RPC** (not built
  here); until then evidence is service-role-only.
