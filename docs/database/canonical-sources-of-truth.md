# Canonical Sources of Truth + Denormalized-Data Inventory

The promise the Admin Dashboard must keep: **change once → update everywhere.**
That only works if every fact has exactly one canonical home, and every copy of
it is updated transactionally (or derived by trigger). This document is the map.

## Canonical source for each major fact

| Fact | Canonical location | Copies / mirrors that must stay in sync |
|---|---|---|
| Auth identity | `auth.users` (Supabase Auth) | `profiles.id` (FK, CASCADE). Email lives in `auth.users`; `reports.reporter_email` etc. are point-in-time captures. |
| Profile identity | `profiles` (1 row / user) | `club_officers.display_name`/`avatar_url` (roster copy), message/report captured fields. |
| Username | `profiles.username` | Historically embedded copies in captured rows (reports). Posts/messages join live — verify no denormalized username exists. |
| Email | `auth.users.email` (canonical) | `reports.reporter_email` (snapshot), `profiles.email_domain` (derived). Changing email is an **Auth admin** op, not a `profiles` update. |
| Profile picture | `profiles.avatar_url` | `club_officers.avatar_url` (roster). Messages/posts should join live — verify. |
| University | **`profiles.university_id` / `clubs.university_id`** (canonical, 042) | `profiles.university` / `clubs.university` (legacy **text mirror**, auto-maintained by `sync_university_name()` trigger). Change `university_id`; the text follows automatically. |
| Interests / activities | `user_interests` / `user_activities` (+ `club_interests`, `event_interests`, `event_activities`) | none (junction tables). |
| Gluemate relationship | `follows` (`follower_id`,`following_id`,`status`) | none. Reciprocity/one-sidedness is defined by rows — verify intended model. |
| Club identity/details | `clubs` | `conversations.name`/`avatar_url` for the club's chat (copy), event display strings. |
| Club membership | `club_members` (1 row / user·club) | `clubs.member_count` (**denormalized counter**, trigger-maintained). |
| Club role / officer **permission** | **`club_members.role = 'officer'`** | `club_officers` roster (display copy). See below. |
| Club president | **Not a distinct schema concept today** — verify how "president" is modeled (likely a `role`/`role_title` value). | — |
| Post content | `posts` | `club_photos` (image mirror for tagged posts, CASCADE-linked). |
| Comment content | `post_comments` | none. |
| Event details | `events` | `saved_events`/`event_rsvps` reference by id; messages `shared_event_id` reference (not copy). |
| RSVP status | `event_rsvps` (1 row / user·event) | any displayed RSVP totals must be **derived** from this table, not stored. |
| Conversation identity | `conversations` | — |
| Conversation membership | `conversation_participants` | `clubs.member_count` is unrelated; club chat membership must track club membership — verify sync. |
| Channel identity/perms | `conversation_channels` (+ `channel_posters` for who may post) | — |
| Message content | `messages` | `content_snapshot`/`attachment_snapshot` are **retention copies of deleted content**, intentionally divergent (frozen originals). |
| Poll / options / votes | `polls` / `poll_options` / `poll_votes` | vote tallies must be derived from `poll_votes`. |
| Report | `reports` (one canonical table) | report email is a notification, not a second store (reports doc). |
| Notification | `notifications` | `push_queue`/`push_tickets` are delivery pipeline, not identity. |
| Deleted state | per-entity soft-delete columns (`messages.deleted_at`; `club_photos.is_visible`) | **inconsistent across entities today** — see technical-debt. |
| Edit history | only `profiles.username_changed_at`/`email_changed_at` + message snapshots | no general history table (greenfield). |
| Admin audit | **does not exist** (greenfield). | — |

## Officer status — the important two-place representation

`is_club_officer(club_id)` (RLS/authorization everywhere) checks
**`club_members.role = 'officer'`**. That is the *only* thing that grants officer
permissions in the installed apps.

`club_officers` is a **separate cosmetic roster** shown on the club profile
("Officers" section): `display_name`, `role_title`, `avatar_url`,
`display_order`, and a **nullable** `user_id` (an officer can be listed without a
linked account). Editing `club_officers` does **not** change anyone's
permissions.

**Dashboard rule:** a "promote to officer" action must write
`club_members.role='officer'` (permission) via the existing `add_club_officer`
RPC pattern (033), and *may* additionally maintain the `club_officers` roster for
display. "Demote" uses `remove_club_officer` (038). Never edit one and assume the
other follows.

## Denormalized / duplicated / mirror values (inventory)

| Value | Kind | How it's kept correct today | Dashboard obligation |
|---|---|---|---|
| `clubs.member_count` | denormalized counter | trigger on `club_members` | Any admin add/remove member must go through paths that fire the trigger; provide an `admin_rebuild_derived_counts` verifier. |
| `profiles.university` / `clubs.university` (text) | mirror of `university_id` | `sync_university_name()` trigger | Only ever set `university_id`; never write the text directly. |
| `club_officers` roster | display copy of member+profile | manual / RPC | Keep in sync with `club_members.role` on role changes. |
| `reports.reporter_username` / `reporter_email` | point-in-time snapshot | captured at insert | Leave frozen; do not "fix" to current values. |
| `messages.content_snapshot` / `attachment_snapshot` | frozen deleted original | captured at delete | Founder-only retention; never expose to clients. |
| RSVP totals, poll tallies, unread counts | derived | computed / counter | Never treat a cached count as truth; derive from `event_rsvps` / `poll_votes`. |
| `onboarding_complete` vs `onboarding_completed` | **two columns, same concept** | **UNKNOWN sync** | Verify which is canonical before any write (open-uncertainties.md #2). |
| Legacy club-chat tables (006) | possibly-orphaned duplicate of the 040/041 system | — | Do not build on them; verify dead before cleanup. |

## Rule for the dashboard

For any admin write that touches a fact with copies/mirrors:
1. Write the **canonical** column only.
2. Let triggers propagate mirrors (`university`, `member_count`).
3. Where no trigger exists, update all copies **inside one SQL function
   (transaction)** so partial failure can't desync them.
4. Record the change in the (to-be-built) audit log.
5. Never introduce a *new* copy of an existing fact.
