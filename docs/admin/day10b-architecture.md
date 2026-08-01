# Day 10B — Account Restrictions & Student Blocking
## Read-only audit + architecture

> ## ✅ APPROVED BY FOUNDER — 2026-07-31
>
> This architecture is approved. Implementation is split into two phases.
>
> ### Founder decisions of record
>
> | # | Decision | Effect on this document |
> |---|---|---|
> | 1 | **Student blocking ships before administrator restriction controls.** | Confirms the §11.3 sequencing recommendation. Day **10B1** = student blocking (migration **057**). Day **10B2** = administrator restrictions, separately. |
> | 2 | **Shared group and club messages remain visible.** Blocking prevents direct contact rather than filtering shared conversation history. | **Option C adopted** (§2.4). Options A and B are rejected. No hidden-message placeholder is built, and no per-message filtering is added to either renderer. |
> | 3 | **Official club and event information must remain visible even when its officer or author is blocked.** | Confirms §2.3 category 2. The technical distinction is `posts.club_id IS NULL` (personal) vs `NOT NULL` (official) — verified nullable/not-null in production. |
> | 4 | **Do NOT use Supabase Auth `banned_until`** for future suspension or platform blocking. | **Supersedes §5.4 and §9.3.** The `ban_duration` leg is removed from the future restriction design. Blocker **B5** is thereby resolved: with no ban, a restricted student can always still sign in far enough to reach in-app account deletion. Enforcement will rest on canonical database predicates + session revocation only. |
> | 5 | Future administrator restrictions will use **canonical database enforcement, session revocation, and a restricted-account shell that preserves account-deletion access.** | Confirms §4, §5.4 (minus the ban) and §6.3. The restriction shell **must** expose "Delete my account". |
> | 6 | The public-bucket known-URL limitation is **documented but out of implementation scope**. | §1.3 "Storage" and blocker **B6** stand as documented limitations. No bucket redesign. |
> | 7 | **`ADMIN_WRITES_ENABLED` must remain false.** | No administrator write is enabled by 10B1. Student blocking is entirely student-owned and does not depend on the write switch. |
> | 8 | **Migration 051 remains absent and out of scope.** | Unchanged. |
>
> ### Day 10B2 — final founder decisions (recorded 2026-08-01)
>
> | # | Decision | Effect |
> |---|---|---|
> | 9 | **Two states only: `suspended` and `platform_blocked`.** An unrestricted student is `active`. | Implemented as `account_restrictions.restriction_type`. No ambiguous shared "blocked" value with `user_blocks`. |
> | 10 | **Still NO Supabase Auth `banned_until`.** | Enforcement is database-side. A restricted student can sign in far enough to reach the restricted shell and **delete their account** — which is why `delete_own_account_atomic()` is deliberately ungated. |
> | 11 | **`platform_blocked → suspended` is NOT supported directly.** | The administrator must unblock first, as a separate, independently audited action. A de-escalation is never smuggled inside a "suspend" record. |
> | 12 | **Changing a suspension's expiry is an explicit, separately audited action**, not a silent edit. | `restriction.adjustExpiry`, with its own reason. |
> | 13 | **Expiry is a predicate, not a job.** | `get_account_access_state()` evaluates `suspended_until > now()`, so a lapsed suspension stops restricting to the second. An un-lifted expired row is bookkeeping, never an access state. |
> | 14 | **The student is never told the internal classification.** | `my_access_state()` returns the generic `restricted` rather than `platform_blocked`, plus `suspended_until` and the public support address — never a reason, an administrator identity, history, or a correlation id. |
> | 15 | **A restriction deletes nothing** and **does not touch Day 10B1 `user_blocks` rows.** | Verified by test: content, memberships, officer roles and existing student blocks all survive both applying and lifting. |
>
> ### What this changes in the migration plan
>
> §11.1 proposed 057 = restrictions and 058 = blocks. **Decision 1 reverses that order.**
> The authoritative numbering is now:
>
> | # | File | Phase | Status |
> |---|---|---|---|
> | **057** | `057_student_blocking.sql` | **Day 10B1** | implemented on `safety/student-blocking` |
> | **058** | `058_admin_restrictions.sql` | **Day 10B2** | implemented on `safety/admin-restrictions` |
>
> Blocker **B1** (`requireRecentMfa()` bypassing the write kill switch) is fixed in 10B1 as a
> prerequisite, using a **new `requireRecentMfaWrite()` composition** rather than by changing
> `requireRecentMfa()` itself — so the two sensitive *reads* (`message.revealBody`,
> `message.contentSearch`) keep working while writes are disabled.
>
> Blockers **B2** (spoofable discovery `p_user_id`) and **B3** (notification INSERT paths that
> bypass `insert_notification_once`) are both closed inside migration 057, because student
> blocking cannot be enforced without them.

---

## Original audit (as reviewed)

**Date:** 2026-07-31
**Branch inspected:** `main` @ `4885185f` (verified identical to `origin/main` — 0 ahead / 0 behind)
**Production project:** `yoozrnosmqtaiksgcixc` (We Glue, ACTIVE_HEALTHY)
**Method:** live SQL introspection of production Postgres via the Supabase Management API (read-only helper that refuses any non-`SELECT` statement), cross-checked against source. **No claim below is inferred from a migration file alone.**
**Changes made:** none. No schema, code, config, env var, branch, deployment, OTA or build. No test users, no restrictions, no blocks. No private message body was read.

---

# 0. Verified production baseline

| Fact | Verified value |
|---|---|
| `current_user` for introspection | `postgres` (NOSUPERUSER + BYPASSRLS) |
| Public tables | **49** |
| RLS policies (public + storage) | **124** |
| Public functions | **179** (`private` schema: 15) |
| Realtime publication members | **13** tables |
| Live auth sessions | 41 |
| Migrations applied | …042–050, 052–056 |
| **Migration 051** | **NOT applied** (confirmed absent) |
| `app_config.single_campus_mode` | `true` |
| Universities | 1 — Lone Star College |
| Row counts (est.) | profiles 64 · clubs 6 · club_members 216 · posts 20 · events 21 · messages 94 · conversations 44 · conversation_participants 423 · notifications 2011 · follows 2 · push_queue 98 |

### Tables that DO NOT exist in production

`account_restrictions` · `user_blocks` · `restrictions` · `blocks` · `suspensions` · any sanction table.
Confirmed by direct `pg_class` enumeration of all 49 public tables. **Both Day 10B systems are greenfield.**

### What DOES exist and is directly reusable

| Asset | Status |
|---|---|
| `admin_audit_events` / `admin_audit_actions` (055) | live, RLS **forced**, append-only via 4 triggers, `service_role` has **SELECT only** |
| `admin_audit_log()` | live, validates event_type ↔ success ↔ error_code consistency |
| `private.admin_tx_ok()` / `private.admin_tx_fail()` (056) | live — the mutate+audit-in-one-transaction primitives |
| `lib/admin/atomicMutation.ts` | live — DB-only mutation runner |
| `lib/admin/crossService.ts` | live — **attempt → outcome, one correlation id**, exactly what Auth session revocation needs |
| `components/admin/ConfirmAction.tsx` | live — reason dialog, `MIN_REASON=3` / `MAX_REASON=500` |
| `requireSecureAdmin()` / `requireRecentMfa()` | live |
| `auth.users.banned_until` | column **exists** (GoTrue native ban) |
| `conversation_participants.hidden_at` | exists — reusable for inbox hiding, no new concept needed |
| `apps/web/app/account-restricted/page.tsx` | exists (platform-admin containment) — a template, not reusable as-is |
| `apps/mobile/lib/platformAdmin.ts` → `resolveMobileSessionRoute()` | exists — the exact routing shape a restriction screen needs |

**Important correction to the prior Day 10A blocker list:** the review recorded "reason collection is not wired into the UI" as a hard prerequisite for `ADMIN_WRITES_ENABLED`. That is **now closed** — `ConfirmAction.tsx` collects and validates a 3–500 character reason and passes it to `run(reason)`, and `actions.ts` threads `reason` through to `runAtomicMutation` for every `requires_reason` action. Day 10B does not need to build it.

---

# 1. Live schema and code audit

## 1.1 The single most consequential finding

**Nearly every student-visible read policy is `USING (true)` for `authenticated`.** Verified policy text:

| Table | SELECT policy | `USING` |
|---|---|---|
| `profiles` | profiles: anyone authenticated can read | **`true`** |
| `posts` | posts: anyone authenticated can read | **`true`** |
| `post_comments` | post_comments: anyone authenticated can read | **`true`** |
| `post_likes` | post_likes: anyone authenticated can read | **`true`** |
| `follows` | follows: anyone authenticated can read | **`true`** |
| `user_privacy` | user_privacy: read all authenticated | **`true`** |
| `conversations` | non-members see club group chats | `type = 'club_group'` |

Consequences that shape the whole design:

1. There is **no existing visibility model to extend**. Blocking/restriction filtering must be *introduced* into these policies, not adjusted.
2. `follows` SELECT is `true`, so **any authenticated user can already enumerate the entire follow graph**. A student block that only removes rows is trivially detectable by B. Non-disclosure has to be designed for, not assumed.
3. Adding a naive per-row subquery to `profiles`/`posts` SELECT would put a correlated subquery on the hottest reads in the product. §4.4 gives the fix.

## 1.2 Spoofable-parameter defect in discovery (pre-existing, must be fixed by 10B)

```sql
search_discovery(p_user_id uuid, p_query text)    -- STABLE SECURITY DEFINER
get_discovery_people(p_user_id uuid)              -- STABLE SECURITY DEFINER
get_discovery_clubs(p_user_id uuid, …)
get_discovery_events(p_user_id uuid, …)
```

All four are `SECURITY DEFINER`, `EXECUTE` granted to `authenticated`, and take the **caller's identity as an argument** instead of reading `auth.uid()`. Call sites confirmed in `apps/mobile/services/searchService.ts:61,87,110,149` passing `p_user_id: userId` from the client.

Today this leaks nothing (results are already public). **The moment blocking is enforced inside these functions it becomes a bypass**: a modified client passes any other UUID and gets an unfiltered result set. Fixing this is a hard prerequisite, not a nice-to-have.

## 1.3 Surface-by-surface audit

Legend for "Effect": **AR** = administrator restriction (suspend / platform block), **SB** = student block.

| # | Surface | Canonical table / function | Current RLS | Client query | Mutation path | Mobile | Student web | Admin dash | Realtime/refetch | AR effect | SB effect | Required change | Risk |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Auth users | `auth.users` (GoTrue) | n/a | — | GoTrue | ✔ | ✔ | read via service role | none | ban + revoke sessions | none | Admin API `updateUserById({ban_duration})` + `signOut(scope:'global')` under cross-service audit | Auth ≠ Postgres transaction; needs attempt→outcome |
| 2 | Profiles | `profiles` | SELECT **true**; UPDATE own | `.from("profiles")` everywhere | own UPDATE | ✔ | ✔ | ✔ | not in realtime pub | restricted profile excluded from discovery; own row still readable by self | A↔B mutually invisible in discovery/search | rewrite SELECT policy (§4.2) | hottest read in app — perf critical |
| 3 | Follows / Gluemates | `follows` (`status` ∈ pending/accepted) | SELECT **true**; INSERT `follower_id=auth.uid()`; DELETE either side | `followService.ts:125-207`, web `useUserProfile.ts:37-69` | direct table writes | ✔ | ✔ | `admin_tx_gluemate_remove` | none | AR: no new follows | SB: both rows deleted atomically; no new follows either way | INSERT policy + SELECT policy; block RPC deletes both rows in one tx | 3 notify triggers fire on insert/update/delete |
| 4 | Search | `search_discovery()` | SECDEF, spoofable arg | `searchService.ts:110` | — | ✔ | ✖ (no student search on web) | separate admin search | on-demand | exclude restricted | exclude both directions | **rewrite to `auth.uid()`** + block/restriction filter | §1.2 bypass |
| 5 | Recommendations (people) | `get_discovery_people()` | SECDEF, spoofable arg | `searchService.ts:87` | — | ✔ | ✖ | — | on-demand | exclude restricted | exclude both directions | same | same |
| 6 | Recommendations (clubs) | `get_my_club_recommendations()`, `rank_eligible_clubs()`, `club_recommendation_batches` | SECDEF, `auth.uid()`-based | 3 call sites | — | ✔ | ✔ | — | — | restricted user gets none | **no change** — clubs are not people | none | — |
| 7 | Profile discovery / deep link | `profiles` + `app/profile/[userId].tsx`, `app/u/[id]/page.tsx` | SELECT true | direct | — | ✔ | ✔ | ✔ | focus refetch | restricted → unavailable state | A→B and B→A → unavailable state | policy + client empty state | deep link is the main bypass vector |
| 8 | Posts | `posts` | SELECT **true**; author CRUD | feeds | direct insert | ✔ | ✔ | ✔ | — | AR: no new posts | **personal** posts hidden from blocker; **club** posts stay visible (§2.3) | INSERT/UPDATE/DELETE gate; SELECT split by `club_id IS NULL` | feed perf |
| 9 | Comments | `post_comments` | SELECT **true** | `comments/[postId].tsx` | direct insert | ✔ | ✔ | ✔ | private broadcast (050) | no new comments | hidden from blocker both ways | policies | thread gaps |
| 10 | Likes | `post_likes` | SELECT true; manage own | — | direct | ✔ | ✔ | ✔ | private broadcast (050) | no new likes | suppressed both ways | policies | counts drift (§2.3) |
| 11 | Event interactions / RSVPs | `event_rsvps` (+`user_privacy.hide_events`) | manage own; read respects hide_events | — | direct | ✔ | ✔ | `admin_tx_rsvp_*` | private broadcast (050) | no new RSVPs | **attendance unchanged** — shared events are not contact | attendee-list display filter only | must not break event integrity |
| 12 | Conversations | `conversations` (type ∈ direct/group/club_group/officer_chat) | participants read; club_group readable by all | `chatService.ts` | `get_or_create_direct_chat` etc. | ✔ | **✖ no messaging on web** | ✔ | in realtime pub | restricted → cannot read/create | no new `direct` conv between A and B | gate in RPC + INSERT policy | 4 conv types, only `direct` is affected |
| 13 | Conversation participants | `conversation_participants` (`hidden_at`, `cleared_before`, `muted_at`) | participants read; self insert/update/delete | — | direct + RPCs | ✔ | ✖ | ✔ | in realtime pub | restricted cannot join | set blocker's `hidden_at` on block | reuse existing column | — |
| 14 | DMs | `messages` where `conversations.type='direct'` | INSERT: `sender_id=auth.uid() AND is_conversation_participant()` | `messagingService.ts` | direct insert | ✔ | ✖ | reveal-gated | in realtime pub | restricted cannot send | **no new messages either direction; history preserved** | INSERT policy + composer state | hottest write path — perf critical |
| 15 | Custom group chats | `conversations.type='group'` | same | `create_group_chat`, `add_group_participants` | RPC | ✔ | ✖ | ✔ | realtime | restricted excluded | **fully visible, no filtering** (§2.3) | block A→B *invitation* only | conversation integrity |
| 16 | Club chats / channels | `type='club_group'`/`'officer_chat'`, `conversation_channels`, `channel_posters` | membership/officer based | — | RPC | ✔ | ✖ | ✔ | realtime | restricted excluded | **fully visible, no filtering** | none | founder's safety rule |
| 17 | Messages (all) | `messages` | 4 policies incl. non-member club preview | **two renderers**: `components/chat/ConversationThread.tsx` and the standalone `club/[clubId]/channels/[channelId].tsx` (1,178 lines) | direct insert | ✔ | ✖ | reveal-gated | realtime | denied | direct-only restriction | §4.3 | 94 rows today, unbounded later; **any per-message client filtering must be built twice** |
| 18 | Group invitations | `chat_invitations`, `join_chat_invitation()`, `add_group_participants()` | token-based SECDEF | `messagingService.ts:397-436` | RPC | ✔ | preview only | — | — | restricted cannot join | A cannot add B; B cannot be added by A | guard inside both RPCs | token links are public |
| 19 | Notifications | `notifications` + `insert_notification_once()` + `notifications_prepare` trigger | own only | `useNotifications` | trigger-only | ✔ | ✔ | ✔ | in realtime pub | none created for restricted | suppressed for blocked pairs | **single choke point** = `insert_notification_once()` + a BEFORE INSERT guard | `add_group_participants`/`create_group_chat` insert directly, bypassing the helper |
| 20 | Push | `push_queue` ← `enqueue_push()` ← `notifications_after_insert_push` | RLS on, **zero policies** (deny-all to students) | — | trigger | ✔ | ✖ | ✔ | — | none enqueued | suppressed pre-enqueue | guard in `enqueue_push()` | stale queued items (§8) |
| 21 | Reports | `reports` (21 cols incl. `content_snapshot`) | insert own / read own / service_role all | `reportService.ts`, `report_message()` | insert + RPC | ✔ | ✔ | ✔ | — | restricted may still be reported | **reporting a blocked user must keep working** | explicit carve-out in every gate | easy to break by accident |
| 22 | Account deletion | `delete_own_account_atomic()` | SECDEF `auth.uid()` | `accountService.ts` | RPC | ✔ | ✔ | — | — | **must remain available** (§9) | must remain available | add `user_blocks` cleanup; audit survives (no FK) | App Store 5.1.1(v) |
| 23 | Admin user detail | `app/admin/users/[id]/page.tsx` | service_role | server | server actions | — | — | ✔ | — | new Access panel | read-only block count | §5 | — |
| 24 | Student web auth/routing | `apps/web/middleware.ts` | — | — | — | — | ✔ | — | per-request | redirect to restriction screen | none | §6.3 | already does a `profiles` lookup — cheap to extend |
| 25 | Mobile auth/routing | `app/_layout.tsx` + `lib/platformAdmin.ts` | — | — | — | ✔ | — | — | boot + `onAuthStateChange` | route to restriction screen | none | §6.2 | must stay OTA-safe |
| 26 | Realtime | 13-table publication + `lib/realtime.ts` `createSafeChannel` + 050 private broadcast | — | — | — | ✔ | ✔ | — | — | see §7 | see §7 | **do not add `profiles`** | payload/privacy |
| 27 | Storage | `storage.objects`, 6 buckets | see below | — | — | ✔ | ✔ | — | — | see below | see below | **none** | honest limitation |

### Storage — verified bucket reality

| Bucket | Read policy | Consequence |
|---|---|---|
| `avatars` | `bucket_id='avatars'` — **fully public** | A blocked/restricted user's avatar object stays fetchable by direct URL |
| `posts` | **fully public** | same for post images |
| `club-photos`, `club-avatars`, `club-covers` | **fully public** | same |
| `chat-attachments` | `is_conversation_participant(foldername[1]::uuid)` — **private** | DM/group attachments already correctly gated |

**Honest limitation to state in the product copy and to the founder:** neither an administrator restriction nor a student block can retract an already-known public CDN URL for an avatar or post image. Blocking hides the *account and its surfaces*; it does not make previously-public image bytes unreachable. Changing that would require converting three public buckets to signed URLs — a separate, much larger project, explicitly **out of Day 10B scope**. `chat-attachments` needs no change: in every shared-chat and preserved-DM case both parties remain participants.

## 1.4 Admin infrastructure findings

**F-1 — `requireRecentMfa()` does not enforce the write kill switch.** `secureAdmin.ts:224-235`:

```ts
export async function requireRecentMfa(maxAgeSeconds = ADMIN_STEP_UP_MAX_AGE_SECONDS): Promise<User> {
  const user = await requireSecureAdmin();          // ← no { write: true }
  …
}
```

Its own docblock names "user deletion/suspension" as the intended consumer. As written, a restriction action calling `requireRecentMfa()` would satisfy recent-MFA **but skip `ADMIN_WRITES_ENABLED`**. Today's only callers are two sensitive *reads*, so nothing is broken now. Day 10B must add `requireRecentMfa({ write: true })` (and default `write` to `true` for safety, opting the two read call sites out explicitly).

**F-2 — no platform-admin target guard exists anywhere.** `is_platform_admin_auth(jsonb)` reads `app_metadata`, but no admin action checks whether its *target* is a platform admin. Because platform admins have no `profiles` row (053), most targets are naturally unreachable — but `account_restrictions.user_id` would reference `auth.users`, so this must be an explicit database-level refusal, not an accident of schema shape.

**F-3 — the audit `target_type` CHECK already contains `'user'`.** No constraint change needed; only new rows in `admin_audit_actions`.

**F-4 — `admin_audit_events` has no FK to `profiles` or `auth.users`.** Verified: its only FK is `action → admin_audit_actions`. Audit evidence therefore already survives account deletion. This must be preserved for `account_restrictions` history.

**F-5 — `service_role` holds `SELECT` only on both audit tables.** All writes go through `SECURITY DEFINER` functions owned by `postgres`. Restriction functions must follow the same shape.

---

# 2. Behavior contracts

## 2.1 Administrator suspension

| Property | Contract |
|---|---|
| Effect | Cannot enter or use mobile **or** student web |
| Existing sessions | Denied by database predicate in RLS — not by client routing |
| Auth | Sessions revoked (`signOut` global) + `banned_until` set to `suspended_until` |
| Data | Nothing deleted: posts, messages, clubs, memberships, RSVPs, media all preserved |
| Reversible | Yes — `suspended → active` |
| Expiry | Optional `suspended_until timestamptz` |
| Reason | Internal, admin-visible only; **never** returned to the student |
| Student sees | Generic restriction screen + public support contact + sign-out |
| Direct Supabase | Denied by RLS/RPC predicates — a modified client gains nothing |
| Platform admin | Cannot be targeted (DB-level refusal) |

**Expiration — decided: database predicate, not a cleanup job.**

```
effective_state(user) =
  active           if no active row
  active           if row.status='active' AND row.restriction_type='suspension'
                      AND row.suspended_until IS NOT NULL AND row.suspended_until <= now()
  suspended        if row.restriction_type='suspension' (and not expired)
  platform_blocked if row.restriction_type='platform_block'
```

A cron sweep would create a window in which an expired suspension still blocks a student — an availability bug with legal/store exposure. The predicate is evaluated at query time so expiry is exact to the second. `banned_until` is set to the same timestamp so GoTrue's own expiry matches. An **optional** nightly job may flip `status` to `'expired'` for reporting hygiene only; it is **never** consulted for enforcement, and the system is correct if it never runs.

## 2.2 Administrator platform block

Everything in §2.1, plus:

- Indefinite until an administrator explicitly unblocks. `suspended_until` must be `NULL` (DB CHECK).
- `banned_until` set far future (e.g. `now() + 100 years`) rather than left unset.
- Profile excluded from student search and recommendations.
- No new DMs, follows, invitations, messages, posts, comments, RSVPs, likes, reports-as-actor.
- **Existing public content is NOT deleted.** A block is an access sanction, not content moderation. Removing content is a separate, separately-audited action.
- Administrator retains full read access to the user's data and reports.
- Unblock restores *access only*. It does not recreate follows, memberships, RSVPs, or anything removed by a separate action.
- The user never receives the internal reason or any administrator note.

**Platform block vs. permanent deletion**

| | Platform block | Account deletion |
|---|---|---|
| Data | preserved | destroyed / anonymized per `delete_own_account_atomic` |
| Reversible | yes | no |
| Who initiates | administrator | the student (or support on request) |
| Auth row | exists, banned | deleted |
| Audit | append-only, retained | append-only, retained (no FK) |
| Store obligation | must not obstruct the deletion right (§9) | is the deletion right |

## 2.3 Student-to-student block

**Directional ownership, symmetric prevention.** A owns the row; the *prevention* applies in both directions.

Verified behaviors:

| Behavior | Contract |
|---|---|
| Discovery | A cannot find B; B cannot find A |
| Follow | neither may follow the other |
| Existing follows | **both directions deleted atomically inside the block transaction** |
| Gluemate | disappears immediately (Gluemate = mutual accepted follow; deleting either row ends it) |
| Unblock | does **not** restore follows or Gluemate status |
| New DM | denied both ways |
| Existing DM | **no new messages either direction; history preserved for both** |
| Entry points | share-to-DM, profile Message button, group invitations, "add to group" all disabled A↔B |
| Notifications | new ones caused by the other user suppressed |
| Push | suppressed before enqueue |
| Deep links | safe unavailable state, both directions |
| Disclosure | B is not notified; only A sees B in Blocked Accounts |
| Unblock UI | Settings → Blocked Accounts, and the profile overflow menu |
| Clubs / events | **unchanged** — memberships, officer status, RSVPs, university all untouched |
| Shared chats | must not break for other participants |

### The six-category behavior matrix

| # | Category | Visible to blocker (A)? | Visible to blocked (B)? | Can A act? | Can B act? | Rationale |
|---|---|---|---|---|---|---|
| **1** | **Personal / social content** — personal posts (`posts.club_id IS NULL`), comments, likes, personal profile | **Hidden both ways** | **Hidden both ways** | no | no | This is the interpersonal surface a block exists to sever. |
| **2** | **Official club content** — club posts (`club_id IS NOT NULL`), officer-created club content, events, announcements, club photos, club goals | **Fully visible** | **Fully visible** | normal club rights | normal club rights | **Founder's safety rule.** A student who blocks an officer must not lose the club's event times, announcements, or safety information. Club content belongs to the club, not the author. |
| **3** | **Direct conversations** | history visible; composer disabled; thread `hidden_at` set for A only | history visible; composer disabled | **no new messages** | **no new messages** | Preserves evidence for reports and honours "data preserved". Prevents contact, which is the point. |
| **4** | **Shared group conversations** (`type='group'`) | **all messages visible, no filtering, no placeholder** | same | may leave; may not add B | may leave; may not add A | See the shared-chat decision immediately below. |
| **5** | **Shared club conversations** (`club_group`, `officer_chat`, channels, polls, announcements) | **all messages visible, no filtering** | same | normal | normal | Same as category 2. Filtering an officer's channel post would delete a club's operational record from one member's view. |
| **6** | **Reports & moderation evidence** | A can still report B | B can still report A | yes | yes | Blocking must never be a shield against being reported, nor a barrier to reporting. `reports.content_snapshot` / `attachment_snapshot` are untouched by blocks. Administrators see everything. |

**Notifications created before the block:** retained, not deleted. Rationale — deleting them is a destructive rewrite of the blocker's own history, it can be inferred by B if counts change, and it is not required by any store policy. They are, however, **filtered out of the notification list render** for actor-linked types where the actor is now blocked, and their deep links resolve to the unavailable state. Push items already queued: see §8.

**Likes/comment counts:** counts are computed from `post_likes` / `post_comments` rows. Filtering the *rows* changes A's visible count relative to everyone else's. Decision: **filter rows, accept the count difference, do not attempt to keep counts globally identical.** Trying to show a count that includes rows the viewer cannot see leaks the existence of a hidden actor. A small, private discrepancy is the safer error.

## 2.4 Shared-chat decision — the three options, compared

The founder named three candidate behaviours for group and club conversations. All three were evaluated against the **actual** client architecture, not against a generic chat app.

The decisive architectural fact — **verified in source, and it is worse for Options A and B than a single shared renderer would be.** There are **two independent message renderers**:

| Renderer | Covers | Size |
|---|---|---|
| `components/chat/ConversationThread.tsx` — rendered by `app/chat/[chatId]/index.tsx:428` and `app/chat/[chatId]/[channelId].tsx:147` | `direct`, `group`, `club_group`, `officer_chat` reached through the Messages tab | shared component |
| `app/club/[clubId]/channels/[channelId].tsx` | club channels reached through the **club profile** — its own `FlatList` and its own message rendering, not `ConversationThread` | **1,178 lines, standalone** |

So message-level filtering for blocking would have to be written **twice, in two independently-authored renderers**, and kept in agreement forever. The second one is precisely the surface that carries official club announcements — the content the founder's safety rule protects.

At the database layer the cost is equally poor: `messages` has no conversation-type column, so any policy that filters DMs but spares club chats needs an `EXISTS` join to `conversations` on **every** message read — a per-row join added to the highest-volume query in the product.

| | Option A — hide blocked sender's messages from the blocker | Option B — neutral "message hidden" placeholder | **Option C — keep shared-context messages visible, prevent direct communication** ✅ |
|---|---|---|---|
| Conversation integrity | **Broken.** Replies, quotes and poll context reference messages A cannot see. | Preserved structurally, holes visible. | **Fully preserved.** |
| Founder's safety rule ("official club info must not disappear because a student blocked an officer") | **Violated.** An officer's channel announcement vanishes from a member's view. | Technically satisfied, but the announcement is replaced by "hidden" — functionally the same harm. | **Satisfied.** |
| Polls | `polls`/`poll_options`/`poll_votes` are keyed to `messages.id`. Hiding the message orphans a poll A may already have voted in. | Same orphaning, now visibly. | **No effect.** |
| Non-disclosure | Weak — A's own view differs from every other member's, and a "hidden" gap where an officer posted is trivially attributable. | **Worst.** A placeholder is a per-message announcement that someone is blocked. | **Strongest** — nothing in a shared room changes at all. |
| RLS cost on `messages` | New `EXISTS` join to `conversations` on every message SELECT — the hottest read path. | Same cost. | **Zero.** `messages` SELECT policies are untouched. |
| Client change | Rework **both** renderers (`ConversationThread` **and** the 1,178-line club-channel screen) and keep them in agreement. | Same, plus a new placeholder component in both. | **None** to either renderer; composer state only. |
| Matches user expectation | No — users expect a block to stop contact, not to censor a club they chose to join. | No. | **Yes** — Instagram, Discord servers and Slack all behave this way. |

**Recommendation: Option C.** Keep every message in shared group and club conversations fully visible to both parties, with no filtering and no placeholder, and prevent contact at the surfaces that actually constitute contact — DMs, follows, discovery, invitations, notifications and push.

**The tradeoff, stated plainly:** A will still *see* B's messages in a club or group chat they both belong to. That is a real cost, and some users will expect a block to be total. It is accepted because the alternatives are worse in every dimension that matters: Option A silently deletes official club information from a student's view (the one outcome the founder explicitly forbade), Option B announces the block on every affected message, and both add a per-row join to the highest-volume query in the product for a benefit users do not actually want. The mitigation for a user who genuinely cannot share a room with someone is the one that already exists and is correct — **leave the group, or report them**, both of which remain fully available.

---

# 3. Proposed canonical schema — migrations 057 and 058

**Numbering:** next free number after `056` is **`057`**. Migration `051` remains absent by design and is *not* backfilled (052 already ships without it — the gap is established precedent). Two migrations, because these are two independent systems with different threat models, different owners, and different rollback stories:

- `057_account_restrictions.sql` — administrator restrictions
- `058_user_blocks.sql` — student-to-student blocks

## 3.1 `account_restrictions` (057)

```sql
CREATE TABLE public.account_restrictions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NO foreign key, deliberately. See §9.2: an FK to profiles/auth.users would
  -- let account deletion destroy enforcement history, which is administrator
  -- evidence. Same rule the 055 audit tables already follow.
  user_id          uuid        NOT NULL,
  restriction_type text        NOT NULL CHECK (restriction_type IN ('suspension','platform_block')),
  status           text        NOT NULL DEFAULT 'active'
                                        CHECK (status IN ('active','lifted','expired')),
  reason           text        NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 500),
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid,
  suspended_until  timestamptz,
  lifted_at        timestamptz,
  lifted_by        uuid,
  lift_reason      text        CHECK (lift_reason IS NULL OR char_length(lift_reason) BETWEEN 3 AND 500),
  correlation_id   uuid        NOT NULL,

  -- A platform block is indefinite by definition; a suspension may expire.
  CONSTRAINT ar_block_has_no_expiry
    CHECK (restriction_type <> 'platform_block' OR suspended_until IS NULL),
  -- 'lifted' must carry its evidence; 'active' must not pretend to be lifted.
  CONSTRAINT ar_lift_consistency
    CHECK ((status = 'lifted'  AND lifted_at IS NOT NULL AND lifted_by IS NOT NULL)
        OR (status <> 'lifted' AND lifted_at IS NULL     AND lifted_by IS NULL)),
  CONSTRAINT ar_expiry_forward
    CHECK (suspended_until IS NULL OR suspended_until > created_at)
);

-- ONE coherent active restriction per account, AND the enforcement lookup index.
CREATE UNIQUE INDEX uq_account_restrictions_active
  ON public.account_restrictions (user_id) WHERE status = 'active';

-- History reads (admin detail page, ordered newest-first).
CREATE INDEX idx_account_restrictions_user_created
  ON public.account_restrictions (user_id, created_at DESC);

-- Cross-reference an audit correlation id back to the restriction it produced.
CREATE INDEX idx_account_restrictions_correlation
  ON public.account_restrictions (correlation_id);
```

**Append-mostly, never destructive.** Rows are inserted on suspend/block; lifting **updates** the row (`status='lifted'`, `lifted_at/by/reason`) rather than deleting it, and a `BEFORE DELETE`/`BEFORE TRUNCATE` trigger (mirroring `private.admin_audit_block_mutation`) refuses removal outright. History is therefore complete.

**Timestamps are server-generated** — `created_at`/`updated_at` default to `now()`; a `BEFORE UPDATE` trigger overwrites `updated_at`. No client-supplied timestamp is ever trusted.

**RLS:**

```sql
ALTER TABLE public.account_restrictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_restrictions FORCE ROW LEVEL SECURITY;
-- ZERO policies. Exactly like admin_audit_events: nothing reaches this table
-- through PostgREST. Ordinary students cannot read administrator reasons, and a
-- restricted user cannot alter their own restriction, because there is no path.
REVOKE ALL ON public.account_restrictions FROM anon, authenticated;
GRANT  SELECT ON public.account_restrictions TO service_role;  -- SELECT ONLY
```

Writes happen **only** inside `SECURITY DEFINER` functions owned by `postgres` (§4.5). This matches the verified production reality that `service_role` holds `SELECT` only on the audit tables and that prod `postgres` is `NOSUPERUSER + BYPASSRLS`, so grants — not policies — are the operative control for `service_role`.

**What a student *is* allowed to learn about their own restriction:** only what the enforcement predicate returns — `'suspended'` or `'platform_blocked'`, plus `suspended_until` when it is a suspension. Delivered by a narrow `SECURITY DEFINER` RPC (`my_access_state()`), never by table access. **`reason` is never in that payload.**

## 3.2 `user_blocks` (058)

```sql
CREATE TABLE public.user_blocks (
  blocker_id uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  blocked_id uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CONSTRAINT user_blocks_no_self CHECK (blocker_id <> blocked_id)
);

-- The PK covers "who have I blocked". This covers "who has blocked me",
-- which the symmetric predicate needs on every evaluation.
CREATE INDEX idx_user_blocks_blocked ON public.user_blocks (blocked_id, blocker_id);
```

FK cascade on both columns is correct here (unlike restrictions): a block is a *live relationship*, not evidence. When either account is deleted the relationship is meaningless, and cascade satisfies "account deletion cleans relationship rows safely" with **zero changes to `delete_own_account_atomic`**.

**RLS:**

```sql
ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_blocks FORCE ROW LEVEL SECURITY;

-- The ONLY student-facing policy: you may read the blocks you own.
CREATE POLICY "user_blocks: blocker reads own"
  ON public.user_blocks FOR SELECT TO authenticated
  USING (blocker_id = auth.uid());

-- No INSERT / UPDATE / DELETE policies at all — mutation is RPC-only (§4.5),
-- so blocking and follow-removal cannot be split into two client round-trips.
REVOKE INSERT, UPDATE, DELETE ON public.user_blocks FROM authenticated;
GRANT  SELECT ON public.user_blocks TO service_role;
```

This satisfies every stated requirement: unique pair (PK), no self-block (CHECK), only the blocker can list, **blocked users cannot enumerate who blocked them** (the SELECT policy is `blocker_id = auth.uid()`, so B's query returns zero rows), no public counts (no aggregate is exposed anywhere), and no durable admin audit for ordinary student blocks. Operational logging records `(blocker_id, blocked_id, outcome)` only — no content, no reason, no admin trail.

**Why narrow SECURITY DEFINER RPCs rather than direct table INSERT:** blocking is not one write. It is `INSERT user_blocks` + `DELETE follows` (both directions) + `UPDATE conversation_participants.hidden_at`, and all of it must be one transaction. If a client could `INSERT` directly, a hostile or merely crashed client could create the block row and leave the follow rows in place — a Gluemate relationship surviving a block. RPC-only makes that unrepresentable.

---

# 4. Enforcement architecture

## 4.1 The predicate layer

All names in `public`, all `STABLE`, all `SET search_path = ''`, all `SECURITY DEFINER` (they read tables the caller cannot).

```sql
-- ── Administrator restrictions ────────────────────────────────────────────────

-- Effective state for an arbitrary user. Expiry is evaluated here, so it is
-- exact and needs no cleanup job.
public.account_access_state(p_user uuid) RETURNS text   -- 'active'|'suspended'|'platform_blocked'

public.is_account_restricted(p_user uuid) RETURNS boolean
  -- = account_access_state(p_user) <> 'active'

-- THE hot-path predicate. Argument-free on purpose (see §4.4).
public.can_student_access_app() RETURNS boolean
  -- = auth.uid() IS NOT NULL AND account_access_state(auth.uid()) = 'active'

-- ── Student blocks ────────────────────────────────────────────────────────────

-- Symmetric: true if EITHER direction of block exists.
public.users_have_block_relationship(p_a uuid, p_b uuid) RETURNS boolean

-- THE hot-path set. Argument-free, returns every uuid the current user cannot
-- interact with, in either direction.
public.blocked_user_ids() RETURNS uuid[]
  -- SELECT coalesce(array_agg(other), '{}') FROM (
  --   SELECT blocked_id AS other FROM user_blocks WHERE blocker_id = auth.uid()
  --   UNION
  --   SELECT blocker_id            FROM user_blocks WHERE blocked_id = auth.uid()
  -- ) s

-- ── Combined ──────────────────────────────────────────────────────────────────

public.users_may_interact(p_a uuid, p_b uuid) RETURNS boolean
  -- = NOT is_account_restricted(p_a) AND NOT is_account_restricted(p_b)
  --   AND NOT users_have_block_relationship(p_a, p_b)
```

`users_may_interact()` is for **RPCs and server code**, where it is called once. It must **never** appear in a policy over a high-volume table — see §4.4.

## 4.2 Policy changes — administrator restriction (the write half)

The security-critical half is **mutation**. Add `public.can_student_access_app()` as a conjunct to the `WITH CHECK` (and `USING` for UPDATE/DELETE) of every student-writable policy:

`posts` (I/U/D) · `post_comments` (I/D) · `post_likes` (ALL) · `follows` (I/U/D) · `event_rsvps` (ALL) · `saved_events` (ALL) · `messages` (I/U) · `conversations` (U) · `conversation_participants` (I/U/D) · `user_interests` (ALL) · `user_privacy` (ALL) · `profiles` (U) · `reports` (**INSERT — carve-out, see below**) · `poll_votes`, `polls`, `poll_options`, `post_club_tags`, `club_members`, `club_goals`, `club_photos`, `channel_mutes`, `channel_reads`, `message_hides`, `push_tokens`, `event_interests`, `event_activities`, `club_interests`, `club_categories`, `notifications` (U/D), `deletion_requests`, `club_officers`.

**Carve-outs — deliberately NOT gated:**
- `reports` INSERT — a suspended student may still report abuse. Removing that would be indefensible.
- `deletion_requests` INSERT and `delete_own_account_atomic()` — §9.3.
- `notifications` UPDATE/DELETE (mark-read) — harmless, and gating it produces confusing errors on a screen the student cannot reach anyway. *(Low priority; gate for consistency if cheap.)*

**Protected reads** additionally gated with `can_student_access_app()`: `messages` SELECT (both participant and club-preview policies), `conversations` SELECT, `conversation_participants` SELECT, `notifications` SELECT, `chat-attachments` storage SELECT. Public club content reads (`clubs`, `events`, `posts` where `club_id IS NOT NULL`) are left ungated — a restricted user who defeats the client still sees only what any signed-in student sees, which is not a leak, and gating them would double the policy cost on the feed for no security gain.

## 4.3 Policy changes — student block

```sql
-- profiles: the discovery surface.
DROP POLICY "profiles: anyone authenticated can read" ON public.profiles;
CREATE POLICY "profiles: authenticated read, block-aware"
  ON public.profiles FOR SELECT TO authenticated
  USING (
        id = auth.uid()                                   -- always see yourself
    OR  id <> ALL ( (SELECT public.blocked_user_ids()) )   -- InitPlan; see §4.4
  );

-- posts: personal posts filtered, CLUB posts always visible (§2.3 category 2).
CREATE POLICY "posts: authenticated read, block-aware"
  ON public.posts FOR SELECT TO authenticated
  USING (
        club_id IS NOT NULL                                -- official club content
    OR  author_id = auth.uid()
    OR  author_id <> ALL ( (SELECT public.blocked_user_ids()) )
  );

-- post_comments / post_likes / follows: same <> ALL shape on user_id/actor.

-- messages: DIRECT conversations only. Group and club chats are untouched.
CREATE POLICY "messages: participants can insert"           -- replaces existing
  ON public.messages FOR INSERT TO authenticated
  WITH CHECK (
        sender_id = auth.uid()
    AND public.is_conversation_participant(conversation_id)
    AND (channel_id IS NULL OR public.can_post_in_channel(channel_id))
    AND public.can_student_access_app()
    AND NOT EXISTS (                                       -- the block gate
          SELECT 1
          FROM public.conversations c
          JOIN public.conversation_participants cp ON cp.conversation_id = c.id
          WHERE c.id = messages.conversation_id
            AND c.type = 'direct'
            AND cp.user_id <> auth.uid()
            AND cp.user_id = ANY ( (SELECT public.blocked_user_ids()) )
        )
  );
```

The `messages` SELECT policies are **not** changed. That is the §2.3 categories 3–5 decision made concrete: history is preserved, shared rooms are never filtered, and the hottest read path in the product gains zero cost.

## 4.4 Performance — the index and query plan

This is the part that makes the design viable at scale, so it is stated precisely.

**The rule:** a `STABLE` function whose arguments do not reference the current row is **not** correlated with the scan, so the planner can hoist it. Wrapping the call in a scalar subquery — `(SELECT public.blocked_user_ids())` — forces an **InitPlan**, which Postgres evaluates **exactly once per statement** and then reuses as a constant. This is the standard Supabase RLS optimization and it is why both hot predicates are deliberately argument-free.

| Predicate | Shape | Evaluations per query | Index used | Cost |
|---|---|---|---|---|
| `can_student_access_app()` | argument-free, InitPlan | **1** | `uq_account_restrictions_active` (partial, `WHERE status='active'`) | one index probe on a tiny index — restricted accounts are a vanishing fraction of all accounts, so the partial index stays a page or two even at millions of users |
| `blocked_user_ids()` | argument-free, InitPlan → `uuid[]` | **1** | `user_blocks_pkey` + `idx_user_blocks_blocked` | two index range scans on a per-user prefix |
| `id <> ALL (const array)` | array comparison against a constant | per row, but **no subquery, no join, no I/O** | — | a few ns/row; the array is typically 0–50 elements |
| `users_may_interact(a,b)` | **two arguments, row-correlated** | **per row** | — | **must never appear in a policy on `profiles`, `posts`, `messages`, or any feed query.** RPC/server use only. |

**Expected plans (to be captured with `EXPLAIN (ANALYZE, BUFFERS)` during implementation, on a seeded shadow database — not on production):**

```
-- Feed read: SELECT * FROM posts ORDER BY created_at DESC LIMIT 20
InitPlan 1 (returns $0)
  ->  Function Scan on blocked_user_ids            (actual rows=1 loops=1)   ← ONCE
Limit
  ->  Index Scan Backward using idx_posts_created_at on posts
        Filter: (club_id IS NOT NULL OR author_id = auth.uid() OR author_id <> ALL ($0))

-- Message send: INSERT INTO messages …
InitPlan 1 (returns $0)  ->  Function Scan on blocked_user_ids   ← ONCE
InitPlan 2 (returns $1)  ->  Function Scan on can_student_access_app   ← ONCE
```

**Acceptance gate before merge:** no new plan node with `loops > 1` on `profiles`, `posts`, `post_comments`, `messages`, or `notifications`; total added planning+execution time on the Home feed and a 50-message conversation page **< 5 ms** at production data volume, measured on a seeded shadow DB.

**No additional index is required on existing tables.** Verified live: `posts` already carries `idx_posts_author_id` and `idx_posts_author_created (author_id, created_at DESC)`; `follows` carries five indexes including both directional pairs; `conversation_participants` carries `idx_conv_participants_user_id`. Every column the new policies filter on is already indexed. The only new indexes are the three on `account_restrictions` and the two on `user_blocks`.

## 4.5 RPC model

### Student-facing (`authenticated`, SECURITY DEFINER, `auth.uid()`-authorized — never a caller-supplied id)

| RPC | Contract |
|---|---|
| `block_user(p_target uuid) → jsonb` | ONE transaction: refuse self/missing/platform-admin target → `INSERT user_blocks ON CONFLICT DO NOTHING` (idempotent, so a duplicate block is a silent success, not an error that leaks state) → `DELETE FROM follows` both directions → set `conversation_participants.hidden_at = now()` for the blocker on any shared `direct` conversation. Returns `{status:'ok'}` in every non-error case. |
| `unblock_user(p_target uuid) → jsonb` | `DELETE FROM user_blocks WHERE blocker_id = auth.uid() AND blocked_id = p_target`. **Restores nothing.** Idempotent. |
| `list_my_blocks(p_limit int, p_offset int)` | `blocker_id = auth.uid()` only; returns id/username/full_name/avatar_url/created_at. |
| `my_access_state() → jsonb` | `{state, suspended_until}`. **Never returns `reason`.** Callable by a restricted user — this is the one thing they must be able to read. |

`DELETE FROM follows` inside `block_user` fires `trg_follow_delete_notify` → `handle_follow_delete()`. **Verified against the live function body: it emits nothing.** Its entire behaviour is to `DELETE` a stale `follow_request` notification when a *pending* follow is removed. So the block path is not only non-disclosing, it is actively helpful — a pending follow request from B disappears from B's own notification list as a side effect, with no new notification of any kind. No suppression mechanism is needed.

### Administrator (`service_role`, mirroring the 056 `admin_tx_*` shape exactly)

```
admin_tx_restriction_suspend(p_actor_id, p_actor_email, p_reason, p_correlation_id,
                             p_user_id, p_suspended_until)
admin_tx_restriction_unsuspend(…, p_user_id, p_lift_reason)
admin_tx_restriction_block(…,     p_user_id)
admin_tx_restriction_unblock(…,   p_user_id, p_lift_reason)
```

Each returns `private.admin_tx_ok(...)` or `private.admin_tx_fail(..., code)` so the restriction change and its audit row commit in **one** transaction — or neither does. New `admin_audit_actions` rows (`target_type='user'`, already permitted by the existing CHECK):

| action | sensitivity | requires_reason |
|---|---|---|
| `restriction.suspend` | destructive | **true** |
| `restriction.unsuspend` | sensitive | **true** |
| `restriction.block` | destructive | **true** |
| `restriction.unblock` | sensitive | **true** |
| `restriction.revokeSessions` | sensitive | **true** (cross-service leg) |

`STATE_FIELDS.user` in `auditSanitize.ts` is currently `["id","created_at"]` and must be extended to `["id","created_at","restriction_type","status","suspended_until","lifted_at"]`. **`reason` and `lift_reason` are deliberately excluded from before/after state** — they already live in `admin_audit_events.reason`, and duplicating them into a JSONB blob doubles the surface for accidental disclosure.

Failure codes: `already_suspended`, `already_blocked`, `not_restricted`, `no_change`, `invalid_transition`, `platform_admin_target`, `self_target`, `user_not_found`, `invalid_expiry`.

---

# 5. Administrator Dashboard design

## 5.1 User detail — new "Access" panel (`app/admin/users/[id]/page.tsx`)

```
┌─ Access ────────────────────────────────────── [Suspend] [Block from We Glue] ─┐
│  State          ● Suspended                                                    │
│  Expires        2026-08-14 09:00 CT   (in 13 days)   — or "No expiry"          │
│  Applied        2026-07-31 11:04 CT                                            │
│  By             zarellanocampos@… (founder)                                    │
│  Reason         Repeated harassment reports in club chat  ← ADMIN-ONLY         │
│  Sessions       Revoked ✓  ·  Auth ban until 2026-08-14   [correlation 3f2a…]  │
│  Blocks         Has blocked 3 · Blocked by 1   (counts only — never the list)  │
│  Related        4 reports →   ·   Audit history →                              │
└────────────────────────────────────────────────────────────────────────────────┘

┌─ Restriction history ──────────────────────────────────────────────────────────┐
│  When        Type              Status  By        Reason      Lifted    Corr.   │
│  07-31 11:04 suspension        active  founder   Repeated…   —         3f2a…   │
│  07-02 14:22 suspension        lifted  founder   Spam in DM  07-09 …   9c1b…   │
└────────────────────────────────────────────────────────────────────────────────┘
```

**"Blocks" shows counts only.** Exposing *who* blocked a user in the dashboard would let an administrator disclose it, defeating the non-disclosure guarantee at the human layer. Counts are enough for moderation triage ("this account has been blocked by 40 people this week" is a signal; the identities are not needed to act).

The **`/admin/restrictions` page** (currently 82 lines of honest "not supported in current schema") becomes the platform-wide queue: active suspensions, active blocks, expiring within 7 days, recently lifted — plus a link into each user's detail. The `DisabledAction` placeholders for *Timeout*, *Shadow restriction*, *Content restriction*, *Club restriction*, and *Report-based sanction* **stay exactly as they are** — Day 10B does not build them and must not imply it did.

## 5.2 The action contract

Every one of the four actions:

| Requirement | Implementation |
|---|---|
| identify the exact user | `p_user_id` UUID validated server-side; the confirm dialog restates username + email + id |
| 3–500 character reason | `ConfirmAction requireReason` (client) → `assertAuditReason()` (server, pre-mutation) → `admin_audit_events_reason_len_chk` (database). **Three independent layers.** |
| recent MFA | `requireRecentMfa({ write: true })` — **requires F-1 to be fixed first** |
| global write gate | `ADMIN_WRITES_ENABLED` via the same `{write:true}` |
| reject direct-call bypass | Server Actions only; actor is always the `User` from `requireSecureAdmin()`, never a form field |
| refuse platform-admin targets | database-level: `admin_tx_restriction_*` returns `platform_admin_target` if `is_platform_admin_auth(raw_app_meta_data)` — checked in SQL, not TypeScript |
| refuse founder self-target | `p_user_id = p_actor_id` → `self_target`. **Belt and braces:** the founder's dashboard identity has no `profiles` row (053), so it cannot appear in the user list — but the guard is explicit anyway |
| refuse no-op / invalid transitions | §5.3 table, enforced in SQL |
| correlation id | one id spans the DB transaction **and** the Auth revocation legs |
| sanitized before/after | `STATE_FIELDS.user`, extended as above; reason excluded |
| honest success/failure | `runAtomicMutation` maps each code to plain founder-facing wording; the Auth leg reports its own outcome separately and may legitimately read "restriction applied; session revocation failed — flagged for reconciliation" |
| prevent duplicate submission | `ConfirmAction` disables on submit; **and** the partial unique index `uq_account_restrictions_active` makes a double-suspend a database error, not a second row |
| inaccessible while writes disabled | every action throws `writes_disabled` before touching data; the panel renders read-only with a `DisabledAction` explaining why |

## 5.3 Valid transitions

| From | To | Allowed | Action |
|---|---|---|---|
| active | suspended | ✅ | `restriction.suspend` |
| active | platform_blocked | ✅ | `restriction.block` |
| suspended | active | ✅ | `restriction.unsuspend` |
| suspended | platform_blocked | ✅ | `restriction.block` (escalation: lifts the suspension row **and** inserts the block row in one transaction) |
| platform_blocked | active | ✅ | `restriction.unblock` |
| **platform_blocked** | **suspended** | ❌ **PROHIBITED** | — |
| active | active | ❌ `no_change` | — |
| suspended | suspended | ❌ `already_suspended` | — |
| platform_blocked | platform_blocked | ❌ `already_blocked` | — |

**`platform_blocked → suspended` is prohibited — recommendation, with reasoning.** It is a de-escalation with no capability that two audited steps (unblock → suspend) do not already provide. Allowing it silently converts an *indefinite* sanction into an *expiring* one inside a single click, which is the exact shape of a mistake that is hard to spot in an audit log. Two steps produce two records, two reasons, and an unambiguous moment at which the account was unrestricted. If the founder wants one-click de-escalation later it can be added as an explicit `restriction.downgrade` action with its own catalog entry — but it should not be smuggled in as a variant of "suspend".

## 5.4 Auth session revocation — the cross-service leg

Postgres and GoTrue cannot share a transaction. `lib/admin/crossService.ts` already implements the correct pattern and is used today by exactly one action (`portal.lock`). Restriction revocation becomes its second consumer:

```
correlation_id C
├─ [DB transaction]  admin_tx_restriction_block(...)   → row + audit 'success'   (atomic)
└─ [cross-service]   runCrossServiceOperation({
       action: 'restriction.revokeSessions',
       perform: async () => {
         await admin.auth.admin.signOut(userId, 'global')             // kill refresh tokens
         await admin.auth.admin.updateUserById(userId, {              // block re-login
           ban_duration: <until suspended_until, or '876000h' for a block>
         })
       }
     })
     → 'attempt'  (BEFORE the call; if it cannot be recorded, the call does not happen)
     → 'success' | 'failure' | 'reconciliation_required'
```

**Ordering: database first, then Auth.** If Auth succeeds but the database write fails, the student is locked out with no record of why — the worst outcome. Database-first means the failure mode is "restriction is in force via RLS, but the old access token survives until it expires", which the dashboard reports honestly and an administrator can retry.

**Precise honesty about "immediately":**

| Layer | Effect | Latency |
|---|---|---|
| RLS predicates | every protected read and every write denied | **immediate — next query** |
| `signOut(global)` | refresh tokens destroyed; session cannot be renewed | immediate |
| `ban_duration` | new sign-in refused by GoTrue | immediate |
| **the already-issued JWT** | still signature-valid until it expires (default 3600 s) | **up to 1 hour** |

That last row is why the RLS predicate is mandatory and not merely defence in depth. During the residual token window the RLS layer is the *only* thing stopping a restricted account, and it stops it completely. **Any claim that Auth revocation alone makes a session "useless immediately" would be false**, and the dashboard copy must not make it.

---

# 6. Student mobile and web design

## 6.1 Entry points (iOS + Android identical; web where applicable)

| Entry point | Mobile | Student web | Notes |
|---|---|---|---|
| Profile overflow menu | `app/profile/[userId].tsx:184-199` — the ellipsis menu exists and currently offers **Report only**; add **Block / Unblock** | `app/u/[id]/page.tsx` — menu must be **added** | |
| Conversation menu | `app/chat/[chatId]/info.tsx` + `MessageActionsSheet.tsx` | n/a — **web has no messaging UI at all** (verified) | |
| Report flow | `components/shared/ReportButton.tsx` → add "Report and block" | `lib/hooks/useReport.ts` | must still work *after* a block |
| Settings → Blocked Accounts | new `app/privacy-center/blocked-accounts.tsx` — Privacy Center is the correct home (it already owns private-account / hide-interests / hide-events) | new `/profile` settings section | |

## 6.2 Mobile UI states

| State | Copy / behaviour |
|---|---|
| Confirm block | "Block @username? They won't be able to message you or find your profile, and you won't see theirs. They won't be told." |
| Success | optimistic local update + `queryClient.invalidateQueries` for profile / search / conversations / feed |
| Blocked profile | neutral "This account isn't available." — **identical** to the deleted-account and restricted-account states, so the state itself discloses nothing |
| DM disabled | composer replaced with "You can't reply to this conversation." — **identical text for both parties** |
| Blocked Accounts list | avatar + name + date + Unblock; pull-to-refresh |
| Unblock confirm | "Unblock @username? This won't restore your previous Gluemate connection." |
| Empty | "You haven't blocked anyone." |
| Loading / error | existing skeleton + retry primitives |
| Offline | RPC is not queued offline — show "You're offline. Try again when you're connected." A block must never appear to have succeeded when it has not |

**Non-disclosure — the honest limit.** B's composer is disabled, so a determined B can infer *something* changed. This is unavoidable for any block that prevents replies (Instagram, Discord and iMessage all share the property). It is mitigated by using **identical neutral copy** for block, deletion, and restriction so B cannot distinguish which occurred. It is **not** eliminated, and the founder should not be told otherwise.

## 6.3 Administrator-restricted account screen

**Mobile** — extend `lib/platformAdmin.ts` (rename to `lib/sessionRouting.ts`):

```ts
export type MobileSessionRoute =
  | "signed-out"
  | "platform-admin-blocked"
  | "account-restricted"     // NEW
  | "student";
```

Resolution: `app/_layout.tsx` calls `my_access_state()` once at bootstrap and on every `onAuthStateChange`/resume. If it returns `suspended` or `platform_blocked`, **the student tree never mounts** — same containment shape already proven for platform admins. Content:

- generic message: "Your account is currently restricted." / "Your account access has been suspended." (+ "until 14 Aug 2026" when `suspended_until` is present)
- public support contact — **`info@weglue.app`** (per the verified constraint that `SUPPORT_EMAIL` must stay `info@weglue.app` until the domain is verified)
- **no internal reason, ever**
- Sign out
- **Delete my account** — see §9.3
- when the restriction lifts, the next `my_access_state()` returns `active` and the student tree mounts normally, with no reinstall and no re-login

**Student web** — `middleware.ts` already performs a `profiles` lookup on protected/auth-flow routes (line 176). Extend that same query to fetch effective access state (one round trip, not two) and redirect to a **new** `/restricted` page. `/account-restricted` is **not** reused: it is hard-coded to platform-admin identities (line 32 redirects any non-platform-admin to `/home`) and its copy points at the Admin Dashboard. Reusing it would send students toward the private admin portal — unacceptable. `/restricted` must also be reachable from every authenticated route, not only `PROTECTED_PREFIXES`.

## 6.4 Store-compliance constraints

- **No new native permissions.** Nothing here touches camera, contacts, location, notifications-permission, or any OS capability.
- **No new third-party SDK.** Everything is Supabase RPC + existing React Query + existing UI primitives.
- **OTA compatibility: YES.** All mobile work is JS/TS — new screens, new service functions, new hooks, modified routing logic. No new native module, no `app.json`/plugin change, no dependency with native code. It is therefore `eas update --branch production`-compatible.
  **Two caveats the founder must know:** (1) per verified project history, the local `.deno` pnpm layout produces a fingerprint that does **not** match the shipped builds (24/22 → runtimes `6549da75`/`d644c732`), so a plain `eas update` will not reach current testers — the fingerprint must be reconciled first; (2) **no OTA is published in this phase**, as instructed.

---

# 7. Synchronization and Realtime

## 7.1 Administrator action → every surface

```
Admin Dashboard (Server Action, requireRecentMfa + writes gate)
   ↓  admin_tx_restriction_* ............ ONE transaction: restriction row + audit row
   ↓  runCrossServiceOperation .......... attempt → signOut(global) + ban → outcome   [same correlation id]
   ↓
Canonical: account_restrictions  ← the single source of truth
   ├─→ RLS predicates .................... every protected read/write denied     ⏱ IMMEDIATE (next query)
   ├─→ student web: middleware ........... redirect to /restricted               ⏱ next navigation
   ├─→ iOS / Android: my_access_state() .. route to restriction screen           ⏱ next focus/resume/boot
   └─→ search + recommendations .......... profile excluded                      ⏱ next query
```

## 7.2 Student block → every surface

```
Mobile or web: block_user(target)   ← ONE transaction
   ↓  INSERT user_blocks · DELETE follows (both directions) · UPDATE cp.hidden_at
   ↓
   ├─→ local optimistic update + invalidate(profile, search, feed, conversations)  ⏱ <100 ms
   ├─→ Gluemate gone (mutual follow rows deleted)                                  ⏱ immediate
   ├─→ DM composer disabled, thread hidden from A's inbox                          ⏱ immediate
   ├─→ search / recommendations exclude both directions                            ⏱ next query
   └─→ B's device: blocked_user_ids() changes                                      ⏱ next query/refetch
```

## 7.3 Realtime decision — explicit

**Do NOT add `profiles`, `account_restrictions`, or `user_blocks` to the `supabase_realtime` publication.**

- `profiles` — a broad publication broadcasts every column of every changed row to every subscriber matching the RLS filter. With `profiles` SELECT currently `USING (true)`, that is a firehose of the entire student directory. Payload and privacy cost, zero benefit.
- `account_restrictions` — students have **no** SELECT path (zero policies); a publication would be dead weight, and any future policy would risk leaking `reason`.
- `user_blocks` — the blocker already knows (they just acted); the blocked user **must not** be told, and a realtime event is precisely a notification.

**Chosen mechanism instead: bounded refetch.**

| Trigger | Mechanism |
|---|---|
| App foreground / resume | `AppState` listener → `my_access_state()` + invalidate block-sensitive queries |
| Screen focus | existing `useFocusEffect` refetch |
| Cold start | `app/_layout.tsx` bootstrap |
| Web navigation | `middleware.ts` (already per-request) |
| Any protected query | **RLS denies regardless of UI state** — this is the real guarantee |

**Measurable propagation targets:**

| Path | Target | Ceiling |
|---|---|---|
| Server-side enforcement (any protected query) | **immediate** — the very next request | 0 |
| Restricted student's UI reaches the restriction screen | **≤ 5 s** on an active foreground app; **≤ 1 navigation / focus event** otherwise | 30 s |
| Student block reflected in the blocker's own UI | **≤ 100 ms** (optimistic) | 1 s |
| Student block reflected on the blocked user's device | **≤ 1 refetch cycle** (focus / resume / next query) | 60 s |
| Auth session revocation | immediate for refresh; **≤ 3600 s** residual access-token window, fully covered by RLS | 3600 s |

There is no 60-second wait for any *safety* restriction: enforcement is server-side and immediate. The 60-second ceiling applies only to *cosmetic* UI convergence on a device that is idle and not querying — where nothing is at risk because nothing is being fetched.

**Direct canonical changes** (a founder editing `account_restrictions` via SQL) are reflected on the same schedule, because every consumer reads the canonical table rather than a cache of a dashboard action.

---

# 8. Notification and messaging safety

| Requirement | Mechanism | Verified concern |
|---|---|---|
| Blocked pairs cannot trigger new interaction notifications | guard in **`insert_notification_once()`** — the choke point used by `handle_follow_insert`, `handle_post_like_notify`, `handle_post_comment_notify`, and most others | **`create_group_chat` (`messagingService`→SQL) and `add_group_participants` INSERT into `notifications` DIRECTLY, bypassing the helper.** A `BEFORE INSERT` trigger on `notifications` that drops rows where `users_have_block_relationship(NEW.user_id, NEW.actor_id)` is therefore **required** — the helper guard alone is insufficient. This is the single most bypassable path found in the audit. |
| Push suppressed before enqueue | early return in **`enqueue_push()`** — it already returns early for disabled types, absent tokens, hourly caps, and collapse throttles; a block check is the same shape | belt-and-braces with the notifications trigger, since `enqueue_push` is only reached via `notifications_after_insert_push` |
| Existing queued push cancelled | `DELETE FROM push_queue WHERE status='pending' AND ((user_id=A AND …actor B) OR …)` inside `block_user`. `push_queue` has no `actor_id` column, so cancellation is best-effort via `notification_id` join | **honest limit:** an item already `status='sent'` cannot be recalled from APNs/FCM. A push may land seconds after a block. Acceptable and unavoidable. |
| Stale deep link cannot reveal a blocked profile/conversation | the *route allowlist* (046) resolves the destination, then the destination screen re-checks and renders the unavailable state | RLS makes the underlying read return zero rows regardless |
| Existing DM cannot bypass | `messages` INSERT policy (§4.3) | server-side, not UI |
| Muted ≠ blocked | different columns entirely: `conversation_participants.muted_at` / `channel_mutes` vs. `user_blocks` | already separate; no UI shares a control |
| Group/club notifications | follow §2.3 categories 4–5 — **not suppressed**, because the notification is from the *room*, not the person | a club announcement must reach every member |
| Reports still submittable | explicit carve-out in every gate | `reports` INSERT ungated by both restriction and block |
| Moderator evidence retained | `reports.content_snapshot` / `attachment_snapshot` untouched | no schema change |
| Migration 051 | **out of scope, not deployed, not referenced** | confirmed absent |

**Notification copy must never encode block state.** No "you were blocked", no suppressed-count badge, no "some notifications are hidden". Suppression is silent by construction — the row is simply never inserted.

---

# 9. Account deletion and data integrity

## 9.1 Verified interaction with `delete_own_account_atomic()`

The function (SECURITY DEFINER, `auth.uid()`-based) collects storage keys → scrubs FK-less residues → anonymizes reports → deletes orphans → hard-deletes solo-thread messages → **pre-empts every `ON DELETE SET NULL`** (the documented App-Store-5.1.1(v) fix) → `DELETE FROM auth.users`.

| Object | Interaction | Change needed |
|---|---|---|
| `user_blocks` | both FKs `→ profiles(id) ON DELETE CASCADE`; `profiles` cascades from `auth.users` | **NONE.** Cascade handles it. |
| `account_restrictions` | **no FK by design** — rows survive | **NONE.** This is the intended behaviour. |
| `admin_audit_events` | **verified: no FK to profiles/auth.users** (only `action → admin_audit_actions`) | **NONE.** Already safe. |
| `conversation_participants` | already cascades | none |
| Step-6 SET NULL pre-emption | neither new table has a `SET NULL` FK, so the ordering hazard cannot recur | none |

**No change to `delete_own_account_atomic` is required, and none is proposed in this audit phase.** The one thing implementation **must** do is add both tables to `supabase/scripts/test_052_account_deletion.sql` and prove the invariant holds.

## 9.2 Retention policy (to be documented in the Privacy Policy)

| Data | Retained | Why |
|---|---|---|
| `user_blocks` rows | **deleted** with either account | a live relationship, not evidence |
| `account_restrictions` rows | **retained indefinitely** after deletion | administrator enforcement evidence; the account identifier is a bare UUID with no remaining join target |
| `admin_audit_events` | **retained indefinitely, append-only** | unchanged from 055 |

## 9.3 A restricted student's right to delete — assessed honestly

**App Store 5.1.1(v) and Google Play both require an in-app path to account deletion. Restriction must not obstruct it.** The audit's assessment:

| Question | Answer |
|---|---|
| Does the restriction screen block the delete flow? | It would, unless the restriction screen **explicitly** exposes "Delete my account" — which §6.3 requires. |
| Does RLS block `delete_own_account_atomic()`? | Not inherently — it is `SECURITY DEFINER` and does not consult a restriction predicate. **It must be explicitly excluded from the `can_student_access_app()` gate**, and a regression test must prove a suspended and a platform-blocked user can both still delete. |
| Does `banned_until` block it? | **Yes, potentially — this is the sharpest edge in Day 10B.** A banned user cannot obtain a *new* token. Once the current access token expires, they cannot sign in to reach the in-app delete flow at all. |
| Mitigation | The **web deletion request path already exists**: `app/delete-account/page.tsx` + `deletion_requests` table + `app/account/delete/page.tsx`. A banned user reaches it unauthenticated. The restriction screen and the store listing must both link to it, and `deletion_requests` INSERT must remain ungated. |
| Residual risk | A banned user whose token has expired has **no in-app** deletion path — only the web form. Whether that satisfies Apple's "in the app" wording for a *banned* account is a judgement call. **Recommendation: do not set `banned_until` for `suspension` at all** (RLS + `signOut` already deny everything, and the student can still sign in to reach Delete), and set it **only** for `platform_block`, where the account is under indefinite sanction and the public web form is the documented route. This should be reviewed with the App Review notes before writes are enabled. |

**No change to account deletion is made in this audit phase**, as instructed.

---

# 10. Store and privacy assessment

Both new tables were reviewed field by field. Neither introduces an advertising identifier, contacts access, precise location, biometric data, or any third-party tracking. No new SDK, no new native permission.

| Artifact | Update required? | What |
|---|---|---|
| **App Store privacy disclosure** | **YES — "User Content" and "Identifiers", linked to identity, used for App Functionality.** `account_restrictions.reason` is free-text authored by an administrator *about* a user, and `user_blocks` records identified user-to-user relationships. **Not** "Data used to track you". | Add/confirm *User Content → Other User Content* and *Identifiers → User ID* under App Functionality. |
| **Google Play Data Safety** | **YES** — same two categories: *App activity → Other user-generated content* (collected, not shared, not for tracking); *Personal info → User IDs*. Confirm "Data is encrypted in transit" and "Users can request data deletion". | Update the form; the deletion answer is already true. |
| **Privacy Policy** | **YES — cannot ship without it.** Must state: (a) We Glue records which accounts a user blocks; (b) administrators may restrict or block accounts and record an internal reason; (c) the retention rule from §9.2, including that restriction records **survive account deletion**; (d) the blocked user is not notified. Item (c) is a material disclosure — silently retaining data past deletion after telling users deletion is complete would be a real compliance problem. | New "Safety and enforcement" section. |
| **Terms of Use** | **YES** | We Glue may suspend or permanently restrict access for violations; suspension may be time-limited; restriction is not account deletion and preserves data; how to contact support. |
| **Community Guidelines** | **YES** | What leads to suspension vs. permanent block; how to block another student; that blocking is private. |
| **Support / restriction documentation** | **YES — new** | A public "Why is my account restricted?" page explaining the generic states, the support contact (`info@weglue.app`), and the web deletion route. The restriction screen links here. |
| **App Review notes** | **YES** | Explain that the restriction screen is an enforcement state, not a paywall or a broken build; state that account deletion remains available (in-app for suspension, via the linked web form for a platform block); reviewer account `appreview@myschool.edu` is never restricted. |
| **Play review notes** | **YES** | Same, plus the Data Safety delta. |

**Explicitly assessed, not assumed:** `user_blocks` stores `(blocker_id, blocked_id, created_at)` — three columns, all identifiers or timestamps, no free text. `account_restrictions` stores identifiers, timestamps, constrained enums, and **two free-text fields (`reason`, `lift_reason`) authored by an administrator about a user**. Those two fields are the reason a disclosure update is genuinely required rather than merely prudent.

---

# 11. Migration plan, branches, and order

## 11.1 Migrations

| # | File | Contents | Reversible |
|---|---|---|---|
| **057** | `057_account_restrictions.sql` | table + constraints + 3 indexes + append-only triggers + zero-policy RLS + grants · predicates `account_access_state` / `is_account_restricted` / `can_student_access_app` · `my_access_state()` · 4 `admin_tx_restriction_*` · 5 `admin_audit_actions` rows · policy rewrites for the write-gate set | drop functions, revert policies, retain table |
| **058** | `058_user_blocks.sql` | table + PK + reverse index + RLS (SELECT-own only) · `blocked_user_ids` / `users_have_block_relationship` / `users_may_interact` · `block_user` / `unblock_user` / `list_my_blocks` · policy rewrites for `profiles`/`posts`/`post_comments`/`post_likes`/`follows`/`messages` INSERT · `insert_notification_once` guard + `notifications` BEFORE INSERT trigger · `enqueue_push` guard · **`search_discovery` / `get_discovery_people` / `get_discovery_clubs` / `get_discovery_events` rewritten to `auth.uid()`** | restore prior policy/function bodies (captured verbatim before the change) |

Both are **additive** — no column is dropped, no data destroyed. Every replaced policy and function body is captured verbatim in the migration header so the down-path is exact rather than reconstructed.

**Migration 051 remains absent and is not touched.**

## 11.2 Branches

| Branch | Scope | Depends on |
|---|---|---|
| `fix/admin-recent-mfa-write-gate` | **F-1 only** — `requireRecentMfa({write:true})`. Tiny, independently reviewable, independently mergeable. | — |
| `db/account-restrictions` | migration 057 + shadow-DB harness | — |
| `db/user-blocks` | migration 058 + shadow-DB harness | 057 (shares the predicate module) |
| `web/admin-restrictions` | Access panel, `/admin/restrictions` rewrite, 4 server actions, `auditSanitize` extension | 057, F-1 fix |
| `mobile/student-blocking` | profile menu, conversation menu, report-and-block, Blocked Accounts, restriction screen, session routing | 058 |
| `web/student-blocking` | `/u/[id]` menu, settings section, `/restricted` page, middleware extension | 058 |
| `docs/day10b-policy-updates` | Privacy Policy, Terms, Community Guidelines, support page, review notes | — |

## 11.3 Recommended implementation order

1. **F-1 fix** (`requireRecentMfa({write:true})`) — 30 minutes, unblocks everything, mergeable today.
2. **057 on a shadow database.** Validate the full test matrix. **Do not apply to production.**
3. **058 on the same shadow database**, including the discovery-RPC `auth.uid()` rewrite.
4. **`EXPLAIN (ANALYZE, BUFFERS)`** on the seeded shadow DB. Hard gate: §4.4 acceptance criteria. **If a plan shows `loops > 1` on a hot table, stop and redesign — do not proceed.**
5. **Codex / independent review** of both migrations before either touches production. (This is what caught 7 real blockers on migration 051 and the vacuous append-only test on 055.)
6. **Apply 057 to production** with `ADMIN_WRITES_ENABLED` still **false**. Enforcement predicates go live; no restriction can exist yet, so `can_student_access_app()` returns `true` for everyone and behaviour is unchanged. Verify that.
7. **Admin dashboard UI**, writes still disabled. Browser QA proves fail-closed.
8. **Apply 058 to production.** Ship mobile + web blocking. Student blocking works with **no** admin writes enabled — it is entirely student-owned, and shipping it first delivers the user-safety feature and the store-required control without ever unlocking administrator writes.
9. **Policy/legal documents + store disclosure updates.** Must land **before** step 10.
10. **Enable `ADMIN_WRITES_ENABLED`** — a separate, deliberate decision with its own verification pass.
11. `eas update --branch production` (after reconciling the fingerprint mismatch) + Vercel deploy.

Student blocking (steps 8) is deliberately sequenced **before** administrator writes (step 10). It is the higher-value, lower-risk half, it is what App Store 1.2 actually requires for user-generated content, and it does not depend on the write kill switch at all.

---

# 12. Test plan

Harness: the established shadow-database pattern (`supabase/scripts/test_05*.sql`, throwaway Docker Postgres with `pgowner NOSUPERUSER BYPASSRLS` + `anon`/`authenticated`/`service_role` roles, `\set ON_ERROR_STOP on`). **Never production.** Two new files: `test_057_account_restrictions.sql`, `test_058_user_blocks.sql`. Plus vitest for the web layer.

**A hard lesson from Day 10A that applies here:** an append-only test on an empty table is vacuous. Every test below must be preceded by a positive-control assertion that the row it expects to be protected actually exists.

## 12.1 Administrator restrictions (26 cases)

| # | Case | Expected |
|---|---|---|
| 1 | suspend active user | row inserted, `status='active'`, audit `success`, same correlation id |
| 2 | suspend with expiration | `suspended_until` stored; predicate returns `suspended` before it, `active` after |
| 3 | unsuspend | `status='lifted'`, `lifted_at/by/reason` set, predicate → `active` |
| 4 | platform block | row inserted, `suspended_until IS NULL` enforced by CHECK |
| 5 | unblock | `status='lifted'`, predicate → `active` |
| 6 | suspend already-suspended | `already_suspended`; **no second row** (partial unique index); durable failure audit |
| 7 | unblock an active user | `not_restricted`; no mutation |
| 8 | invalid transition `platform_blocked → suspended` | `invalid_transition` |
| 9 | missing reason | rejected **before** the RPC by `assertAuditReason` |
| 10 | whitespace-only reason | rejected (`btrim` → empty) |
| 11 | 501-character reason | rejected by `admin_audit_events_reason_len_chk` |
| 12 | 2-character reason | rejected (min 3) |
| 13 | duplicate submission | one row; second returns `already_*` |
| 14 | platform-admin target | `platform_admin_target`; **no row** |
| 15 | founder self-target | `self_target` |
| 16 | `ADMIN_WRITES_ENABLED=false` | throws `writes_disabled` before any DB contact |
| 17 | stale MFA | `stepup_required` |
| 18 | non-allowlisted admin | `denied` |
| 19 | **forced audit failure** (inject a forbidden key) | **mutation rolled back** — restriction row absent AND audit row absent |
| 20 | Auth revocation success | `attempt` + `success`, one correlation id, attempt row **unmodified** |
| 21 | Auth revocation failure | `attempt` + `failure`; restriction still in force; dashboard reports honestly |
| 22 | outcome record unpersistable | `reconciliation_required` written |
| 23 | reconciliation status surfaced | attempt with no sibling outcome is queryable and shown |
| 24 | restricted user with a live access token | **every protected read/write denied by RLS** |
| 25 | restricted user, direct PostgREST call (no client) | denied identically |
| 26 | expiry boundary | at `suspended_until - 1s` → `suspended`; at `+1s` → `active`, with **no job run** |

Plus: **27** — a suspended user and a platform-blocked user can each still call `delete_own_account_atomic()` and each still `INSERT` into `reports`. **28** — `account_restrictions` rows survive `delete_own_account_atomic()` for that user.

## 12.2 Student blocks (24 cases)

| # | Case | Expected |
|---|---|---|
| 1 | A blocks B | one row; `blocker_id=A` |
| 2 | duplicate block | idempotent success, still one row |
| 3 | self-block | `CHECK` violation → RPC returns `self_target` |
| 4 | A unblocks B | row gone |
| 5 | **B cannot determine A blocked them** | B's `SELECT * FROM user_blocks` → **0 rows** (positive control: assert A's query returns 1) |
| 6 | follow rows removed both directions | both gone, in the **same transaction** as the insert |
| 7 | Gluemate disappears | mutual-accepted derivation now false |
| 8 | unblock does not restore follows | `follows` still empty |
| 9 | concurrent follow + block | serialized; final state = blocked, no follow row |
| 10 | concurrent message send + block | message either committed before, or rejected — never a message with a block already visible |
| 11 | new DM denied | `get_or_create_direct_chat` refuses |
| 12 | existing DM send denied | `messages` INSERT policy refuses, **both directions** |
| 13 | search exclusion | `search_discovery` returns neither, **both directions** |
| 14 | **search with a spoofed `p_user_id`** | **filtered by `auth.uid()`, not the argument** — the §1.2 regression |
| 15 | recommendation exclusion | `get_discovery_people` excludes both |
| 16 | deep-link denial | `profiles` SELECT → 0 rows for the blocked id |
| 17 | notification suppression | no row inserted, **including via `create_group_chat` / `add_group_participants`** (the trigger path) |
| 18 | push suppression | no `push_queue` row |
| 19 | **shared club behaviour** | A still sees B's **club** posts, club-chat messages, channel posts, polls and announcements. Positive control: assert those rows exist and are returned. |
| 20 | **shared group behaviour** | every message in a shared `type='group'` conversation remains visible to both; no placeholder; other participants unaffected |
| 21 | report remains available | A can report B **after** blocking |
| 22 | account deletion cleanup | deleting A removes both A-owned and A-targeted rows via cascade |
| 23 | blocked-account list privacy | `list_my_blocks` returns only `blocker_id=auth.uid()` |
| 24 | **modified-client / direct-API bypass** | raw PostgREST `INSERT` into `user_blocks` → **denied** (no INSERT policy); raw `INSERT` into `messages` for a blocked DM → **denied**; raw `SELECT` on a blocked profile → **0 rows** |

Plus: **25** — personal posts filtered, club posts not, in the **same** query. **26** — RSVPs and club memberships are unchanged by a block.

## 12.3 Synchronization (10 cases, browser + device QA)

Dashboard → Supabase → iOS · → Android · → student web · mobile block → web · web block → mobile · app restart · app resume · two devices, same account · offline recovery (block attempted offline fails visibly, never silently succeeds) · Realtime disconnect → focus-refetch fallback still converges within the §7.3 ceiling.

**QA must use provisioned test accounts and a provisioned test club, cleaned up afterwards — the method already proven for the migration-050 verification. No real student is blocked or restricted.**

---

# 13. True blockers

Ranked. Only genuine blockers — items that must be resolved before implementation, not preferences.

| # | Blocker | Severity | Resolution |
|---|---|---|---|
| **B1** | **`requireRecentMfa()` skips the write kill switch** (`secureAdmin.ts:227`). Every restriction action would satisfy step-up MFA while bypassing `ADMIN_WRITES_ENABLED`. | **HIGH** | One-line fix + a regression test asserting all four actions throw with writes disabled. Separate branch, mergeable immediately. |
| **B2** | **`search_discovery` / `get_discovery_people` / `get_discovery_clubs` / `get_discovery_events` take a caller-supplied `p_user_id`.** The instant blocking is enforced inside them, a modified client bypasses it by passing another UUID. | **HIGH** | Rewrite all four to `auth.uid()` in 058, keeping the parameter for signature compatibility but **ignoring** it. Must ship in the same migration as blocking, never after. |
| **B3** | **`create_group_chat` and `add_group_participants` INSERT into `notifications` directly**, bypassing `insert_notification_once()`. A guard placed only in the helper leaves a live notification path between blocked users. | **HIGH** | Enforce with a `BEFORE INSERT` trigger on `notifications`, not only in the helper. Test case 12.2#17 must exercise the RPC path specifically. |
| **B4** | **`profiles`, `posts`, `post_comments`, `post_likes`, `follows` all have `SELECT USING (true)`.** Blocking requires rewriting the hottest read policies in the product. A naive correlated subquery would degrade the feed for every user. | **HIGH** | The `(SELECT fn())` InitPlan pattern in §4.4, gated on a measured `EXPLAIN` acceptance criterion before merge. **Do not skip step 4 of §11.3.** |
| **B5** | **`banned_until` vs. the store-mandated deletion right.** A banned user, once their access token expires, cannot sign in to reach the in-app delete flow. | **MEDIUM-HIGH** | §9.3: do not ban on `suspension`; ban only on `platform_block`; link the existing web deletion form from the restriction screen and the review notes. **Founder decision required.** |
| **B6** | **Public storage buckets.** `avatars`, `posts`, `club-photos`, `club-avatars`, `club-covers` are `USING (bucket_id = …)` — fully public. Neither system can retract a known image URL. | **MEDIUM (accepted)** | Document honestly in the Privacy Policy and product copy. Converting to signed URLs is a separate project, out of scope. |
| **B7** | **Privacy Policy, Terms, Community Guidelines, Data Safety and App Store disclosures must be updated before either system reaches users** — specifically the retention of restriction records past account deletion. | **MEDIUM** | §10. Must land before step 10 of §11.3. |
| **B8** | **EAS fingerprint mismatch.** The local `.deno` pnpm layout fingerprints differently from shipped builds 24/22, so a plain `eas update` will not reach current testers. | **MEDIUM (pre-existing)** | Reconcile before any OTA. Not a Day 10B design issue, but it will block delivery. |

**Not blockers** (each checked against the live database or live source, then cleared):

- **Reason-collection UI** — **shipped.** `ConfirmAction.tsx` collects and validates 3–500 chars; `actions.ts` threads it through. The Day 10A blocker is closed.
- **Follow-delete disclosure** — **cleared.** `handle_follow_delete()` emits no notification; it only deletes a stale `follow_request` row.
- **Missing indexes for the new policies** — **cleared.** `idx_posts_author_id`, `idx_posts_author_created`, five `follows` indexes and `idx_conv_participants_user_id` all already exist.
- **Audit-vs-deletion FK hazard** — **cleared.** `admin_audit_events` has no FK to `profiles` or `auth.users`.
- **`admin_audit_actions.target_type` CHECK** — **cleared.** It already contains `'user'`; no constraint change needed.
- **`delete_own_account_atomic` changes** — **none required.** Cascade handles `user_blocks`; `account_restrictions` is FK-free by design.
- **`chat-attachments` storage** — **cleared.** Already gated on `is_conversation_participant`.

---

# 14. Recommendation

## **GO — for the architecture, with three mandatory conditions and a sequencing change.**

The design is sound and the ground is unusually well prepared. Every primitive Day 10B needs already exists in production and has been reviewed: the durable append-only audit trail (055), the atomic mutate-plus-audit transaction shape (056), the cross-service attempt→outcome pattern for Auth (`crossService.ts`), the reason dialog with three-layer validation, the secure admin gate, and — in `resolveMobileSessionRoute()` — a proven, tested containment shape for keeping a whole account out of the student tree. Nothing here requires inventing a new security pattern under pressure.

The two systems are cleanly separable, and the terminology separation the founder asked for is preserved throughout: **`account_restrictions` / `restriction_type` / `suspended` / `platform_blocked`** for administrator action, **`user_blocks` / `blocker_id` / `blocked_id`** for student choice. Two tables, two migrations, two branches, two vocabularies, no shared "blocked" field anywhere.

**Three conditions before any implementation begins:**

1. **Fix B1** (`requireRecentMfa({write:true})`). Small, isolated, and it removes a live gap in the *existing* dashboard, not just a future one.
2. **Accept that B2 ships inside migration 058, not after it.** The discovery RPCs must move to `auth.uid()` in the same migration that introduces blocking. Enforcing a block in a function whose identity parameter the client controls is not enforcement.
3. **Make the B5 decision** — ban on `platform_block` only, not on `suspension`. This is a founder judgement call with App Store consequences and should not be made implicitly by an implementer.

**One sequencing change I recommend against the implied order:** ship **student blocking (058) before administrator restrictions reach a write-enabled state**. Student blocking is the higher-value, lower-risk half — it is what App Store Guideline 1.2 actually requires for an app with user-generated content, it is entirely student-owned, and it works with `ADMIN_WRITES_ENABLED` still false. Administrator restrictions can go to production as *inert predicates* (step 6 of §11.3) and stay dormant until the founder makes a separate, deliberate decision to enable writes. That gets the user-safety feature to students soonest while keeping the most dangerous capability behind the switch it belongs behind.

**NO-GO on two specific things**, stated so they are not quietly assumed:

- **No-go on enforcing restrictions through client routing alone.** RLS predicates are not optional. During the residual access-token window (up to one hour) they are the *only* control, and any claim that Auth revocation alone is immediate would be false.
- **No-go on merging either migration without the `EXPLAIN` gate in §4.4 step 4.** `profiles`, `posts` and `messages` are the hottest paths in the product and are currently policy-free (`USING (true)`). A correlated subquery introduced there would be a performance regression measured in the whole app, discovered in production, at exactly the scale the founder is building for.

**Nothing has been implemented. No branch, no migration, no code change, no production write, no OTA, no build.** This document is for founder review.

---

## Appendix — verification method

All schema claims came from live production reads through a helper that refuses any statement containing `INSERT`/`UPDATE`/`DELETE`/`DROP`/`ALTER`/`CREATE`/`TRUNCATE`/`GRANT`/`REVOKE`. Sources: `pg_class`, `pg_policies`, `pg_proc` + `pg_get_functiondef`, `pg_constraint` + `pg_get_constraintdef`, `pg_trigger` + `pg_get_triggerdef`, `pg_indexes`, `pg_publication_tables`, `information_schema.columns`, `information_schema.role_table_grants`. Code claims are cited to file and line. No private message body, no report snapshot, and no student's personal data was read.
