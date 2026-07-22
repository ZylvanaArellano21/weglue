# Backend Architecture (Supabase)

Source of truth for the backend is `supabase/migrations/001–050` plus
`supabase/functions/`. This summarizes the moving parts the Admin Dashboard
depends on.

## Auth
- Supabase Auth (`auth.users`). Providers: email/password + **Microsoft OAuth**
  (Azure, migration 047). Education-email gating via `is_educational_email()` and
  the `before_user_created` **hook** (008/027) — signups are rejected in the hook,
  **never by raising in an `auth.users` trigger** (GoTrue masks trigger
  exceptions as opaque 500s; this is a hard-won rule — see project memory).
- `profiles.id` FKs `auth.users.id` **ON DELETE CASCADE** — deleting the auth
  user tears down the whole profile graph. This is how atomic account deletion
  works (044).
- Signup abuse throttling: `auth_probe_rate_limits` (027).

## Functions / RPCs (from `types.ts` + migrations — non-exhaustive)
Authorization helpers (all `SECURITY DEFINER STABLE`, used inside RLS):
- `is_club_member(p_club_id)` — `club_members` membership.
- `is_club_officer(p_club_id)` — `club_members.role = 'officer'` (**the officer
  permission source**).
- `is_channel_club_officer(p_channel_id)`, `is_conversation_participant(p_conv_id)`.

Mutations / operations (SECURITY DEFINER RPCs — the pattern the dashboard should
extend with `admin_*` functions):
- `add_club_officer(club_id, user_id, role_title)` (033),
  `remove_club_officer(club_id, user_id)` (038).
- `leave_club(...)` (029/032 — race-safe, `FOR UPDATE` officer-count guard).
- `get_or_create_direct_chat(other_user_id)`, `mark_conversation_read(...)`,
  `cast_poll_vote(...)`.
- `delete_own_account_atomic()` (044) — SECURITY DEFINER, deletes `auth.users`,
  cascades. Called by the `delete-account` Edge Function.
- Discovery/recommendation: `get_discovery_clubs`, `get_discovery_people`,
  `search_discovery` (locked down in 045).
- `check_club_inactivity()` (scheduled).

> Full function/RPC/trigger enumeration against prod is a Codex onboarding task
> (`functions-rpcs-triggers.md` to be generated). Do not assume this list is
> complete.

## Triggers (representative)
- `handle_new_user` — creates `profiles` row on signup, sets
  `picture_prompt_status='pending'` for genuinely new accounts.
- `sync_university_name()` — mirrors `university_id` → legacy `university` text.
- `club_members` → `clubs.member_count` counter maintenance.
- `post_club_tags` → `club_photos` sync (022/033/038/039).
- Notification-generation triggers (031/046) — **all notifications are
  trigger-created; never insert notifications from a client.**

## RLS model
Every user-facing table has RLS enabled. The recurring patterns:
- **Own-row**: `USING (user_id = auth.uid())` (profiles update, reports
  insert/select, privacy, follows).
- **Membership/officer**: gated through the `is_club_member` /
  `is_club_officer` / `is_conversation_participant` SECURITY DEFINER helpers
  (avoids self-referential-policy recursion — see migration 025/032 lessons).
- **Service-role escape hatch**: e.g. `reports` has
  `FOR ALL TO service_role USING (true)`. Today this is the *only* way privileged
  code reads all reports. The dashboard will formalize this with a
  platform-admin check (see admin-dashboard.md) rather than shipping the
  service-role key.

**Deleted-content privacy is currently enforced by query/RLS conventions**, not a
single global rule. Verifying that deleted rows are invisible to ordinary clients
across every table is a required audit (deletion doc + open-uncertainties.md).

## Realtime
- `lib/realtime.ts` (both apps) — **never call `supabase.channel()` directly**;
  use `createSafeChannel` (unique-topic requirement, migration 032 lesson).
- 049 = realtime for club content; 050 = realtime for interactions (RSVP / like /
  comment) redesigned as **deletion-safe private Broadcast** with an auth bridge
  (most recent hardening, commits `65b984ff`→`2b21b37e`). Realtime payloads must
  not leak deleted content.

## Storage
Supabase Storage buckets for avatars / club images / covers / message
attachments. Policies were cleaned up in 019–021 (image uploads, avatars policy,
zero-byte cleanup). **Storage-policy enumeration against prod is a Codex task**
(`storage-map.md` to be generated); the dashboard's "purge media" and
"deleted-content" features depend on knowing exactly which buckets/paths hold
what and whether deleted-message attachments remain readable by URL.

## Edge Functions (`supabase/functions/`)
- `delete-account` — invokes `delete_own_account_atomic()`; the DB is
  authoritative so a function failure can't leave a ghost user (044).
- `send-report-email` — called by client **after** a `reports` row is inserted;
  reads `.from("reports")`, emails the founder via Resend
  (`RESEND_API_KEY`). Email is best-effort; the DB row is the source of truth.
- `send-push` — drains `push_queue` → APNs/FCM, records `push_tickets` (046).

## Scheduled jobs
`pg_cron`-style scheduling appears in 014/024/033/046 (inactivity checks,
notification maintenance). Enumerate the actual cron entries from prod during
onboarding.
