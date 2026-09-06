# Interest Matching + Admin Control — Status

Rollout is split into three stages (see `docs/audits/migration-ledger-reconciliation.md` §3):
- **A** — `chore/migration-ledger-reconcile` / **PR #104**: ledger reconciliation for versions
  115 / 116 / 120. Merges first; then `supabase migration repair --linked --status applied 116`
  under separate founder authorization.
- **B** — `backend/interest-system` PR: the production-required DB portion — migrations **122–127**,
  the DB regression harness, `packages/database/src/types.ts`, these docs. Merges to `main`, then
  its migrations are applied to production under separate authorization.
- **C** — `feat/interest-matching-and-admin` / **PR #103**: rebased to frontend/Admin/mobile only,
  merged and deployed to Vercel Production after the backend is live. Mobile release later.

NO migrations applied to any environment. NO build. NO deploy.

## Migrations (apply on prod ledger @ 121 after PR #104 + `migration repair` 116, in order)
| # | File | What |
|---|---|---|
| 122 | `interests_catalog.sql` | `interests` table + 22-row seed + RLS; `club_interests` gains `interest_id`(NOT NULL)+`tier`+unique; `user_interests` gains `interest_id` (**kept nullable** for old-client compat) backfilled by label (`ON DELETE RESTRICT`) + a `BEFORE` resolver trigger that fills `interest_id` from the legacy label (and back-fills the label from an id); drops the hard-coded CHECKs; `set_my_interests(text[])` RPC. NOT NULL on `user_interests.interest_id` deferred to a later cleanup migration once label-only mobile builds age out. |
| 123 | `club_interest_seed.sql` | approved Primary/Secondary map for **13** prod clubs (**45** rows, incl. Climbing Club; the Philosophy Club mappings target its successor **The Academy** / `handle = TheAcademy`; seeded by handle; aborts if a club/slug is missing or a club has no primary). No club rows created. |
| 124 | `scoring_and_surveys.sql` | `rank_eligible_clubs` weighted `match_score` (primary 3 / secondary 1); `generate_/preview_/get_my_club_recommendations` count natural on `match_score>0` and resolve interests via `interest_id` (rename-safe); `handle_new_user` + `reconcile_signup_survey` catalog-driven. **`user_activities` never touched; every frozen RPC signature/JSON shape preserved.** |
| 125 | `admin_interest_tx.sql` | 7 audit actions (reusing target_type system/club — no CHECK change) + 6 `admin_tx_*` RPCs (create/rename/set_active/assign/remove/set_tier) following the 056 pattern. Interests are never hard-deleted. |
| 126 | `phone_discovery.sql` | Option B: `club_categories` + `get_discovery_clubs*` + `get_discovery_events` FROZEN. New `get_phone_discovery_categories()` returns **every active interest** (not gated on club assignment) + `get_phone_discovery_clubs(__inner)()` read `club_interests` (both tiers); grants mirror the legacy discovery functions. |
| 127 | `disable_rotate_chat_invitation.sql` | Forward migration that **reapplies the approved read-only / no-rotation `rotate_chat_invitation(uuid)`** — its original slot (115) was consumed in production by `seed_math_society_club`, so PR #94's DB change never landed. Same signature, `authenticated`-only EXECUTE, trailing self-check aborts if the body is not read-only. Historical migration 115 + its prod ledger row untouched. |

**Mobile phone-Discovery FE** (`apps/mobile/services/searchService.ts`): if `get_phone_discovery_*` answers "function not found" (PGRST202 / 42883 — migration 126 not deployed yet), it falls back to the legacy `getDistinctCategories` / `getDiscoveryClubs`. Defensive only — it does **not** restore interest categories before 122+123+126 (`club_categories` is empty in prod). No hard-coded categories. iPad-native + web unchanged.

`packages/database/src/types.ts`: surgical additions only. **Recommend a full `supabase gen types` regen
against prod after 122-126 apply** (the file was already stale before this work; nothing imports it).

## Validation done
- Migrations 122-126 applied + exercised transactionally (`BEGIN … ROLLBACK`) on a clone of the local
  dev DB with all 12 prod club handles: apply clean; scoring `Accounting+Finance(primary)=3`,
  `Tech+Strategy(secondary)=1`, `Economics 3-primary=9`, `Music P+P+S=7`; `preview_club_match_count`
  ≥ 2 for a real interest and for `[]`; deactivating an interest zeroes its score and preserves
  `user_interests` rows; full `admin_tx_*` lifecycle + every failure path; phone discovery
  personalized order + both-tier filter + identity guard.
- Prod introspection (Management API, read-only) confirmed: prod ledger @ 121, all 12 clubs exist &
  active, `club_interests` + `club_categories` EMPTY in prod (root cause), `user_interests` 205 rows /
  22 canonical values, `rank_eligible_clubs` has no activity scoring.
- Web: 1097 unit tests pass. Mobile: 292 pass. TypeScript: 0 errors (web / mobile / shared / database).
- **NOT done:** BEGIN/ROLLBACK against the *actual prod* schema (the local command classifier blocks
  writes to the prod Management API — validated on the local clone instead). Run this at release.

## Not in scope / follow-ups
- Applying migrations to prod, EAS/native builds, PR, deploy — all founder-authorized, at release.
- Pre-existing `explore-clubs` `onboarding_complete` vs `onboarding_completed` typo — left untouched.
- Local↔prod migration ledger divergence (`115`, missing `116`/`120` files locally) — reconciled on
  branch `chore/migration-ledger-reconcile` / **PR #104** (`docs/audits/migration-ledger-reconciliation.md`).
  **PR #104 must merge to `main` before PR #103**, then `db push` applies `{116, 122…126}` in order.
- Philosophy Club was removed from prod post-recon; migration 123 assigns its mappings to the
  successor club **The Academy** (`handle = TheAcademy`).
