#!/usr/bin/env python3
"""
MIGRATION ORDER CHECK — read-only, local, no deployment.

Two pull requests are open against `main` at once and each adds migrations:

    PR #29  fix/web-permission-parity            069, 070, 072, 073, 074, 075
    PR #30  security/cron-worker-secret-parity   071

Neither branch can see the other's file, so nothing in Git will complain, and
`supabase db push` will not complain either — until it does, on Production,
because Supabase records applied migrations by VERSION and refuses to insert a
version BELOW the highest one already applied.

This script answers three questions mechanically, from the actual Git refs:

  1. Is any migration version claimed by more than one branch?
  2. Is there a version gap that only exists because the other PR owns it?
  3. Given what Production has already applied, is there a merge/apply order
     that never inserts a migration below the highest applied version?

It reads `git` only. It contacts no database, applies nothing, and changes no
file in either branch.

Usage:
    python3 supabase/scripts/check_migration_order.py
    python3 supabase/scripts/check_migration_order.py --remote-latest 068
"""

import argparse
import re
import subprocess
import sys

MAIN = "origin/main"
BRANCHES = {
    "PR #29  fix/web-permission-parity": "fix/web-permission-parity",
    "PR #30  security/cron-worker-secret-parity": "origin/security/cron-worker-secret-parity",
}
VERSION_RE = re.compile(r"^(\d+)_")


def migrations(ref: str) -> dict:
    """version -> filename for one ref. Empty dict if the ref is unknown."""
    out = subprocess.run(
        ["git", "ls-tree", "--name-only", ref, "supabase/migrations/"],
        capture_output=True, text=True,
    )
    if out.returncode != 0:
        return {}
    found = {}
    for line in out.stdout.splitlines():
        name = line.rsplit("/", 1)[-1]
        m = VERSION_RE.match(name)
        if m:
            found[m.group(1)] = name
    return found


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--remote-latest", default="068",
                    help="highest migration version already applied on Production")
    args = ap.parse_args()

    base = migrations(MAIN)
    if not base:
        print(f"could not read {MAIN} — run `git fetch origin` first")
        return 2

    print(f"{MAIN}: {len(base)} migrations, latest {max(base)}")
    print(f"Production reports latest applied: {args.remote_latest}\n")

    added = {}
    for label, ref in BRANCHES.items():
        theirs = migrations(ref)
        if not theirs:
            print(f"  ! {label}: ref '{ref}' not found — fetch it before trusting this report")
            continue
        new = {v: n for v, n in theirs.items() if v not in base}
        added[label] = new
        print(f"  {label}\n      adds: {', '.join(sorted(new)) or '(none)'}")
    print()

    problems = []

    # 1. Duplicate versions across branches.
    seen = {}
    for label, new in added.items():
        for version, name in new.items():
            if version in seen:
                problems.append(
                    f"DUPLICATE version {version}: '{name}' ({label}) collides with "
                    f"'{seen[version][1]}' ({seen[version][0]})")
            else:
                seen[version] = (label, name)
    print("1. duplicate versions across open PRs: "
          + ("NONE" if not any(p.startswith("DUPLICATE") for p in problems) else "FOUND"))

    # 2. Gaps a branch cannot see.
    for label, new in added.items():
        if not new:
            continue
        others = {v for other, n in added.items() if other != label for v in n}
        lo, hi = min(new), max(new)
        gaps = sorted(v for v in others if lo < v < hi)
        if gaps:
            print(f"2. {label} has an interior gap at {', '.join(gaps)} — owned by the other PR")
        else:
            print(f"2. {label}: no interior gap owned by another PR")

    # 3. Is there a safe apply order?
    combined = sorted(seen)
    below = [v for v in combined if v <= args.remote_latest]
    if below:
        problems.append(
            f"OUT OF ORDER: {', '.join(below)} are at or below the version Production "
            f"has already applied ({args.remote_latest})")
    print("3. every pending migration is above the applied high-water mark: "
          + ("YES" if not below else "NO"))

    print("\n" + "=" * 70)
    if problems:
        for p in problems:
            print("  PROBLEM: " + p)
        print("\nVERDICT: the combined set is NOT safe to apply as numbered.")
        return 1

    print(f"""VERDICT: safe, with ONE condition.

  Combined pending set, in application order:
      {', '.join(combined)}

  All of these are above Production's high-water mark ({args.remote_latest}),
  so a single `supabase db push` applies them in numeric order with no gap, no
  duplicate and nothing inserted behind an applied version. No renumbering is
  required and neither PR needs to be edited.

  THE CONDITION — this is the whole point of the check:

      Do NOT apply either PR's migrations to Production on its own.

  Production is at {args.remote_latest}. The moment one PR's migrations are applied
  alone, the other PR's versions fall BELOW the new high-water mark and become
  out-of-order inserts that `supabase db push` refuses without --include-all:

      apply PR #29 first  -> 075 applied, then 071 arrives  -> out of order
      apply PR #30 first  -> 071 applied, then 069 arrives  -> out of order

  Merge order between the two PRs does not matter. What matters is that BOTH
  are merged into main before the FIRST remote apply, and that the first apply
  covers the whole range.""")
    return 0


if __name__ == "__main__":
    sys.exit(main())
