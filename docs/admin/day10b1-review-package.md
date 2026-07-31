# Day 10B1 — Student-to-Student Blocking
## Review package (NOT applied to production, NOT merged, NOT deployed)

**Branch:** `safety/student-blocking` — 6 commits, unmerged
**Base:** `origin/main` @ `4885185f`
**Migration:** `057_student_blocking.sql` — **written and validated, NOT applied to production**
**Date:** 2026-07-31

---

# 1. Branch and commits

| # | Commit | What |
|---|---|---|
| 1 | `9bce5ec7` | `docs(safety)` — approved architecture + the 8 founder decisions of record |
| 2 | `7ed9b774` | `feat(safety)` — migration 057: model, predicates, RPCs, discovery hardening, notification trigger, policies |
| 3 | `7a344125` | `fix(admin)` — `requireRecentMfaWrite()` so step-up cannot bypass the write gate |
| 4 | `01412cb5` | `feat(mobile)` — iOS + Android blocking |
| 5 | `84238739` | `feat(web)` — student-web blocking + the two search call sites |
| 6 | `736b9dcc` | `fix(safety)` — advisory-lock serialization for the concurrency race found by test |
| 7 | `e5f1d0a…` | `chore` — unstage two unrelated pre-existing files |

**26 files changed, 6,015 insertions, 44 deletions.**

# 2. Files changed

**Database (3 new, 1 migration)**
`supabase/migrations/057_student_blocking.sql` · `supabase/scripts/test_057_fixture_schema.sql` · `supabase/scripts/test_057_student_blocking.sql` · `supabase/scripts/test_057_concurrency.sh`

**Mobile (iOS + Android — one code path, no `Platform.OS` branch)**
new: `services/blockService.ts` · `hooks/useBlocking.ts` · `lib/blockPrompts.ts` · `app/privacy-center/blocked-accounts.tsx` · `lib/__tests__/blocking.test.ts`
edited: `app/profile/[userId].tsx` · `app/chat/[chatId]/index.tsx` · `app/chat/[chatId]/info.tsx` · `app/privacy-center/index.tsx` · `components/shared/ReportButton.tsx`

**Web**
new: `lib/blocking.ts` · `lib/hooks/useBlocking.ts` · `app/settings/blocked/page.tsx` · `components/settings/BlockedAccountsClient.tsx` · `lib/__tests__/blocking.test.ts` · `lib/admin/__tests__/recentMfaWrite.test.ts`
edited: `lib/admin/secureAdmin.ts` · `components/profile/UserProfileClient.tsx` · `components/profile/OwnProfileClient.tsx` · `lib/hooks/useCreateEvent.ts` · `lib/clubs/clubManagement.ts`

**Docs:** `docs/admin/day10b-architecture.md`, this file.

---

# 3. Migration 057 — schema and policy design

## 3.1 Canonical model

```sql
user_blocks (blocker_id, blocked_id, created_at)
  PRIMARY KEY (blocker_id, blocked_id)          -- uniqueness for the pair
  CHECK (blocker_id <> blocked_id)              -- no self-block
  FK both columns -> profiles(id) ON DELETE CASCADE
  created_at DEFAULT now()                      -- server-generated, never client
  INDEX (blocked_id, blocker_id)                -- the reverse direction
  RLS ENABLED + FORCED
```

**One SELECT policy, zero write policies.** `blocker_id = auth.uid()` means a blocked user's query returns **zero rows** — they cannot enumerate who blocked them, and no count or aggregate is exposed anywhere. Writes are RPC-only so "insert the block" and "delete the follows" cannot be split into two client round trips, which would leave a Gluemate alive next to a block.

**Platform admins cannot participate:** they have no `profiles` row (053), so the FK alone refuses them; `block_user` additionally checks `is_platform_admin_auth` and returns `user_not_found`, which is deliberately indistinguishable from a deleted or never-existed account.

## 3.2 Predicates (all `auth.uid()`-driven; none accepts an identity)

| Function | Shape | Use |
|---|---|---|
| `blocked_user_ids()` | argument-free `uuid[]` | **hot path** — InitPlan |
| `blockable_notification_types()` | argument-free `text[]` | **hot path** — InitPlan |
| `users_have_block_relationship(a,b)` | 2 args, row-correlated | RPC / trigger only |
| `users_may_interact(a,b)` | 2 args | the seam Day 10B2 extends |
| `current_user_blocks(target)` | directional | Block/Unblock label |
| `target_is_blocked_from_current_user(target)` | symmetric | DM composer |

## 3.3 Policies rewritten

| Table | Change |
|---|---|
| `profiles` SELECT | was `USING (true)` → block-aware. **Zero rows** for a blocked profile, which is what makes every deep link resolve to the same safe state without client code |
| `posts` SELECT | `club_id IS NOT NULL` (**official — always visible**) OR author not blocked |
| `post_comments`, `post_likes` SELECT | personal social interaction, filtered both ways |
| `post_comments` INSERT, `post_likes` ALL | cannot act on a blocked user's post |
| `follows` SELECT / INSERT / UPDATE | blocked pair invisible; follow cannot be created or accepted |
| `messages` INSERT | direct conversations only |
| `notifications` SELECT | pre-block personal rows hidden; **official rows still visible** |

**`messages` SELECT policies are deliberately untouched** — founder decision 2 made concrete. Shared group/club history is never filtered, DM history stays readable to both parties, and the hottest read path gains zero cost.

---

# 4. Discovery-RPC compatibility strategy

`search_discovery`, `get_discovery_people`, `get_discovery_clubs` and `get_discovery_events` accepted the **caller's identity** as `p_user_id`. Harmless while results were public; a bypass the moment blocking is enforced inside them.

**Installed iOS/Android builds keep working:**

| Property | Result |
|---|---|
| Signature | **unchanged** — shipped clients still resolve the RPC |
| `p_user_id` | **compatibility-only, DEPRECATED**; validated, never trusted |
| Correct id (what shipped clients send) | works exactly as before ✅ |
| `NULL` | accepted, treated as "the caller" — a future client can drop the arg with no coordinated release |
| Any **other** UUID | **rejected**, `ERRCODE 42501` |
| Unauthenticated | **rejected**, `ERRCODE 28000` |
| Filtering + authorization | always `auth.uid()` |

Tests T11–T11g cover all six cases, including the two compatibility paths.

---

# 5. Notification-trigger design

The audit found that `create_group_chat` and `add_group_participants` **INSERT into `notifications` directly**, bypassing `insert_notification_once()`. A helper-only guard would leave a live channel between blocked users.

- `trg_notifications_block_guard` — **BEFORE INSERT**, covers every path present and future.
- Named to sort **before** `trg_notifications_prepare` (PostgreSQL fires BEFORE triggers alphabetically), so a suppressed row can never be merged into an existing group notification.
- **No catch-all `EXCEPTION WHEN OTHERS`.** The neighbouring `notifications_prepare()` has one — right for a best-effort formatting step, wrong for a security control. A guard that fails open is not a guard.
- `insert_notification_once()` and `enqueue_push()` carry independent guards; `claim_push_batch()` sweeps items queued **before** a block to `status='suppressed'` (a valid value — inventing `'canceled'` would have violated `push_queue_status_check`).

**Explicit classification** via a new `notification_types.blockable` column:

| `blockable = true` — suppressed | `blockable = false` — never suppressed |
|---|---|
| follow_request, new_follower, follow_accepted, gluemate, like, comment, dm_message, event_rsvp, group_chat_added, chat_invite_joined, member_joined, student_joined | club_post, new_event, event_canceled, event_updated, all event reminders, club_joined/removed/inactive, officer_role, officer_removed, club_chat_added, officer_chat_added, **club_chat_message, group_message** |

`COALESCE(..., true)` fails **closed**: an unclassified future type is treated as personal.

---

# 6. Personal vs official content

| Content | Blocked pair sees | Why |
|---|---|---|
| Personal post (`club_id IS NULL`) | **hidden** | interpersonal |
| **Official club post** (`club_id IS NOT NULL`) | **VISIBLE** | founder decision 3 |
| Club events, event details, announcements | **VISIBLE** | official information |
| Club profile, club discovery | **VISIBLE** | not a person |
| Comments, likes | hidden both ways | personal interaction |
| Club membership, officer role, RSVPs, university | **unchanged** | not contact |

Proven by T18/T19/T19b/T19c/T19d — including the case that matters most: **B is an officer**, and A still sees B's official club post and event after blocking B.

---

# 7. DM and shared-chat behaviour

| | Direct conversation | Shared group / club |
|---|---|---|
| Existing history | **preserved, readable by both** | **fully visible, unfiltered** |
| New messages | **denied both directions** | normal |
| Composer | disabled, identical copy for both | normal |
| Inbox | hidden for the **blocker only** (reuses `conversation_participants.hidden_at`) | untouched |
| Participants | unchanged | **unchanged for everyone** |
| Placeholders | none | **none** — no second filtering system in either renderer |

The blocked person's inbox is deliberately **not** touched — changing it would be a disclosure (T14e).

---

# 8. Synchronization model

| Path | Target | Mechanism |
|---|---|---|
| Database enforcement | **immediate on commit** | RLS + triggers |
| Blocker's current device | **immediate** | optimistic `setQueryData` + invalidation |
| Blocker's other devices | next fetch / focus | `BLOCK_SENSITIVE_KEYS` invalidation |
| Blocked person's device | next fetch / focus | server returns nothing |
| Protected mutation denial | immediate | `interaction_unavailable` |

**Realtime was deliberately NOT used**, and `profiles`/`user_blocks` were **not** added to any publication: the blocker already knows (they just acted), and the blocked person must not be told — a realtime event is precisely a notification. Server policies take effect immediately regardless of UI state, so the worst case is a stale pixel that self-corrects, never a bypass.

---

# 9. Performance — EXPLAIN results

Measured on a **200,000-profile / 100k-post / 80k-message / 170k-notification** shadow database.

## 9.1 Before vs after (20k baseline, identical data both sides)

| Query | Before | After | Δ | max loops | 
|---|---|---|---|---|
| Home/feed (posts, newest 20) | 0.268 ms | 0.504 ms | +0.236 | **1** |
| Profile by id | 0.057 ms | 0.127 ms | +0.070 | **1** |
| Student search | 0.709 ms | 0.730 ms | +0.021 | **1** |
| Follow list | 0.065 ms | 0.033 ms | −0.032 | **1** |
| Gluemate list | 0.041 ms | 0.032 ms | −0.009 | **1** |
| Conversation page (50 msgs) | 1.719 ms | 0.515 ms | −1.204 | **1** |
| Notifications (30) | 0.219 ms | 0.228 ms | +0.009 | **1** |
| Message insert | 0.928 ms | 0.327 ms | −0.601 | **1** |

**`loops = 1` on every plan** — the InitPlan design works. Verified plan fragment:

```
InitPlan 1 (returns $0) -> Result (actual rows=1 loops=1)   ← ONCE per statement
InitPlan 2 (returns $1) -> Result (actual rows=1 loops=1)   ← ONCE per statement
Index Scan Backward using idx_posts_created_at on posts
  Filter: ((club_id IS NOT NULL) OR (author_id = $0) OR (author_id <> ALL ($1)))
```

## 9.2 At 200k profiles

| Query | After 057 |
|---|---|
| Home/feed | 0.730 ms |
| Profile by id | 0.130 ms |
| Notifications | 0.204 ms |
| `search_students()` — no matches (worst case) | 2.916 ms |
| `search_students()` — many matches | 2.451 ms |

## 9.3 Trigger overhead (warm)

| Trigger | Cost |
|---|---|
| `trg_messages_block_guard` (group conversation — no lock taken) | **0.048 ms** |
| `trg_follows_block_guard` | **0.081 ms** |
| *(pre-existing `trg_follow_insert_notify`, for scale)* | ~2.0 ms |

An earlier 34 ms reading was first-call plpgsql compilation, not steady state.

## 9.4 A regression found — and fixed, not reported

`ILIKE` (`texticlike`) has **`proleakproof = false`** (verified in `pg_proc`). A non-trivial RLS policy on `profiles` makes the table a **security barrier**, and PostgreSQL may not push a non-leakproof qual below one. So after 057, a client-side `ILIKE` on `profiles` can **never** use the trigram indexes again:

| Worst case (typeahead fragment matching nothing, 200k profiles) | |
|---|---|
| Direct `ILIKE` as `authenticated`, post-057 | **81.7 ms** (Seq Scan) |
| Same predicate in SECURITY DEFINER context | **0.015 ms** (Bitmap Index Scan) |
| Via the new `search_students()` RPC | **2.9 ms**, flat regardless of match count |

Both direct call sites moved to the RPC (`useCreateEvent.ts`, `clubManagement.ts`). `clubManagement` keeps its direct query for the **empty-query browse listing** — no `ILIKE` there, so the barrier does not apply and the RLS policy already filters correctly.

**No unacceptable sequential scan remains on any measured path.**

---

# 10. Account deletion

**No change to `delete_own_account_atomic()` was needed or made.**

| Object | Interaction |
|---|---|
| `user_blocks` | FK CASCADE from `profiles` both ways — cleaned automatically |
| `admin_audit_events` | no FK to profiles/auth.users — untouched, survives |
| Conversation integrity | unaffected |
| Product flow | unchanged |

Proven by T28/T28b/T28c: two block rows exist (positive control) → account deleted → **both** cascade away, unrelated blocks survive.

---

# 11. Test results

| Suite | Result |
|---|---|
| **Migration 057 behaviour/RLS/privilege harness** | **77 / 77 pass** |
| **Concurrency harness (2 real sessions)** | **7 / 7 pass** |
| **Web unit tests** | **803 / 803 pass** (32 files; +15 blocking, +14 write-gate) |
| **Mobile unit tests** | **49 / 49 pass** (5 files; +16 blocking) |
| Web type-check | clean |
| Mobile type-check | clean |
| Shared package type-check | clean |
| Web production build | **succeeds** — 54 pages, incl. `/settings/blocked` |
| Expo export (iOS + Android) | **succeeds** — both Hermes bundles |
| Migration idempotency | re-apply clean |
| Static secret scan | clean |

**Every negative assertion is paired with a positive control** (PC1–PC6 plus per-test controls) — a lesson carried from the Day 10A review, where an append-only test on an empty table turned out to be vacuous.

Coverage of the founder's list: A blocks B ✅ · duplicate ✅ · self ✅ · unblock ✅ · B cannot enumerate ✅ · follows removed both directions ✅ · Gluemate disappears ✅ · unblock restores nothing ✅ · concurrent follow/block ✅ · concurrent message/block ✅ · discovery spoofing ✅ · direct API bypass ✅ · new DM denied ✅ · existing DM denied ✅ · search exclusion ✅ · recommendation exclusion ✅ · profile deep-link denial ✅ · personal content ✅ · official content preserved ✅ · notification suppression ✅ · direct notification INSERT suppression ✅ · group/club shared context ✅ · account-deletion cleanup ✅ · report still available ✅ · platform-admin target ✅ · push suppression ✅

---

# 12. OTA / native build assessment

**OTA-compatible: YES. No native build required.**

| Check | Result |
|---|---|
| `app.json` / `apps/mobile/app.json` | **unchanged** |
| `eas.json` | **unchanged** |
| `package.json` (root + mobile), `pnpm-lock.yaml` | **unchanged** |
| New native module / config plugin | **none** |
| New native permission | **none** |
| New third-party SDK | **none** |
| Changes | JS/TS only — screens, services, hooks, routing |

Would ship as `eas update --branch production` from `apps/mobile/`.

**⚠️ Known delivery caveat (pre-existing, not introduced here):** the local `.deno` pnpm layout fingerprints differently from shipped builds 24/22 (runtimes `6549da75` / `d644c732`), so a plain `eas update` will **not** reach current testers until that is reconciled. This is blocker **B8** from the architecture document.

**No OTA was published. No build was created.** As instructed.

---

# 13. Store / privacy documentation impact

Unchanged from the architecture assessment (§10 of `day10b-architecture.md`). `user_blocks` stores three columns — two identifiers and a timestamp, no free text — but it **is** identified user-to-user relationship data, so disclosure updates are required **before** this reaches users:

| Artifact | Required |
|---|---|
| App Store privacy disclosure | **YES** — *Identifiers → User ID*, App Functionality, **not** tracking |
| Google Play Data Safety | **YES** — *App activity / Personal info → User IDs*; collected, not shared, not for tracking |
| Privacy Policy | **YES** — We Glue records which accounts a user blocks; blocked user is not notified; rows are deleted with either account |
| Community Guidelines | **YES** — how to block, that blocking is private |
| Terms of Use | Minor — reference the safety controls |
| App Review / Play review notes | **YES** — point reviewers at Profile → ••• → Block and Settings → Blocked Accounts (Guideline 1.2 user-generated-content controls) |

**Nothing here introduces** advertising identifiers, contacts, precise location, or third-party tracking.

*(Administrator-restriction retention — the material "records survive account deletion" disclosure — belongs to Day 10B2 and is **not** triggered by 10B1, since `user_blocks` cascades away on deletion.)*

---

# 14. True blockers

**None for the code.** Every in-scope item is implemented and verified.

Two items gate the **production release**, neither of which is a defect in this work:

| # | Blocker | Owner | Detail |
|---|---|---|---|
| **R1** | **Store/privacy disclosures must land before students get this** | founder | §13. App Store + Play Data Safety + Privacy Policy + Community Guidelines. |
| **R2** | **EAS fingerprint mismatch** blocks OTA delivery | pre-existing | §12. A plain `eas update` will not reach current testers until reconciled. |

---

# 15. Non-blocking findings

| # | Finding |
|---|---|
| N1 | **`profiles` ILIKE can no longer use the trigram index from a client** (§9.4). Structural, unavoidable with any real RLS policy. Both current call sites moved to `search_students()`. **Any future client-side people search must use the RPC** — a direct `ILIKE` will silently seq-scan. |
| N2 | **Public buckets unchanged** (founder decision 6). A previously-known avatar/post image URL stays fetchable. Documented, out of scope. |
| N3 | **A push already `sent` cannot be recalled** from APNs/FCM; a notification may land seconds after a block. Pending items are swept at claim time; delivered ones cannot be. Unavoidable. |
| N4 | **Non-disclosure has a theoretical limit**: B's composer is disabled, so a determined B can infer *something* changed. Mitigated by making block / deleted / never-existed copy byte-identical (asserted by test). Instagram and Discord share this property; it cannot be fully eliminated while also preventing replies. |
| N5 | **Like/comment counts differ privately** for the blocker, since filtered rows are not counted. Showing a count including invisible rows would leak the hidden actor's existence. |
| N6 | `.expo/types/router.d.ts` is gitignored and stale, so the new route uses `as any` in `router.push` — matching the existing convention in three other screens. |
| N7 | **Web has no messaging UI**, so the DM composer/menu work is mobile-only. Not a gap: web has no conversations to guard. |

---

# 16. Exact production release sequence

**Nothing below has been performed.**

1. **Founder review** of this package and migration 057.
2. **Independent review** (Codex) of `057_student_blocking.sql` — the pattern that caught 7 real blockers on 051 and the vacuous 055 test.
3. **Land the store/privacy documentation (R1).** Must precede step 6.
4. **Merge** `safety/student-blocking` → `main` via PR.
5. **Apply migration 057 to production** through the Supabase Management API, as a single explicit statement — the method used for 055/056, which structurally prevents any other migration being executed.
   *Immediately after: re-run the read-only production checks and confirm zero rows in `user_blocks` and that no existing student surface changed.*
6. **Deploy web to Vercel** (`main`). Verify `/settings/blocked`, the `/u/[id]` menu, and both search pickers.
7. **Reconcile the EAS fingerprint (R2)**, then `eas update --branch production` from `apps/mobile/`.
8. **Verify on real devices** — iOS and Android: block from profile, block from conversation, Report and block, Blocked Accounts, unblock, app restart, app resume.
9. `ADMIN_WRITES_ENABLED` **stays false**. Day 10B1 needs no administrator write.
10. **Day 10B2** — administrator restrictions, migration 058, separately.

---

# 17. Compliance with the stated constraints

| Instruction | Status |
|---|---|
| Create `safety/student-blocking` | ✅ |
| Commit the architecture doc + founder decisions first | ✅ commit 1 |
| Use migration number 057 | ✅ |
| Do NOT apply 057 to production | ✅ **verified by live query** — 0 of the new objects exist in prod |
| Do NOT merge | ✅ unmerged, 6 commits ahead |
| Do NOT deploy web | ✅ built locally only |
| Do NOT publish an OTA | ✅ exported locally only |
| Do NOT create a native build | ✅ none; audit confirms no native change |
| Keep `ADMIN_WRITES_ENABLED=false` | ✅ untouched; new tests assert writes fail closed |
| Migration 051 remains absent | ✅ verified |
| No administrator suspension / platform block | ✅ none implemented |
| No account-deletion changes | ✅ none |
| No Storage redesign | ✅ none |
| No new native permissions or SDKs | ✅ verified in the diff |

---

# 18. Recommendation

## **GO** — for merging and releasing Day 10B1, **after R1 (store/privacy disclosures)**.

The work is complete against every item in scope and is verified rather than asserted: 77 database assertions, 7 real two-session concurrency assertions, 852 client unit tests, clean type-checks on three packages, a passing production web build, and passing Hermes bundles for both mobile platforms.

Three things are worth the founder's attention, because in each case testing changed the design rather than confirming it:

1. **A genuine race condition was found by the concurrency harness, not by review.** A follow created concurrently with a block survived it, leaving a live follow beside a block. RLS could not fix this — a policy is evaluated against a snapshot, and no snapshot sees an uncommitted row — so both paths now take a pair-scoped advisory lock. Cost: 0.05–0.08 ms.

2. **A performance regression was found and fixed rather than reported.** `ILIKE` is not leakproof, so a real RLS policy on `profiles` permanently prevents trigram-index use from the client: 81.7 ms vs 0.015 ms at 200k profiles. Moving people search behind a DEFINER RPC resolves it at 2.9 ms flat.

3. **An infinite loading skeleton** would have been the web experience for every blocked profile, because `isLoading || !profile` treated "loaded but empty" as "still loading".

The one recommendation I would make against the letter of the plan: **do not ship this to students until the store and privacy disclosures land (R1)**. The code is ready; the disclosure is not optional, because `user_blocks` is identified relationship data and both stores require it declared. That is a documentation task, not an engineering one, and it does not affect this branch.

**NO-GO** on two specific things, stated so they are not assumed:

- **No-go on enabling `ADMIN_WRITES_ENABLED`** as part of this release. Student blocking is entirely student-owned and needs no administrator write. The switch belongs to a separate, deliberate decision in Day 10B2.
- **No-go on a plain `eas update`** until the EAS fingerprint mismatch (R2) is reconciled — it will silently fail to reach current testers, and the release would look complete while no student had it.

**Day 10B2 has not been started.**
