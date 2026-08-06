#!/usr/bin/env python3
"""Manifest-driven harness runner.

Contract (see harness_manifest.py for the per-harness facts):
  * every harness runs in the environment ITS OWN header documents;
  * `setup_role` builds schema/fixtures, the harness switches to its own
    assertion roles — the runner never elevates a role to force a pass;
  * a verdict comes from the process exit status plus the harness's own
    explicit summary. There is no broad `grep FAIL`;
  * only infrastructure faults (container/database build, clone) are
    retried. A real assertion failure is never retried;
  * exit status is nonzero if ANY harness fails, is skipped, or cannot be
    classified.

LOCAL ONLY. Never `--linked`, never a Production connection string.
"""
import argparse
import os
import re
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness_manifest import (MANIFEST, CHAINS, SEEDS, PG17_COMPAT,
                              STACK_CONTAINER, PG15_CONTAINER, PG17_CONTAINER)

SCRIPTS = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(SCRIPTS))
MIGRATIONS = os.path.join(REPO, "supabase", "migrations")
INFRA_RETRIES = 3


def sh(cmd, stdin_path=None, timeout=900):
    """Run a command, capturing combined output and the real exit status."""
    data = None
    if stdin_path:
        with open(stdin_path, "rb") as fh:
            data = fh.read()
    try:
        p = subprocess.run(cmd, input=data, stdout=subprocess.PIPE,
                           stderr=subprocess.STDOUT, timeout=timeout)
        return p.returncode, p.stdout.decode("utf-8", "replace")
    except subprocess.TimeoutExpired as e:
        out = (e.stdout or b"").decode("utf-8", "replace")
        return 124, out + f"\n*** RUNNER: timed out after {timeout}s ***\n"


def psql(container, db, user, sql=None, path=None, unaligned=True):
    cmd = ["docker", "exec", "-i", container, "psql", "-U", user, "-d", db,
           "-v", "ON_ERROR_STOP=1", "-q"]
    if unaligned:
        cmd += ["-A", "-F", "|", "-P", "footer=off"]
    if sql is not None:
        cmd += ["-c", sql]
        return sh(cmd)
    return sh(cmd, stdin_path=path)


# --------------------------------------------------------------------------
# environment construction
# --------------------------------------------------------------------------
def chain_paths(chain):
    out = []
    for item in CHAINS[chain]:
        kind, name = item.split(":", 1)
        out.append(os.path.join(SCRIPTS if kind == "fx" else MIGRATIONS, name))
    return out


def build_chain_db(container, db, chain, log):
    """Create a fresh database owned by pgowner and apply its documented chain.

    Returns True on success. Failures here are INFRASTRUCTURE, not assertions.
    """
    rc, out = psql(container, "postgres", "postgres",
                   sql=f'DROP DATABASE IF EXISTS "{db}";')
    log.append(f"[setup] drop {db} rc={rc}\n{out}")
    rc, out = psql(container, "postgres", "postgres",
                   sql=f'CREATE DATABASE "{db}" OWNER pgowner;')
    log.append(f"[setup] create {db} owner=pgowner rc={rc}\n{out}")
    if rc != 0:
        return False
    rc, out = psql(container, db, "pgowner",
                   sql="GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;")
    log.append(f"[setup] grant usage rc={rc}\n{out}")
    if rc != 0:
        return False
    for path in chain_paths(chain):
        rc, out = psql(container, db, "pgowner", path=path)
        log.append(f"[setup] apply {os.path.basename(path)} as pgowner rc={rc}\n{out}")
        if rc != 0:
            return False
    return True


FINGERPRINT = (
    "select (select count(*) from pg_tables where schemaname in ('public','private'))"
    "||'/'||(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace"
    "        where n.nspname in ('public','private'))"
    "||'/'||(select count(*) from pg_policies where schemaname in ('public','private','storage'));"
)


def stack_ready(log):
    """The disposable stack is long-lived: `supabase db reset` cannot be used
    per harness here because this machine's Docker VM (2 GB) cannot keep the
    storage service healthy, and the CLI's post-reset restart then blocks.

    Isolation instead comes from the harnesses themselves — every harness that
    runs against the base database wraps its fixtures in a transaction it rolls
    back. The two that mutate get their own cloned database. This function
    records the schema fingerprint before each run so contamination between
    harnesses would be visible rather than silent.
    """
    rc, out = psql(STACK_CONTAINER, "postgres", "postgres", sql=FINGERPRINT)
    log.append(f"[setup] disposable stack fingerprint tables/fns/policies = "
               f"{out.strip().splitlines()[-1] if out.strip() else '?'} rc={rc}")
    return rc == 0


def clone_stack_db(db, log):
    """Full clone of the migrated stack database into a fresh database.

    Restoring as `postgres` (NOT a superuser here) leaves `postgres` owning the
    copy — that is precisely what lets test_054 disable a trigger on auth.users,
    which the shared stack refuses because auth.users is owned by
    supabase_auth_admin. Ownership/SET ROLE errors during restore are EXPECTED
    and are what produce the owner topology the harness documents.

    The source database is only READ.
    """
    rc, out = psql(STACK_CONTAINER, "postgres", "postgres",
                   sql=f'DROP DATABASE IF EXISTS "{db}";')
    log.append(f"[setup] drop clone rc={rc}\n{out}")
    rc, out = psql(STACK_CONTAINER, "postgres", "postgres",
                   sql=f'CREATE DATABASE "{db}";')
    log.append(f"[setup] create clone rc={rc}\n{out}")
    if rc != 0:
        return False
    rc, out = sh(["docker", "exec", STACK_CONTAINER, "bash", "-lc",
                  f"pg_dump -U postgres -d postgres | psql -U postgres -d {db} 2>&1 "
                  f"| grep -cE '^ERROR' || true"])
    log.append(f"[setup] clone into {db}: {out.strip()} expected ownership/SET ROLE "
               f"errors (they leave `postgres` as owner, which the harness needs)")
    rc2, out2 = psql(STACK_CONTAINER, db, "postgres", sql=FINGERPRINT)
    log.append(f"[setup] clone fingerprint tables/fns/policies = "
               f"{out2.strip().splitlines()[-1] if out2.strip() else '?'}")
    return rc2 == 0


# --------------------------------------------------------------------------
# verdicts — explicit, per-harness, never a broad grep
# --------------------------------------------------------------------------
HARD_MARKER = "*** FAIL ***"


def classify(entry, rc, out):
    """Return (verdict, summary, reason)."""
    if HARD_MARKER in out:
        n = out.count(HARD_MARKER)
        return "FAIL", f"{n} explicit '*** FAIL ***' marker(s)", "assertion"
    crit = entry["criterion"]

    if crit in ("raise", "shell"):
        if rc != 0:
            return "FAIL", f"exit={rc}", "assertion-or-error"
        return "PASS", f"exit=0, no failure marker", ""

    if rc != 0:
        return "FAIL", f"exit={rc}", "assertion-or-error"

    if crit == "okcol":
        # rows are `name|t` / `name|f`
        bad = [l for l in out.splitlines() if re.search(r"\|f$", l.strip())]
        good = [l for l in out.splitlines() if re.search(r"\|t$", l.strip())]
        if bad:
            return "FAIL", f"{len(bad)} assertion row(s) ok=false", "assertion"
        if not good:
            return "UNCLASSIFIED", "no ok=true rows found", "runner"
        return "PASS", f"{len(good)} assertion rows ok=true", ""

    if crit == "resultcol":
        # rows are `test|PASS|detail` / `test|FAIL|detail`
        bad = [l for l in out.splitlines() if re.search(r"\|FAIL\|", l)]
        good = [l for l in out.splitlines() if re.search(r"\|PASS\|", l)]
        # test_038_039 prints `test|t|detail` / `test|f|detail`
        bad += [l for l in out.splitlines() if re.search(r"\|f\|", l)]
        good += [l for l in out.splitlines() if re.search(r"\|t\|", l)]
        if bad:
            return "FAIL", f"{len(bad)} assertion row(s) reported FAIL", "assertion"
        if not good:
            return "UNCLASSIFIED", "no PASS rows found", "runner"
        return "PASS", f"{len(good)} assertion rows PASS", ""

    if crit == "verdict":
        want = entry["verdict_ok"]
        if any(l.strip() == want for l in out.splitlines()):
            return "PASS", f"verdict '{want}'", ""
        v = [l.strip() for l in out.splitlines() if "FAILURE(S)" in l]
        return "FAIL", v[0] if v else "verdict line absent", "assertion"

    return "UNCLASSIFIED", f"unknown criterion {crit}", "runner"


# --------------------------------------------------------------------------
def run_entry(entry, pgver, logdir):
    """Execute one harness. Infra faults retried; assertion failures never."""
    name = entry["file"]
    log = []
    container = {"pg15": PG15_CONTAINER, "pg17": PG17_CONTAINER}.get(entry["env"],
                                                                    STACK_CONTAINER)
    if pgver == "pg17" and entry["env"] == "pg15":
        container = PG17_CONTAINER

    # Exhausting the infrastructure retries must surface as an explicit
    # non-pass, never as a crash and never as a silent skip.
    verdict, summary, reason = "INFRA-FAIL", "environment could not be built", "infrastructure"
    rc = None
    for attempt in range(1, INFRA_RETRIES + 1):
        log.append(f"\n=== attempt {attempt} — env={entry['env']} pg={entry['pg']} "
                   f"container={container} setup_role={entry['setup_role']} ===")
        # --- build environment -------------------------------------------
        if entry["env"] in ("pg15",):
            db = entry["chain"]
            if not build_chain_db(container, db, entry["chain"], log):
                log.append("[infra] chain build failed — retrying")
                time.sleep(5)
                continue
            user = "pgowner"
        elif entry["env"] == "stack17":
            db, user = "postgres", "postgres"
            if not stack_ready(log):
                log.append("[infra] disposable stack unreachable — retrying")
                time.sleep(10)
                continue
            if entry.get("needs_seed"):
                rc, out = psql(container, db, user, sql=SEEDS[entry["needs_seed"]])
                log.append(f"[setup] seed {entry['needs_seed']} rc={rc}\n{out}")
                if rc != 0:
                    log.append("[infra] seed failed — retrying")
                    continue
        elif entry["env"] == "stack17_clone":
            db, user = "s1a_" + entry["file"].split("_")[1], "postgres"
            if not stack_ready(log):
                log.append("[infra] disposable stack unreachable — retrying")
                time.sleep(10)
                continue
            if not clone_stack_db(db, log):
                log.append("[infra] clone failed — retrying")
                continue
            if entry.get("needs_seed"):
                rc, out = psql(container, db, user, sql=SEEDS[entry["needs_seed"]])
                log.append(f"[setup] seed {entry['needs_seed']} rc={rc}\n{out}")
                if rc != 0:
                    log.append("[infra] seed failed — retrying")
                    continue
        else:
            return dict(entry=entry, verdict="UNCLASSIFIED", summary="unknown env",
                        reason="runner", log="\n".join(log), rc=None)

        # --- execute ------------------------------------------------------
        path = os.path.join(SCRIPTS, name)
        if entry["type"] == "shell":
            rc, out = sh(["bash", path, container, db], timeout=900)
        elif name == "test_053_platform_admin.sql":
            # header: BEGIN; <this file>; ROLLBACK; — nothing may persist
            # psql runs INSIDE the container, so the file is inlined rather
            # than \i'd from a host path.
            wrapped = os.path.join(logdir, "_wrapped_053.sql")
            with open(path) as src, open(wrapped, "w") as fh:
                fh.write("BEGIN;\n" + src.read() + "\nROLLBACK;\n")
            rc, out = psql(container, db, user, path=wrapped)
        elif entry["type"] == "fixture":
            # already applied by the chain build; success = the chain applied.
            rc, out = 0, "[fixture applied as part of the documented chain]\n"
            applied = [l for l in log if f"apply {name} as pgowner rc=0" in l]
            if not applied:
                rc, out = 1, "[fixture did NOT apply cleanly in its chain]\n"
        else:
            rc, out = psql(container, db, user, path=path)

        log.append(f"\n--- harness output (exit={rc}) ---\n{out}")
        verdict, summary, reason = classify(entry, rc, out)
        # Assertion failures are FINAL — never retried to obtain a pass.
        break

    logpath = os.path.join(logdir, f"{pgver}__{name}.log")
    with open(logpath, "w") as fh:
        fh.write("\n".join(log))
    return dict(entry=entry, verdict=verdict, summary=summary, reason=reason,
                log=logpath, rc=rc, container=container)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pg", choices=["pg15", "pg17"], default="pg15")
    ap.add_argument("--only", default=None, help="comma-separated file names")
    ap.add_argument("--logdir", required=True)
    a = ap.parse_args()
    os.makedirs(a.logdir, exist_ok=True)

    entries = MANIFEST
    if a.pg == "pg17":
        entries = [e for e in MANIFEST if e["file"] in PG17_COMPAT]
    if a.only:
        want = set(a.only.split(","))
        entries = [e for e in entries if e["file"] in want]

    results = []
    for e in entries:
        print(f"→ {e['file']:52s} env={e['env']:14s} ", end="", flush=True)
        r = run_entry(e, a.pg, a.logdir)
        results.append(r)
        print(f"{r['verdict']:14s} {r['summary']}")

    bad = [r for r in results if r["verdict"] != "PASS"]
    print(f"\n{len(results)-len(bad)} PASS / {len(bad)} not-pass  ({a.pg})")
    for r in bad:
        print(f"  !! {r['entry']['file']}  {r['verdict']}  {r['summary']}  [{r['reason']}]")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
