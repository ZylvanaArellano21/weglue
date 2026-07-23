# We Glue — Engineering Documentation

Authoritative, repository-verifiable documentation for We Glue. Written so a new
engineer or agent (Claude, Codex) can understand the system **without access to
any prior chat history**. Everything here is derived from the code, migrations,
and git history and cites its source. Where a fact could not be verified from the
repo, it is listed in [`decisions/open-uncertainties.md`](decisions/open-uncertainties.md),
not asserted.

> **First-read order for Codex** is at the bottom of this file.

## Map

### architecture/
- [`system-overview.md`](architecture/system-overview.md) — monorepo layout, the four platforms (iOS, Android, web, Supabase), deploy topology, four-way-sync rule.
- [`backend-architecture.md`](architecture/backend-architecture.md) — Supabase surface: functions/RPCs, triggers, RLS model, Realtime, storage, Edge Functions.

### database/
- [`schema-map.md`](database/schema-map.md) — **the true current table inventory**, derived from migrations (the generated `packages/database/src/types.ts` is STALE — see note there).
- [`canonical-sources-of-truth.md`](database/canonical-sources-of-truth.md) — one-source-of-truth map + the duplicated/denormalized-data inventory.
- [`migration-status.md`](database/migration-status.md) — migrations 001–050, the 042–044 reconciliation note, and how to verify prod vs. files.
- [`roles-and-officer-authorization.md`](database/roles-and-officer-authorization.md) — how club roles/officers actually authorize, and why there is currently **no platform-admin concept**.

### product/
- [`reports-and-moderation.md`](product/reports-and-moderation.md) — the single `reports` table, the report→email flow, gaps.
- [`conversations-channels-messages.md`](product/conversations-channels-messages.md) — the conversation → channel → message hierarchy and message payload types.
- [`deletion-and-edit-history.md`](product/deletion-and-edit-history.md) — current soft-delete / snapshot / hide behavior and what edit-history exists.
- [`deleted-message-privacy.md`](product/deleted-message-privacy.md) — **authoritative v8 design** for secure deleted-message privacy (preflight-vs-active-saga failure taxonomy, authorization + Category-C create no attempt, Storage-4xx split, `data_health_diagnostics`, lease-based reconciliation, exact legacy idempotency-key rule, push provenance DDL, report evidence, OTA evidence). Design only, not implemented.
- [`admin-dashboard.md`](product/admin-dashboard.md) — **the proposed Admin Dashboard**: IA, routes, actions, admin-auth design, canonical reports/restrictions/audit design, phased plan, rollback.

### operations/
- [`agent-collaboration-protocol.md`](operations/agent-collaboration-protocol.md) — Claude/Codex roles, task ownership, migration lock, approval gates, transition criteria.
- [`codex-onboarding-checklist.md`](operations/codex-onboarding-checklist.md) — what Codex must read, verify independently, and its first safe task.

### decisions/
- [`known-technical-debt.md`](decisions/known-technical-debt.md) — verified debt (stale types, legacy chat tables, dual onboarding columns, denormalized fields).
- [`open-uncertainties.md`](decisions/open-uncertainties.md) — facts NOT yet verified from the repo; each has a concrete verification step.

## Status of this document set

This is the **discovery + architecture + Codex-onboarding** deliverable (see the
project brief, section 42). **No dashboard code has been built, no migration has
been written, no production change or EAS build has been made.** These are
documents only.

## Codex first-read order

1. [`operations/agent-collaboration-protocol.md`](operations/agent-collaboration-protocol.md) — the rules of engagement.
2. [`architecture/system-overview.md`](architecture/system-overview.md) — the shape of the system.
3. [`database/schema-map.md`](database/schema-map.md) — the real schema (ignore `types.ts`).
4. [`database/canonical-sources-of-truth.md`](database/canonical-sources-of-truth.md) — where each fact truly lives.
5. [`database/roles-and-officer-authorization.md`](database/roles-and-officer-authorization.md) — the auth model.
6. [`product/deletion-and-edit-history.md`](product/deletion-and-edit-history.md) — the deleted-content-privacy rule and current mechanism.
7. [`product/admin-dashboard.md`](product/admin-dashboard.md) — the proposal it will help build/review.
8. [`decisions/open-uncertainties.md`](decisions/open-uncertainties.md) — what to verify independently first.
