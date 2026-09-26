# We Glue 148 → 149 scalability harness

Staging-only load harness for the pre-149 baseline and the migration-149 comparison. The full experiment design, safety model and procedure are in [`docs/performance/pre-149-baseline.md`](../docs/performance/pre-149-baseline.md).

**Never run anything here against production.** The loader refuses the production project, and every write or load command needs its own exact approval phrase.

## Layout

| Path | Role |
|---|---|
| `src/cli.ts` | Control plane: `plan`, `preflight`, `trace`, `seed`, `prepare-auth`, `reset-actions`, `cleanup`, `campaign`, `analyze`, `compare` |
| `src/config.ts` | Environment validation, production refusal, staging allowlist, ceilings, join-rate budget |
| `src/contract.ts`, `src/preflight.ts` | 001–148 / +149 ledger contract, schema fingerprint, 149/150 markers, push/cron isolation |
| `src/seed.ts`, `src/cleanup.ts` | Synthetic fixture, and the scoped transactional reset and final cleanup |
| `src/trace.ts` | Deterministic, hashed action trace (archetypes, 8–20 s pacing, cold launch) |
| `k6/main.js`, `k6/lib/*.js` | One plateau of HTTP/PostgREST/RPC load. The journey builders are shared with the tests. |
| `src/realtime-worker.ts`, `src/realtime-topology.ts` | App-identical Realtime topology, join classification, reconnect wave |
| `src/observer-worker.ts`, `src/prometheus.ts` | Database and Metrics API observation plus infrastructure hard stops |
| `src/campaign.ts` | Supervisor: idle baseline, per-plateau runs, cooldowns, stop-on-degrade, run manifest |
| `src/analyze.ts`, `src/compare.ts` | Approved capacity classification, and the controlled 148 → 149 comparison |

## Commands

```sh
pnpm install --frozen-lockfile
pnpm --filter @weglue/load-tests build
pnpm --filter @weglue/load-tests test        # offline contract/unit tests
pnpm --filter @weglue/load-tests type-check

# Needs exported configuration (see .env.example). plan is offline; preflight is read-only.
node load-tests/dist/src/cli.js plan
node load-tests/dist/src/cli.js preflight

# Offline, on archived results:
node load-tests/dist/src/cli.js analyze <run-dir>
node load-tests/dist/src/cli.js compare --pre <148 run dirs…> --post <149 run dirs…> --out <prefix>
```

`seed`, `reset-actions` and `cleanup` need `LOADTEST_CONFIRM_WRITES`. `campaign` needs `LOADTEST_CONFIRM_CAMPAIGN`. Both phrases are listed in `.env.example`, and each is used only after the corresponding separate approval.

Results are written under `load-tests/results/<namespace>/` (git-ignored). Session tokens are stored separately in `…/private/sessions.json` (mode 0600) and are never included in a run folder. To stop a running campaign, create `EXTERNAL_HARD_STOP` in the run folder or press Ctrl-C.
