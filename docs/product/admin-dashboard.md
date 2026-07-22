# Admin Dashboard — Proposed Design

Status: **proposal only.** Nothing here is built. It is the plan the founder
reviews and Codex reviews for backend/security before any implementation.

Guiding constraints (from the brief):
- Web-only UI at `weglue.app/admin`, editing the shared production backend.
- **Change once → update everywhere** (canonical writes only — see
  [`../database/canonical-sources-of-truth.md`](../database/canonical-sources-of-truth.md)).
- **No duplicate product tables.** No `admin_*_copy` stores.
- Must not break current iOS/Android/web clients; **no EAS build required** if
  all changes are additive/compatible.
- Deleted-content privacy and audited private access are hard requirements.

## 1. Authorization design (greenfield — nothing exists today)

Layered, server-enforced, no service-role key in the browser:

```
platform_admins(
  user_id uuid pk -> auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('support','moderator','admin','super_admin')),
  granted_by uuid, granted_at timestamptz, is_active boolean DEFAULT true
)
```

- `current_admin_role()` — SECURITY DEFINER, returns the caller's active admin
  role or NULL. Used by RLS policies and by server actions. Founder =
  `super_admin`.
- **RLS**: privileged read/write policies on `reports`, and on the new
  admin/audit/restriction tables, are gated on `current_admin_role()` — so the
  dashboard uses the founder's normal authenticated session, not the
  service-role key.
- **Server actions / route handlers** (Next.js, following the existing
  `apps/web/app/api/delete-account` pattern) perform the few operations that
  genuinely need elevated privilege (Auth admin email change, account deletion).
  Service-role / Auth-admin credentials live **only** in Vercel server env.
- `/admin` is added to `apps/web/middleware.ts` and redirects non-admins away —
  but the route is a defense-in-depth layer, **not** the security boundary; RLS +
  server checks are.

Every privileged action: authenticate → verify active admin role → verify
action permission → validate input → run transactionally → reject invalid state
transitions → **write audit row** → return a clear result.

## 2. Information architecture

Route root `/admin`. Sections (each entity gets its own list screen, not one
giant table):

```
/admin                      Overview (counts, open reports, data-health flags)
/admin/search               Global search (results labeled by type)
People:      /admin/users, /admin/restrictions, /admin/gluemates
Communities: /admin/clubs, /admin/memberships, /admin/universities
Content:     /admin/posts, /admin/events, /admin/rsvps, /admin/comments, /admin/media
Communication: /admin/conversations, /admin/channels, /admin/messages, /admin/notifications
Safety:      /admin/reports, /admin/deleted
System:      /admin/audit, /admin/edit-history, /admin/data-health, /admin/settings
```

Consistent list pattern for every entity: search → filters → sortable columns →
human-readable labels → status → **Reports column** (for reportable entities) →
clickable row → detail drawer/page → inline actions → **preview before dangerous
ops** → save → clear result → **audit row** → cross-platform data updated.

## 3. Global search

One search resolving human-readable input to typed results (no UUIDs surfaced):
- Users: email, username, full name.
- Clubs: name, university. Events: title. Posts: text/author.
- Conversations: name/participants. Channels: name. Messages: content (audited).
- Reports: by id. Universities.

Backed by an `admin_search(q)` SECURITY DEFINER RPC (admin-gated) that unions the
relevant tables and returns `{result_type, id, label, sub}`. Reuses the existing
`search_discovery` shape as a starting point but is admin-scoped and broader.

## 4. Key sections & actions (canonical-write rules baked in)

- **Users** — columns: avatar, name, @username, email, university, status, #clubs,
  active restrictions, open reports, created. Detail tabs: Overview / Profile /
  University / Interests / Activities / Gluemates / Clubs&Roles / Posts /
  Comments / Events / RSVPs / Conversations / Messages(audited) / Reports /
  Restrictions / Deleted / Edit History / Audit. Actions write **canonical**
  columns only (e.g. university → `university_id`, trigger mirrors text).
- **Email change** — via server-side Auth admin API (`admin_change_user_email`
  server action): verify new email unused, no ordinary verification flow,
  preserve identity (no second account), handle session invalidation, write
  audit (old→new). **Never** in browser code.
- **Restrictions** — new system (see §5).
- **Clubs / Memberships** — role changes go through the officer RPC path so
  `club_members.role` (canonical permission) updates and the app sees it
  immediately; keep `club_officers` roster in sync in the same transaction. Use
  the **exact existing `'officer'` role** — do not invent a new supervisor role.
- **Events / RSVPs** — RSVP totals **derived** from `event_rsvps`, never a cached
  count treated as truth; provide `admin_rebuild_derived_counts`.
- **Conversations / Channels / Messages** — preserve hierarchy; message content
  view is audited; shared events/posts shown as references.
- **Reports** — central queue + per-entity Reports column/tab over the single
  `reports` table (see reports doc).
- **Deleted Content** — founder-only review of retained originals (messages have
  snapshots today; other entities pending soft-delete — deletion doc).
- **Universities** — manage `universities` + `app_config`; change a user/club's
  campus via `university_id`; merge is a previewed, audited op.
- **Notifications** — diagnostics over `notifications` + push pipeline
  (`push_tokens`, `push_queue`, `push_tickets`); disable stale tokens; controlled
  test sends that can't reach real users.

## 5. Restrictions / suspension design (greenfield)

Distinct, typed restrictions (not one vague flag):

```
user_restrictions(
  id, user_id -> profiles(id), type text CHECK (type IN
    ('account_suspended','posting_restricted','commenting_restricted',
     'messaging_restricted','club_creation_restricted','event_creation_restricted',
     'discovery_restricted','timeout')),
  reason text, applied_by uuid, created_at timestamptz,
  expires_at timestamptz,           -- NULL = indefinite
  removed_at timestamptz, removed_by uuid,
  is_active boolean GENERATED / maintained
)
```

- Enforcement helper `has_active_restriction(user_id, type)` used by RLS/RPCs
  (e.g. posting policies check `NOT has_active_restriction(auth.uid(),
  'posting_restricted')`).
- **Compatibility caution:** adding enforcement to existing write paths changes
  behavior for restricted users. The *table + admin UI* are additive/safe; wiring
  enforcement into RLS is a reviewed, tested change (could need coordinated app
  messaging, but no schema break). Ship the record/UI first, enforcement second.
- Account lifecycle distinctions: **Suspend/Deactivate** (reversible, data kept)
  vs **Soft-delete/Admin-hide** (reversible where valid) vs **Permanent delete**
  (irreversible workflow; reuse the `delete_own_account_atomic` cascade pattern
  as a service-role `admin_delete_account(uid)` with impact preview + audit).

## 6. Safe admin backend operations (RPCs / server actions)

All SECURITY DEFINER, admin-gated, transactional, audited. Naming per brief §32:
`admin_change_user_email`, `admin_update_profile`, `admin_change_user_university`,
`admin_set_club_role`, `admin_transfer_club_presidency`, `admin_remove_club_member`,
`admin_update_club`, `admin_update_post`, `admin_update_event`, `admin_cancel_event`,
`admin_change_rsvp`, `admin_archive_content`, `admin_restore_content`,
`admin_purge_content`, `admin_suspend_user`, `admin_apply_restriction`,
`admin_remove_restriction`, `admin_resolve_report`, `admin_remove_message`,
`admin_reset_test_account`, `admin_delete_account`, `admin_rebuild_derived_counts`.
**No generic "edit any table" browser access.**

## 7. Previews, undo, bulk

- Impact preview required before: remove member, demote officer, transfer
  president, suspend, change university, delete club/conversation/event, remove
  content, reset test account, permanent delete/purge, any bulk action.
- Reversible where safe: role/profile/restriction changes, archive/restore,
  hide/restore, event cancel, report-status. Never imply purge is reversible.
- Bulk actions: selected count → impact preview → validation → confirm → audit →
  all-or-nothing (no partial failure) → outcome report.

## 8. Test strategy

Backend contract tests (brief §37) — run via Management API `BEGIN … ROLLBACK`
with a set JWT claim (the established RPC-testing method in this repo). Verify:
one profile ↔ one auth user; user in many clubs; one membership per user·club;
`is_club_officer` reflects `club_members.role`; username/university change
propagate via canonical + trigger; email change preserves identity; **deleted
content invisible to ordinary users** and snapshots founder-only; reports link to
valid targets; conversation→channel→message integrity; poll option/vote
consistency; RSVP totals match `event_rsvps`; restrictions expire; ordinary users
cannot read/alter audit; `admin` access denied to non-admins; service credentials
never sent to clients. Plus Playwright smoke tests for the web UI.

## 9. Phased implementation plan

- **Phase 0 — Verify (no writes):** resolve open-uncertainties.md (esp.
  042–044 history, onboarding column, legacy chat tables, per-entity deletion,
  message_type/conversation.type value sets). Regenerate `types.ts`.
- **Phase 1 — Admin identity + read-only console:** `platform_admins` +
  `current_admin_role()` + `/admin` gating; Overview + read-only Users/Clubs/
  Reports lists + global search. **No mutations.** Lowest risk; proves auth.
- **Phase 2 — Safe canonical writes:** `admin_update_profile`,
  `admin_change_user_university`, `admin_set_club_role` (reuse officer RPCs),
  club edits — each additive, audited, previewed.
- **Phase 3 — Reports & moderation:** admin-gated reports read/resolve
  (`admin_resolve_report`), reports columns/tabs, report notes.
- **Phase 4 — Restrictions & lifecycle:** `user_restrictions` + UI (record first,
  enforcement second), suspend/deactivate, `admin_delete_account`.
- **Phase 5 — Deleted content & edit history:** `admin_audit_log`, snapshot
  review, extend soft-delete to more entities (planned, compatibility-reviewed).
- **Phase 6 — Notifications, data-health, bulk, saved filters.**

Only one migration task active at a time across all phases.

## 10. Rollback & deployment

- Every migration additive-first (new tables/nullable columns) → old clients
  unaffected → trivial rollback (drop the new object; no data loss for
  additive-only). Document rollback + whether it loses data per migration.
- Deploy sequence: local migration → contract tests → review → controlled prod
  deploy → prod verification queries → docs update. Web deploys via Vercel; no
  mobile build needed for compatible backend changes.
- Enforcement changes (restrictions in RLS, hard→soft delete flips) get their own
  migration with explicit client-compatibility analysis and a staged rollout.

## 11. Risk assessment (current systems)

| Risk | Impact | Mitigation |
|---|---|---|
| Shipping service-role/Auth-admin key to browser | Full DB compromise | Server-only; RLS via `current_admin_role()`; audited server actions |
| Editing a mirror instead of canonical (e.g. `university` text) | Data desync across platforms | Write `university_id` only; rely on `sync_university_name()` |
| Editing `club_officers` roster thinking it changes permissions | Broken authz | Route role changes through `club_members.role` RPCs |
| Exposing deleted content / snapshots via new admin queries or Realtime | Privacy breach | Founder-only RLS; audit private access; verify Realtime payloads |
| Building on the 042–044 history divergence | Broken migrations | Reconcile before 051+ |
| Flipping entities hard→soft delete carelessly | Old clients show/hide wrong content | Additive columns + coordinated, tested query changes; treat as planned migration |
| Non-atomic multi-record writes | Partial desync | All multi-row ops inside one SECURITY DEFINER function |
| Enforcing restrictions without app messaging | User confusion / support load | Record+UI first, enforcement second, with product review |
