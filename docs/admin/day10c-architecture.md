# Day 10C — Content lifecycle architecture

**Scope:** posts, post comments, events — removal, restoration, permanent purge.
**Branch:** `safety/content-lifecycle`
**Migration:** `061_content_lifecycle.sql`
**Status:** design + implementation. Nothing applied to Production. `ADMIN_WRITES_ENABLED` stays `false`.

Day 10C does **not** implement report adjudication (10D), synchronization parity (10E), or
deleted-message privacy (10F).

---

## 0. Production baseline — verified, not assumed

Queried live against the Production database (read-only, Management API) on 2026-08-01:

```
060  restriction_enforcement_hotfix          ← ledger tip
059  messages_web_security_and_suggestions
058  admin_restrictions
057  student_blocking
056  atomic_admin_mutations
055  durable_admin_audit
054  atomic_last_officer_protection
053  platform_admin_accounts
052  complete_account_deletion
050  realtime_interactions                   ← 051 absent, as required
```

`061` is unused. No renumbering is required. Migrations `054`–`060` are untouched by this branch.

Production content volumes at audit time: 25 posts, **0 comments**, 25 events, 5 likes,
14 RSVPs, 14 reports, 13 club photos, 15 messages carrying a shared post/event.

---

## 1. Phase 1 — current-state audit

### 1.1 What the schema actually is (several prompt assumptions were wrong)

The prompt anticipated a richer content model than exists. These were checked against the live
schema, and the design below follows the **real** schema:

| Prompt assumed | Reality in Production |
|---|---|
| Comment parent/child reply chains | `post_comments` has **no `parent_id`**. Comments are flat. |
| Comment likes | **No comment-likes table exists.** |
| Comment media | `post_comments` is `(id, post_id, user_id, content, created_at)` — **text only**. |
| Comment edit history | **No UPDATE policy** on `post_comments`. Students cannot edit comments at all. |
| `weglue.app/post/[id]` and `/event/[id]` public routes | **Do not exist.** There is no public post or event route on web. |
| Open Graph metadata for content | The only `openGraph`/`generateMetadata` in the web app is `app/admin/layout.tsx`. **No social previews for content exist.** |
| Event recommendation records | Recommendations are **club**-scoped (`club_recommendation_batches`). There is no per-event recommendation table. Events surface through `get_discovery_events`. |
| Post shares table | No shares table. "Sharing" is `messages.shared_post_id` / `shared_event_id`. |
| `user_activities` as profile activity log | It is a **taxonomy** table (`user_id`, `activity`) — an interest list, not an activity feed. |

Consequences for Day 10C, stated plainly:

* The **comment reply rule (Phase 6) is moot** — there are no replies to govern. It is still
  decided and documented in §6.3 so the rule is unambiguous the day threading ships.
* **Phase 16 (deep links / public fallback / Open Graph) has no existing surface to harden.**
  There is nothing today that leaks a removed post or event to the public web, because nothing
  serves them publicly. This is recorded as a *finding*, not silently skipped — see §14.
* Comment purge never needs to preserve a structural tombstone for replies (§6.4).

### 1.2 Foreign keys and cascades (live)

```
posts.author_id      → profiles     ON DELETE CASCADE
posts.club_id        → clubs        ON DELETE CASCADE
posts.linked_event_id→ events       ON DELETE SET NULL
post_comments.post_id→ posts        ON DELETE CASCADE
post_comments.user_id→ profiles     ON DELETE CASCADE
post_likes.post_id   → posts        ON DELETE CASCADE
post_club_tags.post_id→posts        ON DELETE CASCADE
club_photos.post_id  → posts        ON DELETE CASCADE
events.club_id       → clubs        ON DELETE CASCADE
events.created_by    → profiles     ON DELETE CASCADE
event_rsvps.event_id → events       ON DELETE CASCADE
event_activities/event_interests/saved_events → events ON DELETE CASCADE
messages.shared_post_id  → posts    ON DELETE SET NULL
messages.shared_event_id → events   ON DELETE SET NULL
```

`reports` links to content **polymorphically with no FK** (`entity_type`, `entity_id`), where
`entity_type ∈ (club, event, post, user, message, chat)`. A hard delete of a post therefore
**orphans its report silently** — the report row survives pointing at a vanished id. This is an
existing weakness that Day 10C's removal model fixes by never hard-deleting.

`reports.content_snapshot` / `attachment_snapshot` exist but are **message-specific** (populated
alongside `message_id`, `message_sender_id`). **No evidence snapshot exists for post, comment or
event reports.** This is the single most important report/evidence finding — see §11.

### 1.3 Triggers on content (live) — why lifecycle state must not live on the entity rows

```
events        BEFORE DELETE  trg_event_canceled_notify         → notifies RSVP'd students
events        AFTER  DELETE  trg_event_deleted_notifications
events        AFTER  UPDATE  trg_event_updated_notify          → field-guarded (date/time/location)
events        BEFORE UPDATE  trg_events_updated_at             → bumps updated_at UNCONDITIONALLY
events        AFTER  INSERT  trg_new_event_notify, trg_event_club_activity
posts         AFTER  INSERT  trg_club_post_notify, trg_post_tagged_club_photo
post_comments AFTER  INSERT  trg_post_comment_notify
post_comments AFTER  I/U/D   trg_broadcast_post_comment        → realtime broadcast
post_likes    AFTER  I/U/D   trg_broadcast_post_like           → realtime broadcast
event_rsvps   AFTER  I/U/D   trg_broadcast_event_rsvp          → realtime broadcast
```

Three consequences drive the schema decision in §2:

1. **Hard delete notifies students.** `trg_event_canceled_notify` fires `BEFORE DELETE`, so
   deleting an event tells everyone who RSVP'd that it was cancelled. Administrator removal must
   therefore never be a `DELETE`.
2. **Any UPDATE on `events` bumps `updated_at`** via `trg_events_updated_at`, which is
   unconditional. A lifecycle column on `events` would silently re-order "recently updated"
   surfaces on every remove/restore.
   (`trg_event_updated_notify` *is* field-guarded to date/time/location, so it would not fire —
   stated precisely rather than overclaimed.)
3. **`public.events` is in the `supabase_realtime` publication.** Writing a lifecycle column on
   `events` broadcasts a row change to every subscribed client. A separate table that is *not*
   published broadcasts nothing.

### 1.4 Student read paths (all of them)

Feeds, profile, club and detail reads are **direct PostgREST table queries**, not RPCs
(`apps/mobile/services/postService.ts`, `eventService.ts`, and the mirrored `apps/web/lib/hooks/*`).
That is good news: for these paths **RLS is the single enforcement point**.

The exceptions — `SECURITY DEFINER` functions that read content and therefore **bypass RLS
entirely** — are the real risk surface:

| Function | Reads | Reachable by | Lifecycle action required |
|---|---|---|---|
| `get_discovery_events__inner` | `events` | student (via 058 wrapper) | **must filter** |
| `private.can_receive_post_interaction` | `posts` | realtime authorizer | **must filter** |
| `private.can_receive_event_interaction` | `events` | realtime authorizer | **must filter** |
| `process_event_reminders` | `events` | service_role cron | **must filter** (also leaks title into push copy) |
| `notification_push_copy` | notifications | service_role | must not resolve removed payload |
| `remove_post_from_club__inner` | `posts` | student officer | must refuse on removed posts |
| `delete_club_photo_everywhere__inner` | `posts` | student officer | must refuse on removed posts |
| `get_discovery_clubs__inner` | `events` (activity only) | student | verified: exposes no event payload |
| `search_discovery__inner` | clubs/students only | student | **no content exposure** — verified |

`post_club_tags` carries `SELECT USING (true)` for role **`public`** (i.e. including `anon`).
It exposes only `(post_id, club_id)` pairs, no payload — but it is an existing anon-readable
surface and is tightened in §5.

### 1.5 Deletion paths that exist today

| Path | File | Behavior |
|---|---|---|
| Author deletes own post | `apps/mobile/services/profileService.ts:281` | hard `DELETE` |
| Officer deletes own event | `apps/mobile/services/eventService.ts:455` | hard `DELETE` |
| Officer deletes own event (web) | `apps/web/lib/hooks/useEventDetail.ts:173` | hard `DELETE` |
| Officer un-glues a post from a club | `remove_post_from_club` RPC | clears tag; post survives |
| Administrator | — | **no removal capability exists at all today** |

Comments have a `DELETE` RLS policy (`post_comments: users delete own`) but **no UI path calls it**.

### 1.6 Storage

| Bucket | Public | Used by |
|---|---|---|
| `posts` | **yes** | `posts.image_url` **and** `events.cover_image_url` **and** some `club_photos.url` |
| `club-photos`, `club-avatars`, `club-covers`, `avatars` | yes | clubs / profiles |
| `chat-attachments` | no | messages (out of Day 10C scope) |

Two facts that shape purge:

* **Posts and events share the `posts` bucket.** Uniqueness of an object must be checked across
  `posts.image_url`, `events.cover_image_url` **and** `club_photos.url` — never within one table.
* **20 of 25 posts and 9 of 13 club photos point at `picsum.photos`** (seed data). These are not
  Supabase objects and cannot be deleted. Purge must skip non-Supabase URLs rather than fail.

`public.storage_path_from_public_url(p_url, p_bucket)` already exists in Production and is the
authoritative path deriver — purge uses it rather than parsing URLs in TypeScript.

### 1.7 Current-state lifecycle matrix

| | **Post** | **Comment** | **Event** |
|---|---|---|---|
| Current deletion method | hard `DELETE` by author | RLS allows self-delete; no UI | hard `DELETE` by officer |
| Current restore capability | **none** | **none** | **none** |
| DB dependencies | likes, comments, club_tags, club_photos, messages.shared_post_id (SET NULL) | none (leaf) | rsvps, saved_events, activities, interests, posts.linked_event_id (SET NULL), messages.shared_event_id (SET NULL) |
| Storage dependencies | `posts` bucket object (shared w/ events + club_photos) | none | `posts` bucket object (shared) |
| Student exposure paths | home feed, club feed, profile grid + viewer, post detail, comments screen, club photos, shared message preview, realtime post topic | comments screen, comment count | discovery, club events, calendar, saved events, event detail, shared message preview, realtime event topic |
| Admin exposure paths | `/admin/posts`, `/admin/posts/[id]` | `/admin/comments`, `/admin/comments/[id]` | `/admin/events`, `/admin/events/[id]` |
| Notification paths | `club_post`, `post_like`, `post_comment`, `post_club_tag` | `post_comment` | `new_event`, `event_updated`, `event_canceled`, 3 reminders, `event_last_chance` |
| Realtime paths | `post:<id>` private broadcast (likes/comments) | via post topic | `event:<id>` private broadcast (RSVPs) + `events` in publication |
| Report/evidence deps | `reports.entity_type='post'`, **no snapshot** | reports cannot target a comment (`entity_type` CHECK has no `comment`) | `reports.entity_type='event'`, **no snapshot** |
| Existing security risks | hard delete orphans reports; delete notifies nobody but destroys evidence | none (no path) | hard delete **notifies students it was cancelled** and destroys evidence |
| Proposed correction | lifecycle-governed remove/restore/purge | same | same |

> **Note:** `reports_entity_type_check` permits `club, event, post, user, message, chat` — **not
> `comment`**. A comment cannot be reported today. Comment purge therefore has no report/evidence
> blocker, and Day 10D will need to add `comment` to that CHECK if comment reporting is wanted.

---

## 2. Phase 2 — canonical lifecycle model

### 2.1 One source of truth: `public.content_lifecycle`

A **single administrator-only table** holds lifecycle state for all three entity types.

**Why not columns on `posts` / `post_comments` / `events`:**

1. `events` is in the realtime publication — a column write broadcasts to every client (§1.3).
2. `trg_events_updated_at` bumps `updated_at` on any UPDATE, re-ordering product surfaces.
3. The internal reason must never sit in a student-readable row. A table with **zero RLS
   policies** (the 055/058 posture) is structurally incapable of leaking it; a column on `posts`
   is one policy mistake away from exposure.
4. One table means one transition function, one purge queue, one concurrency model and one test
   suite instead of three of each.

**Absence of a row means `active`.** Only content that has left `active` at least once has a row,
so the table stays a vanishing fraction of all content — the same posture 058 uses for
`account_restrictions`. A restored item keeps its row (state back to `active`) so restoration
history survives.

### 2.2 States

| State | Student reads | Student interaction | Payload | Restorable |
|---|---|---|---|---|
| `active` | yes (normal permissions) | yes | intact | n/a |
| `removed` | **no** | **denied** | intact, admin-visible | **yes** |
| `purge_pending` | **no** | denied | intact but doomed | **no** |
| `purge_failed` | **no** | denied | intact but doomed | **no** |
| `purged` | **no** | denied | irreversibly redacted | **no** |

`purge_pending` and `purge_failed` are deliberately *identical* from the student's side. Only the
administrator sees the difference, and only as a sanitized failure code.

### 2.3 Transition model

Valid:

```
active        → removed          admin_tx_content_remove
removed       → active           admin_tx_content_restore
removed       → purge_pending    admin_tx_content_request_purge
purge_pending → purged           finalize (worker)
purge_pending → purge_failed     worker failure
purge_failed  → purge_pending    admin_tx_content_retry_purge  (or worker retry)
```

Every other transition is rejected with an explicit code — never a silent success and never a
reinterpretation of the requested action:

| Attempt | Code |
|---|---|
| `active → removed` when already removed | `already_removed` |
| `removed → active` when already active | `not_removed` |
| `active → purge_pending` (skipping removal) | `invalid_transition` |
| `active → purged`, `purge_pending → active`, `purge_failed → active` | `invalid_transition` |
| `purged → *` (anything) | `already_purged` |
| restore once purge has begun | `purge_in_progress` |
| duplicate purge completion | `already_purged` (idempotent no-op, audited once) |

**Concurrency.** Every mutation takes `pg_advisory_xact_lock(hashtextextended('content_lifecycle:'
|| entity_type || ':' || entity_id, 0))` before reading current state — the exact mechanism 058
uses per account. Concurrent remove-vs-restore, restore-vs-purge and duplicate-purge therefore
serialize; the loser observes the winner's committed state and fails with a real code.

### 2.4 Where the internal reason lives

`content_lifecycle.internal_reason` (3–500 chars, `btrim`ed, whitespace-only rejected) plus the
durable `admin_audit_events.reason` from 055. The table has **zero RLS policies**, `FORCE ROW
LEVEL SECURITY`, and all DML revoked from `anon`, `authenticated` **and `service_role`** (the
058 lesson: Supabase default privileges grant service_role DML on every new public table, so an
explicit `REVOKE` is mandatory). Only the migration-owned `SECURITY DEFINER` functions write it.

### 2.5 Student visibility predicate

```sql
public.content_is_student_visible(p_entity_type text, p_entity_id uuid) RETURNS boolean
  -- STABLE, SECURITY DEFINER, search_path = ''
  -- TRUE unless a content_lifecycle row exists with state <> 'active'
```

It is `SECURITY DEFINER` because `content_lifecycle` has zero policies: a plain `NOT EXISTS`
subquery inside an RLS policy would be evaluated as `authenticated`, see **zero rows**, and
therefore always return "visible" — the removed content would stay visible. This is the single
most dangerous trap in the design and is covered by a dedicated test.

**Honest residual, documented rather than glossed:** the predicate must be `GRANT EXECUTE ... TO
authenticated`, because PostgreSQL evaluates RLS policy expressions with the caller's privileges.
A student who already holds a content uuid can therefore learn one bit — "this is not
retrievable" — which they also learn from the content being gone. They **cannot enumerate**: the
function takes an id and returns a boolean; it has no listing form, and `content_lifecycle` itself
is unreachable through PostgREST. It never reveals which state, who acted, or why. This is the
same class of id-scoped probe as the existing, shipped `users_have_block_relationship(p_a, p_b)`.

The alternative — an array-returning `hidden_content_ids()` in the 058 `restricted_user_ids()`
style — was **rejected** precisely because it *would* hand any student the complete list of
removed content ids. Enumeration resistance was preferred over InitPlan symmetry.

### 2.6 Purge orchestration

Database and Supabase Storage cannot share a transaction. The lifecycle row **is** the durable
job record (no second queue table to diverge from it), supported by
`public.content_purge_objects` which captures the exact storage objects at request time.

```
1. admin requests purge      (removed → purge_pending, one transaction)
     ├─ capture storage object paths into content_purge_objects
     │    derived from secured DB state via storage_path_from_public_url — never client input
     ├─ mark each object uniquely_owned = NOT EXISTS(another live entity referencing it)
     ├─ audit content.purgeRequested
     └─ payload NOT yet redacted
2. worker: audit content.purgeStorageAttempt
3. worker: delete only uniquely_owned Supabase objects (skip picsum/external)
4. worker: audit content.purgeStorageSuccess | purgeStorageFailure
5. success → finalize in ONE transaction:
     redact payload, delete dependents, purge_pending → purged, audit purgeCompleted
6. failure → purge_pending → purge_failed, sanitized code, retry available
7. outcome persistence itself fails → reconciliation_required = true,
     audit content.purgeReconciliationRequired; content stays hidden; never marked complete
```

Storage deletion happens **before** payload redaction so a retry can always re-derive the object
list from `content_purge_objects` (captured at step 1) even if the payload is already gone.
Every step is idempotent: an already-deleted object, an already-removed dependent row, and a
duplicate finalization are all no-ops that still converge to `purged`.

**Public-bucket honesty.** The `posts` bucket is public. Removal hides content inside We Glue but
cannot revoke a URL someone already copied. Permanent Storage deletion stops future origin
retrieval after CDN propagation. Copies already downloaded, or cached by a third party, cannot be
remotely erased. This is stated in the policy draft (§12) rather than implied away.

---

## 3. Student self-delete vs administrator remove vs administrator purge

| | Student self-delete | Administrator remove | Administrator purge |
|---|---|---|---|
| Who | author / officer | founder only | founder only |
| Mechanism | hard `DELETE` (unchanged) | lifecycle → `removed` | lifecycle → `purged` |
| Reversible | no | **yes** | **no** |
| Reason required | no | **yes** (3–500) | **yes** (3–500) |
| MFA | n/a | aal2 | aal2 **+ recent** (step-up) |
| Typed confirmation | no | no | **`PURGE`** |
| Audit | none | durable, sanitized | durable, sanitized |
| Deletes Storage | no (existing behavior) | **no** | yes, uniquely-owned only |
| Affects author account | no | **no** | **no** |

Student self-delete is **deliberately left as a hard delete**. Making every student deletion an
administrator-style removal would silently retain content the student asked to delete — a privacy
regression and a store-compliance risk, not a security win. Two guards are added:

* Self-delete is **blocked while the content is `removed` or later** (the student must not be able
  to destroy content that is under administrator review or has an open report). Enforced in RLS,
  not in the UI.
* Self-delete of content with an **unresolved report** is blocked for the same reason, so the
  existing evidence rule is not bypassed. (Day 10D owns the adjudication that clears it.)

---

## 4. Interaction with Day 10A and Day 10B

* Day 10A audit stays append-only. New actions are catalog rows only; no audit table changes.
* Suspending or blocking an account **does not** remove its content, and lifting a restriction
  **does not** restore anything. The two systems share no column, function or label.
* Removing content **does not** restrict the author.
* `user_blocks` is untouched. Restoration re-exposes content only to viewers a student block
  already permits — the block predicate and the lifecycle predicate are `AND`ed, never replaced.
* Purge does not alter follow or Gluemate relationships.

---

## 5. Account and club interactions

* **Account deletion** cannot restore removed content: `content_lifecycle` has **no FK** to
  `profiles`, so nothing cascades and no lifecycle row is destroyed. Purged stays purged.
* Account deletion remains available to restricted users (058 §5 guarantee is not weakened).
* Removing a club post does not remove the club; removing an event does not remove the club.
* Deactivating a club does **not** purge content.
* Content **cannot be restored to a club that no longer exists** — restore validates the club row.
* **Restoring content owned by an *inactive* club is allowed**, and the content stays hidden by the
  club's own inactivity rules. Making it visible would override a separate product decision;
  refusing the restore would strand content permanently. This is the explicit rule Phase 20 asks
  for.
* Sole-officer protection (054) and the unscheduled `check_club_inactivity` are untouched.

---

## 6. Per-entity behavior

### 6.1 Post — remove / restore / purge
Remove hides it from home, club feeds, the author's profile grid and viewer, search, discovery,
detail routes, and the shared-message preview; blocks new likes, comments, shares, edits and
author self-delete; preserves likes, comments, tags, media, reports and the original
`created_at`. **No media is deleted on removal.**

Restore requires: author profile exists, club (if any) exists, state is exactly `removed`.
It restores engagement as-is, replays nothing, and creates no notification — structurally
guaranteed, because the post row is never deleted or re-inserted, so `trg_club_post_notify`
(AFTER INSERT) cannot fire.

Purge redacts `caption` and `image_url`, deletes likes, tags, club_photos rows and dependent
comments, nulls `messages.shared_post_id`, and deletes the uniquely-owned Storage object.

### 6.2 Event — remove / restore / purge
Remove hides it from discovery, club event lists, calendars, saved events, search and detail;
blocks new RSVPs, officer edits, shares and **event reminders**; preserves RSVPs, media, reports
and the original event dates.

Reminders are suppressed inside `process_event_reminders` itself (§1.4) — not in the client —
so a removed event can neither generate a reminder row nor leak its title into push copy.

Restore requires: owning club exists, state is exactly `removed`. Past events return only to
historical surfaces; a past event is never presented as upcoming, because the existing
`event_date >= CURRENT_DATE` filters are untouched.

Purge redacts `title`, `description`, `location`, `building`, `room`, `cover_image_url`, deletes
RSVPs / saved_events / activities / interests, nulls `messages.shared_event_id` and
`posts.linked_event_id`, and deletes the uniquely-owned Storage object.

### 6.3 Comment — remove / restore / purge

**Reply rule: Option B** — new replies beneath a removed comment are prevented, existing replies
are preserved. Chosen because it is the only rule that stays correct when threading ships:
allowing replies "to" a removed comment invites students to answer content they cannot see.
Today this is inert (`post_comments` is flat, §1.1), so Option B costs nothing now and is already
decided later.

**Rendering: the row is hidden, not tombstoned — APPROVED BY THE FOUNDER 2026-08-02.**
The Day 10C brief originally asked for a neutral in-place tombstone (*"This comment was removed."*).
That is the right rendering for a **threaded** comment system, where a silent hole breaks the
conversation. The founder has reviewed the analysis below and **approved hiding removed comments
from student lists instead**, on the stated ground that Production comments are currently flat and
no child-thread structure depends on the removed row. This is a settled decision, not an open
deviation. It was approved for these reasons:

1. `post_comments` is **flat** (§1.1). A hidden comment is indistinguishable from one the author
   deleted a second earlier — which is exactly what students already see today. A tombstone would
   *add* information rather than preserve it.
2. A tombstone requires the student client to learn that a specific comment is in a non-`active`
   lifecycle state. Every route to that — a `removed` flag on `post_comments`, a lifecycle read
   grant, or a per-row predicate call — either creates the second source of truth §2 forbids or
   widens the disclosure surface the whole design is built to keep at one bit.
3. Both clients read `post_comments` **directly** through PostgREST (`postService.ts:128`,
   `usePostActions.ts:20`). Rendering redacted bodies would mean moving comment reads onto an RPC
   — a hot-path rewrite affecting counts in five call sites — to buy a placeholder.

So removal is expressed exactly as it is for posts and events: the row stops being returned, and
the comment count (a `count(*)` through the same RLS) stays consistent with it automatically.

**The approved behaviour, and where each part is enforced.** All ten student-facing reads of
`post_comments` across both clients are direct PostgREST table queries, so every one of them passes
through the single RLS SELECT policy that carries the lifecycle predicate:

| Required behaviour | Enforced by | Status |
|---|---|---|
| Removed body inaccessible to students | RLS SELECT predicate on `post_comments` | ✅ test 2.6 |
| Gone from comment lists | `postService.ts:128`, `usePostActions.ts:20` — same policy | ✅ |
| Gone from comment counts | `postService.ts:210/294/395`, `useHomePostsFeed.ts:102/193` — RLS-filtered `count(*)`, so counts self-consistently exclude it | ✅ |
| Gone from search | **no comment search surface exists** in either client | ✅ vacuously |
| Gone from profile activity | **no comment activity surface exists** in either client | ✅ vacuously |
| Gone from direct student lookup | `postService.ts:479/500` — same policy | ✅ test 2.6 |
| Notifications + direct links resolve to the generic unavailable state | notification rows are kept; the comments route resolves its parent and renders `CONTENT_UNAVAILABLE` | ✅ |
| Administrators retain access until purge | `content_lifecycle` + admin detail pages; nothing is deleted on remove | ✅ |
| Restore returns the original body, timestamp and ordering | the entity row is never touched, so `created_at` and ORDER BY position are unchanged by construction | ✅ tests 4.11–4.12 |
| Restore replays no notification | no INSERT occurs, so no AFTER INSERT trigger can fire; measured against a baseline | ✅ test 4.10 |
| Purge irreversibly removes the payload | `content_purge_finalize` clears `content` then deletes the row | ✅ test 6 |

The two "vacuously" rows are stated as such deliberately: those surfaces do not exist today, so
nothing enforces the rule there beyond their absence. **If a comment search or a profile comment
activity feed is ever built, it must read `post_comments` through RLS and not through a
`SECURITY DEFINER` function, or it will reintroduce exactly the bypass this design closes.**

**Reconsideration trigger.** If threaded or nested comments are introduced, this decision must be
revisited: a hidden row in a thread leaves a hole where a reply's parent used to be, and the
tombstone becomes the correct rendering. The state model already carries everything a tombstone
would need, so that change is a rendering change, not a re-architecture.

Restore requires the parent post to exist **and be `active`** — restore fails when the parent is
removed, purge-pending, purged or gone.

### 6.4 Comment purge
Because comments have no children (§1.1), no structural tombstone is required: purge irreversibly
clears `content` and deletes the row after dependencies are handled, preserving only sanitized
audit accountability.

---

## 7. Audit catalog additions

`target_type` values `post`, `comment`, `event` already exist in the 055 CHECK, and `content` is
added for the cross-entity storage/reconciliation actions.

```
post.remove              destructive  reason   comment.remove             destructive  reason
post.restore             sensitive    reason   comment.restore            sensitive    reason
post.purgeRequested      destructive  reason   comment.purgeRequested     destructive  reason
post.purgeCompleted      destructive  —        comment.purgeCompleted     destructive  —
post.purgeFailed         sensitive    —        comment.purgeFailed        sensitive    —
event.remove             destructive  reason   content.purgeStorageAttempt   sensitive  —
event.restore            sensitive    reason   content.purgeStorageSuccess   sensitive  —
event.purgeRequested     destructive  reason   content.purgeStorageFailure   sensitive  —
event.purgeCompleted     destructive  —        content.purgeReconciliationRequired destructive —
event.purgeFailed        sensitive    —        content.purgeRetry            sensitive  reason
```

`purgeCompleted` / `purgeFailed` / storage actions carry `requires_reason = false` because they
are **worker outcomes, not human decisions** — the human reason is captured once on
`purgeRequested` and linked by `correlation_id`. Setting `requires_reason = true` on a
machine-emitted event would force the worker to invent a reason, which is worse than honest.

**Audit payloads carry:** entity type, entity id, owner id, club id, previous state, new state,
sanitized dependency counts, correlation id, storage-object count, outcome category.

**Audit payloads never carry:** post caption, comment body, event description, precise location,
media URLs, storage signed URLs, access tokens, report evidence bodies, MFA data. Enforced by a
sanitizer with a positive allowlist and covered by a test that fails if a payload key escapes it.

---

## 8. Report / evidence boundary (Day 10C's obligation only)

| Case | Rule |
|---|---|
| Active content, no report | normal |
| Removed, no report | purge allowed |
| Removed, **unresolved** report | **purge BLOCKED** — `evidence_required` |
| Removed, resolved/dismissed report | purge allowed |
| Purge request, no snapshot, no open report | allowed |
| Purge request, no snapshot, **open report** | **blocked** |
| Purge request, adequate snapshot | allowed |
| Author deleted their account | lifecycle row survives (no FK); purge allowed |
| Content of a removed club | purge allowed; restore refused |

Removal and restoration **never** delete a linked report. Students cannot reach removed content
through a report relationship (reports carry no payload for post/comment/event, and the content
predicate blocks the join). Administrators may inspect retained content while it exists.

**True Day 10D dependency, recorded and not worked around:** there is **no evidence-snapshot
mechanism for post/comment/event reports** (§1.2). Day 10C therefore blocks purge whenever an
unresolved report exists, rather than copying full content into append-only audit history as a
substitute — which the prompt explicitly forbids and which would defeat the point of purging.
Day 10D must add real evidence retention before content under open report can be purged.

---

## 9. Database enforcement summary

Lifecycle is enforced in Postgres, never only in UI:

* **RLS SELECT** on `posts`, `post_comments`, `events` gains
  `AND public.content_is_student_visible('<type>', id)`.
* **RLS INSERT/UPDATE/DELETE** on `post_likes`, `post_comments`, `event_rsvps`, `saved_events`
  gains a parent-visibility term, so a modified client cannot like, comment on, RSVP to, save or
  edit removed content.
* **Self-delete** on `posts` / `events` / `post_comments` additionally requires the content to be
  `active`.
* `post_club_tags` SELECT is narrowed from `USING (true)` for role `public` to `authenticated`
  plus the post-visibility term.
* The four RLS-bypassing functions in §1.4 are filtered at the source.
* New `SECURITY DEFINER` functions are added to the Day 10B catalog-driven inventory and
  classified there.

No `EXCEPTION WHEN OTHERS THEN NULL`, no `undefined_function THEN CONTINUE` for security-critical
objects, no best-effort setup. Expected dependencies fail loudly.

---

## 10. Notifications, push, realtime

* Historical notification rows are **kept** — deleting them would rewrite a student's history.
  Taps resolve through the same RLS as any read, so they land on the generic unavailable state.
* New interaction notifications cannot be created: the triggers fire on `INSERT` into
  `post_likes` / `post_comments`, and those inserts are now denied for removed parents.
* Pending `push_queue` rows that exist solely for removed content are cancelled at removal.
* `process_event_reminders` skips non-`active` events, so no reminder is generated and no title
  reaches push copy.
* Restore replays nothing, creates nothing, and does not touch unread counts — the entity row is
  never re-inserted.
* Realtime: `private.can_receive_post_interaction` / `can_receive_event_interaction` gain the
  lifecycle term, so a client cannot stay subscribed to a removed item's topic. **No new table is
  added to the realtime publication.**

---

## 11. Shared content in messages

Messages themselves are untouched (Day 10F owns message privacy). Only *resolution* changes:
a removed or purged post/event fails the visibility predicate, the embed returns null, and the
existing `PostShareCard` / `EventShareCard` null branch renders
**"This content is no longer available."** The message, its text, its timestamp and the
conversation are all preserved, and tap-through is disabled. Restoration lets a fresh fetch
resolve normally again with no new message and no new notification.

---

## 12. Policy assessment (draft only — nothing published)

Public language needs to state that We Glue may remove content for policy or safety reasons;
that removed content may be retained for review, restoration, dispute handling and legal
compliance; that permanently purged content cannot be restored; that minimal sanitized
administrator audit evidence remains without retaining the content itself; and that copies
already downloaded or cached outside We Glue cannot always be remotely erased.

It must **not** claim that 10D adjudication, 10E parity or 10F message privacy are live, nor that
every record is erased instantly on purge.

No new Apple or Google data categories are introduced: no new data type is collected, and the
retained lifecycle record is administrative metadata about existing content.

---

## 13. What Day 10C deliberately does not do

Report adjudication, moderator assignment, enforcement workflows, reporter notifications,
escalation queues, broad evidence management (all 10D); cross-platform synchronization parity
(10E); deleted-message privacy and any change to migration 051 (10F); any broadening of the
realtime publication; any change to migrations 054–060.

---

## 14. Findings recorded during the audit

**Blockers for Day 10D (not fixable inside 10C's scope):**

1. No evidence-snapshot mechanism exists for post/comment/event reports, so purge is blocked
   whenever an unresolved report exists (§8).
2. `reports_entity_type_check` has no `comment` value — comments cannot be reported at all.

**Pre-existing weaknesses found and their disposition:**

3. Hard-deleting an event **notifies every RSVP'd student that it was cancelled**
   (`trg_event_canceled_notify`). Administrator removal avoids this entirely; the student
   self-delete path keeps existing behavior deliberately.
4. Hard delete silently orphans `reports` rows (no FK). Removal fixes this for administrator
   actions; student self-delete of reported content is now blocked (§3).
5. `post_club_tags` was anon-readable (`USING (true)` for `public`). Narrowed in §9.
6. `handle_event_updated_notify` uses `EXCEPTION WHEN OTHERS THEN RAISE WARNING`. Pre-existing,
   outside Day 10C's scope, and **not** changed here — recorded so it is not mistaken for new code.
7. 20 of 25 posts and 9 of 13 club photos reference `picsum.photos` seed URLs that no purge can
   delete. Purge skips non-Supabase URLs rather than reporting a false failure.
