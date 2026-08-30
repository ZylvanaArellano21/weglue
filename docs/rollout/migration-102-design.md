# Migration 102 design: asynchronous photo-post notification fan-out

Status: proposal for review only. Nothing in this document or `102_async_photo_fanout.sql` has been applied. The migration is intended for branch `codex/rollout-reliability-backend`; Claude owns the eventual commit.

## Measured problem

On `weglue-staging`, with the complete 001–101 chain and real authenticated authors, correctness was perfect across the tested cases: 0 failures, 0 duplicates, stable behavior, and no connection exhaustion. Latency was not acceptable:

| Campus members | Concurrent photo posts | Post-INSERT p95 | p50 at concurrency 50 |
|---:|---:|---:|---:|
| 100 | 1 / 10 / 50 | 3.5s at 50 | — |
| 300 | 1 / 10 / 50 | 9.4s at 50 | — |
| 500 | 1 / 10 / 50 | 12s at 50 | 7.2s |

The latency scales linearly with campus size because `notify_photo_post_university()` performs a synchronous recipient loop inside the poster's INSERT transaction at approximately 1.5ms per recipient. At 500 members and 50 concurrent posts, 24,950 notification rows were written synchronously in about 13 seconds. The founder-approved remediation direction is asynchronous fan-out.

## Pre-102 function contract

The pre-102 `public.notify_club_post` signature is exactly:

```sql
CREATE OR REPLACE FUNCTION notify_club_post(p_post_id UUID, p_club_id UUID, p_author UUID)
```

Migration 102 uses the same qualified signature, `public.notify_club_post(UUID, UUID, UUID)`, so it replaces the existing function rather than creating an overload. The old body selected the club and author, then inserted one row per current club member other than the author with this exact message expression:

```sql
COALESCE(v_author, 'A member') || ' shared a new post in ' || v_club || '.'
```

Thus the legacy copy is `"<author> shared a new post in <club>."`, with `A member` as the author fallback. The migration-102 worker preserves this club-member copy and uses `"<author> shared a photo post."` for campus-only photo recipients.

Migration 083 also has a separate synchronous path that 102 does not touch: `notify_club_photo()` on `trg_club_photo_notify`, an `AFTER INSERT ON club_photos` trigger for direct `source = 'officer_upload'` gallery uploads. It fans out O(current club members), is bounded by club size rather than campus size, and is out of scope for 102; it was not the measured campus photo-post bottleneck.

## Current double-fire and the target behavior

Before 102, `posts` has two independent AFTER INSERT fan-out triggers:

1. `trg_club_post_notify` calls `handle_club_post_notify()` and, when `club_id` is non-null, `notify_club_post()` for current club members.
2. `trg_photo_post_university_notify` calls `notify_photo_post_university()` when `image_url` is non-null and fans out to every same-campus profile except the author.

The first path uses `club_post:<post>:<recipient>` as `dedupe_key`; the photo path in 088/089 does not use the notification dedupe key. Therefore a club-tagged photo can create two `club_post` rows for an overlapping recipient. Its total is club members plus campus members, including the overlap twice.

After 102, a photo post associated with a club produces exactly one `club_post` notification per distinct recipient in:

`current club members ∪ same-campus profiles excluding the author`.

The worker keeps the old copy contract: current club members receive `"<author> shared a new post in <club>."`; campus-only recipients receive `"<author> shared a photo post."`. If an overlapping recipient is both a current club member and a campus member, the deterministic club copy wins. Non-photo club posts retain the club-only set and club copy. Tagged-only posts are also supported.

## Job schema and enqueue contract

`notification_fanout_jobs` has one row per `post_id` (`UNIQUE`), with:

- `author_id`, `kind` (`club_post` or `photo_post`), and `club_ids[]` for the direct club plus any `post_club_tags` clubs;
- `status`: `pending`, `processing`, `completed`, or `failed`;
- `cursor`: the last recipient UUID completed, ordered ascending by UUID;
- `attempts`, `max_attempts` (default 5), `claimed_at`, `last_error`, timestamps.

The rewritten `handle_club_post_notify()` performs one upsert into this table for a qualifying post. It does not select or loop recipients. The old photo trigger is dropped. The tag trigger remains, but it only upserts the same unique job and appends its club ID, also O(1). The helper resets the cursor only when a new target club or a photo-kind promotion is added; replay is safe because notification uniqueness is database-enforced.

The enqueue remains inside the poster's transaction. The cost is one indexed upsert and is bounded independently of campus size. If the post transaction rolls back, the job rolls back with it, so no notification can outlive an uncommitted post.

## Worker and drain math

`process_notification_fanout()` is a `SECURITY DEFINER` PL/pgSQL worker invoked by pg_cron. Its `FOR UPDATE SKIP LOCKED` claim loop mirrors the durable `process_social_proof_events()` pattern from migration 099, and its timeout reaper mirrors `invoke_push_dispatch()`'s push-queue reaper:

```sql
SELECT public.process_notification_fanout();
```

Defaults are 10 jobs per tick and 500 recipients per job per tick. When separately enabled by the operator, the drain schedule runs every minute. A transaction-scoped advisory lock prevents an overlapping cron/manual invocation. Claimed jobs use `FOR UPDATE SKIP LOCKED`; each recipient batch is one set-based `INSERT ... SELECT`, not a per-recipient PL/pgSQL loop. The worker uses UUID ascending order and `cursor < recipient_id` to resume.

For the measured burst of 50 simultaneous photo posts × 500 campus members:

- 50 jobs × 499 recipient rows = 24,950 logical rows because each author is excluded (25,000 is the worker's upper-bound target slots);
- 10 jobs/tick × 500 recipients/job = 5,000 logical rows maximum per minute;
- the burst drains in 5 worker ticks, or at most 5 minutes from the next minute boundary, assuming each 500-row set-based batch completes within the tick;
- a single 500-recipient post is one batch and completes in its first claimed tick;
- the worker has a hard ceiling of 10 jobs and 500 recipients per invocation, so one tick cannot monopolize the database connection pool or create an unbounded transaction.

The 5-minute bound is the scheduling bound, not a claim that the 500-row insert has already been load-tested. Claude must measure batch duration, pg_cron run time, lock waits, and push-queue/pg_net behavior on staging before approval. If staging shows a batch approaching the one-minute interval, reduce the recipient batch or job batch and recalculate the bound rather than allowing overlapping workers.

## Idempotency and double-fire resolution

The existing 046 `uq_notifications_dedupe_key` index is not enough for historical photo rows because 088/089 inserted some photo notifications without `dedupe_key`. The proposal therefore:

1. Deletes older duplicate `club_post` rows per `(user_id, entity_id)`, retaining the oldest row deterministically.
2. Fills a canonical `club_post:<post>:<recipient>` dedupe key where missing and
   non-conflicting; the composite index below remains authoritative for any
   surviving legacy row that must retain a null key.
3. Adds `uq_notifications_club_post_recipient` on `(user_id, type, entity_id)` with a partial predicate for `type = 'club_post'` and non-null `entity_id`.
4. Uses `ON CONFLICT (user_id, type, entity_id) ... DO NOTHING` in the worker.

The cursor prevents rescanning the completed prefix during ordinary progress. The unique index protects against every other replay scenario: worker retry, crash after notification INSERT but before cursor update, concurrent trigger/job re-enqueue, and the old club/photo double-fire during cutover. Existing duplicate cleanup can cascade-delete duplicate notification-linked `push_queue` rows; this must be inspected on staging as part of the pre-apply checklist.

Membership is evaluated live per batch, as required by the existing behavior: campus recipients come from `profiles` with the author's `university_id`, and club recipients come from current `club_members`. A later membership change can alter the live set; the UUID cursor provides deterministic forward progress, while the unique index makes any replay harmless.

## Retry, reaper, and failure recovery

Claiming a job changes it to `processing` without changing `attempts`. A batch error is caught per job, increments `attempts` once, and allows another job in the same tick to continue. A stuck processing job reaped for timeout also increments `attempts` once when it is requeued. The failed batch and cursor update roll back together; the last committed cursor remains intact. Before the next retry, the job is `pending` unless the failure brings `attempts >= max_attempts`, in which case it is `failed` with the truncated database error in `last_error`. Successful batches do not consume retry attempts, so a long job can span more than `max_attempts` successful batches.

The worker reaps `processing` jobs older than five minutes. A separate lightweight `notification-fanout-reaper` cron is intended to run every five minutes as an additional recovery path, but migration 102 does not enable either cron job automatically. Both schedules are enabled only as a separate deliberate step after the staging schema/signature checklist, pre-102 un-fanned-post review, and 50x500 burst measurement. The reaper requeues jobs below `max_attempts` and marks exhausted jobs `failed`. Failed jobs are not silently deleted and are visible through the service-role-only `notification_fanout_job_health` view for the Admin follow-up.

## Push preservation

The current registry has `notification_types.type = 'club_post'` with `push = true`, category `clubs`, and `in_app = true`. The active 089 `notifications_after_insert_push` AFTER INSERT trigger calls `enqueue_push()` for each inserted notification and then `invoke_push_dispatch()`; the existing one-minute `dispatch-push` cron remains the safety net. The 088 direct `enqueue_push()` call was removed by 089, so the canonical behavior is the notification trigger, not a second direct enqueue.

The async worker inserts only `notifications` rows and does not call `enqueue_push()` directly. Consequently, the existing push trigger continues to decide delivery using the notification registry, user preference, active token, hourly cap, collapse key, and dedupe key. It neither silently starts nor stops `club_post` push behavior. A staging run that shows no `push_queue` delta is explainable by no active push token, preference/cap suppression, or trigger/config drift; Claude must verify each explicitly. The worker's set-based insert will invoke the existing row trigger for newly inserted rows, so staging must also measure whether 500-row batches create acceptable pg_net/dispatch pressure.

## Admin Dashboard impact

The inspected `apps/web/lib/admin/**` paths show:

- `messagingData.ts` lists and details notifications generically and does not assume `club_post` is synchronous;
- `data.ts` uses notifications only for metadata search;
- `dataHealth.ts` checks missing notification recipients, but has no `type = 'club_post'` query and no `notification_fanout_jobs` query;
- notification actions only mark existing notification rows read/unread.

Therefore the existing dashboard does not break when notification rows arrive seconds later, and the new table does not affect any current read path. No `apps/web` file is changed in this proposal.

A small follow-up should add one read-only Data Health check using `notification_fanout_job_health`:

- critical: any `failed` job;
- warning: any stale `processing` job or `pending` job older than the agreed latency threshold;
- healthy: zero failed/stale/aged jobs;
- examples: job ID, post ID, status, attempts, age, and `last_error`, linking to the post where useful.

This is an observability addition, not a repair action. The migration creates the service-role-only view so the follow-up can be implemented without exposing job data to students.

## Cutover and backfill

The proposal drops `trg_photo_post_university_notify`, replaces `handle_club_post_notify()` with an enqueue implementation, and replaces the tag-trigger function with an enqueue implementation. `notify_photo_post_university()` and `notify_club_post()` remain as compatibility shims but no longer loop. All DDL and trigger replacement is transactional with the migration.

There is intentionally no automatic historical fan-out. Automatically enqueuing every old post could create unexpected old inbox alerts. Before the cron schedules are enabled, Claude must identify pre-102 posts with neither a job nor a canonical `club_post` notification. The stated production assumption is that there are no un-fanned posts that matter. If staging or production review finds an approved small set, insert jobs explicitly for that set with the direct and tagged club IDs, record the cutoff and reason, then allow the worker to drain them. Do not run a whole-table historical backfill by default.

## Rollback notes

This repository never runs down migrations. A rollback is a separately reviewed forward migration: first disable/unschedule both 102 cron jobs, preserve failed-job and duplicate-cleanup evidence, then restore the pre-102 function/trigger definitions from the reviewed 089/088 bodies if synchronous behavior is explicitly accepted. Removing the partial unique index or job table must be a separate decision because it would remove the new correctness guarantee. Restoring the old photo and club triggers without a dedupe plan would reintroduce the double-fire defect.

## What Claude must verify before this is applied to staging

- [ ] Review the proposal on the actual branch and confirm no file outside the requested SQL/doc deliverables is changed.
- [ ] Confirm the live signatures/owners of `posts`, `profiles`, `club_members`, `post_club_tags`, `notifications`, `notification_types`, `push_queue`, and the existing notification/push trigger functions match the SQL assumptions.
- [ ] Confirm the pre-102 `public.notify_club_post(p_post_id UUID, p_club_id UUID, p_author UUID)` signature and exact legacy copy (`<author> shared a new post in <club>.`, author fallback `A member`) before applying the replacement.
- [ ] Confirm migration 083's separate `notify_club_photo()` / `trg_club_photo_notify` (`AFTER INSERT ON club_photos`, officer uploads only) remains intentionally outside migration 102's scope.
- [ ] Query duplicate `club_post` rows by `(user_id, entity_id)` and inspect which row/message will survive cleanup; confirm any cascaded `push_queue` deletes are acceptable.
- [ ] Confirm `club_post` is still `push = true`, `in_app = true`, category `clubs`, and that `trg_notifications_push` points to the 089 immediate-dispatch function.
- [ ] Explain the staging no-push observation by checking active `push_tokens`, `notification_preferences`, hourly caps, existing push rows, and pg_net/dispatch logs.
- [ ] Confirm no pre-102 un-fanned posts matter. If any do, approve an explicit bounded backfill set and record its cutoff before enabling the cron worker.
- [ ] Apply only in a disposable/staging database first; do not run the proposal against production from this task.
- [ ] Verify a text-only non-club post creates no fan-out job or notification.
- [ ] Verify a non-photo club post creates one job, club recipients only, exact legacy club message text, and at most one `club_post` row per recipient.
- [ ] Verify a non-club photo post creates one job, same-campus recipients excluding the author, exact legacy photo message text, and no club rows.
- [ ] Verify a club-tagged photo post creates one job, the union of current club and campus recipients, exactly one row per distinct recipient, and deterministic club-copy precedence for overlap.
- [ ] Verify a tagged-only post appends its club to the existing post job rather than creating a second job.
- [ ] Kill/retry the worker after a notification INSERT but before cursor advancement; confirm no duplicate notification or push row is created and the cursor resumes correctly.
- [ ] Force a batch error, confirm `attempts` increments, `last_error` is populated, the committed cursor is preserved, and max-attempt exhaustion becomes `failed`.
- [ ] Leave a job in `processing` past five minutes and confirm both worker-start reaping and the separate reaper requeue/failed transition.
- [ ] Run the 50 × 500 burst on staging and measure actual drain time, per-tick rows, transaction duration, lock waits, cron overlap, pool utilization, notification latency, push_queue growth, and pg_net dispatch pressure. Recalculate the 5-minute bound from measured batch duration.
- [ ] Confirm Admin notification list/detail/search still work and add the separate read-only Data Health check for failed/stale/aged fan-out jobs before production rollout.
- [ ] Confirm no deployment, production change, or commit is part of this design task.
