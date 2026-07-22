# Known Technical Debt (verified from the repo)

Each item is confirmed from code/migrations. **Do not "clean up" any of these
without the full safety proof** (identify prod data + iOS/Android/web/RPC/trigger/
RLS/Realtime/storage deps → backup/rollback → prove backward compatibility → test
→ verify prod). Something being unused-looking is not permission to delete it.

1. **Stale generated types.** `packages/database/src/types.ts` predates several
   migrations (missing `reports`, `universities`, `app_config`, the 046
   notification tables, and newer columns). Anyone reading it as "the schema"
   will be wrong. *Fix:* regenerate from prod, diff, commit.

2. **Legacy club-chat tables — RESOLVED (not debt).** `club_channels`,
   `channel_messages`, `club_polls`, `club_poll_options`, `club_poll_votes` (the
   migration-006 system) were **explicitly `DROP TABLE … CASCADE`-ed in migration
   010:662–664** and are **absent from production** (REST → HTTP 404). Nothing to
   clean up; do not document as active. Kept here only to prevent re-flagging.

3. **Dual onboarding columns — CONFIRMED drift.** `profiles` has both
   `onboarding_complete` (003, legacy) and `onboarding_completed` (027, **declared
   canonical**; backfilled in 042:167). Confirmed live bug: web's final onboarding
   step `apps/web/app/onboarding/explore-clubs/page.tsx:253` writes the **legacy**
   `onboarding_complete`, while web middleware (`middleware.ts:83`), auth callback,
   and mobile all **read `onboarding_completed`**. Prod: **8 rows** with
   `onboarding_complete=false` + `onboarding_completed=true` (042 backfill
   artifact; harmless for routing today, but proves the columns are unsynced and
   the legacy column is stale). *Fix:* own security task — sync + web write fix +
   backfill; drop legacy column only in a future compatible release.

4. **Denormalized/mirror fields that must be written correctly:**
   - `profiles.university` / `clubs.university` (text) mirror `university_id` via
     `sync_university_name()` — never write the text directly.
   - `clubs.member_count` is a trigger-maintained counter — only mutate
     membership through trigger-firing paths; provide a rebuild verifier.
   - `club_officers` roster duplicates member+profile display data and is NOT the
     permission source.
   - `reports.reporter_username`/`reporter_email` are frozen snapshots — leave them.

5. **Deleted-message privacy NOT enforced (confirmed, high severity).**
   `messages` SELECT RLS is participant-only with **no `deleted_at` filter**
   (001:808), and `unsend_message` (040:177) sets `deleted_at`/`deleted_by`
   without nulling `content`/`attachment_url`. `messages` is in `supabase_realtime`
   (010:39) and attachments are re-signable. Result: any participant can retrieve
   deleted-message original content/attachment via PostgREST, Realtime, or a
   fresh signed URL (prod: 4 soft-deleted messages, all retaining `content`). The
   only *protected* retained copy is `reports.content_snapshot` for **reported**
   messages. Own security task (founder to choose the approach first).

6. **Legacy `delete_own_user_data()` still grantable.** The 016 non-atomic
   cleanup RPC is still `GRANT EXECUTE … TO authenticated` (016:144; search_path
   hardened 048:20) and was **not** revoked by 044. **No current code path calls
   it** (mobile/web deletion goes through the edge function → `delete_own_account_atomic`
   or the web admin `deleteUser` route). Residual risk only. Own security task.

7. **Admin Dashboard must not expose retained/deleted content before
   `platform_admins` + `current_admin_role()` exist.** Any founder-only view of
   snapshots/deleted content is blocked until the platform-admin authorization
   model is built.

8. **Inconsistent deletion model.** Only `messages` (soft-delete, *unprotected*)
   and `club_photos.is_visible` implement any hide. Posts/comments/events/clubs
   likely hard-delete. The brief wants a uniform Deleted Content capability — a
   planned, compatibility-reviewed expansion, not a quick change.

9. **Meeting schedule dual representation.** `clubs` has legacy
   `meeting_day/room/building/location/time_start/time_end` **and** newer
   `meeting_schedule` (JSONB). Confirm which the current clients read/write before
   editing meeting info in the dashboard.

10. **Migration history around 042–044 — reconcile before any new migration.**
    The branch `fix/supabase-migration-history-042-044` is **misnamed**: its
    commits are Android-camera/poll/sidebar work and `git diff main...branch` = 0
    files (main already contains them). It holds **no** reconciliation work — that
    still has to be produced. Statement/hash comparison of prod's applied 042–044
    vs the local files requires `supabase migration list` (founder-run link). Do
    not author 051+ until reconciled.

11. **No audit / edit-history / restrictions / platform-admin / blocks tables.**
    Not debt in the "broken" sense — greenfield — but noted so no one assumes they
    exist. The dashboard adds them additively.

12. **Reports moderation reachable only via service-role today.** Founder cannot
    read all reports through a normal session; the only all-reports access is the
    `service_role` RLS policy (used by the Edge Function). Replace with a
    platform-admin-gated path.

13. **Unmerged feature branches** carrying backend/behavior changes not on `main`:
    `web-club-experience`, `fix/android-camera-media-flow`,
    `fix/notification-read-semantics`, `perf/p0-app-wide-performance`,
    `fix/launch-blockers-batch-a`, `fix/recommendation-function-permissions`,
    plus the 042–044 fix branch. Know what's live vs. branch-only before backend
    work (see project memory / `git log` per branch).
