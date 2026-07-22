# System Overview

## Platforms

We Glue is one product on four surfaces that all read/write **one Supabase
project (the shared source of truth)**:

| Surface | Tech | Path | Ships via |
|---|---|---|---|
| iOS (App Store) | Expo / React Native | `apps/mobile` | EAS Build / EAS Update |
| Android (Play Store) | Expo / React Native | `apps/mobile` | EAS Build / EAS Update |
| Web (weglue.app) | Next.js App Router | `apps/web` | Vercel |
| Backend | Supabase (Postgres + Auth + Storage + Realtime + Edge Functions) | `supabase/` | Supabase migrations + `functions/` |

The **Admin Dashboard is web-only** (a new private area of `apps/web`) but it
edits the same shared backend, so every dashboard write is visible on iOS,
Android, and web at once ("change once → update everywhere").

## Monorepo layout

```
weglue/
  apps/
    mobile/        Expo app (iOS + Android). Routes in app/, logic in lib/, services/, store/
    web/           Next.js App Router. Routes in app/, logic in lib/, UI in components/
  packages/
    shared/        Cross-platform TS: authStore, onboardingStore, validateEducationEmail, types
    database/      src/types.ts (generated Supabase types — STALE, see schema-map.md)
  supabase/
    migrations/    001–050 SQL migrations (the real schema history)
    functions/     Edge Functions: delete-account, send-push, send-report-email
    scripts/       Ad-hoc SQL (tests, temp officer seed/revert) — NOT run by the migrator
    config.toml    Supabase project config
  docs/            This documentation set
  CLAUDE.md        Claude Code guidance (session rules)
  AGENTS.md        Codex guidance (backend/security)
```

Package manager is **pnpm** (workspace + Metro symlink handling is delicate — see
the mobile Metro config note in project memory). Turborepo drives builds.

## Web app structure (relevant to the dashboard)

- `apps/web/app/` — App Router routes. Existing top-level areas: `home`, `club`,
  `clubs`, `profile`, `u`, `onboarding`, `interests`, `login`, `get-started`,
  `auth`, `dashboard` (currently a **single stub `page.tsx`**, not the admin
  console), `delete-account`, `invite`, `api/`, `actions/`.
- `apps/web/middleware.ts` — auth/onboarding routing gate. **A new `/admin`
  route must be added here** and must be gated on a real platform-admin check
  (see admin-dashboard.md), not just on being logged in.
- `apps/web/lib/` — `supabase/` (server client), `supabase-browser.ts` (browser
  client), `authFlow.ts`, `onboardingState.ts`, `microsoftAuth.ts`, `realtime.ts`,
  `hooks/` (incl. `useReport.ts`), `clubs/`.
- `apps/web/app/api/` — currently only `delete-account` and
  `delete-account-request` route handlers. **This is the pattern the dashboard's
  privileged server actions should follow** (server-side, service-role stays on
  the server, never shipped to the browser).

## Deploy topology & the four-way-sync rule (CLAUDE.md §5)

Every change must land in all four places, kept in perfect sync:

1. **GitHub** — committed & pushed.
2. **Supabase** — schema/RLS/data via a migration file (never undocumented
   Studio-only edits).
3. **Vercel** — web deploy + env vars.
4. **Local `weglue/` folder** — the working tree.

Mobile additionally: JS/TS-only change → `eas update --branch production`;
native change → `eas build --profile production --platform all --auto-submit`.
**The Admin Dashboard is backend + web only; if built compatibly it needs no EAS
build** (see the compatibility rules in admin-dashboard.md).

## Environments / secrets

- Web env: `apps/web/.env.local` / `.env.example` (Supabase URL + anon key;
  server-only secrets like the service-role key must live in Vercel server env,
  never `NEXT_PUBLIC_*`).
- Edge Functions read secrets from the Supabase Functions env (e.g.
  `RESEND_API_KEY` for report email, push credentials for `send-push`).
- `weglue-a5631ceb0d14.json` at repo root is a Google service-account key
  (FCM/Play). Treat as a secret; it must never be exposed client-side.
