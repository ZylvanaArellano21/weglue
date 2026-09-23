#!/usr/bin/env bash
# Fail-closed production OTA publish for the We Glue mobile app.
#
#   clean git tree
#   → clear inherited EXPO_PUBLIC_SUPABASE_* shell variables
#   → EXPO_NO_DOTENV=1 (local .env files can never reach the bundle)
#   → load the EAS "production" environment (eas env:exec)
#   → export iOS + Android bundles once
#   → verify those exact bundles + write a sha256 manifest
#   → (--dry-run stops here)
#   → re-check manifest → eas update --skip-bundler --input-dir <verified dir>
#   → re-check manifest (proves the published files were the verified ones)
#
# Usage (from the repo root):
#   pnpm run ota:production:dry-run
#   pnpm run ota:production -- --message "Fix X"
#
# Options:
#   --dry-run         export + verify only; never publishes
#   --message <text>  EAS update message (default: HEAD subject + short sha)
#   --keep-output     keep the export/manifest directory for inspection
#
# Publishing requires explicit founder release authorization.
# See docs/release/mobile-ota-production.md.

set -euo pipefail

DRY_RUN=0
KEEP_OUTPUT=0
MESSAGE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --keep-output) KEEP_OUTPUT=1 ;;
    --message)
      [[ $# -ge 2 && -n "$2" ]] || { echo "✗ --message requires a value" >&2; exit 1; }
      MESSAGE="$2"
      shift
      ;;
    --) ;;
    *) echo "✗ Unknown option: $1" >&2; exit 1 ;;
  esac
  shift
done

fail() {
  echo "✗ $*" >&2
  exit 1
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
MOBILE_DIR="$REPO_ROOT/apps/mobile"
VERIFY="$SCRIPT_DIR/verify-mobile-bundle-env.mjs"

command -v eas >/dev/null 2>&1 || fail "eas CLI not found on PATH"
command -v node >/dev/null 2>&1 || fail "node not found on PATH"
[[ -f "$VERIFY" ]] || fail "verifier not found: $VERIFY"
[[ -x "$MOBILE_DIR/node_modules/.bin/expo" ]] || fail "apps/mobile dependencies not installed (run pnpm install --frozen-lockfile)"

# ── 1. Clean git tree ─────────────────────────────────────────────────────────
assert_clean_tree() {
  local dirty
  dirty="$(git -C "$REPO_ROOT" status --porcelain --untracked-files=all)"
  [[ -z "$dirty" ]] || fail "git worktree is dirty — commit or remove these first:
$dirty"
}
assert_clean_tree
COMMIT="$(git -C "$REPO_ROOT" rev-parse HEAD)"
SHORT_COMMIT="$(git -C "$REPO_ROOT" rev-parse --short HEAD)"
BRANCH="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD)"
ORIGIN_MAIN="$(git -C "$REPO_ROOT" rev-parse --verify --quiet origin/main || echo "unknown")"
echo "• Commit:          $COMMIT ($BRANCH)"
echo "• origin/main ref: $ORIGIN_MAIN (local ref; not fetched)"
[[ -n "$MESSAGE" ]] || MESSAGE="$(git -C "$REPO_ROOT" log -1 --format=%s) ($SHORT_COMMIT)"

# ── 2. Clear inherited Supabase variables; disable .env loading ────────────────
while IFS= read -r name; do
  unset "$name"
done < <(compgen -e | grep '^EXPO_PUBLIC_SUPABASE_' || true)
export EXPO_NO_DOTENV=1

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/weglue-ota-production.XXXXXX")"
DIST_DIR="$WORK_DIR/dist"
MANIFEST="$WORK_DIR/verified-manifest.json"
cleanup() {
  if [[ "$KEEP_OUTPUT" == 1 ]]; then
    echo "• Output kept at $WORK_DIR"
  else
    rm -rf "$WORK_DIR"
  fi
}
trap cleanup EXIT

# ── 3–5. Load EAS production env → export once → verify + manifest ─────────────
# Everything that sees the injected values runs inside this single env:exec
# process; the values are never written to disk or printed.
INNER="node $(printf %q "$VERIFY") env \
&& npx --no-install expo export --output-dir $(printf %q "$DIST_DIR") --dump-sourcemap --dump-assetmap --platform ios --platform android --clear \
&& node $(printf %q "$VERIFY") bundle --dist $(printf %q "$DIST_DIR") --manifest $(printf %q "$MANIFEST")"

echo "• Loading EAS production environment, exporting and verifying…"
(cd "$MOBILE_DIR" && eas env:exec production "$INNER" --non-interactive) \
  || fail "production export/verification FAILED — nothing was published"
[[ -f "$MANIFEST" ]] || fail "verified manifest missing — nothing was published"

if [[ "$DRY_RUN" == 1 ]]; then
  echo "✓ DRY RUN PASSED for $SHORT_COMMIT — verified bundles were NOT published."
  exit 0
fi

# ── 6. Publish the exact verified bundle ──────────────────────────────────────
assert_clean_tree
[[ "$(git -C "$REPO_ROOT" rev-parse HEAD)" == "$COMMIT" ]] || fail "HEAD changed during the release — aborting"
node "$VERIFY" check-manifest --dist "$DIST_DIR" --manifest "$MANIFEST"

if [[ -t 0 ]]; then
  echo
  echo "About to publish $SHORT_COMMIT to EAS branch 'production' (all production users on this runtime)."
  read -r -p "Type 'publish production' to continue: " CONFIRM
  [[ "$CONFIRM" == "publish production" ]] || fail "not confirmed — nothing was published"
else
  fail "publishing requires an interactive terminal confirmation — nothing was published"
fi

(cd "$MOBILE_DIR" && eas update \
  --branch production \
  --environment production \
  --skip-bundler \
  --input-dir "$DIST_DIR" \
  --message "$MESSAGE" \
  --non-interactive) || fail "eas update failed"

node "$VERIFY" check-manifest --dist "$DIST_DIR" --manifest "$MANIFEST" \
  || fail "bundle changed during publish — investigate and roll back (docs/release/mobile-ota-production.md)"
echo "✓ Published the verified bundle for $SHORT_COMMIT to branch 'production'."
