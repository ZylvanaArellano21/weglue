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
