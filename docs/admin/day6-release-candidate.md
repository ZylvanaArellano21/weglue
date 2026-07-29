# We Glue Admin Dashboard — Day-6 Release Candidate

**Branch:** `web/admin-dashboard-v1`
**Tip commit:** `73ca9aa7` (harden: fail-closed server-only guard on service-role client)
**Base:** `main` @ `af954e80`
**Commit range:** `af954e80..73ca9aa7` — 29 commits (Days 1–6). Admin work starts at `a3af4ecf`.
**Status:** Release candidate. **UNMERGED, production NOT deployed.** No migration added on this branch. `backend/deleted-message-privacy` untouched.

Day 6 was an integration / reproducibility / QA / release-candidate pass — **no new feature system was added**. The absence of a canonical restrictions/sanctions system and a persisted admin-audit table remains **honestly displayed in the UI and documented** (see §7, §8).

---

## 1. Day-6 changes (only two focused code commits)

| Commit | Type | Files | What |
|---|---|---|---|
| `127457a8` | fix | `apps/web/tsconfig.json`, `apps/web/package.json`, `pnpm-lock.yaml` | Reproducible React type/build fix + declared `vitest` in web |
| `73ca9aa7` | harden | `apps/web/lib/supabase/admin.ts` | Fail-closed `typeof window` guard on the service-role client |

Everything else in Day 6 was verification (audits, scans, QA) that confirmed the Day 1–5 code was already correct — no integration defects required code changes.

---

## 2. React 18/19 type/build duplication — root cause & permanent fix

### Root cause (exact)
The monorepo **intentionally runs two React majors**: `apps/web` = React 18 (Next 14.2.35), `apps/mobile` = React 19 (Expo / React-Native 0.81.5). This is correct and must be preserved — React 18 types are incompatible with RN 0.81 JSX and vice-versa.

`@weglue/shared` is consumed by web as **TypeScript source** (`apps/web/tsconfig.json` maps `@weglue/shared` → `../../packages/shared/src/index.ts`). Shared's zustand stores `import { create } from "zustand"`, and zustand's type definitions reference React. pnpm keys zustand by its `@types/react` peer, so `packages/shared/node_modules/zustand` resolves to `zustand@4.5.7_@types+react@19.2.17_react@19.1.0`, dragging **`@types/react@19` into the web type program** alongside web's own `@types/react@18`.

With two `@types/react` in one program, TypeScript can no longer portably name the inferred JSX return type of page components. `next build` type-check failed on **every** admin page:

```
Type error: The inferred type of 'AdminSectionPage' cannot be named without a reference to
'.pnpm/@types+react@19.1.17/node_modules/@types/react'. This is likely not portable.
```

`tsc --noEmit` appeared clean earlier only because the error surfaces on the `.next/types/**` generated page validators that `next build` adds to the program.

### Permanent fix
`apps/web/tsconfig.json` `compilerOptions.paths` now pins React type resolution for the **entire web program** to web's own single copy:

```jsonc
"react":       ["./node_modules/@types/react"],
"react/*":     ["./node_modules/@types/react/*"],
"react-dom":   ["./node_modules/@types/react-dom"],
"react-dom/*": ["./node_modules/@types/react-dom/*"]
```

This collapses the program to one React-18 typings copy, including when zustand's `.d.ts` and shared's source are pulled in.

**Why this is correct and safe:**
- **Type-check only.** Next's webpack sets its own `react`/`react-dom` alias to the real runtime package, which wins over tsconfig paths at bundle time. Verified: `next build` produces `framework-*.js` = 140 KB of real React runtime; the browser bundle is unchanged and contains a single React 18.
- **Reproducible from committed config** — no manual pnpm-store or symlink edits, survives clean install.
- **Zero blast radius on mobile/shared** — only `apps/web/tsconfig.json` changed; mobile has its own tsconfig and resolves React 19 exactly as before.
- Mapping to the real `react` package instead (the "conventional" alternative) fails: pnpm's `react@18.3.1` ships no types, so `paths` short-circuits `@types` adjacency → 153 × TS7016. Mapping to `@types/react` is the documented pattern for the pnpm duplicate-`@types/react` case.

Tested during Day 6: Option A (map → `@types/react`) = **0 errors**; Option B (map → real `react`) = **153 errors** → reverted to A.

### Clean-install validation
| Check | Command | Result |
|---|---|---|
| Lockfile reproducibility (CI/Vercel-equivalent) | `pnpm install --frozen-lockfile` | **exit 0**, "Already up to date" |
| Web type-check | `apps/web` → `npx tsc --noEmit` | **0 errors** |
| Web production build | `apps/web` → `npx next build` | **exit 0**, all admin routes compiled, real React runtime in bundle |
| Mobile TypeScript | `apps/mobile` → `npx tsc --noEmit` | **0 errors** (unaffected) |
| Shared TypeScript | `packages/shared` → `npx tsc --noEmit` | **0 errors** |
| Database TypeScript | `packages/database` → `npx tsc --noEmit` | **0 errors** |

> A full fresh `node_modules` reinstall was intentionally **not** run: the React fix is a pure committed-config change (no store dependency), and a clean reinstall risks perturbing the mobile pnpm-store layout that EAS build fingerprints depend on. `--frozen-lockfile` is the exact reproducibility gate Vercel/CI runs and it passes.

---

## 3. Reproducible tests

Root cause: the admin vitest suite lives in `apps/web` and `apps/web` had `"test": "vitest run"`, but `vitest` was only declared in `apps/mobile`'s `package.json`. It resolved at all only via `.npmrc public-hoist-pattern[]=*` hoisting — a phantom dependency that would vanish on a clean checkout, and `pnpm test` from `apps/web` failed with `vitest: command not found`.

Fix: declared `vitest ^4.1.10` in `apps/web/package.json` devDependencies (mobile keeps its own). Lockfile diff is +3 lines (web importer only).

| Check | Command | Result |
|---|---|---|
| Documented web test command | `apps/web` → `pnpm test` | **161 passed (161)**, 15 files |

---

## 4. Route acceptance matrix

All 21 nav sections are `ready:true`. Every route below is a Server Component that calls the secure gate before any data, is stamped `no-store` + `X-Robots-Tag: noindex` by middleware, and renders loading / empty / error / honest-disabled states. Detail routes exist for users, clubs, universities, posts, comments, events, conversations, channels, messages, notifications, reports.

| Section | Route | Detail route | Loader authz | Portal-off | aal1 | non-founder | State |
|---|---|---|---|---|---|---|---|
| Overview | `/admin` | — | `requireSecureAdmin` | unavailable | →mfa | denied | ✅ live |
| Users | `/admin/users` | `/users/[id]` | ✅ | ✅ | ✅ | ✅ | ✅ live |
| Officers | `/admin/officers` | — | ✅ | ✅ | ✅ | ✅ | ✅ live |
| Restrictions | `/admin/restrictions` | — | ✅ | ✅ | ✅ | ✅ | ⚠️ honest-unavailable (no canonical system) |
| Gluemates | `/admin/gluemates` | — | ✅ | ✅ | ✅ | ✅ | ✅ live |
| Clubs | `/admin/clubs` | `/clubs/[id]` | ✅ | ✅ | ✅ | ✅ | ✅ live |
| Memberships | `/admin/memberships` | `/memberships/[id]` | ✅ | ✅ | ✅ | ✅ | ✅ live |
| Universities | `/admin/universities` | `/universities/[id]` | ✅ | ✅ | ✅ | ✅ | ✅ live |
| Posts | `/admin/posts` | `/posts/[id]` | ✅ | ✅ | ✅ | ✅ | ✅ live |
| Comments | `/admin/comments` | `/comments/[id]` | ✅ | ✅ | ✅ | ✅ | ✅ live |
| Events | `/admin/events` | `/events/[id]` | ✅ | ✅ | ✅ | ✅ | ✅ live |
| RSVPs | `/admin/rsvps` | — | ✅ | ✅ | ✅ | ✅ | ✅ live |
| Conversations | `/admin/conversations` | `/conversations/[id]` | ✅ | ✅ | ✅ | ✅ | ✅ live |
| Channels | `/admin/channels` | `/channels/[id]` | ✅ | ✅ | ✅ | ✅ | ✅ live |
| Messages | `/admin/messages` | `/messages/[id]` | ✅ | ✅ | ✅ | ✅ | ✅ live (metadata; body behind step-up MFA) |
| Notifications | `/admin/notifications` | `/notifications/[id]` | ✅ | ✅ | ✅ | ✅ | ✅ live |
| Reports | `/admin/reports` | `/reports/[id]` | ✅ | ✅ | ✅ | ✅ | ✅ live (evidence never returned) |
| Deleted Content | `/admin/deleted-content` | — | ✅ | ✅ | ✅ | ✅ | ✅ live (club reactivate only) |
| Edit History | `/admin/edit-history` | — | ✅ | ✅ | ✅ | ✅ | ✅ live (honest: editor/old-values not recorded) |
| Audit History | `/admin/audit-history` | — | ✅ | ✅ | ✅ | ✅ | ⚠️ honest-unavailable (no persisted table) |
| Data Health | `/admin/data-health` | — | ✅ | ✅ | ✅ | ✅ | ✅ live (18 read-only checks) |
| Admin Settings | `/admin/settings` | — | ✅ | ✅ | ✅ | ✅ | ✅ live (masked env presence only) |
| MFA gate | `/admin/mfa` | — | `getSecureAdminContext` | ✅ | challenge | denied | ✅ live |
| Global search | `/admin/api/search` | — | `requireSecureAdmin` | 403 | 403 | 403 | ✅ live |
| Message reveal | `/admin/api/message-reveal` | — | `requireRecentMfa` | 403 | 403 | 403 | ✅ live |
| Message search | `/admin/api/message-search` | — | `requireRecentMfa` | 403 | 403 | 403 | ✅ live |
| Coming-Soon catch-all | `/admin/[section]` | — | inherits layout gate | ✅ | ✅ | ✅ | `notFound()` for ready sections |

---

## 5. Server-action / API security matrix

**Contract (every write action):** `requireSecureAdmin({ write: true })` → strict input validation → mutation on ONE fixed canonical table → read-back → structured audit (success + failure) → `{ ok }` result (never throws to client). Client identity is never trusted (actor = server-validated founder). Service-role client is constructed only **after** authorization. `ADMIN_WRITES_ENABLED` unset/false ⇒ every write throws before touching data.

| Action | Module | Entity → canonical table/RPC-equivalent | R/W | Gate | MFA | Confirm | State |
|---|---|---|---|---|---|---|---|
| `addMembership` | actions | `club_members` insert | W | secure+write | aal2 | ConfirmAction | ✅ |
| `removeMembership` | actions | `club_members` delete (officers blocked) | W | secure+write | aal2 | ConfirmAction | ✅ |
| `setMembershipRole` | actions | `club_members.role` + `club_officers` roster | W | secure+write | aal2 | ConfirmAction | ✅ |
| `addOfficer` | actions | `club_members` + `club_officers` (mirrors add_club_officer) | W | secure+write | aal2 | ConfirmAction | ✅ |
| `editOfficerTitle` | actions | `club_officers.role_title` | W | secure+write | aal2 | inline | ✅ |
| `removeGluemate` | actions | `follows` delete (both directions) | W | secure+write | aal2 | ConfirmAction | ✅ |
| `addUniversity` | actions | `universities` insert | W | secure+write | aal2 | ConfirmAction | ✅ |
| `editUniversity` | actions | `universities` update | W | secure+write | aal2 | inline | ✅ |
| `setUniversityActive` | actions | `universities.is_active` | W | secure+write | aal2 | ConfirmAction | ✅ |
| `lockAdminPortal` | actions | `auth.signOut` (own session) | W | secure (**no write gate — must always work**) | aal2 | — | ✅ |
| `editPostCaption` | contentActions | `posts.caption` | W | secure+write | aal2 | inline | ✅ |
| `removePostFromClub` | contentActions | `posts.club_id`+`post_club_tags`+`club_photos` (mirrors remove_post_from_club) | W | secure+write | aal2 | ConfirmAction | ✅ |
| `editCommentContent` | contentActions | `post_comments.content` | W | secure+write | aal2 | inline | ✅ |
| `editEvent` | contentActions | `events` (fixed fields, chronology-validated) | W | secure+write | aal2 | inline | ✅ |
| `upsertRsvp` | contentActions | `event_rsvps` (UNIQUE event_id,user_id) | W | secure+write | aal2 | inline | ✅ |
| `removeRsvp` | contentActions | `event_rsvps` delete | W | secure+write | aal2 | ConfirmAction | ✅ |
| `createChannel` | messagingActions | `conversation_channels` insert (mirrors 041 RPC) | W | secure+write | aal2 | inline | ✅ |
| `renameChannel` | messagingActions | `conversation_channels.name` (never Main) | W | secure+write | aal2 | inline | ✅ |
| `setChannelPermission` | messagingActions | `conversation_channels.post_permission`/`is_restricted` | W | secure+write | aal2 | inline | ✅ |
| `deleteEmptyChannel` | messagingActions | `conversation_channels` delete (empty-only, no cascade) | W | secure+write | aal2 | ConfirmAction | ✅ |
| `setNotificationRead` | messagingActions | `notifications.read`/`read_at` | W | secure+write | aal2 | inline | ✅ |
| `setReportStatus` | reportsActions | `reports.status` (transition-validated) | W | secure+write | aal2 | ConfirmAction | ✅ |
| `reactivateClub` | deletedContentActions | `clubs.is_active` = true | W | secure+write | aal2 | ConfirmAction | ✅ |
| `revealMessageBody` | messagingActions | `messages` read (1 row, deleted denied) | **R** | secure | **recent-MFA (step-up)** | — | ✅ |
| `searchMessageContent` | messagingActions | `messages` read (cap 25, deleted excluded) | **R** | secure | **recent-MFA (step-up)** | — | ✅ |
| `searchEntities` | data | canonical reads across entities | R | secure | aal2 | — | ✅ |
| `testSupabaseConnection` | settingsActions | `universities` head probe (no data) | R | secure | aal2 | — | ✅ |

No generic mutation API exists. Every write targets a fixed, named table with constrained fields. Cross-entity relationships are validated (same-campus membership, last-officer protection, event chronology, report transition legality, channel-type eligibility).

---

## 6. Destructive-action matrix (disabled — honestly surfaced)

| Capability | Why disabled | UI |
|---|---|---|
| Message delete / redact / restore | retained-evidence privacy backend (migration 051) not deployed | `DisabledAction` with reason |
| Deleted-message purge / restore | privacy-locked; never resurrected or hard-deleted | disabled |
| Retained report evidence (`content_snapshot`/`attachment_snapshot`) | never selected/returned; only a boolean availability flag | not shown |
| Attachment / media hard delete | no approved canonical media-delete lifecycle | disabled |
| Notification remove / resend | `push_queue.notification_id` CASCADEs; removal corrupts delivery | disabled |
| Permanent purge (any entity) | no canonical purge lifecycle; no direct hard-delete shortcut | disabled |
| Restriction / sanction / shadowban | no canonical restrictions table exists | honest `/admin/restrictions` explainer |
| Moderation notes on reports | `reports` has no notes/reviewer/updated_at column (needs migration) | disabled |
| Non-empty channel delete | would cascade a message delete | refused server-side + disabled |
| Env mutation from browser | operator procedure in Vercel only | not built |

---

## 7. Canonical data integration (verified, no shadow tables)

- **Officer authority** = `club_members.role = 'officer'` (via `is_club_officer`). `club_officers` is used **only** for the display roster and title search — never as an authority source. Promote/demote writes `club_members.role` and keeps the `club_officers` roster in sync, exactly as `add_club_officer`/`remove_club_officer` do.
- **Gluemates** = mutual `follows` (both directed rows); removal deletes both directions.
- **RSVP uniqueness** = `event_rsvps` UNIQUE(event_id,user_id); upsert updates in place (no duplicate rows, no manual count writes — Realtime + live reads keep counts correct).
- **Reports** use the canonical `reports` schema (033+038+040); status transitions validated against a fixed transition table with an optimistic `.eq("status", current)` guard.
- **Deleted content** classified from canonical soft-delete columns (`clubs.is_active`, `conversations.deleted_at`, `messages.deleted_at`). Users hard-delete (044) so none are listed. Reactivating a club is the only canonical restore.
- No admin-copy / shadow tables were introduced. No action manually updates a cached count that a trigger or canonical logic already owns.

---

## 8. Privacy limitations (by design)

- Message **content** is never logged, never placed in a URL/query string (reveal + content-search use POST bodies with `force-no-store`), never cached, never written to `localStorage`/`sessionStorage`, and is gated behind **fresh step-up MFA**. Deleted messages never reveal original content.
- Report evidence snapshots are never selected or returned.
- The audit trail today is a structured `admin_audit` JSON line in the server log (greppable in Vercel). There is **no persisted, queryable audit table yet** — surfaced honestly on `/admin/audit-history`. Audit records contain ids/metadata/byte-lengths only — never secrets or message content.
- `/admin/settings` returns env **presence booleans** ("set (hidden)") only — never any secret value.

---

## 9. Static security scans (commands + results)

Run from `apps/web`:

| # | Scan | Command (summary) | Result |
|---|---|---|---|
| 1 | Service-role in a client component | grep `"use client"` files for `supabase/admin`/`SERVICE_ROLE` | **none** |
| 2 | `SERVICE_ROLE` usage sites | `grep -rn SERVICE_ROLE lib app components` | only `admin.ts` (client) + `settingsData.ts` (`!!` presence bool) |
| 3 | Evidence snapshot selected | `grep -rn content_snapshot/attachment_snapshot` | only a `.not(...is null)` availability filter — never `.select`ed |
| 4 | Message content in logs | `grep -rn console.` in admin | none (only `audit.ts` structured JSON, no content) |
| 5 | `localStorage`/`sessionStorage` for admin data | grep admin tree | none (one comment stating it is NOT used) |
| 6 | Raw push/device token display | grep `push_token`/`fcm`/`apns` | none (only a test asserting absence) |
| 7 | `/admin` noindex | grep robots/X-Robots | layout+mfa `robots:{index:false}`; middleware `X-Robots-Tag: noindex`; `robots.ts` disallows `/admin`, no sitemap |
| 8 | Sensitive Route Handlers non-cacheable | inspect `message-reveal`/`message-search` routes | `force-dynamic` + `force-no-store` + explicit `no-store` headers; POST body (no query) |

**Result: clean.** One defense-in-depth improvement was applied (Day 6): a `typeof window` guard on `lib/supabase/admin.ts` matching `secureAdmin.ts`/`audit.ts`.

---

## 10. Browser QA evidence (local dev, safe fail-closed states)

Run against `next dev` on `localhost:3210` pointing at the existing Supabase project, **writes disabled** (`ADMIN_WRITES_ENABLED` absent), no production mutation performed.

| Gate state | How exercised | Evidence | Result |
|---|---|---|---|
| Portal OFF (`ADMIN_PORTAL_ENABLED` absent) | curl `/admin`, `/admin/api/*` | 200 "unavailable" + `X-Robots-Tag: noindex` + `no-store`; APIs **403** `portal_disabled` | ✅ |
| Portal ON, **no session** | curl with no cookies | `/admin` → **307 `/login?next=%2Fadmin`** (deep link preserved); APIs **401** `unauthenticated` | ✅ |
| Portal ON, **authenticated non-founder** | browser with a real signed-in `…@my.lonestar.edu` session | `/admin` → **"Admin access restricted … limited to the founder"** at 1440/1280/1024; `/admin/api/search` → **403 "Not authorized for admin access."** (zero data) | ✅ |

Screenshots captured at 1440 / 1280 / 1024 (saved locally, contain the tester's own account email — not committed to git):
`screenshot-…-18.jpg` (1440), `…-19.jpg` (1280), `…-20.jpg` (1024).

**A fully-authorized founder pass is intentionally NOT fabricated.** It requires the founder's real aal2 TOTP session (or a local Supabase instance seeded with a test founder + enrolled TOTP). See §11 for the exact remaining founder-only QA steps. The fail-closed gate itself — the security-critical property — is fully demonstrated above, and the authorization core is additionally covered by the unit suite (`secureAdmin.test`, `adminEnv` predicates: portal-off, unauth, denied, aal1, writes-disabled).

---

## 11. Remaining founder-only QA (authenticated pass)

These require the founder's own aal2 session and cannot be safely simulated without the founder's TOTP. **Do not** enable `ADMIN_WRITES_ENABLED` against production for read QA.

1. In Vercel Preview (see §12), set `ADMIN_PORTAL_ENABLED=true`, keep `ADMIN_WRITES_ENABLED=false`. Sign in as founder, complete TOTP → land on `/admin` Overview.
2. Read pass at 1440 / 1280 / 1024 across every §4 section: verify list loads, pagination, empty/error states, breadcrumbs, detail links, honest-disabled affordances.
3. Step-up reveal: on a Message detail, trigger "Reveal body" → TOTP re-challenge → single body shown; confirm a deleted message is denied; confirm content never appears in the URL.
4. Mutation pass (only on Preview/staging with a disposable test club/event, `ADMIN_WRITES_ENABLED=true`): exercise each §5 write; verify target changed, unrelated rows unchanged, read-back, audit line present, and that flipping the switch back to `false` denies every write.
5. Confirm non-founder + aal1 denials in the authenticated environment (already demonstrated locally in §10).

---

## 12. Vercel preview / release configuration

`/admin` lives under the existing We Glue web deployment; **no new domain**. Production route stays `/admin`.

### Environment variables (names only — never commit values)
| Variable | Scope | Preview value | Production value |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | public | project URL | project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public | anon key | anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | **server-only** | service-role key | service-role key |
| `ADMIN_PORTAL_ENABLED` | server-only | `true` | `true` (only when going live) |
| `ADMIN_WRITES_ENABLED` | server-only | **`false`** initially | `true` only after founder sign-off |
| `ADMIN_FOUNDER_USER_IDS` | server-only | founder auth UUID(s) | founder auth UUID(s) |
| `ADMIN_FOUNDER_EMAILS` | server-only (optional AND check) | founder email(s) | founder email(s) |
| `NEXT_PUBLIC_SITE_URL` | public | preview URL | production URL |

### Preview checklist
- [ ] Preview is a **protected** deployment (Vercel deployment protection / SSO on the preview URL).
- [ ] `ADMIN_WRITES_ENABLED=false` on the preview.
- [ ] Preview requires **founder authentication + MFA** (no shared reviewer/tester account).
- [ ] `SUPABASE_SERVICE_ROLE_KEY` set as a server-only (non-`NEXT_PUBLIC_`) env var.
- [ ] `/admin` returns `X-Robots-Tag: noindex` and `robots.txt` disallows `/admin` (verify on the preview URL).
- [ ] Ordinary We Glue users on the preview receive no admin data (spot-check with a non-founder session).

### Production checklist
- [ ] Branch reviewed (Day-7 Codex pass) and approved by founder.
- [ ] Merge `web/admin-dashboard-v1` → `main`.
- [ ] Production env vars set exactly as above; `ADMIN_WRITES_ENABLED` starts **`false`**.
- [ ] First production visit: founder login + MFA → Overview loads; non-founder denied.
- [ ] Only after a clean read pass, set `ADMIN_WRITES_ENABLED=true`.

### Emergency-disable procedure
1. Set `ADMIN_PORTAL_ENABLED=false` in Vercel → redeploy/promote. Every `/admin` route renders "unavailable" and every API returns 403 — instantly, no code change.
2. To keep the portal readable but freeze all mutations: set `ADMIN_WRITES_ENABLED=false`.
3. To end the current founder session: the in-portal "Lock Admin Portal" control (or 15-min inactivity auto-lock) signs out + forces a fresh MFA challenge.

### Rollback procedure
- Config rollback (fastest): flip `ADMIN_PORTAL_ENABLED=false` (above) — no deploy needed beyond the env change.
- Code rollback: since the branch is unmerged, production is unaffected until merge. Post-merge, revert the merge commit or redeploy the previous production deployment from the Vercel dashboard. **No migration** ships on this branch, so there is no schema rollback.

---

## 13. Performance & query review

- All list loaders paginate via a shared `PAGE_SIZE = 25` with `.range(from,to)` + exact count. Detail loaders use `.maybeSingle()`/`.single()`. No unbounded list fetch.
- Deleted Content: `MERGE_CAP = 200` per section, search `.limit(500)`.
- Data Health: `SCAN_CAP = 5000` rows per check, `CHUNK = 300` for parent-existence lookups, `EXAMPLE_CAP = 5`, `AUTH_SAMPLE = 300`. Minimal id-only selects; never message content.
- Message reveal loads a single row; content-search caps at 25 and selects only needed columns.
- No N+1 in list rendering — related entities are batched via `.in(ids)` maps (emails, universities, senders).

No Day-6 performance migration was created (out of scope). Recommended indexes are recorded in the V2 backlog (§ "Day-6 performance backlog").

---

## 14. Known non-blocking issues

- No persisted `admin_audit` table (audit is server-log JSON). Deferred until migration 051 sequencing is reconciled off-branch.
- No canonical restrictions/sanctions system. Honestly surfaced on `/admin/restrictions`.
- Edit History cannot show prior values or the editing actor (schema records neither). Honestly stated.
- Deleted-message reveal/restore/purge remain disabled pending the `backend/deleted-message-privacy` (migration 051) deployment.
- Data Health checks read up to 5000 rows/check on demand — acceptable for a founder-triggered diagnostic; indexes recommended in backlog for scale.

---

## 15. Codex review package (Day 7)

**Scope for review:** actual security, authorization, canonical writes, privacy, and deployment readiness — **not** documentation history or architecture re-litigation.

- **Branch / range:** `web/admin-dashboard-v1`, `af954e80..73ca9aa7` (29 commits). Focus the review on the write-action modules and the secure gate.
- **Authorization core:** `lib/admin/secureAdmin.ts` (`requireSecureAdmin`, `requireRecentMfa`, `getSecureAdminContext`) + `lib/admin/adminEnv.ts` (pure predicates, fail-closed allowlist).
- **MFA / kill switches:** aal2 enforced server-side; step-up freshness for message content; `ADMIN_PORTAL_ENABLED` / `ADMIN_WRITES_ENABLED`.
- **Canonical writes:** action modules `actions.ts`, `contentActions.ts`, `messagingActions.ts`, `reportsActions.ts`, `deletedContentActions.ts`, `settingsActions.ts` — verify each against §5/§6/§7.
- **Privacy:** confirm no snapshot/evidence selection, no message content in logs/URLs/cache, step-up on reveal/search, deleted content never resurrected.
- **Matrices:** §4 routes, §5 actions, §6 destructive-disabled, §7 canonical, §8 privacy.
- **Verification results:** §2 (build/type-check clean-install), §3 (161 tests), §9 (static scans), §10 (browser QA).
- **Deployment:** §12 preview/production/rollback/emergency-disable.
- **Known non-blocking:** §14.

---

## 16. Day-7 recommendation

Proceed to Day 7 **Codex security review** of `web/admin-dashboard-v1` @ `73ca9aa7`, scoped as in §15. No true blockers were found in Day 6. After Codex sign-off, create the protected Vercel preview (§12), run the founder authenticated pass (§11), then merge + deploy with `ADMIN_WRITES_ENABLED=false` first.
