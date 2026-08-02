# Day 10C — Content Lifecycle: Founder Review Package

**Status: complete and awaiting founder review. Nothing is merged, applied, deployed or published.**

Prepared 2026-08-02. Read §22 (blockers) and §26 (GO / NO-GO) first if you read nothing else.

---

## 1. Branch

`safety/content-lifecycle`, pushed to `origin`. **Not merged.** No pull request has been opened —
open one only if you want the GitHub review surface; the branch is complete either way.

## 2. Commits

One commit: `214a07f2` — *feat(safety): Day 10C content lifecycle — remove, restore, permanent purge*.
Branch point: `36db6d0c` (current `main`).

## 3. Files changed

30 files, +5,011 / −28.

**New (10)**

| File | Lines | What it is |
|---|---:|---|
| `supabase/migrations/061_content_lifecycle.sql` | 1,870 | The whole database contract |
| `supabase/scripts/test_061_content_lifecycle.sql` | 772 | 176-assertion behavioural harness |
| `supabase/scripts/test_061_fixture_schema.sql` | 394 | Production-shaped shadow fixtures |
| `docs/admin/day10c-architecture.md` | 609 | Audit + architecture (Phases 1–2) |
| `supabase/functions/purge-content/index.ts` | 352 | Durable purge worker |
| `apps/web/lib/admin/contentLifecycleActions.ts` | 325 | Ten narrow admin Server Actions |
| `apps/web/components/admin/ContentLifecycleActions.tsx` | 199 | Admin lifecycle controls |
| `apps/web/lib/admin/lifecycleData.ts` | 143 | Read-only lifecycle access |
| `apps/web/lib/contentAvailability.ts` | 41 | Web unavailable copy |
| `apps/mobile/lib/contentAvailability.ts` | 48 | iOS/Android unavailable copy |

**Modified (20)** — 9 mobile screens/components (unavailable state), 4 web student surfaces,
3 admin detail pages, `ConfirmAction.tsx` (typed confirmation), `auditSanitize.ts`,
`atomicMutation.ts`, and 2 test files updated for the new catalog.

## 4. Migration number

**061**, confirmed free against the **live Production ledger** (not the local file list):
`supabase_migrations.schema_migrations` ends at `060 restriction_enforcement_hotfix`. No renumbering
was needed. `051` remains absent and untouched.

## 5. Migrations 054–060 unchanged

**Confirmed.** `git diff --name-only main...HEAD -- supabase/migrations/054..060` returns **zero
files**. The only migration in this branch is the new `061`.

## 6. What Day 10C actually built

One canonical lifecycle for posts, post comments and events:

```
active ──remove──▶ removed ──restore──▶ active
                      │
                 requestPurge
                      ▼
              purge_pending ──▶ purged        (terminal)
                      │
                      ▼
               purge_failed ──retry──▶ purge_pending
```

**One source of truth**: `public.content_lifecycle`. No `deleted_at`, no `status`, no `hidden`
column was added to `posts`, `post_comments` or `events`. The absence of a lifecycle row *means*
active, so the table stays proportional to moderation activity, not to content volume.

## 7. Enforcement is the database, not the UI

Both student clients query `posts` / `post_comments` / `events` **directly through PostgREST**, so
RLS is the only enforcement point that matters. Migration 061 re-creates each production policy
**verbatim** with one lifecycle term ANDed on, preserving the 057 block terms and the 058 access
predicate exactly. It also closes every path that runs as `SECURITY DEFINER` and would otherwise
bypass RLS: `get_discovery_events`, the realtime broadcast authorizers, `process_event_reminders`,
`remove_post_from_club` and `delete_club_photo_everywhere`.

## 8. The two defects the harness caught that would have shipped

These are the most important lines in this document.

**(a) The self-delete evidence guard was a silent no-op.** Written the obvious way —
`NOT EXISTS (SELECT 1 FROM reports …)` inline in the posts DELETE policy — the subquery is evaluated
as the **calling** role, so `reports`' own RLS applies. Production's policy is
`reporter_id = auth.uid()`. The author of reported content is by definition *not* the reporter, sees
zero rows, and `NOT EXISTS` returns TRUE. The rule would have existed in the migration and enforced
nothing. Fixed with `public.content_delete_allowed()`, a SECURITY DEFINER predicate that answers only
for a caller who could actually perform the delete (owner, or club officer for events), so it can
never be used as a "is this content reported?" oracle. Asserted by tests 10.13, 10.14, 12.2–12.6.

**(b) Two production-apply failures.** `get_discovery_events__inner` was written without production's
`DEFAULT 20 / DEFAULT 0` parameter defaults (`cannot remove parameter defaults from existing
function`), and the rewrite returned `club_member_count` where production returns `member_count`.
Both would have failed the Production apply. Caught because the shadow chain replays the real
migration sequence rather than starting from a clean schema.

A third, smaller one: the 057 fixture had **RLS disabled** on `events` and `saved_events`, which
would have made every "removed event is invisible" assertion vacuously true. Verified against the
live `pg_class` (production has RLS enabled on all eight tables), fixed in the fixture, and 061 now
asserts `ENABLE ROW LEVEL SECURITY` on all seven tables it writes policies for.

## 9. Lifecycle matrix (current → available transitions)

| From | remove | restore | requestPurge | retryPurge | student sees |
|---|---|---|---|---|---|
| `active` | ✅ | ❌ `not_removed` | ❌ `invalid_transition` | ❌ | the content |
| `removed` | ❌ `already_removed` | ✅ | ✅ | ❌ | unavailable |
| `purge_pending` | ❌ `purge_in_progress` | ❌ `purge_in_progress` | ❌ `purge_in_progress` | ❌ | unavailable |
| `purge_failed` | ❌ `purge_in_progress` | ❌ `purge_in_progress` | ❌ `purge_in_progress` | ✅ | unavailable |
| `purged` | ❌ `already_purged` | ❌ `already_purged` | ❌ `already_purged` | ❌ | unavailable |

Every ❌ is a **real, named failure** with a durable failure audit row. Nothing silently succeeds,
nothing is reinterpreted as a different transition. Concurrency is serialized by
`pg_advisory_xact_lock` per entity: the loser observes the winner's committed state and fails with a
true code rather than racing.

Additional failure codes: `not_found`, `owner_missing`, `club_missing`, `parent_missing`,
`parent_unavailable`, `evidence_required`, `invalid_reason`, `invalid_target`.

## 10. Per-entity behaviour

| | Post | Comment | Event |
|---|---|---|---|
| Remove hides | post, its comments, likes, club tags | the comment | event, RSVPs, saves, discovery, reminders |
| Preserved | all engagement | position in thread | **all RSVPs and saves** |
| Notifications | kept; pending pushes cancelled | kept | kept; **no cancellation notice sent** |
| Restore returns | original caption, timestamps, engagement | original body, original position | original details, RSVPs, saves |
| Purge redacts | caption, image_url; deletes comments/likes/tags/club photos | body, then the row | title, description, location, building, room, cover image |
| Purge deletes | uniquely-owned Storage object | — | RSVPs, saves, activities, interests, uniquely-owned cover |

**Event purge ordering matters and is encoded in the migration and in test 7.** Dependents (RSVPs,
saves, activities, interests) are deleted **before** the event row is redacted, because
`trg_event_updated_notify` would otherwise notify every `going` attendee that *"The location for
&lt;title&gt; changed."* — announcing the purge, with the title, to exactly the people it should be
invisible to. Test 7 asserts **zero** `event_updated` notifications across an event purge.

## 11. Student self-delete vs administrator removal

| | Student self-delete | Administrator remove |
|---|---|---|
| Who | owner (officer for club events) | founder, with recent MFA |
| Effect | row is **deleted**; cascades run | row untouched; hidden by RLS |
| Reversible | no | **yes**, exactly as it was |
| Reason | none | 3–500 characters, mandatory, permanent |
| Blocked when | lifecycle ≠ active, **or an open report exists** | never (removal is always available from active) |
| Audit | none (it is the student's own content) | durable, append-only, correlated |

## 12. Comment tombstone — flagged deviation from the brief

The brief asked for a neutral in-place tombstone, *"This comment was removed."* **This build hides
the row instead**, and the architecture doc §6.3 records the full reasoning. Short version:

1. `post_comments` is **flat** — no `parent_comment_id` exists in production. A hidden comment is
   indistinguishable from one the author deleted a moment earlier, which is what students already
   see today. A tombstone would *add* information, not preserve it.
2. A tombstone requires the client to learn that a specific comment is in a non-active state. Every
   route to that either creates the second source of truth the architecture forbids, or widens the
   disclosure surface the design keeps at one bit.
3. Both clients read `post_comments` directly through PostgREST, so redacted bodies would mean
   moving comment reads onto an RPC — a hot-path rewrite affecting counts in five call sites — to
   buy a placeholder.

The tombstone remains the committed design for the day threading ships; the state model already
carries everything it needs. **This needs your decision, and is listed as non-blocking finding N1.**

## 13. Report / evidence boundary (no Day 10D was built)

- Purge is **refused** with `evidence_required` when the content has a `pending` or `reviewing`
  report and no adequate evidence snapshot exists. Today no snapshot exists for posts or events, so
  the term is always true — written explicitly so Day 10D only has to populate the column.
- **Removal is always allowed** even with an open report: hiding harmful content must never wait on
  adjudication.
- Student self-delete is blocked while a report is open (this is the guard from §8(a)).
- No report adjudication, no enforcement workflow, no snapshot capture was built.

## 14. Audit catalog

20 new actions in `admin_audit_actions` and the matching registry entries, kept in lockstep by
`auditSanitize.test.ts` (which now parses 055 + 058 + 061 and asserts **52** catalog rows).

Payloads are allow-listed: **no** caption, comment body, event title, description, location or media
URL travels through any lifecycle audit row. `before_state`/`after_state` are reduced to dependency
counts. Tests 9.7–9.11 assert this directly against the audit rows the harness produced.

The worker's `purgeCompleted` and `purgeReconciliationRequired` rows are `destructive` **and**
reason-bearing: the database carries forward the reason the administrator gave when they *requested*
the purge, rather than letting a machine write an unjustified destructive record or inventing text.

## 15. Purge orchestration

`supabase/functions/purge-content/index.ts`, bearer-guarded by `PURGE_DISPATCH_SECRET`, invoked by
pg_cron → pg_net exactly like `send-push`. **It can never start a purge** — only carry out one a
human already authorized.

Ten steps: claim (`FOR UPDATE SKIP LOCKED`) → enumerate from **secured database state** (never a
caller-supplied URL) → audit the attempt **before** touching Storage → delete → record each object →
audit the outcome (counts only) → finalize → mark failed → reconcile → report.

- **Idempotent throughout.** A duplicate finalize is a no-op that says so. `not_found` on an object
  converges to deleted, because the goal state is "the object is gone".
- **Never falsely complete.** `content_purge_finalize` refuses while any uniquely-owned object is
  still undeleted. If the *outcome itself* cannot be persisted, the item becomes
  `reconciliation_required` — durable work for a human — and is never marked purged.
- **Shared media is checked for unique ownership** before deletion, so purging one post cannot
  delete an image another still uses.
- **Attempt cap** of 5, after which an item parks in `purge_failed` for a human instead of
  re-claiming a batch slot forever.
- **Public-bucket honesty.** The `posts` bucket is public. Deleting an object stops it being served
  from that path; copies already downloaded, cached at a CDN edge, or saved by a student are beyond
  reach. Nothing in the code or the audit trail claims otherwise.

## 16. Admin Dashboard

Lifecycle controls on the post, comment and event detail pages: a state pill sourced from
`content_lifecycle` (so the operator sees exactly what students do), and **only the transitions that
are actually legal from that state** — no greyed-out button that guesses.

Every action requires: portal enabled → validated JWT → founder id allowlist → session age → aal2 →
`ADMIN_WRITES_ENABLED` → **recent MFA** → valid UUID → 3–500 character reason. Purge additionally
requires the operator to type **`PURGE`**, exactly and case-sensitively (`ConfirmAction`'s new
`confirmPhrase`, re-checked server-side because the client's check can be bypassed).

Two `DisabledAction` placeholders on the post page that claimed no lifecycle existed
("Hide globally", "Permanently delete post") were removed — they are now real, guarded actions.

## 17. Student clients (iOS, Android, web)

One shared constant, one sentence: **"This content is no longer available."**

It is byte-identical for content an administrator removed, content the author deleted, content that
was purged, and content that never existed — because a message that differed by cause would itself
disclose the moderation outcome. `apps/mobile/lib/contentAvailability.ts` and
`apps/web/lib/contentAvailability.ts` are deliberate mirrors, with no `Platform.OS` branch anywhere:
**App Store and Play Store builds show the same text.**

Wired into: post detail, post viewer, three event detail screens, both chat share cards, the club
event screen, the club-edit confirmation copy, the web post and event modals, and the web shared
message previews. The comments sheet now resolves its parent post, shows the unavailable state, and
**withdraws the composer** rather than offering a field whose insert the database will refuse.

## 18. Notifications, push, realtime, deep links

- **Notifications are kept.** Deleting them would rewrite a student's history; they resolve through
  RLS to the generic unavailable state when tapped.
- **Pending pushes for removed content are cancelled** at removal (`push_queue`, `status = 'pending'`).
- **Event reminders are suppressed inside `process_event_reminders` itself**, not in the client, so a
  removed event can neither generate a reminder row nor leak its title into push copy (test 14).
- **Realtime**: the private broadcast authorizers refuse topics for non-active content.
  `content_lifecycle` is **not** in the `supabase_realtime` publication (test 11.10), and no
  sensitive table was added to it.
- **Deep links / Open Graph**: production has **no public post or event routes and no content OG
  tags** — nothing to fall back from. Documented in the architecture doc rather than invented.

## 19. Test results

| Suite | Result |
|---|---|
| `test_061_content_lifecycle.sql` (shadow DB) | **176 / 176 pass** |
| `apps/web` vitest | **844 / 844 pass** (35 files) |
| `apps/mobile` vitest | **63 / 63 pass** (6 files) |
| `apps/web` `tsc --noEmit` | clean |
| `apps/mobile` `tsc --noEmit` | clean |
| `apps/web` `next build` | **succeeds** |
| `expo export --platform ios` | succeeds (6.47 MB bundle) |
| `expo export --platform android` | succeeds (6.48 MB bundle) |
| Migration 061 idempotency | clean across **3** consecutive applies |
| Secret scan of all new files | clean |

The 176 assertions cover: baseline visibility, removal invisibility through every read path,
interaction denial, invalid transitions, reason validation, restore fidelity (including **measured**
proof that no notification is replayed), the report/evidence boundary, purge orchestration, event
purge ordering, failure/retry/reconciliation, privacy (students cannot read the lifecycle tables or
call any admin/worker function), security posture (SECDEF, FORCE RLS, zero policies, grants,
append-only), and regression against 10A, 10B, 057, 058 and 060.

Every negative assertion is paired with a positive control, so a test cannot pass because the thing
under test silently did nothing.

## 20. Testing was done on a shadow database only

Per the brief. The shadow chain replays the real production sequence —
`057 fixture → 061 fixture → 055 → 056 → 057 → 058 → 060 → 061` — in Docker, under a
`NOSUPERUSER BYPASSRLS` owner role that matches production's `postgres`, so FORCE-RLS assertions are
honest. **No production content was read beyond schema metadata, ACLs and role attributes. No
production write of any kind was made. No Storage object was touched.**

## 21. EAS fingerprint and OTA compatibility

**All mobile changes are TypeScript/TSX only.** No native module, no config plugin, no `app.json`,
no `package.json`, and no dependency changed — verified against the branch diff. On that basis this
work is **OTA-compatible and does not require a native build.**

**No OTA was published and no build was created**, per the brief. Note also the known local
fingerprint trap recorded from earlier sessions: this machine's `.deno` pnpm layout produces a
fingerprint that does not match the shipped builds, so a local `eas fingerprint` comparison is not
evidence either way. The dependency-diff argument above is the honest basis for the OTA decision.

## 22. TRUE BLOCKERS

**B1 — Migration 061 has never been applied to Production.** Everything above is proven on a shadow
database. The apply is your decision and is step 1 of §25.

**B2 — `ADMIN_WRITES_ENABLED` is still `false` in Production, and correctly so.** Until you enable
it, every lifecycle action will fail closed at `requireRecentMfaWrite()`. This is the intended state
for review; it is a blocker only to *using* the feature, not to shipping it.

**B3 — The purge worker has no deployment or schedule.** `PURGE_DISPATCH_SECRET` does not exist,
the function is not deployed, and no pg_cron job invokes it. Until that is done, `purge_pending`
items will simply sit there — hidden from students, which is the safe failure, but never completing.
Remove and restore are fully functional without the worker.

**B4 — Requirement 9 of `CLAUDE.md` conflicts with the Day 10C prohibitions.** Requirement 9 says
every task ends with `eas update --branch production`. The Day 10C brief says *"Determine OTA
compatibility, but do not publish an OTA during implementation review."* I followed the more specific
instruction and **published nothing**. Surfacing this rather than resolving it silently: after you
approve, the mobile changes need one `eas update --branch production` to reach iOS and Android.

## 23. NON-BLOCKING FINDINGS

**N1 — Comment tombstone deviation** (§12). Needs your decision. Current behaviour is the more
private one and matches what students already see.

**N2 — One-bit enumeration residual, accepted deliberately.** `content_is_student_visible(type, id)`
is callable by any authenticated student for any id they can guess. It returns one boolean for one
known id — never a list, never a state, never a reason. The alternative (the 058-style array
InitPlan) would have handed every student the complete list of removed content ids, which is
strictly worse. Documented in the architecture doc; asserted by tests 9.1–9.6.

**N3 — Five pre-existing weaknesses** were found during the Phase 1 audit and are recorded in
`day10c-architecture.md` §14. None is introduced by this work and none is fixed by it.

**N4 — No browser QA was performed.** The admin controls are proven by type-check, production build
and source-level tests, not by a real founder session with aal2. Worth 15 minutes with the portal
enabled on a preview deployment before you enable writes in production.

**N5 — Two `DisabledAction` placeholders were removed** from the admin post page because they are no
longer true. If you were using them as a visual reminder, they are gone.

## 24. What was NOT built (and was not supposed to be)

Day 10D report adjudication, Day 10E synchronization parity, Day 10F deleted-message privacy,
evidence snapshot capture, comment threading, public content routes, Open Graph tags, and any change
whatsoever to migration 051 or migrations 054–060.

## 25. Exact Production release sequence

Run in this order. Steps 1–3 are safe on their own: with writes disabled, 061 changes what students
can see for **zero** rows, because no lifecycle row exists yet.

1. **Apply migration 061** to Production (Supabase SQL editor or CLI). It is idempotent and was
   verified across three consecutive applies.
2. **Verify the apply**: `content_lifecycle` and `content_purge_objects` exist with FORCE RLS and
   zero policies; `admin_audit_actions` has 52 rows; a spot-check that a normal student feed still
   returns the same posts it did before.
3. **Merge `safety/content-lifecycle` into `main`** and let Vercel deploy the web app. The admin
   controls will render but every action still fails closed on `ADMIN_WRITES_ENABLED`.
4. **Publish the OTA**: `cd apps/mobile && eas update --branch production`. JS-only, so no build.
5. **Deploy the purge worker**: `supabase functions deploy purge-content`, set
   `PURGE_DISPATCH_SECRET` in function secrets **and** in Vault, and create the pg_cron job that
   invokes it. Do this **before** enabling writes, so a requested purge is never left stranded.
6. **Set `ADMIN_WRITES_ENABLED=true`** in Vercel production. This is the switch that makes the whole
   feature live.
7. **Prove it on one piece of real content**: remove a post, confirm it disappears on iOS, Android
   and web; restore it; confirm it returns unchanged with its engagement intact and no notification
   replayed. Do **not** test purge on real content you would miss.
8. **Then, and only then**, consider a purge on genuinely purge-worthy content.

Rollback at any point before step 6: set `ADMIN_WRITES_ENABLED=false`. The migration itself is safe
to leave applied — with no lifecycle rows it hides nothing.

## 26. GO / NO-GO

**GO — for merge, apply and deploy (steps 1–5 of §25).**

**NO-GO — for enabling `ADMIN_WRITES_ENABLED` (step 6) until B3 is done**, because a purge requested
with no worker deployed would sit in `purge_pending` indefinitely. Removal and restore are safe the
moment writes are enabled; the purge path needs its worker first.

The recommendation rests on: 176/176 behavioural assertions on a production-shaped shadow database
with positive controls throughout, 907 unit tests, clean type-checks, a successful production build,
successful iOS and Android exports, three clean idempotent applies, a verified-unchanged 054–060,
and two real defects — one of them a security guard that would have enforced nothing — caught before
they reached Production rather than after.

## 27. Stop point

**This is where Day 10C ends.** Day 10D has not been started and will not be until you say so.
