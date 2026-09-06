# C1 — Backend Reconnaissance (PRODUCTION)

Done by Claude via the Supabase Management API (`POST /v1/projects/yoozrnosmqtaiksgcixc/database/query`,
read-only SELECTs against pg_catalog + app tables). The Codex sandbox has **no external network and no
local Docker/psql**, so it could not reach prod; Claude ran the introspection directly.

Prod project: `yoozrnosmqtaiksgcixc` "We Glue" (us-west-2). Staging: `cwwmuxxqxovhcnnardlj`.
Date: 2026-09-05.

---

## Q1 — Production migration ledger

`supabase_migrations.schema_migrations` (114 rows), applied versions:
```
001–050, 052–098, 100, 102, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 117, 118, 119, 120, 121
```
- **Latest applied: 121** (`sync_store_app_release_role_guard_fix`).
- **Missing from prod: 051, 099, 101, 103, 104, 105, 116.**
- Prod names that DIFFER from local `main`:
  - `115` in prod = **`seed_math_society_club`** (this is PR #93's migration — already applied to prod).
    Local `main` `115` = `disable_rotate_chat_invitation`. **Same number, different migration.**
  - `120` in prod = **`seed_philosophy_club`** (applied). Local: only an **untracked** file
    `supabase/migrations/120_seed_philosophy_club.sql`, never committed.
- `disable_rotate_chat_invitation` (local `115`) is **not in the prod ledger under any number** — status
  unknown; NOT this task's problem, but reported.

### ➤ Next safe migration number for THIS task: **122** (prod is at 121).
This task adds `122`–`126`. The pre-existing local↔prod ledger divergence (different `115`, missing
`116`/`120` files locally) is reconciled on the **separate** branch `chore/migration-ledger-reconcile`
/ **PR #104** (`docs/audits/migration-ledger-reconciliation.md`), which must merge to `main` before
PR #103. After that, `db push` applies `{116, 122…126}` in order. **Do not `supabase db push` until
PR #104 is merged.**

---

## Q2 — Club inventory (PRODUCTION)

**All 12 target clubs exist and `is_active = true`.** No seeding of club rows is needed.

| Club (name) | handle | is_seed | member_count |
|---|---|---|---|
| Accounting Club | `AccountingClub` | false | 6 |
| ASAP - Allied Scholars for Animal Protection | `ASAPAlliedScholarsforAnimalProtection` | false | 5 |
| Asian American Association | `AsianAmericanAssociation` | false | 4 |
| Economics Club | `EconomicsClub` | false | 3 |
| Engineering Society | `EngineeringSociety` | **true** | 3 |
| Human Services Student Organization | `HumanServicesStudentOrganization` | false | 2 |
| Math Society | `MathSociety` | false | 6 |
| Mavericks in Recovery | `MavericksinRecovery` | false | 2 |
| Music Club | `MusicClub` | false | 2 |
| ~~Philosophy Club~~ → **The Academy** | ~~`PhilosophyClub`~~ → `TheAcademy` | false | 7 |
| Student Government Association | `StudentGovernmentAssociation` | **true** | 6 |
| Technology Club | `TechnologyClub` | false | 6 |

> **Update (2026-09-05):** Philosophy Club was removed from production after this recon and
> recreated by its officers as **"The Academy"** (`handle = TheAcademy`, member_count 7, same
> philosophy focus, student-claimed). Migration 123 assigns the approved Philosophy mappings to
> `TheAcademy`. The `120_seed_philosophy_club` ledger row remains (see PR #104 /
> `docs/audits/migration-ledger-reconciliation.md`).

- **No other clubs in prod.** The 6 original demo clubs (Number/Business/Clay/Nature/Dog/Stock Market)
  are GONE.
- Note the real name: **"ASAP - Allied Scholars for Animal Protection"** (not "Allied Scholars…").
- Seed `club_interests` by JOIN on `clubs.handle` (exact handles above).

---

## Q3 — Live function definitions (PRODUCTION)

- `rank_eligible_clubs(uuid,uuid,text[],int)` — **verbatim identical to migration 087.**
  `RETURNS TABLE(club_id uuid, interest_overlap int)`, `interest_overlap = COUNT(*) FROM club_interests
  WHERE ci.interest = ANY(p_interests)`. `ORDER BY interest_overlap DESC, c.member_count DESC, c.name ASC`.
  **No `user_activities` anywhere.** ✅ Q1 (interests-only) already holds at the engine level.
- `handle_new_user()` — LATER than 087 (adds avatar/oauth-pending/agreed_to_terms logic). Still contains
  the **hard-coded 22-value `WHERE i IN (...)` interest whitelist** and 10-value activity whitelist for
  the `user_interests`/`user_activities` inserts, and calls `generate_club_recommendation_batch(NEW.id,'onboarding')`
  when `NOT v_oauth_pending`. Must be `CREATE OR REPLACE`d preserving ALL avatar/oauth/terms logic,
  changing only the `user_interests` insert to resolve labels → `interest_id` against the active catalog.
- `get_discovery_clubs(uuid,text,int,int)` — thin wrapper: restriction check
  (`current_student_can_access_app()`) → `get_discovery_clubs__inner(...)`.
- `get_discovery_clubs__inner(uuid,text,int,int)` — reads `club_categories` for the `categories[]` output,
  the `p_category` filter, and the personalized sort (`club_categories ⋈ user_interests` count
  **+ `event_activities ⋈ user_activities` count**). `assert_self_or_null(p_user_id)` guard.
- `generate_club_recommendation_batch`, `get_my_club_recommendations`, `preview_club_match_count`,
  `get_my_club_recommendation_outcome`, `reconcile_signup_survey` — match migrations 087 / 065 / 109
  (all applied to prod). Not re-pasted here; the migration files are authoritative.

---

## Q4 — Live schema (PRODUCTION)

### `club_interests`
- Columns: `id uuid pk`, `club_id uuid NOT NULL`, `interest text NOT NULL`.
- `club_interests_club_id_fkey` → `clubs(id) ON DELETE CASCADE`.
- `club_interests_interest_check` — CHECK `interest = ANY(ARRAY[<the 22 canonical values>])` (exact list,
  verified).
- Index `idx_club_interests_club_id` on `(club_id)`. **No unique constraint/index on `(club_id, interest)`.**
- RLS: "anyone authenticated can read" (USING true), "officers can manage" (`is_club_officer(club_id)`).
  Migration 003 adds "anon can read". Grants (075): `SELECT` to anon; `SELECT,INSERT,UPDATE,DELETE` to authenticated.

### `user_interests`
- Columns: `id uuid pk`, `user_id uuid NOT NULL`, `interest text NOT NULL`.
- FK → `profiles(id) ON DELETE CASCADE`. CHECK `interest = ANY(ARRAY[<22>])`.
- Unique **index** `uniq_user_interests_user_interest` on `(user_id, interest)` (migration 043 — 043 is
  in the prod ledger, so present).

### `user_activities` — analogous, 10-value CHECK, unique index `(user_id, activity)`. **Out of scope.**

### `club_categories`
- Table exists. **0 rows.**

### `club_recommendation_batches`
- Per migration 042: `club_ids uuid[]`, `match_count int`, `source ∈ {onboarding, interest_update}`,
  `status ∈ {active, dismissed, completed, superseded}`, partial-unique active-per-user. 44 rows.

---

## Q5 — Row counts (PRODUCTION)

| Table | Rows | Notes |
|---|---|---|
| `user_interests` | **205** (43 distinct users) | all **22** canonical values in use; every value matches the frontend list exactly |
| `user_activities` | 162 | out of scope |
| `club_categories` | **0** | empty — discovery category filter is effectively dead today |
| `club_interests` | **0** | **empty — the club-match engine has NO interest data, so every batch today is pure "popular fallback"** |
| `club_recommendation_batches` | 44 | existing user batches (all currently popularity-only) |

**This is the root cause of "matching is broken": `club_interests` is empty in production.** Seeding it
(12 clubs × Primary/Secondary per the approved table) is the core fix. No `interest_id` backfill needed
for `club_interests` (clean slate). `user_interests` has 205 real rows → needs a careful label→`interest_id`
backfill (all 22 labels resolve).

---

## Q6 — Cron jobs

Not directly queried via `cron.job` in this pass (Management API query for `pg_indexes`/`cron` was
intermittently blocked by the local command classifier). Migration `109` ships
`reconcile_recent_signup_surveys` and its header says the cron schedule is applied MANUALLY post-migration
(`SELECT cron.schedule('reconcile-signup-surveys', '*/10 * * * *', ...)`). **Codex C1-followup: confirm
whether that cron job is live in prod** (`select jobname, schedule, command from cron.job`) — needed so
the catalog-driven rewrite of `reconcile_signup_survey` doesn't break a running sweep.

---

## Q7 — CHECK list vs. frontend 22

**Exact match.** The live `user_interests_interest_check` / `club_interests_interest_check` arrays and
the 22 distinct values actually stored in `user_interests` are identical (values + spelling) to the
frontend list:
```
Finance & Business, Social Events, Music, Fashion, Art & Culture, Social Justice & Activism,
Numbers & Economics, Gaming, Health & Wellness, Environment, Sports & Athletics, Community Service,
Crafts, Religion, Technology and Computer, Film & Media, Photography, Strategy and Critical Thinking,
Writing, Theater, Travel & Languages, Debate & Politics
```
(Frontend files order them differently but the SET is identical. Catalog seed uses this canonical set;
`slug` = lower-kebab, e.g. `finance-and-business`, `strategy-and-critical-thinking`.)

---

## BLOCKERS / RISKS FOR CLAUDE

1. **Ledger divergence (pre-existing, founder-owned).** Local `main` and prod disagree on `115`, and
   local is missing `116`/`120` files. This task's migrations (`122`+) are safe to *write and apply on
   prod*, but a `supabase db push` from any branch is unsafe until the founder reconciles local files
   with the prod ledger. **Do not run `db push`.** Apply `122`+ individually / via Management API at
   release time, founder-authorized.
2. **`club_interests` empty ⇒ matching currently returns popularity-only for everyone.** Seeding is the
   fix; expect every existing user's next batch regen to change.
3. **`club_categories` empty ⇒ iPad/web Discovery category filter is already non-functional.** Making it
   a view over `club_interests` is a strict improvement (no regression), but it *is* a behavior change
   for iPad/web. **Founder sign-off needed** (Option A vs B in DESIGN.md §5).
4. **`handle_new_user` is feature-rich** (avatar/oauth/terms) — the catalog rewrite must preserve every
   branch; only the `user_interests` insert changes.
5. **No unique constraint on `club_interests(club_id, interest)`** today — the new
   `UNIQUE(club_id, interest_id)` is safe to add (table empty).
6. **Confirm the `reconcile-signup-surveys` cron** before rewriting `reconcile_signup_survey`.
7. **`user_interests` 205 rows across 43 users** must survive the `interest_id` migration intact
   (`ON DELETE RESTRICT`, backfill by label, never delete).
