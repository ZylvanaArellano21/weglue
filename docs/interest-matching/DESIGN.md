# Interest Matching + Admin Control — Master Design & Contract

Lead: Claude (frontend + integration). Backend: Codex sub-agent tasks C1–C7.
Feature branch (Claude): `feat/interest-matching-and-admin`
Backend worktree (Codex): `/Users/zylvanaarellanocampos/weglue-imb` on `codex/interest-matching-backend`

Founder decisions locked (2026-09-05):
- Club-match scoring is **interests only**; `user_activities` must not affect club-match scoring.
- Discovery category filter: a club appears for interest X if X is assigned at **Primary OR Secondary**.
- Discovery source change is **native iPhone + Android phone only** — a phone-only caller path;
  iPad-native and all web keep their current behavior/code.
- `club_interests` is the **single source of truth**. **Option B (2026-09-05):** `club_categories`
  and the existing `get_discovery_clubs*` are left FROZEN/untouched; the phone Discovery path is a
  fully separate new set of RPCs reading `club_interests`. iPad-native + all web: zero change.
- `user_interests` migrates to **`interest_id`** with a safe one-time backfill; history preserved.
- Interests are **never hard-deleted** from the Admin Dashboard — deactivate/archive only.
- New admin writes use the **existing** secure admin-write protection (secure gate + MFA/write gate + audit).
- Do not merge PR #93. Seed any of the 12 clubs missing from prod **inside this task**, idempotently.
- Activities survey stays **out of scope**.

---

## 0. What already exists (migrations 001 / 042 / 087 / 065 / 109) — DO NOT REBUILD

| Object | Status |
|---|---|
| `club_interests (id, club_id, interest TEXT CHECK(22 values))` | exists, **flat, no tier**, index on club_id only, RLS "officers can manage" / anon+auth read |
| `user_interests (id, user_id, interest TEXT CHECK(22))` + `uniq(user_id,interest)` | exists |
| `user_activities (id, user_id, activity TEXT CHECK(10))` + `uniq(user_id,activity)` | exists — **untouched by this task** |
| `club_recommendation_batches` + partial-unique active-per-user | exists |
| `rank_eligible_clubs(user, univ, interests[], limit)` | ranks by `interest_overlap` count → `member_count` → name; **no activity scoring** (042 comment confirms) |
| `club_match_target_count(natural, eligible) = LEAST(GREATEST(natural,2), eligible)` | **already implements the min-2 + popular-fill rule** |
| `generate_club_recommendation_batch`, `regenerate_my_club_recommendations`, `get_my_club_recommendations` (self-healing top-up), `dismiss_club_recommendation_batch`, `preview_club_match_count`, `get_my_club_recommendation_outcome` | exist; **RPC signatures + JSON shapes are FROZEN** (released clients depend on them) |
| `complete_recommendation_batch_on_join` trigger on `club_members` | exists |
| `handle_new_user()` + `reconcile_signup_survey()` | write `user_interests`/`user_activities` from signup metadata, filtered by a **hard-coded 22-value whitelist** (3 copies) |
| `club_categories` + `get_discovery_clubs(user, category, limit, offset)` + `get_discovery_events` | discovery uses `club_categories` (text), seeded only for the 6 demo clubs (015/017) |

**C1 CONFIRMED (prod introspection 2026-09-05 — see C1-reconnaissance.md):**
- Prod migration ledger latest = **121**. → this task uses **122–126**.
- **All 12 target clubs exist and are active** — NO club-row seeding needed. Seed by `clubs.handle`.
- **`club_interests` is EMPTY in prod (0 rows)** → matching is popularity-only today. Clean slate,
  no `interest_id` backfill for club_interests.
- **`club_categories` is EMPTY in prod (0 rows)** → iPad/web Discovery category filter already dead.
- `user_interests` = 205 rows / 43 users / all 22 canonical values (exact spelling match) → needs
  careful label→interest_id backfill; never delete.
- `rank_eligible_clubs` live def == migration 087 exactly; **no `user_activities` in club scoring** ✅.
- `handle_new_user` live def is later than 087 (avatar/oauth/terms) — preserve all of it.
- `get_discovery_clubs` → wrapper → `get_discovery_clubs__inner` (reads `club_categories`).
- Prod `115` = `seed_math_society_club`, prod `120` = `seed_philosophy_club` (both applied). Local
  ledger diverges — reconciled on branch `chore/migration-ledger-reconcile` / **PR #104** (must merge
  before PR #103). Philosophy Club has since been removed from prod; its successor **The Academy**
  (`handle = TheAcademy`) receives the Philosophy mappings in `123`. See
  `docs/audits/migration-ledger-reconciliation.md`.

---

## 1. Data model changes (Codex C2)

### 1.1 `interests` catalog (NEW)
```sql
CREATE TABLE interests (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug       text NOT NULL UNIQUE,              -- stable machine key; never changes
  label      text NOT NULL,                     -- display; admin-renameable; UNIQUE among active
  is_active  boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz                       -- set when is_active flips to false
);
CREATE UNIQUE INDEX uniq_interests_label_active ON interests (lower(label)) WHERE is_active;
```
- Seed the 22 canonical interests (slug = kebab of label; keep spelling EXACTLY as the frontend list).
- RLS: `SELECT` to `anon, authenticated` **WHERE is_active** (inactive rows only via service role / admin).
  Full read (incl. inactive) for admin through the service-role client.
- No client write policy. All writes via `admin_tx_interest_*` (C4).

### 1.2 `club_interests` — add tier, move to `interest_id`
```sql
ALTER TABLE club_interests ADD COLUMN interest_id uuid REFERENCES interests(id) ON DELETE RESTRICT;
ALTER TABLE club_interests ADD COLUMN tier text NOT NULL DEFAULT 'primary'
  CHECK (tier in ('primary','secondary'));
-- backfill interest_id from interest (label match, case-insensitive) against seeded catalog
-- then: drop DEFAULT on tier, drop the old CHECK on `interest`, keep `interest` text NULLABLE
-- for one release as a shadow column (or drop if C1 shows nothing else reads it) — CONFIRM AT REVIEW.
ALTER TABLE club_interests ADD CONSTRAINT uniq_club_interest UNIQUE (club_id, interest_id);
CREATE INDEX idx_club_interests_interest ON club_interests (interest_id);
```
- RLS: keep "officers can manage" for their own club? **DECISION:** officer self-tagging is now
  superseded by admin control. Keep officer read; **remove officer write** (or leave it — CONFIRM AT
  REVIEW with founder; spec says admin-managed). Admin writes via `admin_tx_*`.

### 1.3 `user_interests` — move to `interest_id` (Q5)
```sql
ALTER TABLE user_interests ADD COLUMN interest_id uuid REFERENCES interests(id) ON DELETE RESTRICT;
-- backfill from interest (label match). Rows whose label has no catalog match: keep, log, leave
-- interest_id NULL (do NOT delete — preserves history).
-- New uniqueness: UNIQUE (user_id, interest_id).
-- Drop old CHECK on `interest`. Keep `interest` text for back-compat reads for one release,
-- OR drop — CONFIRM AT REVIEW.
```
- `ON DELETE RESTRICT` + "never hard delete an interest" ⇒ historical rows are always safe.

### 1.4 `club_categories` — **FROZEN (founder chose Option B)**
Leave the `club_categories` table exactly as it is (empty in prod, unused). Do NOT drop it, do NOT
turn it into a view, do NOT write to it. `get_discovery_clubs*` stays untouched. The phone path (§5)
reads `club_interests` directly and never touches `club_categories`.

---

## 2. Scoring rewrite (Codex C3) — modify in place, signatures frozen

### 2.1 `rank_eligible_clubs` — weighted tier score
Return an extra column but keep the existing ones. New ordering:
```
score = SUM(CASE ci.tier WHEN 'primary' THEN 3 WHEN 'secondary' THEN 1 ELSE 0 END)
        over ci for club c where ci.interest_id IN (the user's interest_ids)
ORDER BY score DESC, c.member_count DESC, c.name ASC
```
- `RETURNS TABLE (club_id uuid, interest_overlap int, match_score int)` — add `match_score`; keep
  `interest_overlap` = count of matched interests (still used by `generate_*` / `preview_*` to compute
  `v_natural = COUNT(*) FILTER (WHERE match_score > 0)`).
- User interest ids: `SELECT interest_id FROM user_interests WHERE user_id = p_user_id AND interest_id IS NOT NULL`.
  For `preview_club_match_count(p_interests text[])` the arg is still **labels** (client onboarding
  state) — resolve labels → interest_ids against active catalog inside the function.
- **Never** reference `user_activities` anywhere in this path (already true; keep it true).
- Score-0 clubs are excluded from "natural matches" (`match_score > 0` filter) but still eligible as
  popular fill — unchanged behavior.

### 2.2 Guarantee count == displayed set (Q7)
- `club_match_target_count` unchanged (already `LEAST(GREATEST(natural,2), eligible)`).
- `generate_club_recommendation_batch`: `v_natural := COUNT(*) FILTER (WHERE match_score > 0)`.
- `preview_club_match_count`: same computation, same pool (`p_user_id = NULL`), same interests ⇒
  identical number to what the signup batch builds. Verify with a harness test (C7).
- Fill order = `rank_eligible_clubs` order (score desc, then member_count desc) ⇒ 0 matches → top-2
  by member_count; 1 match → that match + next by member_count. No dupes (already `NOT (id = ANY(...))`).

### 2.3 Frontend congrats fix (Claude) — no backend change
`apps/web/app/onboarding/signup/page.tsx` + `apps/mobile/app/onboarding/signup.tsx`:
- Remove `Math.max(state.matchCount, 2)` / `Math.max(matchCount, 2)`.
- On mount, re-call `preview_club_match_count(selectedInterests)` to refresh the number (the Activities
  screen's value can be stale after a Back edit). Use that value directly.
- If preview fails / returns `< 1`: show the celebratory copy **without a hard number**
  ("We found clubs you'll love") rather than a wrong "+2". The real batch on Home is authoritative.

---

## 3. Catalog-driven surveys (Codex C3 + Claude FE)

### 3.1 Interest write path — new RPC (Codex C3)
```sql
-- Replace the raw client delete+insert on user_interests with a single validated RPC.
CREATE FUNCTION set_my_interests(p_slugs text[]) RETURNS void
  SECURITY DEFINER ...   -- auth.uid() only; validates each slug ∈ active catalog;
                         -- replaces user_interests rows (by interest_id); raises on unknown slug.
GRANT EXECUTE ... TO authenticated;
```
- `handle_new_user` / `reconcile_signup_survey`: resolve signup-metadata interest **labels** →
  `interest_id` against `interests` WHERE `is_active` (case-insensitive label match); drop the
  hard-coded 22-value `WHERE value IN (...)` lists. Unknown/renamed label → skipped (same as today).
  Keep the `EXCEPTION WHEN OTHERS RAISE WARNING` guards (never 500 a signup).
- Activities lists in `handle_new_user`/`reconcile_signup_survey` stay hard-coded (out of scope).

### 3.2 Shared catalog module (Claude) — `packages/shared/src/interests/catalog.ts` (NEW)
```ts
export interface InterestOption { id: string; slug: string; label: string; sortOrder: number; }
export type ClubInterestTier = 'primary' | 'secondary';
export async function fetchActiveInterests(supabase): Promise<InterestOption[]>;   // is_active, order by sort_order,label
export const INTEREST_CATALOG_FALLBACK: readonly string[];   // the current 22 labels — last-resort only
```
Export from `packages/shared/src/index.ts`.

### 3.3 Survey screens (Claude) — replace hard-coded arrays with `fetchActiveInterests` + fallback
- `apps/mobile/app/onboarding/interests.tsx` (`INTERESTS`)
- `apps/web/app/onboarding/interests/page.tsx` (`INTERESTS`)
- `apps/mobile/app/profile/edit-interests.tsx` (`ALL_INTERESTS`)
- `apps/web/components/profile/InterestsRerunClient.tsx` (`INTERESTS`; leave `ACTIVITIES` hard-coded)
Behaviour: fetch on mount; while loading show skeleton/last-known; on error use `INTEREST_CATALOG_FALLBACK`.
Selection state stays **label[]** end-to-end (onboarding metadata + rerun both send labels; edit-profile
switches to `rpc('set_my_interests', { p_slugs })` — map selected labels → slugs via the fetched catalog).

### 3.4 Write path wiring (Claude)
- `apps/web/lib/hooks/useInterestsRerun.ts`: replace `replaceRows("user_interests",...)` with
  `rpc('set_my_interests', { p_slugs })`. Keep the `regenerate_my_club_recommendations` +
  `get_my_club_recommendation_outcome` calls and the outcome contract untouched.
- `apps/mobile/services/profileService.ts` `updateUserInterests`: same → `rpc('set_my_interests')`.
- `apps/web/app/onboarding/explore-clubs/page.tsx` (writes `user_interests` directly): route through
  the RPC too (or leave — CONFIRM: does the web onboarding actually persist here, or only via signup
  metadata? `[C1 / read at impl]`).
- `packages/shared/src/stores/onboardingStore.ts` / `apps/web/lib/onboardingState.ts`: no shape change
  (still `selectedInterests: string[]` of labels).

---

## 4. Admin Dashboard (Codex C4 backend + Claude FE)

### 4.1 `admin_tx_interest_*` functions (Codex C4) — migration, 056 pattern
Each: single txn = canonical mutation + `admin_audit_log(...)` row, returns `{ status, ... }`.
| Function | Args | Notes |
|---|---|---|
| `admin_tx_create_interest` | `p_label`, `p_slug?` | slug auto from label if omitted; reject dup slug/active-label; `invalid_name` if !2..40 |
| `admin_tx_rename_interest` | `p_interest_id`, `p_label` | `interest_not_found`; dup active-label → `label_taken` |
| `admin_tx_set_interest_active` | `p_interest_id`, `p_active bool` | sets `archived_at`; NEVER deletes; `is_active=false` hides from surveys immediately |
| `admin_tx_assign_club_interest` | `p_club_id`, `p_interest_id`, `p_tier` | `club_not_found` / `interest_not_found` / `interest_inactive` / `already_assigned` |
| `admin_tx_remove_club_interest` | `p_club_id`, `p_interest_id` | idempotent; `not_assigned` ok-ish |
| `admin_tx_set_club_interest_tier` | `p_club_id`, `p_interest_id`, `p_tier` | `not_assigned`; no-op if unchanged |
- No hard-delete function exists. Deletion of an `interests` row is not exposed anywhere.
- GRANT EXECUTE to `service_role` only (called by the Next server action via `createAdminClient`).

### 4.2 Audit vocabulary — reuse existing target types (NO CHECK-constraint change)
`admin_audit_actions.target_type` and `admin_audit_events.target_type` both carry a hard-coded 18-value
CHECK. We do NOT touch those. Interest actions map onto existing target types:
- `interest.create` / `interest.rename` — target_type `system`, target_id NULL, ordinary, reason:false
- `interest.deactivate` / `interest.reactivate` — target_type `system`, target_id NULL, sensitive,
  reason:**true** (hides/shows an interest across both surveys — mirrors `university.setActive`)
- `club.interestAssign` / `club.interestRetier` — target_type `club`, target_id = club_id, ordinary, reason:false
- `club.interestRemove` — target_type `club`, target_id = club_id, sensitive, reason:**true**
  (removing an assignment changes who matches the club)

Claude — `apps/web/lib/admin/auditSanitize.ts`: add these 7 to `AUDIT_ACTIONS` (metadataKeys carry
`interestId`/`slug`/`label`/`tier`/`clubId`). No `AUDIT_TARGET_TYPES` change, no `STATE_FIELDS` change.
Codex C4 — migration `125` appends the SAME 7 rows to `public.admin_audit_actions`
(action, target_type, sensitivity, requires_reason, description), matching exactly.
Claude — `apps/web/lib/admin/atomicMutation.ts` `STATUS_MESSAGE`: add `label_taken`, `slug_taken`,
`interest_not_found`, `interest_inactive`, `already_assigned`, `not_assigned`, `invalid_tier`,
`invalid_label`, `interest_in_use` (if we ever guard), `no_change`.

### 4.3 Admin data + actions (Claude)
- `apps/web/lib/admin/interestsData.ts` (NEW): `listInterests({ search, status: 'active'|'inactive'|'all' })`,
  `getInterestUsage(id)` (club count by tier), `listClubInterests(clubId)`, `listClubsForInterest(id, {search})`.
- `apps/web/lib/admin/interestsActions.ts` (NEW): 7 server actions → `requireSecureAdmin({write:true})`
  → `runAtomicMutation(...)`. `ActionResult` shape. Never throw to client.
- `apps/web/lib/admin/data.ts`: `getClubDetail`/`ClubDetail` gains `interests: {id,label,slug,tier}[]`;
  `listClubs`/`ListClubsParams` gains `interestId?` filter (+ join).

### 4.4 Admin UI (Claude)
- `apps/web/app/admin/interests/page.tsx` (NEW): table (label, slug, status, #clubs primary/secondary,
  created). `ListControls` search + status filter. Row actions: rename, deactivate/reactivate. Header:
  "Add interest". Uses `InterestControls.tsx`.
- `apps/web/components/admin/InterestControls.tsx` (NEW): add/rename/deactivate dialogs (pattern:
  `RestrictionControls.tsx` / `ConfirmAction.tsx` / `primitives.tsx`).
- `apps/web/components/admin/ClubInterestControls.tsx` (NEW): on the club detail "Interests" tab —
  assigned list grouped by tier, remove (×), tier toggle (Primary↔Secondary), "Assign interest"
  (`EntityPicker`-style search over active interests).
- `apps/web/app/admin/clubs/[id]/page.tsx`: add `{ key: "interests", label: "Interests", content: ... }`
  tab rendering `ClubInterestControls`.
- `apps/web/app/admin/clubs/page.tsx`: add an "Interest" filter to `ListControls` (options = active interests).
- `apps/web/lib/admin/nav.ts`: `{ label: "Interests", href: "/admin/interests", icon: "🎯", day: 1, ready: true, group: "Community" }`.
- `apps/web/lib/admin/dataHealth.ts` (opt): check "active club with 0 primary interests".
- `apps/web/components/admin/GlobalSearch.tsx` + `apps/web/app/admin/api/search/route.ts` (opt):
  include interests in results. **CONFIRM scope at review** (may defer).

---

## 5. Discovery — phone-only path (Codex C5 + Claude FE)  — FOUNDER CHOSE **OPTION B (STRICT)**

### 5.1 Backend (Codex C5) — migration `126_phone_discovery.sql`
- **`club_categories` table is FROZEN — left exactly as-is (empty, unused). NO view. Nothing writes it.**
- `get_discovery_clubs` / `get_discovery_clubs__inner` / `get_discovery_events` / any `getDistinctCategories`
  query path: **COMPLETELY UNTOUCHED.** iPad-native + all web keep their current (non-functional-in-prod)
  category behavior. Zero change.
- NEW `public.get_phone_discovery_categories()` RETURNS `TABLE(slug text, label text, sort_order integer)`
  — **EVERY active interest** from the shared catalog, ordered by `sort_order, label`. NOT gated on
  club assignment: a category with no matching clubs still shows; selecting it returns 0 clubs (see
  `get_phone_discovery_clubs__inner`). SECURITY DEFINER STABLE, GRANT to authenticated.
  *(Founder decision 2026-09-06: the earlier `EXISTS (club_interests …)` gate was removed — it caused
  every category to disappear whenever `club_interests` was empty.)*
- NEW `public.get_phone_discovery_clubs(p_user_id uuid, p_interest_slug text DEFAULT NULL,
  p_limit int DEFAULT 20, p_offset int DEFAULT 0)` — thin wrapper that does the same
  `current_student_can_access_app()` restriction check as `get_discovery_clubs`, then calls
  `get_phone_discovery_clubs__inner(...)`.
- NEW `public.get_phone_discovery_clubs__inner(...)` — SAME return-row shape as
  `get_discovery_clubs__inner` (id,name,avatar_url,cover_image_url,member_count,is_member,
  categories text[],meeting_day,meeting_time_start,meeting_time_end,meeting_building,meeting_room):
  - `categories` = the club's active interest **labels** (both tiers), ordered.
  - filter: `p_interest_slug IS NULL OR EXISTS (club_interests ci JOIN interests i ON i.id=ci.interest_id
    WHERE ci.club_id=c.id AND i.slug=p_interest_slug AND i.is_active)`  — **Primary OR Secondary** both
    qualify (founder decision).
  - personalized sort when `p_interest_slug IS NULL`: `ORDER BY <weighted match_score for this user> DESC,
    c.member_count DESC, c.name ASC` where match_score uses the +3/+1 tiers vs the user's
    `user_interests.interest_id`. When a slug filter IS applied: `ORDER BY c.name ASC` (like today's
    filtered view).
  - `assert_self_or_null(p_user_id)` guard, `is_active` clubs only.
- GRANT EXECUTE on both new public RPCs to `authenticated` (and `anon` only if the existing discovery
  RPCs grant anon — match them).

### 5.2 Frontend (Claude) — `apps/mobile` ONLY, phone-only branch
- Phone vs tablet: `useWindowDimensions().width < 768` (same `TABLET_BREAKPOINT` the Home tab uses),
  computed in `apps/mobile/app/(tabs)/search.tsx`.
- `apps/mobile/services/searchService.ts`: `getPhoneDiscoveryClubs(userId, interestSlug, page, size)`
  and `getPhoneDiscoveryCategories()` call the new RPCs. **Missing-RPC safety:** if the RPC answers
  with "function not found" (PGRST202 / SQLSTATE 42883 — i.e. migration 126 not yet deployed), fall
  back to the legacy `getDiscoveryClubs` / `getDistinctCategories` for that call. This is
  defensive/backward-compat only — it does **not** restore interest categories before migrations
  122+123+126, because `club_categories` is already empty in prod. No hard-coded categories. Legacy
  `getDiscoveryClubs` / `getDistinctCategories` are otherwise untouched.
- `apps/mobile/hooks/useSearch.ts`: `useDiscoveryClubs` / `useDistinctCategories` take an `isPhone`
  flag; phone → new functions + phone-scoped query keys; tablet → existing functions unchanged.
  The category value passed around becomes a `{slug,label}` (or the slug) on phone; label on tablet —
  keep them separate so tablet code is byte-identical.
- `apps/mobile/app/(tabs)/search.tsx`: pass the `isPhone` flag; `CategoryPillRow` shows `label`, selects
  by `slug` on phone. No visual change.
- iPad-native: unchanged. Web (`apps/web/lib/search/*`, `useSearchTab.ts`): **untouched.**

### 5.2 Frontend (Claude) — `apps/mobile` only, phone-only branch
- `apps/mobile/services/searchService.ts`: `getDiscoveryClubs` / `getDistinctCategories` take an
  `isPhone` flag (or a new pair of functions). Phone → `get_phone_discovery_*`; tablet → existing RPCs.
- `apps/mobile/hooks/useSearch.ts`: thread a `isPhone` value (from existing tablet detection —
  `[find at impl: Platform / useDeviceType / isTablet helper]`) into the query keys + calls.
- `apps/mobile/app/(tabs)/search.tsx`: no UX change; just passes the flag.
- iPad-native: unchanged (still calls `get_discovery_clubs` with a category string; the view supplies data).
- Web (`apps/web/lib/search/*`, `apps/web/lib/hooks/useSearchTab.ts`): untouched unless a shared type
  breaks (it should not).

---

## 6. Seeds (migration 123) — 13 clubs, 45 assignments

C1 confirmed all 12 original target clubs exist and are active in prod; **Climbing Club** (added
2026-09-06) also already exists (`handle = ClimbingClub`). The **Philosophy Club** was later removed
from production and recreated by its officers as **"The Academy"** (`handle = TheAcademy`, same
philosophy focus) — migration 123 assigns the approved Philosophy mappings to `TheAcademy` as the
successor. No club rows are created — migration 123 seeds `club_interests` (`interest_id` + `tier`)
by handle, idempotently (`ON CONFLICT (club_id, interest_id) DO UPDATE SET tier = EXCLUDED.tier`),
and aborts if any `(handle, slug)` is missing or a club ends with no primary. Total = **45** triples
across **13** clubs.

| Club | Primary | Secondary |
|---|---|---|
| Accounting Club | Finance & Business; Numbers & Economics | Strategy and Critical Thinking |
| Asian American Association | Art & Culture; Social Events | Travel & Languages; Community Service |
| Economics Club | Numbers & Economics; Finance & Business; Strategy and Critical Thinking | Debate & Politics |
| Human Services Student Organization | Community Service; Health & Wellness; Social Justice & Activism | — |
| Mavericks in Recovery | Health & Wellness | Community Service; Social Events |
| Music Club | Music; Art & Culture | Social Events |
| The Academy _(successor to Philosophy Club, `handle = TheAcademy`)_ | Strategy and Critical Thinking; Debate & Politics | Writing; Religion |
| Math Society | Numbers & Economics; Strategy and Critical Thinking | Technology and Computer |
| Student Government Association | Debate & Politics; Community Service | Social Justice & Activism; Strategy and Critical Thinking |
| Technology Club | Technology and Computer | Strategy and Critical Thinking; Gaming |
| Allied Scholars for Animal Protection | Social Justice & Activism; Community Service; Environment | — |
| Engineering Society | Technology and Computer; Strategy and Critical Thinking; Numbers & Economics | Environment |
| Climbing Club | Sports & Athletics; Health & Wellness | Strategy and Critical Thinking; Environment |

All interest labels above are within the canonical 22. Every label must resolve to a seeded
`interests` row or the seed fails loudly (good).

---

## 7. Migration file plan — CONFIRMED numbers (prod ledger @ 121)

- `122_interests_catalog.sql` — `interests` table + seed 22 + RLS/grants; `club_interests` add
  `interest_id` + `tier` + `UNIQUE(club_id,interest_id)` + drop old CHECK on `interest` (table empty,
  trivial); `user_interests` add `interest_id` + **backfill 205 rows by label** + new unique index
  `(user_id, interest_id)` + drop old CHECK; `set_my_interests(p_slugs text[])` RPC.
- `123_club_interest_seed.sql` — seed `club_interests (club_id via handle JOIN, interest_id, tier)` for
  all **13** clubs per §6 (**45** triples, incl. Climbing Club). `ON CONFLICT (club_id, interest_id)
  DO UPDATE SET tier = EXCLUDED.tier`. No club rows created (all 13 exist in prod). RAISE if any
  `(handle, slug)` doesn't resolve or a club ends with no primary.
- `124_scoring_and_surveys.sql` — `rank_eligible_clubs` → add `match_score` (weighted +3/+1), keep
  `interest_overlap`; `generate_club_recommendation_batch` + `preview_club_match_count` +
  `get_my_club_recommendations` use `match_score>0` for the natural count; `handle_new_user` +
  `reconcile_signup_survey` resolve interest labels → `interest_id` via active catalog (drop hard-coded
  22-lists; keep activity lists + all avatar/oauth/terms logic).
- `125_admin_interest_tx.sql` — `admin_tx_create_interest` / `_rename_interest` / `_set_interest_active`
  / `_assign_club_interest` / `_remove_club_interest` / `_set_club_interest_tier`. Register the 7 new
  audit action strings in whatever DB-side allowlist migration 055 uses (`[Codex: inspect 055]`).
- `126_phone_discovery.sql` — **Option B (strict):** `club_categories` + `get_discovery_clubs*`
  UNTOUCHED. Add `get_phone_discovery_categories()` (**every active interest** — not assignment-gated)
  + `get_phone_discovery_clubs(__inner)` reading `club_interests` directly (both tiers qualify;
  weighted personalized sort; `p_interest_slug`; same row shape; restriction-check wrapper preserved).
- `packages/database/src/types.ts` — regenerate (Codex C6).
- `supabase/scripts/…` harness (Codex C7).
- `packages/database/src/types.ts` — regenerate (Codex C6).
- `supabase/scripts/…` harness (Codex C7): scoring math, min-2/fill, preview==batch, admin_tx,
  discovery-phone-vs-tablet, deactivation preserves user_interests.

## 8. Frozen contracts (must not change)
- JSON shape of `get_my_club_recommendations()` and `get_my_club_recommendation_outcome()`.
- Signatures of `get_my_club_recommendations`, `regenerate_my_club_recommendations`,
  `dismiss_club_recommendation_batch`, `preview_club_match_count(text[])`,
  `get_my_club_recommendation_outcome`, `get_discovery_clubs(uuid,text,int,int)`, `get_discovery_events`.
- `club_categories` table + `get_discovery_clubs(uuid,text,int,int)` + `get_discovery_clubs__inner` +
  `get_discovery_events` stay byte-identical (Option B).
- `ClubRecommendationBatch` / `RecommendedClub` / `ClubRecommendationOutcome` TS types
  (add optional fields only).

## 9. Review gates (Claude verifies every Codex deliverable)
Per task: read the full diff; run the harness; check RLS/grants; check signatures unchanged;
check no `user_activities` in club scoring; check idempotency; check "never hard delete";
check migration numbering vs C1 ledger. Codex "done" ≠ accepted.
