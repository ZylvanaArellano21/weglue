#!/usr/bin/env python3
"""Explicit execution manifest for every We Glue database/security harness.

WHY THIS FILE EXISTS
--------------------
An earlier sweep ran all 22 harnesses through one generic runner: a single
`supabase db reset` stack, always as `postgres`, verdict = psql exit status.
That produced 8 false failures and — worse — false PASSes, because:

  * Seven harnesses are written for a DISPOSABLE fixture database (their own
    header documents a `docker run postgres:15` recipe, a `pgowner` owner role
    that is NOSUPERUSER BYPASSRLS like production's `postgres`, a hand-built
    fixture schema, and an ORDERED SUBSET of migrations). Running them against
    a fully-migrated stack collides with rows the migrations already seed
    (042 seeds 'Lone Star College') and with objects owned by `supabase_admin`.

  * FOUR harnesses never raise on a failed assertion. test_038_039, test_046,
    test_052 and test_060 record results in a table and print them. They exit 0
    whether or not an assertion failed, so "rc=0" is NOT a pass for them. Each
    needs its own explicit summary rule.

So the environment, the roles, the PostgreSQL version and the success criterion
are per-harness facts, and they are declared here rather than assumed.

ROLE DISCIPLINE
---------------
`setup_role` is used only to build schema and fixtures. It is never used to
make a security assertion pass: the harnesses themselves switch to
`authenticated` / `anon` / `service_role` (via SET ROLE and the
request.jwt.claims GUC) before asserting. `pgowner` deliberately mirrors
production's `postgres`: NOSUPERUSER, BYPASSRLS. A superuser would silently
bypass FORCE ROW LEVEL SECURITY and pass for the wrong reason.

NEVER points at Production. Every environment here is a throwaway container
created and destroyed by the runner.
"""

# --- environments ----------------------------------------------------------
# stack17  : this session's OWN disposable Supabase stack (project weglues1a),
#            full 001->068 ledger, PostgreSQL 17.6 = the Production major.
#            NOT the shared `supabase_db_weglue` stack, which belongs to
#            another session and is off limits.
# pg15/pg17: throwaway plain-Postgres containers built by the runner, one fresh
#            database per harness, owned by `pgowner`.

# Container names are overridable so this file never hard-codes one machine's
# layout. The full-ledger environment must be a stack YOU own: point
# WEGLUE_HARNESS_STACK at it. To run a second Supabase stack beside an existing
# one, give it a distinct `project_id` and distinct ports in supabase/config.toml
# — that edit is LOCAL ONLY and must never be committed, because it would
# repoint every other developer's local stack.
import os as _os

STACK_CONTAINER = _os.environ.get("WEGLUE_HARNESS_STACK", "supabase_db_weglue")
PG15_CONTAINER = _os.environ.get("WEGLUE_HARNESS_PG15", "weglue-harness-pg15")
PG17_CONTAINER = _os.environ.get("WEGLUE_HARNESS_PG17", "weglue-harness-pg17")

# Ordered build chains. "fx:" = fixture file in supabase/scripts,
# "mg:" = migration file in supabase/migrations.
FIXTURE_057 = "fx:test_057_fixture_schema.sql"
FIXTURE_056 = "fx:test_056_fixture_schema.sql"
FIXTURE_081_082 = "fx:test_081_082_fixture_schema.sql"
FIXTURE_083 = "fx:test_083_fixture_schema.sql"
FIXTURE_084 = "fx:test_084_fixture_schema.sql"
FIXTURE_085 = "fx:test_085_fixture_schema.sql"
FIXTURE_086 = "fx:test_086_fixture_schema.sql"
FIXTURE_087 = "fx:test_087_fixture_schema.sql"

CHAINS = {
    "wg_faithful": ["mg:055_durable_admin_audit.sql",
                    "mg:055_durable_admin_audit.sql"],  # applied twice: idempotency
    "wg2": [FIXTURE_056,
            "mg:054_atomic_last_officer_protection.sql",
            "mg:055_durable_admin_audit.sql",
            "mg:056_atomic_admin_mutations.sql"],
    "wg057fx": [FIXTURE_057],
    "wg": [FIXTURE_057, "mg:057_student_blocking.sql"],
    "wg058": [FIXTURE_057, "mg:057_student_blocking.sql",
              "mg:055_durable_admin_audit.sql", "mg:056_atomic_admin_mutations.sql",
              "mg:058_admin_restrictions.sql"],
    "wg060": [FIXTURE_057, "mg:057_student_blocking.sql",
              "mg:055_durable_admin_audit.sql", "mg:056_atomic_admin_mutations.sql",
              "mg:058_admin_restrictions.sql",
              "mg:060_restriction_enforcement_hotfix.sql"],
    "wg061": [FIXTURE_057, "mg:057_student_blocking.sql",
              "mg:055_durable_admin_audit.sql", "mg:056_atomic_admin_mutations.sql",
              "mg:058_admin_restrictions.sql",
              "mg:060_restriction_enforcement_hotfix.sql",
              "mg:061_restriction_reasons_account_deletion.sql"],
    "wg062": [FIXTURE_057, "mg:062_private_account_posts.sql"],
    # The concurrency harness documents "after ... test_057_student_blocking.sql
    # to database wg" — it reuses the students that harness creates.
    "wg_conc": [FIXTURE_057, "mg:057_student_blocking.sql",
                "fx:test_057_student_blocking.sql"],
    "wg081082": [FIXTURE_081_082,
                 "mg:081_first_login_push_permission.sql",
                 "mg:082_conversation_read_realtime_sync.sql"],
    "wg083": [FIXTURE_083, "mg:083_notification_coverage_audit_fixes.sql"],
    "wg084": [FIXTURE_084,
              "mg:083_notification_coverage_audit_fixes.sql",
              "mg:084_notification_exactly_one_fixes.sql"],
    "wg085": [FIXTURE_085, "mg:085_student_joined_named_copy.sql"],
    "wg086": [FIXTURE_086, "mg:086_members_only_chat_invitations.sql",
              "mg:115_disable_rotate_chat_invitation.sql"],
    "wg087": [FIXTURE_087, "mg:087_club_recommendation_launch_campus_null_fix.sql"],
}

# --- success criteria ------------------------------------------------------
# "raise"      : harness aborts the run on failure -> psql exit status decides.
# "okcol"      : prints `name|ok` rows; any ok='f' is a failure.
# "resultcol"  : prints `test|PASS/FAIL|detail` rows; any FAIL is a failure.
# "verdict"    : prints one explicit verdict line that must match exactly.
# Every harness ALSO fails on a literal '*** FAIL ***' marker if it emits one,
# and on a nonzero exit status. There is no broad grep for the word FAIL:
# assertion prose such as "a FAILURE record is stored" must not trip the runner.

MANIFEST = [
    # ---- full-schema family: documented as "run after the migration suite /
    #      after a disposable local reset", i.e. the whole 001->068 ledger.
    dict(file="test_038_039_regression.sql", type="sql", env="stack17_clone",
         chain=None, pg="17.6", setup_role="postgres", assert_role="postgres (owner-level regression suite)",
         criterion="resultcol", needs_seed="clubs_038",
         note="Header: rolled-back transaction over the real schema. Needs two "
              "clubs and two members to exist; the runner seeds them synthetically."),
    dict(file="test_046_notifications.sql", type="sql", env="stack17",
         chain=None, pg="17.6", setup_role="postgres", assert_role="postgres + request.jwt.claims",
         criterion="resultcol",
         note="Header: rolled-back transaction, production-shaped schema."),
    dict(file="test_052_account_deletion.sql", type="sql", env="stack17",
         chain=None, pg="17.6", setup_role="postgres", assert_role="authenticated / service_role",
         criterion="resultcol",
         note="Header: rolled-back transaction, production-shaped schema."),
    dict(file="test_053_platform_admin.sql", type="sql", env="stack17",
         chain=None, pg="17.6", setup_role="postgres", assert_role="auth triggers under postgres",
         criterion="raise",
         note="Header: BEGIN; 053; this file; ROLLBACK. Every check RAISEs."),
    dict(file="test_058_secdef_coverage.sql", type="sql", env="stack17",
         chain=None, pg="17.6", setup_role="postgres", assert_role="catalog inventory (anon/authenticated grants)",
         criterion="raise",
         note="Header: inventories the LIVE catalog after ALL migrations."),
    dict(file="test_059_messages_web_security.sql", type="sql", env="stack17",
         chain=None, pg="17.6", setup_role="postgres", assert_role="pg_policies inventory",
         criterion="raise",
         note="Header: run after the migration suite on a production-shaped DB."),
    dict(file="test_063_content_lifecycle.sql", type="sql", env="stack17",
         chain=None, pg="17.6", setup_role="postgres", assert_role="authenticated / service_role",
         criterion="okcol",
         note="Header names `supabase db reset --local` + docker exec psql."),
    dict(file="test_064_report_resolution.sql", type="sql", env="stack17",
         chain=None, pg="17.6", setup_role="postgres", assert_role="anon/authenticated privilege checks",
         criterion="raise",
         note="Header: disposable local DB only."),
    dict(file="test_066_synchronization_parity.sql", type="sql", env="stack17",
         chain=None, pg="17.6", setup_role="postgres", assert_role="authenticated (SET ROLE)",
         criterion="raise",
         note="Header names the exact docker exec psql command."),
    dict(file="test_067_deleted_message_privacy.sql", type="sql", env="stack17",
         chain=None, pg="17.6", setup_role="postgres", assert_role="service_role / authenticated claims",
         criterion="raise",
         note="Header names the exact docker exec psql command."),
    dict(file="test_068_deleted_message_privacy_runtime_fix.sql", type="sql", env="stack17",
         chain=None, pg="17.6", setup_role="postgres", assert_role="service_role claims",
         criterion="raise",
         note="Header names the exact docker exec psql command."),
    dict(file="test_076_message_tab_categories.sql", type="sql", env="stack17",
         chain=None, pg="17.6", setup_role="postgres", assert_role="authenticated claims + service-role read",
         criterion="raise",
         note="Header names the exact docker exec psql command. Seeds its own "
              "users/conversations/channels and ROLLBACKs. `ok` is nullable and "
              "NULL fails, so a pre-076 database reports named failures rather "
              "than passing vacuously."),

    # ---- shadow-clone family: needs auth.users + the signup trigger, and
    #      performs destructive DELETE FROM auth.users, so it gets its own
    #      database cloned schema-only from the migrated stack. Restoring as
    #      `postgres` makes `postgres` the owner, which is what lets the
    #      harness DISABLE TRIGGER (the shared stack denies that: auth.users
    #      is owned by supabase_auth_admin).
    dict(file="test_054_last_officer.sql", type="sql", env="stack17_clone",
         chain=None, pg="17.6", setup_role="postgres (owner of the clone)",
         assert_role="postgres (owner-level trigger/constraint backstop suite)",
         criterion="raise",
         note="Header: production-faithful shadow DB via pg_dump --schema-only."),
    dict(file="test_125_public_club_twin.sql", type="sql", env="stack17_clone",
         chain=None, pg="17.6", setup_role="postgres (owner of the clone)",
         assert_role="anon / authenticated RPC callers plus catalog checks",
         criterion="raise",
         note="Rollback fixture; clone source must already include migration 125. "
              "Never run against the live stack17 database."),

    # ---- disposable fixture family: each header documents docker run
    #      postgres:15 + pgowner + a fixture schema + an ordered migration set.
    dict(file="test_055_durable_admin_audit.sql", type="sql", env="pg15",
         chain="wg_faithful", pg="15.18", setup_role="pgowner",
         assert_role="anon / authenticated / service_role",
         criterion="raise",
         note="Migration applied twice to prove idempotency."),
    dict(file="test_056_fixture_schema.sql", type="fixture", env="pg15",
         chain="wg2", pg="15.18", setup_role="pgowner", assert_role="n/a (schema fixture)",
         criterion="raise",
         note="Fixture file; success = applies cleanly as part of the wg2 chain."),
    dict(file="test_056_atomic_admin_mutations.sql", type="sql", env="pg15",
         chain="wg2", pg="15.18", setup_role="pgowner",
         assert_role="anon / authenticated / service_role",
         criterion="raise"),
    dict(file="test_057_fixture_schema.sql", type="fixture", env="pg15",
         chain="wg057fx", pg="15.18", setup_role="pgowner", assert_role="n/a (schema fixture)",
         criterion="raise",
         note="Fixture file; builds its own auth schema and auth.uid() GUC shim."),
    dict(file="test_057_student_blocking.sql", type="sql", env="pg15",
         chain="wg", pg="15.18", setup_role="pgowner",
         assert_role="authenticated (56 SET ROLE transitions)",
         criterion="raise"),
    dict(file="test_058_admin_restrictions.sql", type="sql", env="pg15",
         chain="wg058", pg="15.18", setup_role="pgowner",
         assert_role="authenticated (14 SET ROLE transitions)",
         criterion="raise"),
    dict(file="test_060_restriction_hotfix.sql", type="sql", env="pg15",
         chain="wg060", pg="15.18", setup_role="pgowner",
         assert_role="authenticated (16 SET ROLE transitions)",
         criterion="verdict", verdict_ok="ALL TESTS PASSED",
         note="Does NOT raise; prints an explicit verdict row."),
    # FIXTURE DEFECT (recorded, NOT worked around by editing the harness):
    # 061's header prescribes the 057-fixture chain and states the fixture "must
    # provide public.storage_path_from_public_url() (or 052)". It does not:
    # test_057_fixture_schema.sql CALLS that function in three stubbed bodies but
    # never DEFINES it, and migration 052 cannot be applied onto the minimal
    # fixture (052 depends on complete_oauth_onboarding from 047). So the
    # documented throwaway chain is unbuildable as written. The same header also
    # anticipates "a full local migration reset" — the harness explicitly makes
    # its fixture valid "in both production-shaped orders" — so it runs in that
    # documented order instead. No assertion was weakened.
    dict(file="test_061_restriction_reasons_account_deletion.sql", type="sql", env="stack17_clone",
         chain=None, pg="17.6", setup_role="postgres",
         assert_role="grant/privilege assertions evaluated against authenticated",
         criterion="okcol"),
    dict(file="test_062_private_account_posts.sql", type="sql", env="pg15",
         chain="wg062", pg="15.18", setup_role="pgowner",
         assert_role="authenticated / service_role (10 SET ROLE transitions)",
         criterion="okcol"),

    # ---- shell harness: real parallel sessions, cannot be one psql script.
    dict(file="test_057_concurrency.sh", type="shell", env="pg15",
         chain="wg_conc", pg="15.18", setup_role="pgowner",
         assert_role="authenticated (parallel sessions)",
         criterion="shell",
         note="Runs after test_057_student_blocking on the same `wg` database, "
              "exactly as its header documents."),

    # ---- PR #29 permission-parity family (069, 070, 072, 073, 074, 075).
    #      These were written AFTER the fixture families and deliberately need
    #      no fixture and no grants bridge: migration 075 gives the client roles
    #      their table privileges, so `supabase db reset` alone is the whole
    #      environment. Every one of them RAISEs on a failed assertion.
    dict(file="test_069_web_permission_parity.sql", type="sql", env="stack17",
         chain=None, pg="17.6", setup_role="postgres",
         assert_role="authenticated (SET ROLE + request.jwt.claim.sub)",
         criterion="raise",
         note="Catalog + RLS behaviour for the canonical event predicate."),
    dict(file="test_070_cross_platform_event_permission_parity.sql", type="sql", env="stack17",
         chain=None, pg="17.6", setup_role="postgres",
         assert_role="authenticated (SET ROLE + request.jwt.claim.sub)",
         criterion="raise",
         note="Caller-bound access, historical recipients, Chicago end timestamp."),
    dict(file="test_072_protected_identity.sql", type="sql", env="stack17",
         chain=None, pg="17.6", setup_role="postgres",
         assert_role="authenticated (real PostgREST-shaped statements)",
         criterion="raise",
         note="Applies dependency DDL outside its transaction, so run it LAST "
              "on a stack you are about to discard."),
    dict(file="test_073_blocking_and_club_identity.sql", type="sql", env="stack17",
         chain=None, pg="17.6", setup_role="postgres",
         assert_role="authenticated (SET ROLE + request.jwt.claim.sub)",
         criterion="raise",
         note="Blocking overrides the club-tag exception; club name/handle identity."),
    dict(file="test_073_handle_matrix.sql", type="sql", env="stack17",
         chain=None, pg="17.6", setup_role="postgres",
         assert_role="authenticated officer (SET ROLE)",
         criterion="raise",
         note="All 26 club-handle cases."),
    dict(file="test_074_shared_context_identity.sql", type="sql", env="stack17",
         chain=None, pg="17.6", setup_role="postgres",
         assert_role="authenticated (SET ROLE + request.jwt.claim.sub)",
         criterion="raise",
         note="Shared-context identity readers and chat-attachment blocking."),
    dict(file="test_075_client_table_privileges.sql", type="sql", env="stack17",
         chain=None, pg="17.6", setup_role="postgres",
         assert_role="privilege inventory for anon / authenticated",
         criterion="raise",
         note="Fresh-database permissions. Must pass with NO fixture and NO "
              "grants bridge — that is the whole point of the file."),

    # ---- corrections 1/5 family (081 first-login push permission, 082
    #      conversation-read realtime sync). Disposable-fixture family like
    #      055-062, but run directly on plain postgres:17 (not 15 + a
    #      separate PG17_COMPAT rerun) since that is the Production major and
    #      there is no lighter pg15 image already in the chain for it.
    #      Verified live 2026-08-13: fixture + 081 + 082 + test all apply/pass
    #      cleanly on a throwaway `docker run postgres:17` container (not the
    #      shared stack17 stack) — 8/8 ASSERTs pass.
    dict(file="test_081_082_fixture_schema.sql", type="fixture", env="pg17",
         chain="wg081082", pg="17", setup_role="postgres (throwaway container, not pgowner)",
         assert_role="n/a (schema fixture)",
         criterion="raise",
         note="Fixture file; success = applies cleanly as part of the wg081082 chain."),
    dict(file="test_081_082_notifications_permission_readsync.sql", type="sql", env="pg17",
         chain="wg081082", pg="17", setup_role="postgres (throwaway container)",
         assert_role="request.jwt.claim.sub GUC (auth.uid() shim)",
         criterion="raise",
         note="8 BEGIN/ROLLBACK tests: new-signup flag, existing-row DEFAULT "
              "(no backfill), consume_push_permission_prompt ownership + "
              "idempotency, ensure_profile repair-vs-existing-row, and "
              "mark_conversation_read/mark_channel_read persisting AND "
              "broadcasting sync:message-inbox (082's actual fix)."),

    # ---- correction 4 family (083 notification event-coverage audit fixes).
    #      Verified live 2026-08-13 on a throwaway postgres:17 container —
    #      fixture + 083 + test all apply/pass cleanly, 8/8 ASSERTs pass.
    dict(file="test_083_fixture_schema.sql", type="fixture", env="pg17",
         chain="wg083", pg="17", setup_role="postgres (throwaway container)",
         assert_role="n/a (schema fixture)",
         criterion="raise",
         note="Fixture file; success = applies cleanly as part of the wg083 chain."),
    dict(file="test_083_notification_coverage_audit_fixes.sql", type="sql", env="pg17",
         chain="wg083", pg="17", setup_role="postgres (throwaway container)",
         assert_role="request.jwt.claim.sub GUC (auth.uid() shim)",
         criterion="raise",
         note="8 BEGIN/ROLLBACK tests covering the 5 audit fixes: officer_role "
              "and club_chat_added/group_chat_added no-op-vs-real-change "
              "duplicate-notification guards, club_inactive real message "
              "text, and the new club_photo type (notifies every other "
              "member exactly once, never the uploader, never double-fires "
              "alongside a tagged_post's club_post)."),

    # ---- correction 4 part 2 (084): the founder's follow-up "exactly one
    #      notification" proof for every add-to-chat path. Verified live
    #      2026-08-13 on a throwaway postgres:17 container — 6/6 ASSERTs pass.
    dict(file="test_084_fixture_schema.sql", type="fixture", env="pg17",
         chain="wg084", pg="17", setup_role="postgres (throwaway container)",
         assert_role="n/a (schema fixture)",
         criterion="raise",
         note="Fixture file; success = applies cleanly as part of the wg084 chain."),
    dict(file="test_084_notification_exactly_one_fixes.sql", type="sql", env="pg17",
         chain="wg084", pg="17", setup_role="postgres (throwaway container)",
         assert_role="request.jwt.claim.sub GUC (auth.uid() shim)",
         criterion="raise",
         note="6 BEGIN/ROLLBACK tests: officer-added member gets exactly one "
              "club-membership notification (not also club_joined); a "
              "self-driven join still gets club_joined (guard not "
              "over-broad); group-chat invite-join now notifies exactly "
              "once (was zero) and does not duplicate on re-open; "
              "club invite-join still gets exactly one club_joined."),

    # ---- correction 4 part 3 (085): founder decisions on the Fix 4
    #      follow-up — chat_invite_joined documented as deferred,
    #      student_joined's grouped copy names the newest joiner, and its
    #      route was fixed to actually open that same person (previously
    #      stale at the first joiner). Verified live 2026-08-13 on a
    #      throwaway postgres:17 container — 4/4 ASSERTs pass.
    dict(file="test_085_fixture_schema.sql", type="fixture", env="pg17",
         chain="wg085", pg="17", setup_role="postgres (throwaway container)",
         assert_role="n/a (schema fixture)",
         criterion="raise",
         note="Fixture file; success = applies cleanly as part of the wg085 chain."),
    dict(file="test_085_student_joined_named_copy.sql", type="sql", env="pg17",
         chain="wg085", pg="17", setup_role="postgres (throwaway container)",
         assert_role="request.jwt.claim.sub GUC (auth.uid() shim)",
         criterion="raise",
         note="4 BEGIN/ROLLBACK tests: chat_invite_joined documented as "
              "deferred; single student_joined matches the exact founder "
              "template and opens that profile; a merged (2+ student) "
              "notification names the NEWEST joiner and its route advances "
              "to match (the destination-staleness fix); member_joined's "
              "stable-entity route is unaffected by the generic recompute."),

    # ---- Members-invite rebuild (086): audit-driven fix narrowing invite
    #      authorization to Members chat (club_group) only, adding an
    #      auth.users.email_confirmed_at gate to redemption, and closing a
    #      check-then-insert race with an advisory lock + partial unique
    #      index. Verified 2026-08-14 on a throwaway postgres:17 container —
    #      11/11 ASSERTs pass (tests A-K).
    dict(file="test_086_fixture_schema.sql", type="fixture", env="pg17",
         chain="wg086", pg="17", setup_role="postgres (throwaway container)",
         assert_role="n/a (schema fixture)",
         criterion="raise",
         note="Fixture file; success = applies cleanly as part of the wg086 chain."),
    dict(file="test_086_members_only_chat_invitations.sql", type="sql", env="pg17",
         chain="wg086", pg="17", setup_role="postgres (throwaway container)",
         assert_role="request.jwt.claim.sub GUC (auth.uid() shim)",
         criterion="raise",
         note="11 tests: officer can create/rotate a Members-chat invite (A); "
              "a regular member cannot create/reset one (B); a custom-group "
              "creator can no longer create one — the core Fix 1 regression "
              "(C); an officer cannot create one for the officers chat (D); "
              "an unverified account cannot redeem, no membership leaks (E); "
              "a verified account redeems and gets default_channel_id (F); "
              "the new partial unique index makes one-active-token-per-"
              "conversation DB-enforced, not just RPC convention (G); disabled "
              "rotate_chat_invitation returns the current token unchanged and "
              "mutates nothing (H); redeeming as an "
              "existing officer is a clean no-op, role preserved (I); the "
              "migration's own data-fix retroactively revokes a pre-086 "
              "custom-group token (J); an invalid token leaks no data (K)."),

    # ---- club recommendation minimum-2 guarantee fix (087): the
    #      recommendation pool was excluding launch-campus clubs with a NULL
    #      university_id (migration 042 defines them as launch-campus too),
    #      which could leave the eligible pool undercounted so the batch
    #      never topped up to 2 even when the campus had enough real clubs —
    #      the root cause behind "We found 1 club you'll love" in production.
    #      Verified 2026-08-18 on a throwaway postgres:17 container against a
    #      hand-built fixture (not the shared stack — clubs/profiles/etc. are
    #      minimal disposable rows) — 6/6 ASSERTs pass (tests A-F).
    dict(file="test_087_fixture_schema.sql", type="fixture", env="pg17",
         chain="wg087", pg="17", setup_role="postgres (throwaway container)",
         assert_role="n/a (schema fixture)",
         criterion="raise",
         note="Fixture file; success = applies cleanly as part of the wg087 chain."),
    dict(file="test_087_club_recommendation_launch_campus_null_fix.sql", type="sql", env="pg17",
         chain="wg087", pg="17", setup_role="postgres (throwaway container)",
         assert_role="request.jwt.claim.sub GUC (auth.uid() shim) + SET ROLE authenticated",
         criterion="raise",
         note="6 BEGIN/ROLLBACK tests: NULL-university-id launch-campus clubs "
              "are eligible, the core fix (A); a genuinely different "
              "university's club stays excluded — no cross-campus leakage "
              "(B); already-joined clubs stay excluded even when "
              "university_id IS NULL (C); full end-to-end pass through "
              "generate_club_recommendation_batch() + "
              "get_my_club_recommendations() as the real authenticated role "
              "via RLS, returning >=2 real, non-fabricated clubs (D); the "
              "target never pads beyond the real eligible count — exactly 1 "
              "eligible club stays 1 (E); preview_club_match_count() gets "
              "the same fix (F)."),
    # ---- interest-matching release family (122-126). This is intentionally
    # a full local Supabase ledger, not one of the minimal plain-Postgres
    # fixtures: auth.users, account restrictions, launch-campus data, and the
    # twelve production-shaped club handles are all part of the contract.
    dict(file="test_122_126_interest_matching.sql", type="sql", env="stack17",
         chain=None, pg="17.6", setup_role="postgres (disposable local stack owner)",
         assert_role="anon / authenticated / service_role via SET ROLE + request.jwt.claims",
         criterion="raise",
         note="Run only after a disposable full migration reset plus migrations "
              "122-126. Uses synthetic auth identities and the local demo JWT "
              "claims path; never Production. Every failed assertion RAISEs."),
    dict(file="test_127_rotate_chat_invitation_readonly.sql", type="sql", env="stack17",
         chain=None, pg="17.6", setup_role="postgres (disposable local stack owner)",
         assert_role="n/a (static introspection of pg_get_functiondef + grants)",
         criterion="raise",
         note="Run after migration 127. Static checks only, no fixtures: the "
              "reapplied rotate_chat_invitation body is read-only (no UPDATE / no "
              "token creation), keeps its auth guard and signature, and is "
              "EXECUTE-granted to authenticated only. Wrapped in BEGIN/ROLLBACK."),
]

# Day 10A / Day 10B security harnesses that must also be proven on the
# Production PostgreSQL major (17) once they pass on their documented 15.
PG17_COMPAT = [
    "test_055_durable_admin_audit.sql",
    "test_056_fixture_schema.sql",
    "test_056_atomic_admin_mutations.sql",
    "test_057_fixture_schema.sql",
    "test_057_student_blocking.sql",
    "test_058_admin_restrictions.sql",
    "test_060_restriction_hotfix.sql",
    # 061 runs on the full-ledger environment (see its manifest note),
    # which is already PostgreSQL 17.6, so it needs no separate 17 rerun.
    "test_062_private_account_posts.sql",
    "test_057_concurrency.sh",
]

# Minimal synthetic seed required by test_038_039's documented contract.
# These are fabricated rows in a throwaway database; no Production data.
SEEDS = {
    "clubs_038": """
        INSERT INTO universities (id, name, slug)
        VALUES ('a0380000-0000-4000-8000-000000000038','Harness University 038','harness-university-038')
        ON CONFLICT (name) DO NOTHING;
        INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
                                email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                                created_at, updated_at)
        VALUES
          ('00000000-0000-0000-0000-000000000000','00000001-0000-4000-a000-000000000001',
           'authenticated','authenticated','marcus_038@harness.invalid','',NOW(),
           '{"provider":"email","providers":["email"]}','{"username":"marcus_038"}',NOW(),NOW()),
          ('00000000-0000-0000-0000-000000000000','00000004-0000-4000-a000-000000000004',
           'authenticated','authenticated','diego_038@harness.invalid','',NOW(),
           '{"provider":"email","providers":["email"]}','{"username":"diego_038"}',NOW(),NOW())
        ON CONFLICT (id) DO NOTHING;
        INSERT INTO clubs (id, name, handle, description, university_id)
        VALUES
          ('925e7a84-eb0b-4c98-9460-65ee4667c611','Clay Club','clay-club-038','harness fixture',
           (SELECT id FROM universities ORDER BY created_at LIMIT 1)),
          ('e87b15ef-f7d7-444b-990d-6708ea0bef7d','Stock Market Club','stock-market-club-038','harness fixture',
           (SELECT id FROM universities ORDER BY created_at LIMIT 1))
        ON CONFLICT (id) DO NOTHING;
    """,
}
