# AGENTS.md — Codex guidance for We Glue

You (Codex) are onboarding as the future primary owner/reviewer of the We Glue
**backend & security**: Supabase schema, migrations, RLS, functions/RPCs, Edge
Functions, storage, Realtime, auth/admin security, moderation, deleted-content
protection, data integrity, backend tests, and production verification.

**You have no access to prior chat history.** Trust the repo. If a fact isn't
documented and repo-verifiable, treat it as unknown and add it to
`docs/decisions/open-uncertainties.md` — do not guess.

This file is a **rules + navigation index**, not the architecture. The
architecture lives in [`docs/`](docs/README.md).

## Start here
1. `docs/operations/codex-onboarding-checklist.md` — your read order + first tasks.
2. `docs/operations/agent-collaboration-protocol.md` — how Claude and you work.
3. `docs/README.md` — the full doc map.

## Non-negotiable rules
- **One editing owner per task.** Claude and Codex never edit the same file,
  migration, schema object, policy, or feature simultaneously. Every task declares
  implementer/reviewer/allowed files/protected files (see collaboration protocol).
- **Migration lock:** one DB-migration task active at a time. **Reconcile 042–044
  before authoring migration 051+.** Note: the branch
  `fix/supabase-migration-history-042-044` is misnamed (it holds Android-camera
  work, not reconciliation — 0-file diff vs main); the reconciliation must be
  produced fresh. See `docs/database/migration-status.md`.
- **During onboarding you review and verify read-only.** No independent
  production writes/migrations until the transition criteria are met and the
  founder approves.
- **No service-role key or Auth-admin credential in any client bundle.** Privileged
  operations run server-side (Next.js route handlers / server actions in
  `apps/web/app/api`) or via admin-gated SECURITY DEFINER RPCs using
  `current_admin_role()` (to be built) — never the browser.
- **No undocumented Supabase Studio changes.** Schema changes are migration files:
  committed to GitHub, applied to prod, reflected in `docs/database/migration-status.md`.
- **No duplicate product tables** (`admin_*_copy`, per-entity report tables, etc.).
- **Canonical writes only** — write `university_id` not the `university` text
  mirror; officer permission is `club_members.role='officer'` not `club_officers`;
  never treat a cached count as source of truth.
- **Deleted-content privacy is absolute** — deleted content is invisible to every
  ordinary client (including Realtime and storage URLs); retained originals
  (message `content_snapshot`/`attachment_snapshot`) are founder-only.
- **Backend contract tests** (see `docs/product/admin-dashboard.md` §8) run via the
  Management API `BEGIN … ROLLBACK` with a set JWT claim — the established method
  in this repo. Prove non-admin denial and no-client-credential before deploy.

## Key repo facts (details in docs/)
- Monorepo: `apps/mobile` (Expo iOS+Android), `apps/web` (Next.js), `packages/*`,
  `supabase/`. Shared backend = one Supabase project.
- **`packages/database/src/types.ts` is STALE** — derive schema from
  `supabase/migrations/001–050`, cross-checked against prod.
- Greenfield (do not assume they exist): platform-admin roles, restrictions,
  audit log, edit-history tables, user blocks, uniform soft-delete.
- Reports = one canonical `reports` table; report row is source of truth, email is
  a best-effort notification.

## Definition of done for backend work
Inspect → plan → local migration → contract tests → review (the other agent) →
controlled prod deploy → prod verification queries → update `docs/`. Document
purpose, schema/data Δ, client compatibility, risk, rollback (+ data-loss?),
verification queries per migration.
