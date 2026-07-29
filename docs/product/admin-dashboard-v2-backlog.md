# Admin Dashboard — V2 / deferred backlog

Running list of everything intentionally deferred while building the 7-day Admin
Dashboard, so Day-N work stays unblocked. Add here instead of stopping for:
minor visual defects, wording, optional filters, rare edge cases, future
improvements, non-critical refactors, or advanced-moderation features.

> Stop-the-line conditions (do NOT defer these): non-founder access, service-role
> exposure, probable production data loss, writing to a non-canonical table, an
> unsafe destructive operation, a build-breaking schema incompatibility, or a
> required native/mobile change.

## Authorization

- **Replace the temporary founder env-allowlist gate** (`lib/admin/founder.ts`,
  driven by `ADMIN_FOUNDER_EMAILS` / `ADMIN_FOUNDER_USER_IDS`) with canonical
  platform-admin authorization: a `platform_admins` table + `is_platform_admin()`
  SECURITY DEFINER function, checked server-side. The gate is deliberately marked
  as temporary in the source.
- Add role tiers (super-admin vs. read-only reviewer) once the table exists.

## Data access / performance

- **Indexed email search / email mirror.** Emails live in `auth.users`, resolved
  today via the GoTrue admin API (`getUserById` per row; bounded `listUsers` scan
  for email search). At large scale, add a canonical indexed email projection or a
  SECURITY DEFINER RPC so email search is O(log n), not a directory scan.
- **`pg_trgm` indexes** on `profiles.full_name`, `profiles.username`,
  `clubs.name`, `clubs.handle` to keep `ilike` search fast at millions of rows.
- **Server-side aggregate counts.** User/club per-row counts are batched in JS
  today (one `in(...)` query per metric per page). Consider materialized counts or
  a single RPC returning counts per entity for very large pages.
- Cursor/keyset pagination instead of `range()` offset pagination for deep pages.
- Cache the university filter list (rarely changes).

## Build / tooling

- **Local `next build` duplicate-React hazard.** The pnpm store peers the web's
  React-18 subgraph (`react-dom@18`, `next@14`, `styled-jsx`) against the
  mobile-hoisted `react@19`, which crashes SSR of Next's built-in `/404` and
  `/500` during a local build. Root cause: `.npmrc` `public-hoist-pattern[]=*`
  hoists a single React to root while web needs 18 and mobile needs 19. Permanent
  fix options (validate on a Vercel preview before merging): (a) a web-only
  `next.config.js` `resolve.alias` pinning `react`/`react-dom` to
  `apps/web/node_modules`, or (b) stop hoisting react so each app nests its own,
  or (c) `pnpm dedupe`. Vercel's clean per-project install is unaffected. A green
  local build was verified by correcting the store peer symlinks to `react@18`.
- Add ESLint config for the web app (currently unconfigured — `next lint` prompts
  interactive setup). Out of scope for Day 1; type-check + build are the gates.
- Wire `apps/web` `test` into the root turbo pipeline.

## Users

- Account/profile status column (needs restrictions table — Day 3).
- Raw provider metadata / auth linked-identities view (privacy-gated).
- Posts / Events / RSVPs / Activity-timeline tabs on user detail (Days 3–4).
- Bulk selection + bulk actions.

## Clubs

- Officer add/remove + role changes via canonical officer RPCs (Day 2).
- Edit club details, deactivate/delete (Days 2–3, 7).
- Posts / Events / Conversations / Reports / History tabs (Days 2–5).
- Club owner/creator: not tracked in schema — decide whether to introduce a
  canonical `created_by` on `clubs` (migration) or infer from earliest officer.

## Search

- Extend global search to all entity types as they ship (events, posts, reports,
  conversations, universities…).
- Keyboard navigation (arrow keys + Enter) and recent-search history.

## Day-2 deferrals (memberships / officers / gluemates / universities / restrictions)

- **Persistent audit table.** `adminAudit()` writes structured JSON to server logs
  today; add a canonical `admin_audit` table (INSERT inside `adminAudit`, no caller
  changes) — planned Day 5.
- **Gluemates at scale.** `listGluemates` loads accepted `follows` and pairs them
  in memory (fine at current scale). Add a SQL view / RPC deriving mutual follows
  with keyset pagination for millions of rows. Same for `getUserGluemates`.
- **Membership/officer club filter.** `listClubOptions` is capped at 200 for the
  filter dropdown; swap for a searchable club picker when club count grows.
- **Officer title search in global search.** Global search matches officers by
  user/club; add role-title matching there too (the Officers list already does).
- **Admin-action notifications.** The canonical officer/member RPCs notify the
  affected user; admin writes intentionally skip notifications for now (moderation
  context, avoids actor mismatch). Decide whether admin adds/removals should notify.
- **University domain mapping.** `universities` has no `domain` column; a
  `university_domains` mapping table is referenced in migration 042 but not built.
  Add it before multi-campus, then surface domain on the Universities screen.
- **Restrictions system (greenfield).** No suspensions/timeouts/blocks/shadow/
  content/club-restriction tables exist. Building any requires a canonical
  restrictions table (type, status, reason, expiration, created_by, related
  report, audit), an explicit product decision, and safe iOS/Android/web
  enforcement. The page is an honest disabled state until then.
- **Membership status.** `club_members` has no status column — membership is
  binary (row exists = active). If soft-deactivation is ever needed, add a status
  column + restore action.

## Misc / polish

- Mobile-width (<1024) drawer navigation for the sidebar (desktop-first today).
- Empty-state illustrations; per-column sort indicators in table headers.
- CSV export of list views.
- `server-only` package import guard. Day 6 added a runtime `typeof window`
  throw to `lib/supabase/admin.ts` (matching `secureAdmin.ts`/`audit.ts`);
  consider the `server-only` npm package for a build-time guarantee too.

## Day-6 notes (release-candidate pass)

- **React 18/19 type/build fix (permanent).** `apps/web/tsconfig.json` now pins
  `react`/`react-dom` type resolution to web's own `@types/react@18` via
  `compilerOptions.paths`. Root cause: `@weglue/shared` is consumed as TS source
  and its zustand dep dragged `@types/react@19` into the web type program next to
  web's 18, breaking `next build` type-check (TS2742). Type-check only — Next's
  webpack still aliases the real React runtime, so the browser bundle is
  unchanged. Full write-up: `docs/admin/day6-release-candidate.md` §2. Do NOT
  "fix" this by forcing one React version repo-wide (mobile needs 19, web needs 18).
- **vitest** is now declared in `apps/web` (was only in `apps/mobile`, resolved
  via hoisting). `pnpm test` from `apps/web` works on a clean checkout.

## Day-6 performance backlog (recommended indexes — NOT built on Day 6)

Data Health and some list/search loaders do bounded full-scans (`SCAN_CAP=5000`,
officer-title `ilike` `.limit(500)`). Before scale, add supporting indexes:
- `messages (content)` — trigram (`gin_trgm_ops`) for content search `ilike`.
- `club_members (role)` / `(club_id, role)` — officer roster + last-officer checks.
- `club_officers (role_title)` — trigram for officer-title search.
- `follows (following_id, follower_id)` — mutual-follow (Gluemate) lookups.
- `reports (status)`, `event_rsvps (event_id, user_id)` (UNIQUE already), and
  `*.deleted_at` / `clubs (is_active)` partial indexes for deleted-content scans.
Sequence these AFTER migration 051 is reconciled to avoid migration collisions.

## Codex final-review nonblocking follow-ups (preview pass)

Parked from the final read-only security review before the founder preview. All
are nonblocking for preview / read-only production / enabling writes. Do NOT fix
during the preview deployment; do NOT reopen the release candidate for these.

1. **PostgREST filter-string interpolation (founder-only).** Search/dupe-check
   helpers interpolate unsanitized input into `.or(...)` / `.ilike(...)` filter
   strings (e.g. `data.ts` search, `messagingData.ts` search, `actions.ts`
   `addUniversity` dupe-check — name is length- but not charset-validated).
   Founder-only surface, so no privilege escalation; worst case a broadened or
   errored query. Escape the values or split into `.eq` queries.
2. **Server-side administrator session maximum age.** The 15-min inactivity lock
   is client-side (UI) only; server-side, ordinary aal2 reads/writes stay callable
   until the Supabase session/JWT expires. Only sensitive reveal/search carry the
   5-min server freshness bound (`requireRecentMfa`). Consider a server-side admin
   session max-age / last-activity check on writes.
3. **Atomic last-officer protection.** `setMembershipRole` demote does a
   check-then-write count (TOCTOU) with no backing constraint. Memberships / RSVPs
   / gluemates ARE backstopped by UNIQUE constraints; last-officer is not. Add a
   guarded UPDATE (`... AND (SELECT count(*) officers) > 1`) or advisory lock.
4. **`server-only` package import guard.** (Already noted under "Misc / polish".)
   Add build-time `import "server-only"` to the admin server modules on top of the
   runtime `typeof window` throw.
5. **Aggregate RPCs for bounded large scans.** (Reinforces "Day-6 performance
   backlog" + "Data access / performance".) Replace `SCAN_CAP` full-scans and the
   reports breakdown scan with aggregate SQL/RPCs as data grows.
6. **Active-message 100-char previews.** List/detail render a 100-char preview of
   currently-visible (non-deleted) message content to the aal2 founder without a
   fresh-MFA step-up (full body + content search already require `requireRecentMfa`).
   Decide whether the preview level should also require recent MFA.
