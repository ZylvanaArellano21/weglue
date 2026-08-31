# Rollout — final dependency & deployment-order review

Consolidates the migration state, the frontend reliability stack, and the
message-banner redesign into one ordered release plan. This is the gate
document for the eventual production/release approval.

Last updated after the hybrid-banner design rev 2
(`docs/rollout/hybrid-conversation-banner-design.md`).

> **Renumber note (2026-08-31):** production's migration ledger had independently
> reached `107` via two seed-club migrations (`106_seed_accounting_club_and_chess_president`,
> `107_seed_asap_club`). The two migrations these docs call **105** (hybrid
> conversation banner) and **107** (signup-survey reconciliation) were therefore
> renumbered for the production apply:
> - "migration 105" → file **`108_hybrid_conversation_banner.sql`**
> - "migration 107" → file **`109_signup_survey_reconciliation.sql`**
>
> Staging migrations `099`, `101`, `103`, `104` were staging-only exploration
> (`103`/`104` superseded by the hybrid banner; `099`/`101` never approved) and
> are **not** carried to `main` or production. Production ledger after this
> release: `… 098, 100, 102, 106, 107, 108, 109`.

---

## 1. Production state (verified this session)

| Item | Prod status |
| --- | --- |
| Migration ledger tail | `… 096, 097, 098, 100, 102` — **099 and 101 gaps** (branch-only; not blockers for this stack) |
| Migration 100 (`client_tag` write idempotency) | **APPLIED 2026-08-30.** `client_tag` cols + 3 partial unique indexes on posts/events/post_comments. Inert — no writer deployed. Admin Dashboard: verified, no update required. |
| Migration 102 (`async_photo_fanout`) | **APPLIED.** Both cron jobs (`notification-fanout`, `notification-fanout-reaper`) scheduled + active + healthy. Photo-post INSERT p95 12,000ms → 990ms at 500×50. |
| Migration 103 (`message_banner_broadcast`) | **NOT on prod.** Staging-only. Superseded by 105 (rev 2). |
| Migration 104 (`message_banner_size_gate`) | **NOT on prod.** Staging-only. Not approved as final behavior. Superseded by 105. |
| Migration 105 (`hybrid_conversation_banner`) | **NOT on prod.** Applied to staging 2026-08-31, benchmarked, sweep run. Pending production decision. |
| Migration 107 (`signup_survey_reconciliation`) | **NOT on prod.** Applied to staging 2026-08-31 (from the distributed-500-Auth hardening). Additive functions only; pending production decision. |
| `handle_message_push()` on prod | the **089** definition (no `new_message` broadcast) |
| `broadcast_message_sync()` on prod | the **067** definition (per-participant `invalidate` loop) |
| Frontend reliability stack | **NOT deployed / not merged.** `claude/rollout-reliability-frontend`, 12 commits on `main`. |
| BE-7 logout fix (`5e6c1420`) | code-complete on the FE branch; **physical-device QA outstanding.** |

---

## 2. The message-banner path: 103/104 → 105

**103 and 104 are staging-only and never bound for production.** They were the
iterative validation of the per-user Broadcast path and the size gate. The
founder rejected "`>N` participants = no banner" as permanent behavior.

**Migration 105** (`hybrid_conversation_banner`, design rev 2 — awaiting
approval + benchmark) is authored **standalone from the current production
definitions** (089 `handle_message_push`, 067 `broadcast_message_sync`). It
folds in everything 103 did (per-user `new_message` emission), replaces 104's
gate with the epoch/grace hybrid, and adds:

- `conversations.banner_broadcast_active` / `banner_epoch` /
  `banner_epoch_changed_at`
- `sync:message-inbox-conv:<conversation_id>:<banner_epoch>` topic +
  `can_receive_conv_banner()` auth + the `can_receive_message_sync` case
- `refresh_conversation_banner_state()` + the `conversation_participants`
  INSERT (row) / DELETE (statement) triggers
- `trg_conversation_mute_sync` (cross-device mute)
- `notification_config` keys `banner.broadcast_threshold` (T, from benchmark)
  and `banner.epoch_grace_seconds` (90)

Production ledger path for this work: **`098 → 100 → 102 → 105`.**

---

## 3. Frontend reliability stack — commit → dependency (revised)

Branch `claude/rollout-reliability-frontend`, 12 commits. **10 have no backend
dependency.** The two that do:

| Commit | Needs | Prod status of the dependency |
| --- | --- | --- |
| `bb8f4391` (client_tag write idempotency) + `eec87771` (multi-club tag on that path) | **migration 100** | ✅ **NOW ON PROD** — these two are unblocked as of 2026-08-30 |
| `1115cab4` (realtime A/B/C — banner from a `new_message` broadcast on `sync:message-inbox:<uid>`) | a `messages` trigger that emits `new_message` on the per-user topic | was 103; **now migration 105** (105's per-user path is byte-equivalent to 103 for `≤ T` / grace-window conversations) |

### New frontend work 105 requires (NOT yet on the branch)

The rev-2 design needs a frontend commit that does not exist yet:

- `packages/shared/src/messaging/messageBanner.ts` — `buildMessageBanner` mute-set args
- `apps/{mobile,web}` new `useConversationBannerChannels` hook + mount points
- `useUnreadSummary` — pass mute sets; `invalidate` also invalidates `['myChats']`
- `getMyChats` / `getMyConversations` — carry the three `banner_*` columns
- tests

This commit (call it **FE-13**) depends on **migration 105 live on the target
environment**. It ships in the same release as the rest of the stack.

---

## 4. Ordered release sequence

Nothing below happens without its own founder approval; this is the order, not
a request to proceed.

### Phase A — message-banner backend (blocks the banner frontend)

1. ✅ Founder approved hybrid design rev 2 (2026-08-30).
2. ✅ Benchmark on staging (`load-tests/src/hybrid-banner.ts`) → **T = 50, grace = 90 s** fixed from the data (design doc §Benchmark results).
3. ✅ Migration **105** written + applied to **staging** (`supabase db push --linked`, dry-run showed only 105) + verified + activation sweep run + regressed:
   - churn part — 0 removed-member leaks, 0 missed banners for retained members, statement-level bulk epoch bump, cross-device mute signal — all pass
   - matrix + ceiling parts — conv-scoped INSERT flat, ~500× fewer `realtime.messages` writes, 0 duplicate/leaked channels
   - 50-active regression — p50 at the no-realtime floor, no regression (a genuinely rested clean re-run for the p95 number is in progress)
   - 105 `CREATE OR REPLACE` cleanly overwrote 103/104's function bodies on staging (verified)
4. Founder approves **105 for production**. Apply to prod. Verify:
   - `banner_*` columns + defaults; all existing conversations `banner_broadcast_active = false`
   - `can_receive_message_sync` new case; `can_receive_conv_banner` grants
   - `handle_message_push` / `broadcast_message_sync` replaced from 089/067 with no other behavior change (diff each as one hunk)
   - triggers on `conversation_participants` (INSERT row, DELETE statement) + `trg_conversation_mute_sync`
   - `notification_config` keys present
   - push path (`enqueue_message_push`) byte-identical to 089
   - Admin Dashboard impact: **re-verify** (new columns on `conversations` — check Data Health checks + any `conversations.*` admin read)

### Phase B — frontend reliability stack (one release, web + `eas update` mobile JS)

Preconditions: **100 live** (done), **105 live + verified** (Phase A), **BE-7
physical-device logout QA passed**, `WE_GLUE_BEFORE_DONE_RULES.md` triple-check
clean.

5. Write + review **FE-13** (the 105 client work) on `claude/rollout-reliability-frontend`.
6. Re-point the dependency map: all 13 commits' deps now satisfied on prod.
7. Merge `claude/rollout-reliability-frontend` → `main`.
8. Deploy: web (`pnpm run deploy --branch production`) + mobile JS
   (`eas update --branch production` — **verify EAS fingerprint matches the
   shipped build** before relying on the OTA reaching users; per
   `project_email_eligibility_reverted` a layout-drift fingerprint mismatch
   sends the update to zero devices). All 13 commits are JS-only — **no native
   build required**.

### Not in this release

- Migrations **099** (signup slimming) and **101** (storage/retention) — no
  commit in this stack touches their surface. Ledger-continuity items, separate
  decisions.
- The client-tag **frontend** beyond `bb8f4391`/`eec87771` — those two are in
  the stack; there is no separate client-tag UI to ship.

---

## 5. Open items before the stack can be declared release-ready

| # | Item | Owner | Status |
| --- | --- | --- | --- |
| 1 | Founder approval of hybrid design rev 2 | founder | ✅ 2026-08-30 |
| 2 | Benchmark run → T + grace | Claude (staging) | ✅ T = 50, grace = 90 s |
| 3 | Migration 105 authored + staging regression | Claude authored; staging-verified | ✅ on staging, benchmarked, swept |
| 3b | Genuinely rested clean 50-active re-run (p95) | Claude (staging) | ⏳ in progress |
| 4 | FE-13 (105 client work) written + reviewed | Claude owns `apps/**`+`packages/**` | ☐ Phase B |
| 5 | Physical-device logout/session QA (BE-7 `5e6c1420`) | founder / device | ☐ Phase B |
| 6 | Subscription-ceiling benchmark (1…95 conv channels) | Claude (staging) | ✅ 0 dup/leaked; T = 50 confirmed comfortable |
| 7 | Network-topology matrix (6 cells) | Claude | ✅ 3 directly tested, 3 inferred; $0 GH Actions path for cell 2 pending founder call |
| 8 | `WE_GLUE_BEFORE_DONE_RULES.md` triple-check on the merged stack | Claude | ☐ pre-release |
| 9 | EAS fingerprint parity check for the mobile OTA | Claude | ☐ Phase B deploy |
| 10 | Staging cleanup: delete `~/.config/weglue-staging/staging.env`; reconcile the missing 104/105… staging ledger rows | Claude | ☐ after all staging testing (105 IS in the staging ledger; 104 row still missing) |

---

## 6. Rollback posture

- **100** (on prod): additive columns + partial indexes, no writer. Rollback =
  drop 3 indexes + 3 columns; zero data impact while inert.
- **102** (on prod): rollback documented in the migration; the synchronous
  fan-out triggers were replaced by enqueue shims — reverting needs the 083-era
  trigger bodies restored + cron unscheduled. Monitored; healthy.
- **105** (planned): `handle_message_push` / `broadcast_message_sync` revert to
  089/067 by re-applying those definitions; `banner_*` columns can stay (inert
  once the functions ignore them) or be dropped; triggers dropped;
  `notification_config` keys deleted. A conversation mid-grace at rollback
  simply falls back to the 089 no-broadcast behavior (push + badge unaffected).
- **Frontend stack**: JS-only — roll back by re-deploying the previous web
  build + `eas update` the previous mobile JS bundle.
