# Codex Onboarding Checklist

Goal: Codex can explain and safely own the We Glue backend **using only this repo
+ the live Supabase project** — no prior chat context.

## Read first (in order)
1. `../operations/agent-collaboration-protocol.md`
2. `../architecture/system-overview.md`
3. `../architecture/backend-architecture.md`
4. `../database/schema-map.md` (and note: `packages/database/src/types.ts` is stale)
5. `../database/canonical-sources-of-truth.md`
6. `../database/roles-and-officer-authorization.md`
7. `../database/migration-status.md` (esp. the 042–044 reconciliation note)
8. `../product/reports-and-moderation.md`
9. `../product/conversations-channels-messages.md`
10. `../product/deletion-and-edit-history.md`
11. `../product/admin-dashboard.md`
12. `../decisions/known-technical-debt.md` + `../decisions/open-uncertainties.md`

## Authoritative files (trust these over any memory)
- `supabase/migrations/001–050/*.sql` — the real schema history.
- `supabase/functions/*` — Edge Functions.
- `apps/web/lib/`, `apps/web/middleware.ts`, `apps/web/app/api/` — web backend edges.
- `apps/mobile/lib/` — mobile data access (realtime, supabase client, caches).
- This `docs/` tree — the human-readable synthesis.
- `AGENTS.md` (repo root) — the rules index for Codex.

## Verify independently (read-only) — the first real work
Produce a short written finding for each; these resolve
`../decisions/open-uncertainties.md`:
1. **Migration parity:** dump prod's applied-migration list + regenerate
   `types.ts` from prod; diff against committed files. Confirm/settle 042–044.
2. **Onboarding column:** determine whether `onboarding_complete` or
   `onboarding_completed` is canonical and how (if at all) they're synced; which
   clients read which.
3. **Legacy chat tables:** confirm whether `club_channels`, `channel_messages`,
   `club_polls*` (migration 006) are dead. Grep both apps for reads/writes.
4. **Per-entity deletion:** for posts/comments/events/clubs/conversations/
   channels, confirm hard vs soft delete and whether ordinary clients can ever
   see deleted rows or a deleted message's `attachment_url` (incl. Realtime).
5. **Value sets:** enumerate exact allowed values for `conversations.type`,
   `messages.message_type`, `club_members.role`, `follows.status`,
   `event_rsvps.status` from the migrations.
6. **RLS/RPC/trigger/storage inventory:** dump `pg_policies`, `pg_proc`,
   `pg_trigger`, `storage.policies` from prod; note anything not in a migration
   file (drift).

## First safe implementation task (after verification + founder approval)
**Admin Dashboard Phase 1, read-only, backend piece:** author the
`platform_admins` table + `current_admin_role()` function + admin-gated
**SELECT** RLS on `reports` (so the founder can read all reports in-app without
the service-role key), with contract tests proving non-admins are denied and the
service-role key is never referenced client-side. No mutations, fully additive,
trivial rollback. Claude reviews for product/client compatibility; founder
approves deploy.

## Guardrails Codex must not cross during onboarding
- No independent production writes/migrations.
- No competing/simultaneous edits to files Claude owns.
- No service-role key in any client bundle.
- No Studio-only schema changes.
- No cleanup of "unused" objects without the full safety proof in
  `../decisions/known-technical-debt.md`.
