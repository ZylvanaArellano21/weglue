# Schema Map (true current state)

> **⚠️ `packages/database/src/types.ts` is STALE.** It was generated before
> several shipped migrations and is missing whole tables (`reports`,
> `universities`, `app_config`, the migration-046 notification tables, etc.) and
> newer columns. **Do not treat `types.ts` as the schema.** The authoritative
> source is `supabase/migrations/001–050`, cross-checked against the deployed
> database. Regenerating `types.ts` from prod is a recommended early task.

Derived by extracting every `CREATE TABLE` / `ADD COLUMN` from
`supabase/migrations/*.sql`. Where a column is a compatibility mirror or a
suspected-dead table, it is flagged.

## Table inventory (by domain)

### Identity & profile
| Table | Origin | Notes |
|---|---|---|
| `profiles` | 001 | `id` = `auth.users.id` (FK, ON DELETE CASCADE). Canonical user record. |
| `user_interests` | 001 | interests (CHECK-constrained taxonomy). |
| `user_activities` | 001 | activities (CHECK-constrained taxonomy). |
| `user_privacy` | 001 | `is_private`, `hide_events`, `hide_interests` (1:1 with profile). |

`profiles` columns of note: `username`, `full_name`, `avatar_url`,
`avatar_type`, `bio`, `major`, `year`, `email_verified`, `agreed_to_terms`,
`agreed_at`, `is_seed`. Added later: **`university_id`** (canonical, 042),
**`university`** (legacy free-text mirror), `email_domain` (042),
`picture_prompt_status` (042), **both `onboarding_complete` AND
`onboarding_completed`** (drift — see technical-debt), `username_changed_at`,
`email_changed_at` (partial identity edit-history).

### Social graph (Gluemates)
| Table | Origin | Notes |
|---|---|---|
| `follows` | 001 | `follower_id`, `following_id`, `status`. **This is the Gluemate/follow relationship.** There is **no separate blocks table** (see canonical-sources-of-truth.md). |

### Clubs
| Table | Origin | Notes |
|---|---|---|
| `clubs` | 001 | `member_count` (denormalized), `is_active`, `is_seed`, `claimed`, `last_activity_at`, `inactivity_warned_at`. `university` (legacy text) + **`university_id`** (canonical, 042). Meeting: legacy `meeting_day/room/building/location/time_start/time_end` + newer `meeting_schedule` (JSONB). |
| `club_members` | 001 | `role` (**free-text string**; `'officer'` value is the canonical permission source). One row per (user, club). |
| `club_officers` | 001 | **Display-only roster** (`display_name`, `role_title`, `avatar_url`, `display_order`, nullable `user_id`). NOT the permission source — see roles doc. |
| `club_goals`, `club_interests`, `club_photos`, `club_categories` | 001/012 | `club_photos.is_visible`, `.source` (e.g. `tagged_post`), `.post_id` (CASCADE from posts, 033). |
| `post_club_tags` | 022 | posts tagged into clubs; syncs into `club_photos`. |

### Events
`events` (001) — `visibility`, `specific_user_ids` (uuid[], visibility scoping),
`is_seed`, `created_by`, `club_id`. Plus `event_interests`, `event_activities`,
`event_rsvps` (`status`), `saved_events`.

### Posts & comments
`posts` (001) — `post_type`, `author_id`, `club_id`, `image_url`,
`linked_event_id`. `post_likes` (004), `post_comments` (004).

### Messaging — CURRENT system
| Table | Origin | Notes |
|---|---|---|
| `conversations` | 001 | `type` (dm / group / club member / club officer), `club_id`, `name`, `avatar_url`. |
| `conversation_participants` | 001 | membership + `last_read_at`. |
| `conversation_channels` | 001 | **subchannels** within a conversation. `is_default`, `is_restricted`. |
| `messages` | 001 | see payload columns below. |
| `polls`, `poll_options`, `poll_votes` | 001 | poll attached to a message via `polls.message_id`. |
| `message_hides` | 040 | **per-user, per-message** hide (`PK(message_id,user_id)`) — "delete-for-me" on one message; distinct from a conversation-wide delete. |
| `chat_invitations` | 040 | invite flow. |
| `channel_mutes`, `channel_reads`, `channel_posters` | 041 | per-channel mute/read state + who may post (`post_permission`). |

`messages` payload columns: `message_type`, `content`, `attachment_url` +
`attachment_mime/name/size`, `channel_id`, `shared_event_id` (CASCADE),
`shared_post_id` (CASCADE). **Soft-delete = `deleted_at`, `deleted_by` ONLY**
(040:35). `messages` has **no `hidden_at`** and **no** snapshot columns.
`hidden_at` is on **`conversation_participants`** (per-user inbox "delete-for-me",
040:86) and on **`message_hides`** (per-user per-message). The retention
snapshots `content_snapshot`/`attachment_snapshot` live on **`reports`**
(040:810, populated by `report_message()` at report time), **not** on
`messages`. Shared events/posts are **canonical references**, not copies — good.
⚠️ Note: `unsend_message` (040:177) sets only `deleted_at`/`deleted_by` and does
**not** null `content`/`attachment_url` — so a soft-deleted message still holds
its original text/attachment path (see deletion doc: this is not RLS-protected).

### Messaging — LEGACY (dropped in migration 010 — confirmed absent from prod)
`club_channels`, `channel_messages`, `club_polls`, `club_poll_options`,
`club_poll_votes` were the migration-006 club-chat system. They were **explicitly
`DROP TABLE … CASCADE`-ed in migration 010:662–664** and are **absent from
production** (REST returns HTTP 404). Do not document them as active; do not
build on them. Not debt, not drift — resolved.

### Notifications (migration 046 "complete notifications system")
`notifications` (001, simple) plus registry/pipeline tables:
`notification_types`, `notification_config`, `notification_preferences`,
`push_tokens`, `push_queue`, `push_tickets`, `social_proof_events`.
Notifications are **created by DB triggers only** (never client-side).

### Universities / config
`universities` (042, canonical), `app_config` (042, single-row single-campus
switch: `single_campus_mode`, `launch_university_id`),
`club_recommendation_batches` (042).

### Reports & moderation
`reports` (033) — one canonical table (see reports doc). Migration 040:810 adds
`message_id`, `conversation_id`, `conversation_type`, `message_type`,
`message_sender_id`, **`content_snapshot`**, **`attachment_snapshot`** — the
protected, unsend-proof moderation snapshot of a **reported** message, captured
server-side by `report_message()`. **No** restrictions, suspensions, audit-log,
edit-history, or platform-admin tables exist.

### Account lifecycle / infra
`deletion_requests` (016, deletion cooldown), `auth_probe_rate_limits` (027,
signup abuse throttle).

## What does NOT exist yet (greenfield for the dashboard)
- Platform-admin / super-admin roles (no `is_admin`, `app_role`, etc.).
- User account **restrictions / suspensions / timeouts** (only hard delete + the
  above).
- **Audit log** of admin actions.
- **Edit history** as first-class rows (only `*_changed_at` timestamps on
  `profiles`, plus `reports.content_snapshot` for reported messages).
- User-to-user **blocks**.
- A **soft-delete / hide** mechanism for posts, comments, events, clubs (only
  `messages` and `club_photos.is_visible` have one today).

## Enums / CHECK constraints (representative — verify full set against prod)
Roles and statuses are largely **TEXT + CHECK**, not Postgres enums:
- `reports.entity_type` ∈ {club, event, post, user, message, chat}
- `reports.status` ∈ {pending, reviewing, resolved, dismissed}
- `club_members.role` — free text; `'officer'` is authorization-significant.
- `event_rsvps.status`, `follows.status`, `conversations.type`,
  `messages.message_type` — TEXT; enumerate exact allowed values from migrations
  before building filters (open-uncertainties.md).
