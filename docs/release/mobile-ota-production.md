# Mobile OTA — Production Release Runbook

The only supported way to publish a production EAS Update (OTA) for the We Glue
mobile app. The tooling is fail-closed: if anything about the production Supabase
configuration is missing or wrong, nothing is published.

> Publishing an OTA requires explicit founder release authorization
> (WE_GLUE_DEVELOPMENT_RULES.md §7–§10). This runbook describes *how*, not *whether*.

## ⛔ Forbidden paths

| Path | Why it is forbidden |
|---|---|
| `apps/mobile` → `pnpm run deploy` | **FORBIDDEN for production OTA releases.** Runs `eas update --branch production` with no `--environment`: EAS variables are never loaded, the bundle takes whatever local `.env` / shell values exist (or none — a clean checkout ships a bundle with no Supabase URL and crashes every user), and nothing is verified. The script cannot be removed yet: `apps/mobile/package.json` `scripts` are part of the runtime fingerprint, so editing it would stop OTAs reaching iOS 1.0.9 (49) / Android 1.0.9 (48). **Remove it in the next native release** (new runtime). |
| Bare `eas update …` | No verification; `--environment production` silently omits Secret-visibility variables. |
| `set -a; . ./.env; set +a` + `eas update` (the P0 workaround) | Unverifiable manual step; superseded by this runbook. |

## What the tooling guarantees

`scripts/release/ota-production.sh` (via `pnpm run ota:production[:dry-run]`):

1. Refuses a dirty git tree (tracked or untracked changes).
2. Unsets every inherited `EXPO_PUBLIC_SUPABASE_*` shell variable and sets
   `EXPO_NO_DOTENV=1`, so neither the shell nor any `.env*` file can supply values.
3. Loads the EAS **production** environment with `eas env:exec production`
   (Plain text + Sensitive variables only — Secret variables are never available here).
4. Validates the injected values (`verify-mobile-bundle-env.mjs env`).
5. Exports iOS + Android **once**, with the same flags `eas update` uses, plus `--clear`.
6. Verifies those exact bundles and writes a sha256 manifest of the export
   directory (`verify-mobile-bundle-env.mjs bundle`).
7. `--dry-run` stops here.
8. Re-checks the clean tree, HEAD, and manifest; asks for a typed confirmation;
   publishes with `eas update --skip-bundler --input-dir <verified dir>` (the
   bundler is not run — the verified files are uploaded as-is); then re-checks
   the manifest to prove the uploaded files are the verified ones.

The verifier fails when any of these is true:

- `EXPO_PUBLIC_SUPABASE_URL` absent, or not exactly `https://yoozrnosmqtaiksgcixc.supabase.co`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY` absent, not an anon JWT / `sb_publishable_` key,
  JWT `role` ≠ `anon`, or JWT `ref` ≠ `yoozrnosmqtaiksgcixc`
- any `EXPO_PUBLIC_*` value or shipped file contains `localhost`, `127.x`, `10.0.2.2`,
  `host.docker.internal`, an RFC1918/LAN address, or `:54321` (Hermes string literals:
  except the exact library literals below)
- any file contains a non-production `*.supabase.co` ref, a `service_role` JWT,
  a JWT for another project, or an `sb_secret_` credential
- a launch bundle does not contain the exact injected URL and key (as whole Hermes literals)
- the Hermes bundle uses an unsupported bytecode version or its string table cannot be parsed
- the export lacks an iOS or Android bundle
- any exported file changes between verification and publish

The key is never printed — only its kind, role/ref, and an 8-character sha256 prefix.

### Library-literal allowlist (founder-approved 2026-09-23)

Hermes bundles are checked literal-by-literal: the verifier reads the Hermes
string table (bytecode v96; any other version fails closed until re-validated)
and requires string literals **exactly equal** to the injected URL and key. A
literal containing a local/LAN host fails unless it is **exactly** one of these
library literals, found in the production-equivalent export of `3f9416d7`:

| Exact literal | Origin |
|---|---|
| `http://localhost:8081/` | `react-native/Libraries/Core/Devtools/getDevServer.js` (dev-server fallback) |
| `http://localhost:9999` | `@supabase/auth-js/dist/main/lib/constants.js` (`GOTRUE_URL` default, unused when a URL is passed) |
| `http://localhost:3000` | `expo-router/build/head/url.js` (dev fallback; iOS bundle) |
| `127.0.0.1` | `@supabase/supabase-js` trace-propagation target list (bare host) |
| `localhost` | `@supabase/supabase-js` trace targets, `whatwg-url` and `@supabase/auth-js` webauthn hostname comparisons (bare host) |

Still failing, among others: `http://127.0.0.1`, `https://127.0.0.1`,
`127.0.0.1:54321`, `http://localhost`, `https://localhost`, `localhost:54321`,
any other localhost port or path, `10.0.2.2`, `host.docker.internal`, LAN
addresses, and anything with `:54321`. The allowlist never applies to injected env
values, to bytes outside the Hermes string table, to non-Hermes bundles or to
assets. Changing it requires founder approval (`LIBRARY_LITERAL_ALLOWLIST` in
`scripts/release/verify-mobile-bundle-env.mjs`).

A library upgrade that adds a new local-host literal makes `ota:production` fail
closed; report the exact literal and origin for approval — never widen the rule.

## Procedure

Prerequisites: founder release authorization; a clean checkout of the approved
`main` commit; `pnpm install --frozen-lockfile`; `eas whoami` logged in.

```bash
pnpm run test:release              # verifier unit tests
pnpm run ota:production:dry-run    # export + verify, never publishes
pnpm run ota:production -- --message "<release note>"
```

Record the commit, the printed manifest root hash, and the update group IDs from
the `eas update` output.

## EAS environment variables

Required in the **production** environment with **Sensitive** visibility:
`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`.
Never add a service-role key or any `sb_secret_` value to an `EXPO_PUBLIC_*` variable.

State on 2026-09-23 (before migration): both are **Secret** objects shared by
production, preview and development, so `ota:production` fails with
"EXPO_PUBLIC_SUPABASE_URL is absent". EAS Build still receives them.

### Production migration (requires separate founder authorization)

Run from `apps/mobile` of a clean checkout. Freeze all builds and updates first.

```bash
# 0. Read-only pre-flight — every check must pass
eas whoami
eas build:list --status in-progress --non-interactive   # must be empty
eas build:list --status in-queue --non-interactive      # must be empty
eas update:list --branch production --non-interactive   # record current groups
eas env:list production --format long                   # must match the state above
eas env:list preview --format long

# 1. Detach production from the shared Secret objects (preview/development keep them)
eas env:update --variable-name EXPO_PUBLIC_SUPABASE_URL --variable-environment production \
  --environment preview --environment development --scope project --non-interactive
eas env:update --variable-name EXPO_PUBLIC_SUPABASE_ANON_KEY --variable-environment production \
  --environment preview --environment development --scope project --non-interactive
```

**If EAS refuses the detach: STOP.** Do not delete or recreate the shared Secrets and
do not touch preview/development — deletion affects those environments and needs
separate founder authorization. Report the exact error.

```bash
# 2. Create production-only Sensitive variables from the verified production values
#    (source must be verified first; values are never echoed)
( set -a; . ./.env; set +a
  eas env:create production --name EXPO_PUBLIC_SUPABASE_URL --value "$EXPO_PUBLIC_SUPABASE_URL" \
    --visibility sensitive --scope project --non-interactive
  eas env:create production --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value "$EXPO_PUBLIC_SUPABASE_ANON_KEY" \
    --visibility sensitive --scope project --non-interactive )

# 3. Verify
eas env:list production --format long    # two SENSITIVE vars, environments: production
eas env:list preview --format long       # Secrets still attached to preview, development
pnpm run ota:production:dry-run          # from the repo root; must pass
```

The migration does not change the runtime fingerprint: `app.json` is static and
`EXPO_PUBLIC_*` values only affect the JS bundle.

### Rollback

- **Detach worked, create failed** — reattach the untouched Secret (restores the prior state exactly):
  `eas env:update --variable-name <NAME> --variable-environment preview --environment production --environment preview --environment development --scope project --non-interactive`
- **Wrong Sensitive value** — `eas env:update --variable-name <NAME> --variable-environment production --value <correct> --non-interactive`,
  or `eas env:delete production --variable-name <NAME> --non-interactive` and reattach the Secret as above.
- **Bad OTA published** — republish the last good group
  (`eas update:republish --group <id>`; on 2026-09-23 the production groups were
  iOS `c8c3d7bb-00ab-4749-aef7-9fe2f3b8d350`, Android `ca62a276-b41b-4538-9857-8050ef0bee9a`)
  or `eas update:roll-back-to-embedded`.

## Proving each path receives production values

- **EAS Update** — a passing `ota:production:dry-run` proves the export received and
  embedded the production values; the manifest re-check proves the published files
  are the verified ones.
- **EAS Build** — the `production` profile (store distribution) resolves the
  `production` environment, and builders receive every visibility. On the next
  authorized native build, confirm the build log lists both variable names, and run
  the verifier's `bundle` command against the JS bundle extracted from the `.ipa`/`.apk`.
