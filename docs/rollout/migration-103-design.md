# Migration 103 design: private message-banner broadcast

Status: proposal for review only. Nothing in this document or `103_message_banner_broadcast.sql` has been applied. The migration is intended for branch `codex/rollout-reliability-backend`; Claude owns the eventual commit.

## Change and source definition

Migration 103 replaces `public.handle_message_push()` with the full latest definition from `supabase/migrations/089_immediate_push_dispatch.sql:164-220`. It preserves the existing early returns, one-time sender/preview/conversation resolution, mute filters, `enqueue_message_push()` payload, one post-loop `invoke_push_dispatch()`, trigger, and exception guard. The only addition is a `realtime.send(..., 'new_message', 'sync:message-inbox:<recipient>', true)` immediately after the existing push enqueue.

No new lookup is performed per recipient. The payload reuses `v_sender`, `v_preview`, `v_conv`, and `v_is_channel`; `channel_id` is present only when the already-resolved channel is a hashtag channel. Main and officer chats therefore carry `NULL`.

The existing `realtime.messages` SELECT policy from migration 067 remains sufficient. `private.can_receive_message_sync()` authorizes `sync:message-inbox:<uuid>` only when `auth.uid()` is that UUID and `current_student_can_access_app()` is true. No RLS change is needed. The existing `private.broadcast_message_sync()` and its `invalidate` event are unchanged.

## Idempotency and failure recovery

The AFTER INSERT trigger runs once for each message row. The existing client-tag write contract (the messages client-tag uniqueness from the messaging migrations, carried forward with the migration-100 idempotent-write rollout) makes retries of one logical message resolve to one row, so it emits at most one event per recipient. If a duplicate broadcast is ever observed, `buildMessageBanner` and the banner UI dedupe by message ID, making it harmless.

The new send is inside the function's existing `EXCEPTION WHEN OTHERS` guard, with a nested guard around the send itself so PostgreSQL exception rollback cannot undo a push enqueue or stop the remaining recipients. A `realtime.send` failure is swallowed: the message INSERT and push path still succeed, while that recipient may recover through the existing five-minute unread-summary poll and reconnect/refetch path. This preserves the failure posture of `private.broadcast_message_sync()` in migration 067 while making the existing push loop failure-isolated.

## Fan-out cost and load-test requirement

For a 500-member club MEMBER chat, one sender leaves at most 499 recipients before mute/channel-mute exclusions. Migration 103 therefore adds up to 499 synchronous `realtime.send` calls, each inserting one row into `realtime.messages`, inside the message INSERT statement. The existing 067 `invalidate` loop still runs independently on the same topic, so the total Realtime-message fan-out remains roughly 500 existing invalidates plus up to 499 new banner events.

This is an O(N) database-side cost, not a measured latency result yet. Migration 102 measured the old synchronous notification loop at approximately 1.5 ms per recipient; using that only as a planning proxy gives roughly 0.75 s for 499 recipients, but `realtime.send` must be measured directly. The coordinated `weglue-lt` / `codex/rollout-reliability-loadtests` run must add message cases alongside migration 102's 100/300/500-member photo-fan-out matrix and record message post-INSERT p50/p95/p99, successful recipient/event counts, mute exclusions, transaction duration, connection/pool observations, and Realtime delivery. Do not apply either migration from this task.

The old path instead exposed a broad `messages` INSERT subscription to every other user's socket and made Realtime perform the messages SELECT-policy RLS evaluation for as many as 500 subscribers per message, followed by two client reads per delivered row. Migration 103 removes that broad subscription and its reads, but shifts a large club's cost into the writer's transaction. Recommendation: gate banner fan-out for large club MEMBER chats unless the coordinated load test shows the 500-member p95 remains within the rollout budget; keep DMs and small groups on the new path. If gated, retain the five-minute unread-summary/reconnect backstop and define the threshold from measured p95 rather than guessing it here.

## Scope and verification plan

Admin Dashboard impact is none: no Admin Dashboard path reads `message-banners`, and no current Admin path depends on this trigger's banner event.

Before applying in staging, run a two-session verification:

- A message sent by session A reaches only authenticated session B's `sync:message-inbox:<B>` socket through the private broadcast; it does not reach A or an unrelated session.
- Recipients equal `conversation_participants` minus the sender, muted participants, and channel-muted participants. Deleted/hidden messages and deleted/missing conversations emit neither push nor `new_message`.
- DM, group, main/officer club chat, hashtag channel, and all preview message types carry the expected payload. Hashtag channels carry `channel_id`; main/officer chats carry `NULL`.
- The existing `invalidate` event on the same inbox topic still fires alongside `new_message`, including for the existing deletion/read-sync paths.
- Retry the same client tag and verify one message row and no duplicate banner effect by message ID.
