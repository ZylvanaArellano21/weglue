# Agent Collaboration Protocol (Claude ↔ Codex)

## Roles (current)

- **Founder** — final product decision-maker. Approves plans, migrations, and
  production deployments.
- **Claude Code** — primary programmer. Holds the historical context; owns
  frontend/product implementation; prepares backend architecture + history for
  Codex; deploys mobile/web.
- **Codex** — backend/security reviewer and learner, onboarding to become the
  primary owner of Supabase, DB architecture, migrations, RLS, functions/RPCs,
  Edge Functions, storage, Realtime, auth/admin security, moderation,
  deleted-content protection, data integrity, backend tests, and prod
  verification. **During onboarding Codex reviews and verifies read-only; it does
  not independently alter production.**

Codex has **no access to Claude's prior conversations.** Everything it needs is
in this repo. If a fact isn't documented and repo-verifiable, it goes in
`../decisions/open-uncertainties.md`, not into an assumption.

## Task ownership rules

- **One editing owner per task.** The other agent reviews the diff. Never two
  agents editing the same file, migration, schema object, policy, or feature.
- **Migration lock:** only one DB-migration task active at a time. No competing
  migrations. Reconcile 042–044 history before authoring 051+.
- **No uncontrolled production changes.** No undocumented Supabase Studio edits.
  Schema changes exist as migration files, committed to GitHub, applied to prod,
  and reflected in `../database/migration-status.md`.
- **No service-role key in client code**, ever.

## Every task must declare

```
Task: <name>
Primary implementer: Claude | Codex
Reviewer:            Codex | Claude
Allowed files:       <paths this task may edit>
Protected files:     <paths it must not touch>
Supabase changes:    yes/no   Production changes: yes/no
Required tests:      <contract tests / Playwright / manual>
Required docs update: <which docs/ files>
```

## Workflow — current (Codex onboarding)

**Frontend/product task:** Claude implements → Codex reviews data/security
implications → tests pass → founder approves.

**Backend task:** Claude prepares architecture + historical context → Codex does
independent **read-only** verification → Claude resolves product/history
misunderstandings → one agreed plan → **one** agent edits → the other reviews the
diff → tests pass → founder approves → controlled deploy → prod verification →
both update docs.

## Migration procedure (mandatory)

Inspect → Plan → local migration → tests → review → controlled deploy → prod
verification → docs update. Each migration documents purpose, schema Δ, data Δ,
current-client compatibility, risk, rollback (+ whether rollback loses data),
verification queries, prod checks.

## Definition of done (per CLAUDE.md §7–9)

Triple-check (works / looks right / every change verified) → deploy to **both**
iOS and Android when mobile is affected (`eas update` for JS, EAS Build for
native) → report exact commands + output. **The Admin Dashboard is backend+web;
if changes stay additive/compatible it needs no EAS build** — but that must be
proven, not assumed.

## Codex transition criteria (to primary backend owner)

Only after Codex demonstrably can (verified by work, not confidence): explain the
architecture; identify canonical sources; understand mobile/web deps; reconcile
migration history; produce safe, backward-compatible migrations with rollback
plans; review RLS; protect privileged credentials; maintain deleted-content
privacy, reports integrity, and the conversation/channel/message hierarchy;
update docs; pass backend contract tests; complete prod verification; avoid
duplicate structures; and handle several reviewed backend tasks without
regressions.

**Future target workflow:** backend/DB/security → Codex designs & implements →
Claude checks product/client compatibility → tests pass → founder approves →
Codex deploys under controlled procedure → Claude verifies web/mobile → both
document. Frontend/product stays Claude-led with Codex review.
