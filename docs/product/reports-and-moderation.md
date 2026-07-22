# Reports & Moderation (current state + gaps)

## Current canonical model (migration 033)

There is **one** `reports` table (good — matches the "one canonical report
system" requirement). Shape:

```
reports(
  id uuid pk,
  reporter_id uuid  -> profiles(id) ON DELETE SET NULL,
  reporter_username text,        -- snapshot at report time
  reporter_email    text,        -- snapshot at report time
  entity_type text NOT NULL CHECK (entity_type IN
      ('club','event','post','user','message','chat')),
  entity_id   uuid,              -- the reported object
  entity_name text,              -- snapshot label
  club_id     uuid -> clubs(id) ON DELETE SET NULL,   -- context
  reason  text,
  details text,
  status  text NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending','reviewing','resolved','dismissed')),
  created_at timestamptz
)
```

RLS: reporter can **insert own** and **read own**; `service_role` has `FOR ALL`.
Indexes on `status` and `created_at DESC`.

## Report → email flow (verified)

1. Client (mobile or web via `apps/web/lib/hooks/useReport.ts`) **inserts a
   `reports` row**.
2. Client then **best-effort** invokes the `send-report-email` Edge Function,
   which reads `.from("reports")` and emails the founder via Resend.

So the **database row is the source of truth**; the email is a notification.
A failed email does not erase the report. (Matches brief §21.) Repeat-tap
dedupe is handled in `useReport.ts`.

## Reported-message moderation snapshot (protected evidence)

Migration 040:810 extends `reports` with `message_id`, `conversation_id`,
`conversation_type`, `message_type`, `message_sender_id`, **`content_snapshot`**,
and **`attachment_snapshot`** (JSONB). `report_message()` fills these
**server-side at report time**, so a later unsend cannot destroy the evidence.
These snapshot columns live on **`reports`**, not on `messages`. They are the
*only* protected retained copy of a deleted message; an unreported deleted
message has no such protection today.

## Gaps vs. the Admin Dashboard requirements

| Requirement (brief §19–21) | Present? | Gap |
|---|---|---|
| One canonical report table | ✅ | — |
| Target types: club/event/post/user/message/chat | ✅ | **`comment` and `channel` are NOT valid targets** — add via CHECK extension if those become reportable. |
| "General platform / support" target for non-object reports | ⚠️ partial | `'chat'` exists but there's no explicit `platform`/`support` category — add one so no report is orphaned. |
| Severity | ❌ | no `severity` column. |
| Assigned admin | ❌ | no `assigned_to`. |
| Private notes | ❌ | no notes column/table. |
| Action taken / resolution / resolver / resolved_at | ❌ | only `status`; no resolution audit. |
| Related reports | ❌ | none. |
| Report audit history | ❌ | none (needs the general audit log). |
| Founder can read ALL reports in-app | ⚠️ | only via `service_role` today — must be replaced by a platform-admin-gated path (never ship service-role to browser). |
| Every report links back to the entity in the dashboard | ❌ (no dashboard yet) | build. |
| Email links to the exact report | ❌ | add deep link once `/admin/reports/:id` exists. |

## Proposed evolution (non-breaking, backend + web only)

Add columns/tables **additively** (old clients ignore them):
- `reports.severity` (text CHECK, nullable), `assigned_to uuid`,
  `resolution text`, `resolved_by uuid`, `resolved_at timestamptz`,
  `related_report_id uuid` (self-FK, nullable).
- Extend `entity_type` CHECK to include `comment`, `channel`, and a
  `platform` (support/safety) catch-all — **only after** confirming clients
  don't rely on the current exact set.
- `report_notes(report_id, admin_id, note, created_at)` for private notes.
- A platform-admin RLS policy on `reports` (`SELECT`/`UPDATE`) driven by
  `current_admin_role()` so the founder reads/works reports in-app **without**
  the service-role key.
- `admin_resolve_report(report_id, status, resolution, reason)` SECURITY DEFINER
  RPC that verifies admin role, updates status, and writes an audit row.

Status workflow to standardize on (superset of current):
`pending → reviewing → resolved | dismissed` (keep the existing four values;
the UI can label `pending` as "Open").

## Centralized + per-entity views

- One central **Reports** queue (`/admin/reports`) over the single table.
- A **Reports column** on each reportable entity list, and a **Reports tab** on
  each detail page — all just filtered views of `reports WHERE entity_type/id`.
  No per-entity report tables.
