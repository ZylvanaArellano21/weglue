# Deletion, Retention & Edit History

## The non-negotiable rule (brief §17)

When an ordinary user deletes something, **no ordinary user (sender, recipient,
officer, member, any normal client) may ever see the original again** — not via
iOS/Android/web queries, Realtime, search, feeds, or storage URLs. Only the
founder/super-admin may inspect retained originals, through the private Admin
Dashboard.

## Current deletion mechanisms (verified — and inconsistent)

| Entity | Mechanism today | Retention of original |
|---|---|---|
| **Messages** | Soft delete: `deleted_at`, `deleted_by` only (`unsend_message` 040:177). `hidden_at` is NOT on messages — it's per-user on `conversation_participants` (inbox) / `message_hides` (per-message). | ⚠️ **Incidental, not protected.** `unsend_message` does **not** null `content`/`attachment_url`, so the original stays in the row. The **only protected** snapshot is `reports.content_snapshot`/`attachment_snapshot` for **reported** messages (040:810, via `report_message()`). |
| **Club photos** | `is_visible` flag (037) | image row retained |
| **Posts / comments / events / clubs / conversations / channels** | **Not confirmed** — likely hard delete (with FK cascades wired in 023/033/038/039) | **none** (hard delete = no retention) |
| **Accounts** | Hard delete via `delete_own_account_atomic()` cascading through `auth.users` (044) | none |

> 📐 **The full remediation design lives in
> [`deleted-message-privacy.md`](deleted-message-privacy.md) (authoritative v6).**
> The note below states the current (broken) reality.

> ⚠️ **Deleted-message privacy is NOT yet enforced.** The `messages` SELECT RLS
> is `USING(is_conversation_participant(conversation_id))` (001:808) with **no
> `deleted_at` filter**, and `unsend_message` doesn't null `content`. Verified in
> prod: **4 soft-deleted messages, all 4 still holding original `content`.** Any
> participant can retrieve deleted content/attachment via direct PostgREST,
> Realtime (`messages` is in `supabase_realtime`, 010:39), and a re-minted signed
> URL. Only client code hides it. This is a confirmed gap, not a retain-but-hide
> success. See the deleted-message design comparison (founder-directed) before any
> fix.

## Two distinct destructive actions (must stay distinct in the UI)

- **HIDE / SOFT DELETE** — invisible to ordinary users, retained for founder
  review, restorable. (Messages already do this. Extend to other entities
  additively where the brief requires a Deleted Content view.)
- **PERMANENT PURGE** — irreversible, unrecoverable even by the founder, requires
  impact preview + strong confirmation + audit.

## Enforcement obligations for the dashboard work

1. **Verify** that ordinary-client RLS/queries filter `deleted_at IS NOT NULL`
   (and `hidden` states) for messages **everywhere** — including Realtime
   payloads (049/050) and any storage URL for a deleted attachment. A deleted
   message must not leak its `attachment_url`. This is an audit, not an
   assumption.
2. **Report snapshots are on `reports`, and are founder-only.**
   `reports.content_snapshot`/`attachment_snapshot` must never be selectable by
   ordinary clients (confirm no RLS/`select` path exposes them). The dashboard
   reads them through a platform-admin-gated path. (Note: these exist only for
   messages that were *reported*; an unreported deleted message has no protected
   snapshot — its original currently survives only, and unsafely, in the
   un-nulled `messages.content`.)
3. Where the brief wants a Deleted Content view for entities that currently hard
   delete, adding soft-delete is an **additive, compatible** change (new nullable
   `deleted_at`/`deleted_by` columns + client queries already ignore unknown
   columns) — but flipping those entities from hard to soft delete changes client
   read behavior and may need coordinated app query updates. Treat as a planned
   migration with compatibility analysis, not a quick change.

## Edit history (current state)

Almost none exists as first-class data:
- `profiles.username_changed_at`, `profiles.email_changed_at` — timestamps only,
  no old/new values.
- `reports.content_snapshot` — a frozen copy of a **reported** message, captured
  at report time (not at edit/delete time, and only for reported messages; not an
  edit trail).

Everything else (post edits, club edits, event edits, role changes, restriction
changes, report-status changes) has **no history**. The dashboard's Edit History
is therefore mostly greenfield.

## Proposed edit-history + audit design (shared table)

A single append-only history/audit spine, additive and client-invisible:

```
admin_audit_log(
  id, actor_id, actor_role, action, entity_type, entity_id,
  previous_values jsonb, new_values jsonb, reason,
  correlation_id, source, created_at
)
```

- Ordinary users cannot read or write it (RLS: platform-admin only).
- It is **not** a second source of truth — the canonical record stays
  authoritative; the log is an immutable record of *changes*.
- Sensitive admin actions (email/username/university change, role change,
  membership change, deletion, purge, restriction, report resolution,
  private-conversation access) **must** write a row with `previous_values` /
  `new_values` and a `reason`.
- "Edit History" tabs in the dashboard are read-only views over this log,
  filtered by `entity_type`/`entity_id`. User-initiated edits captured by
  triggers (e.g. `*_changed_at`) can feed the same log over time.
