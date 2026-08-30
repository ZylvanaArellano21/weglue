# Frontend rollout stack — commit → backend-dependency map

Branch: `claude/rollout-reliability-frontend` (11 commits on top of `main` `dc4228d6`).
Intended production scope: **the whole stack** (integrated reliability stack).

**Release rule (founder):** no frontend commit ships to production before its
required backend migration is live on production and verified. This document is
the gate.

Production migration ledger at time of writing: **001–098, 102** (099/100/101
and 103/104 are NOT on production).

## Per-commit map

| # | Commit | What it does | Backend surface it touches | Required migration | On prod? | Ship gate |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `5e6c1420` | Stop the unexpected logout — foreground-only token refresh, stale-link guard | GoTrue client behaviour only (`stopAutoRefresh`/`startAutoRefresh` on AppState; deep-link staleness guard). No DB. | none | — | ✅ clear |
| 2 | `37daec9f` | Cut steady-state auth/notification request load | `useUnreadSummary` poll interval widened; `registerPush` in-memory skip guard. No new DB calls. | none | — | ✅ clear |
| 3 | `b1cbd2b3` | Regression test for the unread-summary fallback poll | test + poll-knob constants. | none | — | ✅ clear |
| 4 | `158581d1` | Bounded transient-only retry for idempotent reads (`isTransientError`, react-query retry config) | client retry policy only. | none | — | ✅ clear |
| 5 | `57eb7123` | Jittered realtime reconnect backoff | `reconnectAfterMs` on the supabase realtime client config; `jitteredReconnectAfterMs` helper. Client-only. | none | — | ✅ clear |
| 6 | `bb8f4391` | client_tag write idempotency + identity-aware push token + join safety | **Inserts `client_tag` into `posts`, `events`, `post_comments` unconditionally**; resolves 23505 via the per-table `uq_*_client_tag` partial unique indexes. `joinClub` upsert on `club_members(club_id,user_id)` (index present on prod). `registerPush` identity guard (no DB). | **100** — `client_tag` columns on posts/events/post_comments + `uq_posts_author_client_tag` / `uq_events_created_by_client_tag` / `uq_post_comments_user_client_tag` | **NO** (all missing on prod — verified) | ⛔ **BLOCKED on 100** — without it, post/event/comment creation fails `column …client_tag does not exist` |
| 7 | `eec87771` | Multi-club post tags idempotent on the client_tag retry path | Refactors #6's `post_club_tags` upsert (`onConflict post_id,club_id`, index present) — but sits entirely on #6's client_tag insert path. | **100** (transitive) | **NO** | ⛔ **BLOCKED on 100** |
| 8 | `76cf8a4e` | RSVP + save are explicit desired-state, not blind toggles | `event_rsvps` upsert `{event_id,user_id,status}` — column `status` (CHECK `IN ('going','cant')`) and unique index `event_rsvps_event_id_user_id_key` **both present on prod**. `saved_events` upsert `{user_id,event_id}` — unique index present. Deletes for the "unset" path. | none (uses existing schema) | — | ✅ clear |
| 9 | `42cd0a4c` | Coalesce per-navigation `my_access_state` RPC + student-content invalidation | Reduces call frequency of the existing `my_access_state` RPC and the `sync:access:<uid>` broadcast — both already on prod. No new surface. | none | — | ✅ clear |
| 10 | `c889a162` | Claim-first password-reset cooldown + live countdown | `supabase.auth.resetPasswordForEmail` (GoTrue); AsyncStorage cooldown key. No DB. | none | — | ✅ clear |
| 11 | `1115cab4` | Realtime approach A/B/C — consolidate 4 → 2 always-on channels | **A** (notif channel merge): existing `notifications` table only — no dep. **B** (deletes `useRealtimeMessageBanners`; the foreground banner now comes from a `new_message` broadcast on `sync:message-inbox:<uid>`): needs the `messages` AFTER INSERT trigger to emit that event. **C** (my-clubs): unchanged. Also removes web `useMessagesRealtime`'s own `sync:message-inbox` subscription (the `invalidate` half is covered by 067, already on prod). | **103** — `new_message` emission added to `handle_message_push()`. Recommended alongside: **104** (conversation-size gate). | **NO** (prod `handle_message_push` is the 089 version — verified) | ⛔ **BLOCKED on 103** — without it, no foreground banner on an incoming message while the app is open (push + unread badge unaffected) |

## Bottom line

- **9 of 11 commits have no unmet backend dependency** and could ship today on their own.
- **The whole stack requires, on production first:**
  - **migration 100** (client_tag idempotency) — unblocks `bb8f4391` + `eec87771`
  - **migration 103** (message-banner broadcast) — unblocks `1115cab4`
  - **migration 104** (banner size gate) — strongly recommended to ship with 103 (see `migrations-102-103-staging-results.md`); not a hard code dependency of the frontend, but shipping 103 without it exposes the large-club-chat fan-out cost.
- **Not frontend blockers:** 099 (signup slimming) and 101 (storage/retention) — no commit in this stack touches their surface. They matter for ledger continuity, not for this release.
- **Already satisfied:** every other dependency (`event_rsvps.status`, the `onConflict` unique indexes, `my_access_state`, `sync:access`/`sync:message-inbox` `invalidate`, GoTrue) is live on prod.

## Release sequence for the whole stack

1. Apply + verify **100** on production → commits 6, 7 unblocked.
2. Apply + verify **103** (+ **104**) on production → commit 11 unblocked.
3. Then merge `claude/rollout-reliability-frontend` → `main` and deploy (web + `eas update` mobile JS). No native build required — all 11 commits are JS-only.

Migrations 100, 103, 104 are each their own founder decision and their own staging verification; this document only asserts the code dependency.
