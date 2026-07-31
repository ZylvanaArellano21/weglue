# Day 10 — Phase 1: Capability & Synchronization Audit (READ-ONLY)

**Date:** 2026-07-30
**Branch inspected:** `security/admin-session-and-officer-floor` (tip `6a748236`)
**Production project:** `yoozrnosmqtaiksgcixc`
**Method:** live introspection of production Supabase (PostgREST OpenAPI + Management API read queries) cross-checked against source. Migration files were **not** trusted on their own — every schema claim below was verified against the running database.
**Edits made:** none. No schema, code, config, or deployment was changed.

---

## 0. Verified production baseline

| Fact | Verified value |
|---|---|
| Applied migrations | …042–050, **052, 053, 054** |
| **Migration 051** | **NOT applied** (confirmed: no `message_deletion_attempts`, no `deleted-message-retention` bucket) |
| Tables/views exposed via PostgREST | 47 |
| RPCs exposed | 89 |
| `app_config.single_campus_mode` | `true` |
| `app_config.launch_university_id` | `174a1779-0281-4d20-9b0d-a075c17fc01f` |
| Universities | exactly 1 — Lone Star College (`lone-star-college`, `is_active=true`) |
| Storage buckets | `avatars`(public), `club-avatars`(public), `club-covers`(public), `club-photos`(public), `posts`(public), `chat-attachments`(private) |
| Realtime publication members (live) | `channel_posters`, `club_goals`, `club_members`, `club_officers`, `club_photos`, `clubs`, `conversation_channels`, `conversation_participants`, `conversations`, `events`, `messages`, `notifications`, `poll_votes` — **13 tables** |

Live data scale: 64 profiles, 6 clubs, 235 club_members, 24 posts, 0 comments, 25 events, 10 RSVPs, 98 messages, 60 conversations, 14 reports, 14 follows.

### Tables that DO NOT exist in production
`admin_audit` · `restrictions` · `blocks` · `suspensions` · `user_blocks` · `edit_history` · any version/snapshot table · any sanction table.

Confirmed by direct query against `information_schema.tables` (returned empty for all `%audit%`, `%restrict%`, `%block%`, `%suspend%`, `%edit_history%` patterns).

---

## 1. Canonical table map

| Entity | Canonical table(s) | Key FKs |
|---|---|---|
| Auth users | `auth.users` (GoTrue) | `profiles.id` → `auth.users.id` |
| Profiles | `public.profiles` (22 cols) | `university_id` → `universities.id` |
| Restrictions | **none** | — |
| Blocks / suspensions | **none** | — |
| Gluemates | `follows` (`follower_id`, `following_id`, `status`) | both → `profiles.id` |
| Clubs | `clubs` (24 cols) | `university_id` → `universities.id` |
| Club categories | `club_categories` (`club_id`, `category`) — **child table, not a column** | → `clubs.id` |
| Club memberships | `club_members` (`role` = authority) | → `clubs.id`, `profiles.id` |
| Club officers | `club_members.role='officer'` (**authority**) + `club_officers` (**display roster only**) | → `clubs.id`, `profiles.id` |
| Universities | `universities` (5 cols) | — |
| Posts | `posts` (8 cols) | `author_id`→`profiles`, `club_id`→`clubs`, `linked_event_id`→`events` |
| Comments | `post_comments` (5 cols) | `post_id`→`posts`, `user_id`→`profiles` |
| Events | `events` (18 cols) | `club_id`→`clubs`, `created_by`→`profiles` |
| RSVPs | `event_rsvps` (`status`) | `event_id`→`events`, `user_id`→`profiles` |
| Conversations | `conversations` (`deleted_at`) | `club_id`→`clubs` |
| Channels | `conversation_channels` | `conversation_id`→`conversations` |
| Messages | `messages` (`deleted_at`, `deleted_by`) | `conversation_id`, `channel_id`, `sender_id` |
| Notifications | `notifications` (+ `notification_types`, `push_queue`) | `user_id`, `actor_id` |
| Reports | `reports` (21 cols, incl. `content_snapshot`, `attachment_snapshot`) | `reporter_id`, `club_id` |
| Deleted content | *derived* — `clubs.is_active`, `conversations.deleted_at`, `messages.deleted_at` | — |
| Media / Storage | `storage.objects` across 6 buckets | untracked from app tables |
| Recommendations | `club_recommendation_batches` + `rank_eligible_clubs()` / `get_my_club_recommendations()` | — |
| Audit history | **none** (server log only) | — |
| Edit history | **none** — only `updated_at > created_at` on `profiles`, `clubs`, `events`, `messages` | — |

---

## 2. Entity-operation matrix

Legend: **F**=Fully implemented · **P**=Partially implemented · **R**=Read-only · **M**=Missing · **U**=Unsafe/inconsistent · **N/A**

| # | Entity | Status | Dashboard reads | Dashboard writes | Realtime | Propagation gap |
|---|---|---|---|---|---|---|
| 1 | Auth users | **R** | `auth.admin.listUsers`, `getUserById` (`data.ts:98,123`) | **none** | N/A | — |
| 2 | Profiles | **R** | `listUsers`, `getUserDetail` (`data.ts:243,381`) | **none** | ❌ **not in publication** | no push to any client |
| 3 | Restrictions | **M** | `reportStatusCounts` only | none — honest "unsupported" UI | N/A | no enforcement model exists |
| 4 | Blocks & suspensions | **M** | none | none | N/A | **no such state anywhere** |
| 5 | Gluemates | **P** | `listGluemates`, `getUserGluemates` | `removeGluemate` | ❌ not in publication | client refetch only |
| 6 | Clubs | **P / U** | `listClubs`, `getClubDetail` | `reactivateClub` **only** | ✅ | **asymmetric: can restore, cannot deactivate** |
| 7 | Club memberships | **F** | `listMemberships`, `getMembershipDetail` | `addMembership`, `removeMembership`, `setMembershipRole` (054 RPCs) | ✅ | — |
| 8 | Officers & titles | **F** | `listOfficers`, `clubOfficerCount(s)` | `addOfficer`, `editOfficerTitle`, transfer (054 RPCs) | ✅ web / ⚠️ mobile | **mobile does not subscribe to `club_officers`** |
| 9 | Universities | **F** ⚠ | `listUniversitiesFull`, `getUniversityDetail` | `addUniversity`, `editUniversity`, `setUniversityActive` | ❌ not in publication | **`addUniversity` is live — Phase 9 requires it disabled** |
| 10 | Posts | **P** | `listPosts`, `getPostDetail` | `editPostCaption`, `removePostFromClub` (un-tag) | ❌ post row not in publication | no delete; 050 broadcast covers likes/comments only |
| 11 | Comments | **P** | `listComments`, `getCommentDetail` | `editCommentContent` | via 050 broadcast `post:<id>` | **no delete** |
| 12 | Events | **P** | `listEvents`, `getEventDetail` | `editEvent` | ✅ table in publication | **mobile has no `events` subscription** |
| 13 | RSVPs | **F** | `listRsvps` | `upsertRsvp`, `removeRsvp` | via 050 broadcast `event:<id>` | — |
| 14 | Conversations | **R** | `listConversations`, `getConversationDetail` | none | ✅ | — |
| 15 | Channels | **F** | `listChannels`, `getChannelDetail` | `createChannel`, `renameChannel`, `setChannelPermission`, `deleteEmptyChannel` | ✅ | — |
| 16 | Messages | **R** (privacy-locked) | `listMessages`, `getMessageDetail` (metadata); `revealMessageBody` + `searchMessageContent` behind step-up MFA, **active only** | **none** | ✅ | deleted bodies unreachable (051 undeployed) |
| 17 | Notifications | **P** (deliberate) | `listNotifications`, `getNotificationDetail`, `listNotificationTypes` | `setNotificationRead` | ✅ | delete/resend intentionally refused (`push_queue` CASCADE) |
| 18 | Reports | **P** | `listReports`, `getReportDetail`, `getReportsSummary` | `setReportStatus` **only** | ❌ not in publication | **no notes column, no sanction linkage** |
| 19 | Deleted content | **P** | `listDeletedContent` (clubs/conversations/messages) | `reactivateClub` only | mixed | posts/comments/events **have no soft-delete to list** |
| 20 | Media & Storage | **M** | **zero** — no `storage.*` reference anywhere in `lib/admin` or `app/admin` | none | N/A | orphans undetectable |
| 21 | Recommendations | **M** | none | none | N/A | no visibility into batches/ranking |
| 22 | Audit history | **M** | `getAuditStatus` (honest "no table") | `adminAudit()` → **`console.log` only** (`audit.ts:31`) | N/A | **not durable, not queryable** |
| 23 | Edit history | **M** | `listEditHistory` — derives from `updated_at` only | none | N/A | **before/after values were never recorded** |

---

## 3. Deletion & restoration semantics (verified per entity)

| Entity | Model | Restorable? |
|---|---|---|
| Clubs | **Soft** — `is_active=false` | ✅ yes (`reactivateClub`) — the only true restore in the product |
| Conversations | **Soft** — `deleted_at` | ❌ no canonical restore op exists |
| Messages | **Soft** — `deleted_at` + `deleted_by` | ❌ privacy-locked; body never served (051 undeployed) |
| Posts | **HARD delete** — no `deleted_at` column | ❌ **irrecoverable** |
| Comments | **HARD delete** — no `deleted_at` column | ❌ **irrecoverable** |
| Events | **HARD delete** — no `deleted_at`, no `cancelled` column | ❌ **irrecoverable** |
| RSVPs | **HARD delete** | ❌ |
| Accounts | **HARD cascade** (`delete_own_account_atomic`, 044/052) | ❌ by design — Apple 5.1.1(v) compliance |

**Consequence for Phase 4:** "Restoration where retained" and "permanent purge with explicit confirmation" are **not implementable for posts, comments, or events** without a new soft-delete model. Presenting a restore affordance for them today would be fiction. Likewise "Cancel or reactivate" for events has no column to write.

---

## 4. Synchronization maps

### 4a. Dashboard → Supabase → apps

Every write follows one hardened contract (`actions.ts` header): `requireSecureAdmin({write:true})` → strict validation → **fixed canonical table** (no generic mutation endpoint) → read-back → audit → `{ok}` result, never throws to client. Service-role client is constructed **only after** authorization passes.

| Admin write | Canonical target | Reaches mobile? | Reaches web? |
|---|---|---|---|
| `addMembership` / `removeMembership` / `setMembershipRole` | `club_members` (via 054 RPCs) | ✅ realtime (own row filter) ~1s | ✅ realtime (club filter) |
| `addOfficer` / `editOfficerTitle` / transfer | `club_members` + `club_officers` | ⚠️ authority yes, **roster display no** | ✅ both |
| `reactivateClub` | `clubs.is_active` | ✅ `clubs` UPDATE → invalidate | ✅ filtered |
| `editEvent` | `events` | ❌ **no mobile subscription** → ≤60s stale + focus | ✅ filtered |
| `editPostCaption` | `posts` | ❌ no push | ❌ no push (page is `force-dynamic`, so correct on navigation) |
| `editCommentContent` | `post_comments` | ⚠️ 050 broadcast fires on comment INSERT/UPDATE/DELETE → ✅ | ✅ |
| `upsertRsvp` / `removeRsvp` | `event_rsvps` | ✅ 050 private broadcast `event:<id>` | ✅ |
| `createChannel`/`rename`/`permission`/`deleteEmpty` | `conversation_channels` | ✅ | ✅ (hub) |
| `setNotificationRead` | `notifications` | ✅ | ✅ |
| `removeGluemate` | `follows` | ❌ no push → refetch only | ❌ refetch only |
| `addUniversity`/`edit`/`setActive` | `universities` | ❌ no push | ❌ no push |
| `setReportStatus` | `reports.status` | N/A (not student-facing) | N/A |

### 4b. Supabase → dashboard

All 37 admin pages are `force-dynamic` (40 files declare it) and every loader calls `requireSecureAdmin()` then reads live via service role. **A direct Supabase change is reflected in the dashboard on next request — no caching layer to invalidate.** The dashboard has **no Realtime subscriptions of its own**; freshness after its own writes comes from `router.refresh()` in the action components (17 call sites). There is **no `revalidatePath`/`revalidateTag` anywhere in the web app.**

### 4c. Client cache behavior (bounds the "acceptable time")

- **Mobile:** React Query `staleTime: 60_000`, `gcTime: 24h`, `refetchOnWindowFocus: true`, persisted to AsyncStorage under `weglue-query-cache-v1`. Non-realtime entity worst case = **stale until next mount/focus after 60s**; a cold start renders persisted data first.
- **Student web:** React Query `staleTime: 60_000`, no persistence; all data-bearing pages `force-dynamic` → server render is always fresh.
- **Realtime path:** targeted `invalidateQueries` (never polling) → observed convergence ~1s.

### 4d. Realtime coverage gaps (the substantive ones)

1. **`profiles` is not in the publication at all.** No profile change — by admin or by the student — pushes to any client.
2. **Mobile has no `events` subscription.** Web's `useClubRealtime` subscribes to `events` filtered by club; mobile's app-wide `useClubRealtimeSync` subscribes only to `club_members`(own), `clubs` UPDATE, `conversation_channels`, `channel_posters`(own). **Web and mobile are not at parity.**
3. **Mobile has no `club_officers` subscription.** Officer *authority* flips live (own `club_members` row); the officer *roster display* does not.
4. `follows`, `posts`, `reports`, `universities`, `app_config` are in no publication and have no broadcast trigger.

---

## 5. Migration 051 — deployment recommendation

**Recommendation: do NOT bundle 051 into Day 10. Deploy it as its own isolated, separately-reviewed change, after the Day-10 work lands.**

Reasoning:

- 051 is large and contains **two intentionally destructive steps**: §18 backfills report snapshots into a deny-all `report_evidence` table then **NULLs the reporter-readable `reports.content_snapshot` / `attachment_snapshot`**; §15b **retargets message parent FKs to `ON DELETE RESTRICT`**. Neither is reversible by simply dropping objects.
- It spans PostgreSQL **and** a Storage-orchestrating Edge Function — Postgres and Storage are not atomic, so it has a genuine two-system failure mode with a worker resume/claim-lease protocol.
- Day 10's own needs (durable audit, restrictions, soft-delete for content) each want their own migration. Sequencing 051 in the middle couples an unrelated privacy change to routine admin work and makes rollback ambiguous.
- It is currently the **only** blocker for serving retained deleted-message evidence — so it gates Phase 5's founder-access requirement, but nothing else in Day 10.

**Proposed sequence:** `055` durable audit → `056` restrictions/suspensions → `057` content soft-delete + moderation notes → **then** 051 renumbered to `058` on its own review cycle. 051 must not keep the number 051 — the applied history is already past it (052/053/054 are live), and Supabase orders by version string.

---

## 6. Precise message-state distinction (Phase 5)

Against the **current deployed** schema (051 absent):

| State | Representation today | Admin access today |
|---|---|---|
| **Active** | `deleted_at IS NULL` | Metadata always; **full body** via `revealMessageBody` behind `requireRecentMfa` (5-min step-up) — content never logged, never in URL, `no-store` |
| **Sender-deleted** | `deleted_at`, `deleted_by = sender_id` | Metadata only. Body **always refused** (`messagingActions.ts:93`) |
| **Moderator-removed** | **does not exist** — no admin message-delete path is exported | N/A |
| **Soft-deleted retained evidence** | **does not exist** — original content is *overwritten*, not retained, without 051 | N/A |
| **Permanently purged** | Hard row delete (bulk/cascade paths pre-051) | Unrecoverable — and must never be claimed otherwise |

The critical honesty point: **today a sender-deletion does not retain the original.** Founder "access to deleted-message evidence where retention permits" is currently satisfied by *nothing*, because nothing is retained. 051 is what creates the retained copy. Until it deploys, the only truthful answer for a deleted message is "the original was not preserved."

Already-correct guardrails in place: step-up MFA on every reveal, no message text in any log (only `content_len`), deleted rows denied unconditionally, server-side result cap on search, no bulk export endpoint.

Missing for Phase 5 compliance: **required access reason** (not currently collected) and **durable audit entry** (currently `console.log` only).

---

## 7. Durable audit — current state and required architecture

**Current:** `adminAudit()` (`lib/admin/audit.ts`) serializes `{tag, ts, action, actorId, actorEmail, target, before, after, ok, error}` to `console.log`. That is a real greppable trail in Vercel logs, but it is **not durable, not queryable, not append-only-enforced, and subject to log retention**. `/admin/audit-history` reports this honestly rather than faking records.

**Required (Phase 7):** an `admin_audit` table with `actor_id`, `actor_email`, `action`, `target_type`, `target_id`, `reason`, `before`, `after`, `ok`, `error`, `created_at`, `correlation_id`; RLS denying all client access (service-role insert only, no `authenticated` INSERT/UPDATE/DELETE policy); founder read routed through the existing `requireSecureAdmin()` gate rather than a direct client policy; documented retention. `adminAudit()` becomes the single place that also INSERTs — **call sites do not change** (its header already anticipates exactly this).

---

## 8. Privacy & store-disclosure impact

- **Apple 5.1.1(v) account deletion must not regress.** Deletion is a hard cascade by design; any Phase 2 "delete account" admin path must reuse the atomic 044/052 mechanism, not invent a soft-delete. **Do not build a reversible "permanent deletion"** — as instructed.
- **Introducing suspension/blocking changes the privacy story.** A restrictions table stores enforcement state about a person and must be reflected in the privacy policy before shipping, on both stores.
- **⚠️ Independent finding, outside Day 10's stated scope but material:** the student apps have **no user-blocking feature at all**. Verified — the only occurrence of "block user" in the entire codebase is the admin page stating it doesn't exist. Reporting exists (`reports`, 14 rows) and message-level hiding exists (`message_hides`), but a student cannot block another student. **Apple Guideline 1.2 and Google Play's UGC policy both require a mechanism to block abusive users** in apps with user-generated content and direct messaging. We Glue has DMs. This is a live store-compliance exposure on an already-submitted app, and it happens to share a data model with Phase 2's admin blocking work. Flagging for a founder decision; not acting on it.

---

## 9. Phase 9 — Lone Star restriction status

| Check | State |
|---|---|
| Sole active university | ✅ verified — exactly one row, Lone Star College |
| `single_campus_mode` | ✅ `true` |
| `launch_university_id` | ✅ points at Lone Star |
| Student signup/onboarding | ✅ untouched, no change proposed |
| **Add University control** | ❌ **live and enabled** — `UniversityControls.tsx:110` wires `addUniversity`. **Must be disabled for the production founder dashboard.** |

---

## 10. True blockers

1. **No durable audit table** — Phases 2, 3, 4, 5, 6 all require "record every action in durable audit history". Everything else is gated on this. Must land first.
2. **No restriction/suspension/block model** — Phase 2's block/unblock/suspend/unsuspend is 100% greenfield: table + RLS + **enforcement in discovery/search/recommendations/RLS** + iOS + Android + web. This is the single largest piece of work in Day 10 and it is the one that requires real mobile changes (hence a possible OTA).
3. **No soft-delete for posts/comments/events** — Phase 4's "restoration where retained" and "cancel/reactivate" cannot be honestly implemented without new columns.
4. **No `reports` notes column** — Phase 6's "internal moderator notes" needs a migration.
5. **Migration 051 undeployed** — Phase 5's retained-evidence access is impossible until it ships; and it must be renumbered past 054.
6. **Mobile/web Realtime parity gap** — Phase 8's "iOS reflects the change / Android reflects the change" will legitimately fail for events, profiles, officer rosters and gluemates until subscriptions or an accepted refetch bound is defined.
7. **Zero Storage/media admin coverage** — Phase 4's "media inspection" has no foundation at all.

---

## 11. Proposed implementation order (for Phase 10 approval)

| # | Branch | Migration | Scope | Mobile change? |
|---|---|---|---|---|
| 1 | `admin/durable-audit` | `055` | `admin_audit` table, RLS deny-all, `adminAudit()` writes rows, audit-history page reads real records | no |
| 2 | `admin/content-lifecycle` | `056` | soft-delete + `updated_at` on posts/comments/events; moderation notes on reports; honest restore/purge | no (RLS filters) |
| 3 | `admin/user-administration` | `057` | restrictions/suspensions model + enforcement in search/discovery/recs/RLS; admin account deletion reusing 044/052 | **yes — OTA** |
| 4 | `admin/club-content-ops` | none | club editing (name/description/categories/images/visibility/deactivate), post/comment/event delete+restore, event cancel, media inspection | no |
| 5 | `admin/reports-enforcement` | none | report notes, evidence-driven actions, prior-report context, full audit trail | no |
| 6 | `admin/lonestar-lock` | none | disable Add University; verify single-campus invariants | no |
| 7 | `admin/realtime-parity` | `058` (pub only) | mobile `events`/`club_officers` subscriptions; `profiles` publication decision | **yes — OTA** |
| 8 | *(separate cycle)* | `059` (was 051) | deleted-message privacy — own review, own deploy decision | yes |

Ordinary admin operations = branches 1, 2, 4, 5, 6. Sensitive privacy operations = branches 3, 7, 8.

---

## 12. Phase 8 test plan (to execute after implementation, not now)

Per mutation: canonical-row assertion → no-shadow-data assertion → iOS reflect → Android reflect → web reflect → dashboard reflect → convergence within bound (**realtime ≤2s; non-realtime ≤60s + focus**, matching the measured `staleTime`) → counts/relationships intact → audit row present → failure produces no partial mutation.

Reverse direction: apply an isolated change via a Management API transaction against a **provisioned test club and test accounts**, confirm all four surfaces, roll back with no residue. **No real student messages and no real student accounts will be modified** — the QA provisioning/cleanup method from the migration-050 verification is reused.

---

**Phase 1 complete. No edits made. Awaiting founder review before Phase 2.**
