# Realtime load reduction — 50 active users

Status: **proposal**, awaiting founder approval of the approach. No code changed. The frontend half is Claude's; the one trigger is Codex's.

## The measured problem

Staging (`weglue-staging`, full 001–101 chain), 50/50 pre-warmed authenticated sessions, the **exact** We Glue client realtime topology, 5-minute measurement window, run both single-process and 5-process sharded:

| Realtime | p50 (all ops) | Throughput | DB conns | Active queries |
| --- | ---: | ---: | ---: | ---: |
| **ON** | 10–44 s | 437 ops / run | ~22 / 60 | 2 |
| **OFF** (`--no-realtime`) | ~180–325 ms | 1,239 ops / run | ~22 / 60 | 2 |

The database write path handles 50 concurrent active users fine (photo-fan-out separately drove 50 concurrent writers at p50 2.6 s). **The free-plan Realtime service does not.** 50 users × 4 always-on `postgres_changes` channels = **200 subscriptions**; the free-plan Realtime tenant has `connection_pool: 2` for RLS evaluation of every one of them on every change to a watched table. Under active write load (each like/comment/RSVP/chat produces a `notifications` INSERT) the RLS-eval queue never drains.

## The 4 always-on `postgres_changes` channels per user

From the session hub (`apps/web/app/providers.tsx` `useSessionRealtimeHub`, mobile `_layout.tsx`):

| # | Channel | Binding(s) | Purpose | Cost |
| --- | --- | --- | --- | --- |
| 1 | `notifications:<uid>` | `notifications` INSERT `user_id=eq` | foreground banner + `['notifications']`/`['unreadSummary']` invalidation + type-specific invalidations | user-filtered, cheap per row — but **redundant with #2** |
| 2 | `unread-summary:<uid>` | `notifications` INSERT `user_id=eq` **+** `notifications` UPDATE `user_id=eq` | badge invalidation; UPDATE = cross-device read sync | INSERT half **redundant with #1** |
| 3 | `message-banners:<uid>` | `messages` INSERT `filter: sender_id=neq.<uid>` | foreground banner for an incoming message; handler then does **2 follow-up reads** (`conversations` + `profiles`) per delivered row | **the expensive one** — `sender_id≠self` matches every other user's messages, so Realtime RLS-evaluates the `messages` SELECT policy per subscriber per message; plus 2 client reads per delivery |
| 4 | `my-clubs:<uid>` | `club_members` `*` `user_id=eq` | membership/permission invalidation | user-filtered, very low traffic |

Broadcasts (`sync:message-inbox`, `sync:block`, `sync:access`, `sync:university`) are cheap — server-authorized, exact-recipient, no per-subscriber RLS eval — and stay.

## Proposal

### A. Consolidate the redundant `notifications` INSERT subscription (frontend only, no migration)

`#1` and `#2` both bind `notifications` INSERT `user_id=eq.<uid>`. Merge into **one** channel:

- `useUnreadSummary` owns the single channel (it is the session-hub hook). Its INSERT handler does everything the current `#1` handler does: `publishNotificationInsert(row)`, invalidate `['notifications', uid]` + `['unreadSummary', uid]`, and the type-specific invalidations (`userProfile`/`ownProfile` on follow types; chat caches on `club_chat_added`/`officer_chat_added`/`officer_role`/…).
- Keep the UPDATE binding (cross-device read sync) on the same channel.
- `useNotifications` / `useRealtimeNotifications` **stops opening its own `postgres_changes` channel**. If it still needs to react to live inserts while its screen is open, it reads from the same `['notifications']` cache that the hub now invalidates.

Result: **4 channels → 3**, and 3 `notifications` bindings → 2 (1 INSERT + 1 UPDATE).

Files: `apps/mobile/hooks/useUnreadSummary.ts`, `apps/mobile/hooks/useNotifications.ts`, `apps/web/lib/hooks/useUnreadSummary.ts`, `apps/web/lib/hooks/useNotifications.ts`, plus the tests. Risk: low — same rows, same handlers, one subscription. The banner and every invalidation must be preserved exactly (regression tests).

### B. Replace `message-banners` `postgres_changes` with a server-authored broadcast (migration + frontend)

**Migration (Codex):** a `messages` AFTER INSERT trigger that, for each conversation participant except the sender, calls:

```sql
PERFORM realtime.send(
  jsonb_build_object(
    'message_id', NEW.id, 'conversation_id', NEW.conversation_id,
    'sender_id', NEW.sender_id, 'message_type', NEW.message_type,
    'preview', left(coalesce(NEW.content, ''), 140),
    'sender_name', <resolved once>, 'conversation_type', <resolved once>
  ),
  'new_message',
  'sync:message-inbox:' || participant.user_id::text,
  true   -- private
);
```

Resolve `sender_name` and `conversation_type` **once per INSERT**, not per recipient. Skip deleted/hidden. This is the same `sync:message-inbox:<uid>` topic the deletion-sync triggers (067/077/082) already publish `'invalidate'` on — we add a `'new_message'` event with a payload.

**Frontend (Claude):** `useRealtimeMessageBanners` drops the `messages` `postgres_changes` channel entirely and instead adds a `'new_message'` handler to the existing `sync:message-inbox:<uid>` broadcast subscription (currently only `useUnreadSummary` subscribes for `'invalidate'`). The handler builds the banner **directly from the payload** — no `conversations`/`profiles` follow-up reads. RLS is not bypassed: `realtime.send(..., true)` is a private broadcast and the trigger only sends to actual participants, which is a superset check of what the client could see anyway; the message row itself is still RLS-protected on every normal fetch.

Result: `#3` stops being a `postgres_changes` subscription (no per-subscriber `messages` RLS eval on the Realtime server) and the 2 follow-up reads per delivered message disappear. **4 always-on `postgres_changes` channels → 1** (`notifications` INSERT+UPDATE, user-filtered) + broadcasts.

Files: migration `NNN_message_banner_broadcast.sql` (Codex — next number after 102); `apps/mobile/hooks/useRealtimeMessageBanners.ts`, `apps/web/lib/hooks/useRealtimeMessageBanners.ts`, `apps/mobile/hooks/useUnreadSummary.ts` / `apps/web/lib/messages/hooks.ts` (wire the `'new_message'` handler), tests.

### C. `my-clubs` — leave as-is

`club_members` changes for a single user are rare (join/leave/role). Not worth a broadcast trigger. It stays as the one remaining low-traffic user-filtered `postgres_changes` binding.

## Expected effect

Per user: 4 always-on `postgres_changes` channels → 1. On the free-plan Realtime service that is a ~4× cut in the per-change RLS-evaluation fan-out, plus removal of the `message-banners` follow-up-read load. Re-run the 50-active A/B on staging after B lands — target: realtime-ON p50 back within a small multiple of the realtime-OFF ~200 ms.

## What Claude must verify before B is applied to staging

- The `messages` AFTER INSERT trigger sends to exactly the current participant set (`conversation_participants` minus sender), matching the RLS the old `postgres_changes` path delivered under.
- `realtime.send(..., private := true)` on `sync:message-inbox:<uid>` is delivered to that user's authenticated socket and no one else (two-session test).
- No banner regression: every message type still produces the right preview/title; a message in a conversation the user has muted/left does not.
- The deletion-sync `'invalidate'` events on the same topic still work alongside the new `'new_message'` event.
- Admin Dashboard: nothing reads `message-banners` or the trigger; the trigger adds per-INSERT work to `messages` — measure it in the fan-out load test.
