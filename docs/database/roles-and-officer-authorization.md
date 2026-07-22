# Roles & Officer Authorization

Two role systems must be kept **strictly separate**:

1. **Club roles** — control one club. Exist today.
2. **Platform-admin roles** — control the private Admin Dashboard. **Do not exist
   today.** Greenfield (see admin-dashboard.md for the proposal).

## Club roles (current, verified)

- Membership + role live in **`club_members`** (`user_id`, `club_id`, `role`).
  `role` is **free text**; the value `'officer'` is authorization-significant.
- The single authorization primitive is:

  ```sql
  CREATE FUNCTION is_club_officer(p_club_id UUID) RETURNS BOOLEAN AS $$
    SELECT EXISTS (SELECT 1 FROM club_members
                   WHERE club_id = p_club_id AND user_id = auth.uid()
                     AND role = 'officer');
  $$ LANGUAGE sql SECURITY DEFINER STABLE;
  ```

  Every officer-gated RLS policy and RPC calls this (or `is_club_member` /
  `is_channel_club_officer`). **`club_members.role = 'officer'` is the canonical
  officer permission.** The installed iOS/Android apps recognize an officer the
  instant this row says `'officer'`.

- Mutations go through SECURITY DEFINER RPCs with explicit permission checks:
  - `add_club_officer(club_id, user_id, role_title)` (033) — promotes.
  - `remove_club_officer(club_id, user_id)` (038) — demotes.
  - `leave_club(...)` (029/032) — race-safe, refuses to let the **only** officer
    leave (`FOR UPDATE` guard; returns `'blocked_only_officer'`).

- **`club_officers` is NOT authorization.** It is a public **display roster**
  (`display_name`, `role_title`, `avatar_url`, `display_order`, nullable
  `user_id`) rendered in the club's "Officers" section. An entry here grants
  nothing; a missing entry revokes nothing.

### Consequence for the dashboard
A "Promote to Officer" admin action MUST set `club_members.role='officer'` (the
existing RPC path is the safe way — it fires the same triggers the app relies on).
It should *optionally* also maintain the `club_officers` roster for display, in
the **same transaction**. A "Demote" reverses both. Never assume editing the
roster changes permissions, or vice-versa.

### "President"
There is **no dedicated president column/table** confirmed in the schema.
"President" is most likely a `club_members.role` value and/or a
`club_officers.role_title` string. **Verify the exact representation before
building "transfer president"** (open-uncertainties.md). Whatever it is, a
transfer must be one atomic operation that updates the canonical role for both
the old and new president and cannot leave the club with zero presidents.

## Platform-admin (does NOT exist — greenfield)

Confirmed by grep across `supabase/migrations`, `apps/web/lib`, and
`apps/web/middleware.ts`: there is **no** `is_admin`, `super_admin`,
`platform_admin`, `app_role`, `is_staff`, or equivalent. There is also no admin
route (`apps/web/app/admin` does not exist).

Therefore the dashboard's authorization is built from scratch. Requirements
(from brief §28) the design must meet:
- Not a public `profiles` boolean as the *only* gate.
- Not security-by-hidden-route.
- Server-side enforcement on every privileged action.
- Never ship the service-role key or Auth-admin credentials to the browser.

The proposed model (a dedicated `platform_admins` table + a
`current_admin_role()` SECURITY DEFINER check + server-only privileged actions)
is specified in [`../product/admin-dashboard.md`](../product/admin-dashboard.md).
