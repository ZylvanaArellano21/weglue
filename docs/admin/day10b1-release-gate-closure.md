# Day 10B1 — Release-Gate Closure
## Student-to-student blocking · `safety/student-blocking`

**Date:** 2026-07-31 · **Base:** `origin/main` @ `4885185f` · **Commits ahead:** 10 · **Unmerged, undeployed, not applied to production.**

---

# 1. Branch HEAD and new commits

**HEAD:** `3ca70b40` (+ this document)

| # | Commit | Gate |
|---|---|---|
| 1 | `9bce5ec7` | docs — architecture + founder decisions |
| 2 | `7ed9b774` | migration 057 |
| 3 | `7a344125` | `requireRecentMfaWrite()` |
| 4 | `01412cb5` | mobile blocking |
| 5 | `84238739` | web blocking |
| 6 | `736b9dcc` | advisory-lock serialization |
| 7 | `f5179f9d` | chore — unstage unrelated files |
| 8 | `bf48f1da` | docs — review package |
| 9 | **`cf34f95d`** | **Gate 1 — three security gaps closed** |
| 10 | **`3ca70b40`** | **Gate 2 — store + legal disclosure package** |

## Changed files (Gates 1–2 only)

`supabase/migrations/057_student_blocking.sql` · `supabase/scripts/test_057_student_blocking.sql` · `supabase/scripts/test_057_concurrency.sh` · `apps/web/lib/hooks/useCreateEvent.ts` · `apps/web/lib/clubs/clubManagement.ts` · `apps/web/app/privacy-policy/page.tsx` · `apps/web/app/community-guidelines/page.tsx` **(new)** · `apps/web/app/page.tsx` · `packages/shared/src/legal/termsAndConditions.ts` · `docs/admin/day10b1-store-disclosure.md` **(new)** · this file.

---

# 2. GATE 1 — Security review

## 2.1 Pair-lock path matrix

Canonical key: `private.user_pair_lock_key(a,b)` — `md5` of the **sorted** pair, `IMMUTABLE`, taken via `pg_advisory_xact_lock`.

| Path | Locked? | Where | Notes |
|---|---|---|---|
| `block_user` | ✅ | RPC body | after self/platform-admin rejection |
| **Follow creation** | ✅ | `trg_follows_block_guard` | BEFORE INSERT |
| **Follow acceptance** | ✅ | same trigger | BEFORE **UPDATE** — same trigger covers both |
| **Direct-conversation creation** | ✅ **added in Gate 1** | `get_or_create_direct_chat` | **was a reproduced defect** |
| **Direct-message insertion** | ✅ | `trg_messages_block_guard` | BEFORE INSERT, **direct conversations only** |
| **Share-to-DM** | ✅ | inherits both above | no separate path exists |
| `create_group_chat` | ✅ **added in Gate 1** | key-ordered multi-lock + re-filter | |
| `add_group_participants` | ✅ **added in Gate 1** | key-ordered multi-lock + re-filter | |
| `unblock_user` | ✅ **added in Gate 1** | RPC body | was fail-safe already; removes a confusing post-unblock rejection |
| Group/club **message** send | ⛔ **intentionally not locked** | `messages_block_guard` returns early | founder decision 2 — shared rooms are never restricted |

### Verified properties

| Property | Result |
|---|---|
| A/B and B/A produce the same key | ✅ `true` |
| Pair ordering deterministic | ✅ `least()/greatest()` on the uuid text |
| Cannot deadlock via reversed user ordering | ✅ single key per pair; multi-pair callers lock in ascending **key** order (a total order — id order would **not** suffice, since the key is a hash of the unordered pair). RACE 6 proves overlapping concurrent group creations both commit. |
| Self-pairs rejected **before** locking | ✅ `block_user` returns `self_target` before the lock |
| Lock scope transaction-level | ✅ `pg_advisory_xact_lock`; **0** advisory locks survive `COMMIT` |
| Unrelated pairs do not serialize globally | ✅ **20,000 random pairs → 20,000 distinct keys** |
| Unblock cannot let a stale follow/message commit incorrectly | ✅ RACE 1/2/4 re-verified after adding the unblock lock |
| 0.05–0.08 ms cost still representative | ✅ re-measured warm: `messages` guard **0.048 ms**, `follows` guard **0.081 ms** |

### The reproduced defect

```
session 1: BEGIN; block_user(C)                  -- holds open
session 2:        get_or_create_direct_chat(A)   -- checked WITHOUT the lock
session 1: COMMIT
→ result: created=t, and a direct conversation existed between a blocked pair
```
The empty thread landed in the **blocker's** inbox un-hidden, because `block_user`'s `hidden_at` sweep had already run before the conversation existed. Now: `ERROR: interaction_unavailable`, `blocked_pair_direct_convs=0`.

## 2.2 `search_students()` SECURITY DEFINER review

| Requirement | Result |
|---|---|
| `auth.uid()` the only authoritative identity | ✅ — the function takes **no** caller-id parameter at all |
| Rejects unauthenticated callers | ✅ `28000` |
| Accepts no trusted caller UUID | ✅ none exists in the signature |
| Fixed safe `search_path` | ✅ `search_path=""`, all names fully qualified |
| Owned by the intended role | ✅ `pgowner` (production `postgres`) |
| PUBLIC / `anon` execute revoked | ✅ no PUBLIC grant present |
| Only `authenticated` granted EXECUTE | ✅ `authenticated=X/pgowner` |
| Explicit allowlist of returned fields | ✅ `id, username, full_name, avatar_url, university` |
| No email / DOB / private metadata / moderation state / admin identity / block ownership | ✅ body scan for `email\|raw_app_meta\|banned\|password\|phone\|birth\|token` → **clean** |
| Excludes platform-admin accounts | ✅ they hold no `profiles` row (053) |
| Enforces single-campus scope | ✅ `p.university IS NOT DISTINCT FROM v_univ` |
| Enforces block visibility both directions | ✅ `p.id <> ALL(blocked_user_ids())` |
| Bounded result limits | ✅ `GREATEST(1, LEAST(limit, 50))`; 9999 → 50, −5 → 1, NULL → 10 |
| Blank / whitespace input safe | ✅ returns nothing |
| Excessively long input safe | ✅ capped at 100 chars |
| **Wildcard-only / pathological input** | ✅ **fixed in Gate 1** — see below |
| Maintains the measured performance benefit | ✅ see §2.4 |
| Existing installed clients keep working | ✅ `search_students` is **new** (web-only, both call sites updated). `search_discovery`'s signature is unchanged. |

### Two defects found and fixed

**(a) LIKE-metacharacter enumeration.** Parameterization stops SQL injection but not LIKE metacharacters. Verified before the fix: `search_students('%')` returned the entire student directory up to the limit. New `safe_like_fragment()` trims, caps at 100 chars and escapes `\ % _`; applied to `search_students` **and** `search_discovery`, used with `ESCAPE '\'`.

**(b) Short queries forced sequential scans.** A trigram index cannot serve a pattern under 3 characters:

| Fragment length | Plan | Time (200k profiles) |
|---|---|---|
| 1 char | Seq Scan | 20.6 ms |
| 2 chars | Seq Scan | **72.2 ms** |
| **3 chars** | **Bitmap Index Scan** | **0.41 ms** |
| 4 chars | Bitmap Index Scan | 0.25 ms |

`search_students` now requires 3 characters, measured on the **raw** trimmed input (escaping `%` yields the 2-character `\%`, which must not sneak past). Both web callers gate at the same threshold.

> **Deliberately not applied to `search_discovery`.** Installed iOS/Android builds search from the first keystroke; adding a minimum would change their behaviour. Recorded as non-blocking finding **N1**.

## 2.3 Notification-type matrix

`trg_notifications_block_guard` — **BEFORE INSERT**, covering every insertion route (`insert_notification_once`, `create_group_chat`, `add_group_participants`, and any direct INSERT). Verified it sorts **before** `trg_notifications_prepare`, so a suppressed row can never be merged into a group notification. No catch-all exception handler: it fails **closed**.

| Class | Types | Behaviour |
|---|---|---|
| **Suppressed — direct/social interaction** | `follow_request`, `new_follower`, `follow_accepted`, `gluemate`, `like`, `comment`, `dm_message`, `event_rsvp`, `group_chat_added`, `chat_invite_joined` | **blocked pairs: suppressed** |
| **Suppressed — social proof (names a person)** | `member_joined`, `student_joined` | **suppressed** |
| **Allowed — official club content/status** | `club_post`, `club_joined`, `club_removed`, `club_inactive`, `officer_role`, `officer_removed`, `club_chat_added`, `officer_chat_added` | **never suppressed** |
| **Allowed — official event information** | `new_event`, `event_canceled`, `event_updated`, `event_reminder_hour`, `event_reminder_now`, `event_reminder_tomorrow`, `event_last_chance` | **never suppressed** |
| **Allowed — approved shared context** | `club_chat_message`, `group_message` | **never suppressed** (founder decision 2) |
| **Not applicable** | `new_message` (`enabled=false`) | disabled registry-wide |

| Confirmation | Result |
|---|---|
| Official club and event information remains available | ✅ T21c / T21d |
| Safety notices (e.g. `event_canceled`) remain available | ✅ T21d |
| Report-status notifications | ⚠️ **no such notification type exists today** — reports are emailed to support, not notified in-app. Nothing to suppress or preserve. Stated rather than assumed. |
| Direct/social interaction suppressed | ✅ T20 / T21 |
| Push enqueue cannot recreate a suppressed notification | ✅ guard inside `enqueue_push` |
| Push dispatch rejects stale blocked-pair work | ✅ `claim_push_batch` sweeps pending → `'suppressed'` (a valid status; `'canceled'` would violate the CHECK) |
| No notification reveals a block | ✅ suppression is silent by construction — the row is never inserted |
| Unclassified future type | ✅ `COALESCE(blockable, true)` fails **closed** |

---

# 3. GATE 2 — Store & legal disclosure

Full detail: **`docs/admin/day10b1-store-disclosure.md`**.

| Artifact | Status |
|---|---|
| **Privacy Policy** | ✅ updated — new "Blocking Another Student" section covering all 11 required points, and explicitly **not** promising invisibility outside We Glue |
| **Community Guidelines** | ✅ **created** (did not exist) + linked from the landing footer |
| **Terms §12** | ✅ updated — blocking is a personal control, **not** a We Glue enforcement action |
| **Terms — suspension wording** | ✅ reviewed, **no change**: the existing "may suspend or terminate" is a reservation of right, not a claim that a suspension console exists (important, since 10B2 has not shipped) |
| **Account-deletion documentation** | ✅ reviewed — unaffected by 10B1 |
| **App Review notes** | ✅ drafted |
| **Play review notes** | ✅ drafted |

## Apple App Privacy — assessment

**No new data category is required.** `user_blocks` stores two identifiers and a timestamp — a category (**User ID**) the app already collects for authenticated accounts.

| Field | Current | Required | Change |
|---|---|---|---|
| Identifiers → User ID, collected | **UNVERIFIED** | Yes | only if missing |
| Linked to the user | **UNVERIFIED** | Yes | only if missing |
| Used for App Functionality | **UNVERIFIED** | Yes | only if missing |
| Used for Tracking | `false` (verified in manifest) | stays false | none |
| Analytics / Advertising / Personalization | — | **No** | do not add |

*(Apple has no "security/fraud prevention" purpose — that is a Google concept. Blocking maps to App Functionality.)*

## Google Play Data safety — assessment

**No new data category is required.** Play's *App activity → Other user-generated content* is explicitly **not** applicable: a block row contains no authored content.

| Field | Current | Required |
|---|---|---|
| Personal info → User IDs, collected | **UNVERIFIED** | Yes |
| Shared with third parties | **UNVERIFIED** | **No** |
| Processed ephemerally | **UNVERIFIED** | **No** |
| Required or optional | **UNVERIFIED** | Optional |
| Purpose: App functionality | **UNVERIFIED** | Yes |
| Purpose: Fraud prevention, security, compliance | **UNVERIFIED** | Appropriate |
| Encrypted in transit / deletion available | **UNVERIFIED** | Yes / Yes |

> Every "current" value is **UNVERIFIED** because no console access and no exported record exist. Nothing was submitted, and no console answer is claimed.

## Exact founder console actions

**Apple** — App Store Connect → We Glue → App Privacy → Edit → confirm *Identifiers → User ID* is collected, **Linked**, **App Functionality**, **Tracking = No** → Save. (No new binary required.)

**Google** — Play Console → We Glue → Policy → App content → **Data safety** → Manage → confirm *Personal info → User IDs* collected; Shared **No**; Ephemeral **No**; Optional; purposes *App functionality* (+ *Fraud prevention, security and compliance*); Encrypted in transit **Yes**; Deletion **Yes** → Submit. (Reviewed independently of a binary.)

---

# 4. GATE 3 — EAS runtime and fingerprint

## 4.1 Installed build metadata (from EAS, read-only)

| | iOS | Android |
|---|---|---|
| Build number | **23** | **27** |
| Build ID | `c01bb224-1413-4baa-8c09-b008808da583` | `7f98821b-bc67-43a7-a205-a1312619826b` |
| Git commit | `af954e80` | `af954e80` |
| Profile / channel | production / **production** | production / **production** |
| Status | FINISHED | FINISHED |
| Created | 2026-07-28 | 2026-07-28 |
| **Runtime version** | **`d644c732e7471dda3cdd6fc4d28e12179fded642`** | **`6549da75b3646f045f15ac939343b110552836cc`** |
| Latest update on branch `production` | group `a434e7af`, runtime `d644c732…` | group `9fe01c25`, runtime `6549da75…` |
| Store/testing track | *not exposed by EAS* — founder-reported: TestFlight / iOS 1.0 in review | *not exposed by EAS* — founder-reported: closed testing (alpha) |

`runtimeVersion` policy = **`fingerprint`**; update URL `https://u.expo.dev/e9ee8bc0-…`; channel **production** → branch **production**.

## 4.2 Candidate values (this working tree)

| Platform | Candidate runtime (EAS CLI 21.4.0) | Installed build | Match |
|---|---|---|---|
| iOS | `d644c732e7471dda3cdd6fc4d28e12179fded642` | `d644c732…` | ✅ **exact** |
| Android | `6549da75b3646f045f15ac939343b110552836cc` | `6549da75…` | ✅ **exact** |

Verified with `eas fingerprint:compare --build-id …` against **both** builds:
```
✅ Fingerprint d644c732… from IOS build matches fingerprint d644c732… from local directory
✅ Fingerprint 6549da75… from ANDROID build matches fingerprint 6549da75… from local directory
```

## 4.3 The mismatch cause — resolved

**There is no genuine runtime mismatch. The reported blocker was a TOOLING ARTIFACT.**

| Tool | iOS hash | Android hash | Authoritative? |
|---|---|---|---|
| `npx @expo/fingerprint@latest` (**v0.20.6**) | `08eb3d69…` (platform-agnostic) | — | ❌ newer standalone algorithm |
| `npx expo-updates fingerprint:generate` | `692c327c…` | `7dc3067a…` | ❌ resolves a different implementation |
| **`eas-cli` 21.4.0 (what `eas update` uses)** | **`d644c732…`** | **`6549da75…`** | ✅ **yes** |

Earlier sessions compared a hash from a standalone tool against the hash EAS stored, and concluded the runtimes had diverged. They had not — the two tools simply compute different algorithm versions. The authoritative computation is the one `eas update` performs, and `eas fingerprint:compare` uses exactly that path.

### Classification of every candidate mismatch input

| Input | Classification |
|---|---|
| `app.json` / `app.config.*` | **no difference** — unchanged on this branch |
| `eas.json` | **no difference** |
| expo-updates config, update URL, channel/branch mapping | **no difference** |
| `runtimeVersion` policy | **no difference** (`fingerprint`) |
| package.json / pnpm-lock.yaml / Expo SDK / expo-updates version | **no difference** |
| Native dependencies, config plugins | **no difference** |
| iOS entitlements / Android manifest | **no difference** |
| Local untracked `apps/mobile/ios/` (2.8 GB, **gitignored**) | **tooling-only** — appears as a `bareNativeDir` source with `hash: null` because fingerprint honours `.gitignore`; contributes nothing |
| Standalone `@expo/fingerprint@latest` vs EAS CLI | **tooling-only / non-native** — **this was the entire reported mismatch** |
| Day 10B1 source changes | **none** — proven below |

### Proof the native JS interface is unchanged

Fingerprints computed on the **same machine, same `node_modules`**, switching only the tracked files:

```
safety/student-blocking   ios 692c327c…   android 7dc3067a…
origin/main               ios 692c327c…   android 7dc3067a…      ← byte-identical
```

Day 10B1 changes **zero** fingerprint inputs. JS/TS source is deliberately not a fingerprint input — that is precisely what makes an update OTA-eligible. Independently corroborated: `app.json`, `eas.json`, both `package.json` files and `pnpm-lock.yaml` are all untouched on this branch, and no native module, config plugin or permission was added.

## 4.4 Release decision — **OPTION A: existing builds are genuinely compatible**

- The candidate tree's runtime **exactly equals** iOS build 23 and Android build 27.
- The most recent published update on branch `production` already carries those same two runtimes, so the OTA path to these builds is not theoretical — **it has already been exercised**.
- No new binary is required for Day 10B1.

**Safe OTA targeting plan (NOT executed):**

```
cd apps/mobile
# 1. Re-confirm immediately before publishing (cheap, read-only):
npx eas-cli fingerprint:compare --build-id c01bb224-1413-4baa-8c09-b008808da583   # iOS 23
npx eas-cli fingerprint:compare --build-id 7f98821b-bc67-43a7-a205-a1312619826b   # Android 27
#    Both MUST report ✅ before continuing. If either reports a difference, STOP —
#    that would mean a genuine native change crept in, and Option A no longer holds.

# 2. Publish to the branch the production channel already points at:
npx eas-cli update --branch production --message "Day 10B1 — student blocking"
```

- Targets **channel `production` → branch `production`**, the existing mapping. No new channel, no re-point.
- **No anti-bricking protection is disabled**, and **no `--runtime-version` override is used.** The fingerprint policy resolves the runtime itself; forcing it would be exactly the unsupported override to avoid.
- Rollback: `eas update:rollback` or republish the prior group (`a434e7af` iOS / `9fe01c25` Android).

**Blocker R2 is CLOSED.** The only remaining release gate is R1 (store/privacy disclosure confirmation).

---

# 5. Updated test results

| Suite | Result |
|---|---|
| Migration 057 behaviour / RLS / privilege | **95 / 95 pass** (was 77 — +18 for search hardening and length bounds) |
| Concurrency (real two-session) | **17 / 17 pass** (was 7 — +10 for RACE 4/5/6 and lock-key invariants) |
| Web unit tests | **803 / 803 pass** |
| Mobile unit tests | **49 / 49 pass** |
| Web / mobile / shared type-checks | clean |
| Web production build | succeeds (55 routes, incl. `/community-guidelines`) |
| Migration idempotency | re-apply clean |

---

# 6. True blockers

| # | Blocker | Owner | Status |
|---|---|---|---|
| **R1** | **Store/privacy disclosure confirmation.** Documents are written and committed; the two **console** declarations must be confirmed by the founder (no console access here). | founder | **OPEN — the only release gate** |
| ~~R2~~ | ~~EAS runtime/fingerprint mismatch~~ | — | ✅ **CLOSED** — was a tooling artifact; both platforms verified matching |

---

# 7. Non-blocking findings

| # | Finding |
|---|---|
| **N1** | `search_discovery` keeps its 1-character minimum so installed iOS/Android builds are not broken. It therefore still seq-scans on 1–2 character fragments (20–72 ms at 200k profiles; immaterial at Lone Star's current scale). Apply the 3-char minimum when mobile next ships a matching client change. |
| **N2** | `apps/mobile/ios/WeGlue/PrivacyInfo.xcprivacy` declares an **empty** `NSPrivacyCollectedDataTypes` while the app collects email, username and user content. **Pre-existing**, unrelated to 10B1, not changed here (editing a native manifest alters the build). |
| **N3** | No **report-status notification type** exists — reports are emailed to support, not surfaced in-app. Nothing to preserve or suppress today; revisit if in-app report status ships. |
| **N4** | Public buckets unchanged (founder decision 6): an already-known avatar/post URL stays fetchable. Now disclosed honestly in the Privacy Policy. |
| **N5** | A push already `sent` cannot be recalled from APNs/FCM; pending items are swept at claim time. |
| **N6** | Non-disclosure has a theoretical limit — a disabled composer lets a determined user infer *something*. Mitigated by byte-identical copy across blocked / deleted / never-existed (asserted by test). |
| **N7** | Like/comment counts differ privately for the blocker, since filtered rows are not counted. |
| **N8** | `.expo/types/router.d.ts` is gitignored and stale, so the new mobile route uses `as any` — matching the existing convention in three other screens. |

---

# 8. Constraint confirmation

| Constraint | Verified |
|---|---|
| `ADMIN_WRITES_ENABLED=false` | ✅ 0 occurrences of a `true` assignment outside tests |
| Migration 057 **not applied** to production | ✅ live query: `user_blocks` absent, `notification_types.blockable` absent |
| Migration 051 remains absent | ✅ 0 files |
| No production row modified | ✅ only read-only `SELECT`s were issued (helper refuses non-reads) |
| No user blocked during testing | ✅ all blocking exercised on shadow-database fixtures |
| Nothing merged | ✅ 0 — branch is 10 commits ahead, unmerged |
| Nothing deployed | ✅ web built locally only |
| No OTA published | ✅ only `build:list`, `channel:list`, `update:list`, `fingerprint:compare` (all read-only) |
| No native build created | ✅ no `eas build` invoked |
| Day 10B2 not started | ✅ no `058`, no restriction model, no admin restriction action |

---

# 9. Recommendation

## **GO** — merge and release Day 10B1 once **R1** is confirmed.

Both remaining gates closed cleanly, and in each case the evidence changed the conclusion rather than confirming it:

**Gate 1 found three real defects**, each reproduced before being fixed. The most serious was silent: `get_or_create_direct_chat` checked the block relationship *without* the pair lock, so a DM created concurrently with a block left an empty conversation with the blocked person sitting in the **blocker's own inbox**. The other two were in code I wrote in this phase — a bare `%` enumerated the student directory through the search box, and any 1–2 character fragment forced a 72 ms sequential scan at scale. All three are fixed, tested, and measured.

**Gate 3 dissolved a blocker rather than confirming it.** The EAS "fingerprint mismatch" was never real: earlier sessions compared a hash from `@expo/fingerprint@latest` against the hash EAS stored, and those tools run different algorithm versions. Asking EAS itself — `eas fingerprint:compare` — returns an **exact match on both platforms**, and the most recent published update on the `production` branch already carries those same runtimes, so the OTA path to builds 23 and 27 is proven rather than assumed. Day 10B1 changes zero fingerprint inputs, demonstrated by computing identical hashes on this branch and on `origin/main` with the same `node_modules`.

**One condition remains, and it is not an engineering task.** The public documents are written and committed, but the two store-console declarations must be confirmed by someone who can see them. My assessment is that **no new data category is required for either store** — `user_blocks` stores identifiers the app already collects — so this should be a confirmation rather than a change. I have deliberately not claimed what the consoles currently say, because I cannot see them.

**NO-GO**, stated explicitly so neither is assumed:

- **No-go on publishing the OTA before re-running the two `fingerprint:compare` commands.** They are seconds long and are the only thing standing between a safe update and a bricked tester build. If either stops matching, Option A no longer holds.
- **No-go on enabling `ADMIN_WRITES_ENABLED`.** Student blocking is entirely student-owned and needs no administrator write. That switch belongs to Day 10B2.

**Day 10B2 has not been started.**
