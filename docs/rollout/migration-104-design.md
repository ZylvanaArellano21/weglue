# Migration 104 design: gate large-conversation message banners

Status: review-only. Migration 103 is applied on staging; this migration is
not applied, deployed, or committed. Claude owns the eventual commit and
staging apply after review. Migration numbering is continuous: the staging
ledger contains 102 and 103, so this change is 104.

## Change

Migration 104 replaces `public.handle_message_push()` with migration 103's
current body plus one conversation-size gate around the synchronous
`realtime.send(..., 'new_message', 'sync:message-inbox:<recipient>', true)`.
It resolves these values once before the recipient loop:

```sql
v_participant_count int := (
  SELECT count(*)
  FROM public.conversation_participants
  WHERE conversation_id = NEW.conversation_id
);
SELECT COALESCE((value #>> '{}')::int, 50)
INTO v_banner_max
FROM public.notification_config
WHERE key = 'banner.max_participants';
v_banner_max := COALESCE(v_banner_max, 50);
```

Only when `v_participant_count <= v_banner_max` does the existing nested
exception-guarded `realtime.send` execute. The `enqueue_message_push(...)`
call remains outside that conditional and runs for every eligible recipient.
The existing `PERFORM public.invoke_push_dispatch()` and outer exception guard
are unchanged.

## Confirmed configuration schema

The source definition in migration 046 is:

```sql
CREATE TABLE IF NOT EXISTS notification_config (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  description TEXT
);
```

Migration 104 seeds the knob without overwriting an operator value:

```sql
INSERT INTO public.notification_config (key, value)
VALUES ('banner.max_participants', to_jsonb(50))
ON CONFLICT (key) DO NOTHING;
```

The threshold is tunable without a redeploy or another migration. For example:

```sql
UPDATE public.notification_config
SET value = to_jsonb(75)
WHERE key = 'banner.max_participants';
```

The function also defaults to 50 if the row is absent. A malformed non-integer
value is not silently accepted; the existing outer function guard preserves
the message-trigger failure posture, but the review/apply checklist should
keep this server-only value numeric.

## Product behavior and tradeoff

With the default threshold of 50, DMs (`type = 'direct'`, normally two
participants) and small groups are always at or below the threshold and keep
the instant in-app banner. Normal-size club chats also remain on the instant
path. Large club member and officer conversations are the intended gated
cases; technically, any conversation whose participant count exceeds the
configured threshold is gated.

Above the threshold, the accepted product tradeoff is:

- The push notification path is unchanged. `enqueue_message_push(...)` still
  runs per eligible recipient, subject to its existing preference, cap, mute,
  dedupe, and token rules.
- The existing migration-067 `private.broadcast_message_sync()` invalidate
  event still fires for every participant on
  `sync:message-inbox:<uid>`. Badge/unread refresh and normal inbox recovery
  therefore remain available.
- The synchronous `new_message` event is omitted, so the foreground instant
  banner pop is omitted for that large conversation.

This deliberately favors writer latency and rollout stability over an instant
banner in very large chats. The client still learns about the message through
the invalidate/unread path and push content.

## Cost rationale

The evidence is in
`docs/rollout/migrations-102-103-staging-results.md`, from the full 001 → 103
staging chain:

- Migration 103 measured a single message to a 500-participant club chat at
  approximately 678 ms p50/p95, versus approximately 250–350 ms for the
  pre-103 INSERT. The roughly 400 ms increase came from up to 496 synchronous
  `realtime.send` calls after the sender/mute exclusions.
- At 500 participants × 10 concurrent senders, message-send p95 was 3,060 ms.
- At 500 participants × 50 concurrent senders, message-send p95 was 12,753
  ms (12.7 s). The cost scaled with participants × concurrent senders.

For a conversation above the gate, migration 104 removes those synchronous
`new_message` writes from the INSERT. Its message cost drops back to the
pre-103 shape: the existing `enqueue_message_push(...)` recipient loop plus
the existing migration-067 invalidate loop, with the existing one-time
dispatch call. The exact post-104 latency must be re-measured on staging; the
250–350 ms pre-103 single-message range is a baseline, not a new guarantee.

For conversations at or below the gate, the migration 103 behavior and cost
remain unchanged. The gate does not make push fan-out asynchronous and does
not alter migration 102's photo fan-out path.

## Idempotency and failure posture

The trigger still runs once per inserted message row, so the existing
idempotency contract is unchanged: one logical message row produces at most
one fan-out pass. The nested `BEGIN ... EXCEPTION WHEN OTHERS ... END` remains
around each `realtime.send`, and the outer function guard remains unchanged.

If an individual realtime send fails, its exception is swallowed as before;
the message INSERT, other recipient work, push enqueue, and invalidate path
are not rolled back by that send failure. Above the threshold there are simply
no synchronous `new_message` calls to fail. No RLS, trigger, push payload,
dedupe key, or client contract changes are included.

## Review and staging verification

Before applying, confirm the migration ledger is at 103 and that 102/103 are
unchanged. On staging, verify at minimum:

1. A two-user direct conversation and a small group still receive
   `new_message` with zero self-banner events.
2. A conversation at exactly 50 participants still receives the expected
   `new_message` events; a conversation at 51 does not receive them.
3. A large conversation still enqueues the same push rows and receives the
   existing 067 `invalidate` event for each eligible participant.
4. Parent-muted and channel-muted recipients remain excluded from push and
   banner fan-out as they were under 103.
5. Re-run the `message-fanout` matrix, including 500 × 50, and compare raw
   message-send p50/p95/p99, delivery counts, push-queue deltas, and
   `observations.snapshots[].pg.connection_totals` with the 103 results.

Nothing in this design note authorizes applying the migration, deploying it,
or changing the threshold in staging.
