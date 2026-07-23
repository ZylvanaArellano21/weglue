# Migration Status

Migrations live in `supabase/migrations/` and are the **only** sanctioned way to
change the schema. No undocumented Supabase Studio edits (CLAUDE.md §5).

## Current range: 001 → 050 (applied to production)

| # | Name | Theme |
|---|---|---|
| 001 | initial_schema | All core tables + RLS + auth helpers |
| 002–005 | onboarding / web onboarding / home / email validation | onboarding + email gating |
| 006 | club_tab | **legacy** club chat: `club_channels`, `channel_messages`, `club_polls*` (later superseded — see debt) |
| 007–009 | signup trigger fix / before_user_created hook / year | auth hardening |
| 010–015 | message tab / unread / search / discovery / calendar / seed categories | features + indexes |
| 016 | account_deletion_and_cooldowns | `deletion_requests` |
| 017–021 | categories remap / discovery / image uploads / avatars policy / zero-byte cleanup | storage + discovery |
| 022 | post_club_tags_sync | `post_club_tags` + club_photos sync |
| 023 | share_messages_and_club_leave_cleanup | shared-content messages |
| 024 | performance_indexes | indexes |
| 025 | fix_chat_channels_and_messages_rls | RLS recursion fix (SECURITY DEFINER helpers) |
| 026 | profile_privacy_interests_recs | `user_privacy` behavior |
| 027–028 | auth_signup_hardening / replace_pending_signup | `auth_probe_rate_limits`, re-signup RPCs |
| 029–030 | event_visibility_and_leave_club / specific_user_ids backfill | event visibility RLS + race-safe leave |
| 031 | notifications_system | trigger-driven notifications v1 |
| 032 | fix_leave_club_officer_count | `FOR UPDATE` officer-count fix |
| 033 | reports_deletion_chat_sync_schedule | **`reports` table**, deletion-integrity FKs, `add_club_officer` |
| 034–035 | club_members update policy / officer chat channels | RLS + officer chat |
| 036 | club_officers_unique | uniqueness on officer roster |
| 037 | club_photos_officer_visibility | `club_photos.is_visible` |
| 038–039 | club sync/tag removal/joins/reports / photo removal never deletes posts | `remove_club_officer`, cascade fixes |
| 040 | messaging_overhaul | shared ConversationThread model; message **soft-delete + report snapshots** (snapshot cols on `reports`, not `messages`), `message_hides`, `chat_invitations` |
| 041 | club_conversation_hub | `channel_posters/mutes/reads`, post permissions |
| 042 | single_campus_and_club_recommendations | **`universities`, `app_config`, `university_id`**, `sync_university_name()` |
| 043 | fix_duplicate_signup_trigger_and_survey_uniqueness | signup/survey fixes |
| 044 | atomic_account_deletion | `delete_own_account_atomic()` (cascade via `auth.users`) |
| 045 | lock_down_internal_recommendation_functions | privilege lockdown |
| 046 | complete_notifications_system | registry + push pipeline tables |
| 047 | microsoft_oauth_onboarding | Azure provider onboarding |
| 048 | security_hardening_search_path | `SET search_path` hardening |
| 049 | realtime_club_content | Realtime for club content |
| 050 | realtime_interactions | deletion-safe private-Broadcast RSVP/like/comment realtime |
| 051 | deleted_message_privacy | **NOT DEPLOYED — awaiting Codex review + founder approval.** Deleted-message privacy foundation (v9): `message_deletion_attempts`, `message_attachment_map`, `deleted_message_history`, `data_health_diagnostics`, `report_evidence`; message/poll SELECT RLS require `deleted_at IS NULL`; secure `unsend_message` (B2) + deletion/worker/restore/purge RPCs; push provenance + scrub; `deleted-message-retention` bucket. Validated locally (62/62 tests). Branch `backend/deleted-message-privacy`. |

## The 042–044 reconciliation note — ✅ RECONCILED (2026-07-23)

**Verdict: RECONCILED.** Statement-level comparison of prod's *stored applied
SQL* against the committed local files closed the long-standing uncertainty.

Evidence (all read-only; zero prod writes; no `migration repair`):
- Pulled the full applied history from `supabase_migrations.schema_migrations`
  via the Management API (`POST /database/query`, project ref
  `yoozrnosmqtaiksgcixc`): all **50** versions 001→050 applied; every
  version+name matches local filenames (whole-range `diff` = empty — no gaps,
  extras, or name drift).
- Pulled the stored `statements[]` for 042/043/044, normalized both sides
  (stripped comments + whitespace + separators), and diffed:
  **042/043/044 are byte-identical (normalized) to the committed files.**
- Local provenance: 042/043 from commit `e4f9acb1`, 044 from `53a88cfd`; working
  tree == HEAD. Local SHA-256: 042 `0b6dad5b…`, 043 `f633dc02…`, 044 `f9d81c35…`.
- ⚠️ The branch `fix/supabase-migration-history-042-044` remains misnamed —
  `git diff main...that-branch` = **0 files**; it holds no reconciliation work.

**Next valid migration number = 051** (now authored — see below).
No `supabase migration repair` is warranted (no mismatch exists).

## How to verify prod vs. files
- Pull the applied migration list from prod (`supabase migration list` against the
  linked project, or query the migrations history table via the Management API).
- Regenerate `packages/database/src/types.ts` from prod and diff against the
  committed (stale) copy to surface every table/column the types are missing.
- For RPC/trigger/RLS/storage parity, dump `pg_proc`, `pg_trigger`, `pg_policies`,
  and `storage.policies` from prod and compare to migration DDL.

## Migration discipline (enforced)
- One migration task active at a time (no competing migrations).
- Every migration documents: purpose, schema Δ, data Δ, current-client
  compatibility, risk, rollback (and whether rollback loses data), verification
  queries, prod checks. (See operations/agent-collaboration-protocol.md.)
- Sequence: Inspect → Plan → local migration → tests → review → controlled deploy
  → prod verification → docs update.
