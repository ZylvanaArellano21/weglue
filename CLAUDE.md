# We Glue — Session Requirements

READ AND UNDERSTAND AND DO THESE 9 REQUIREMENTS BEFORE DOING ANYTHING ELSE. They apply to every task, every response, every line of code in every session.

## 1. dangerously-skip-permissions
Operate with full permissions. No confirmation gates unless explicitly needed.

## 2. Dual-platform mandatory (iOS + Android)
Every single change must work on **App Store (iOS) AND Google Play Store (Android)**. Both submission policies apply at all times. Every link, element, color, API, permission — must comply with both stores. Tell Claude Code and Cursor explicitly when scanning code that everything must work on both platforms.

## 3. Self-decide on technical details
File locations, naming conventions, migration order, index strategy — decide yourself and proceed. Do not ask about these.

## 4. Think ahead like a professional
Build this app like a senior engineer launching a worldwide product. Always keep in mind:
- App Store and Play Store policies (before AND after launch)
- Millions of users, global scale
- Growth, professionalism, store submission readiness
- Apply this thinking to every line of code, every answer, every suggestion.

## 5. Four-way sync — GitHub + Supabase + Vercel + weglue folder
Every change, element, table, code, color, environment variable, deployment — anything added or modified — must be saved in:
- GitHub (committed and pushed)
- Supabase (schema, RLS, data)
- Vercel (deploy changes, sync env vars, keep project config up to date)
- The weglue local folder

All four must be in perfect sync with the actual app at all times.

## 6. Ask before starting if anything is unclear
If there are any questions before beginning a task, ask them first. Do not guess.

## 7. Play sound on completion or when needing permission
When fully done with all tasks, OR when needing to ask a question or get permission before continuing, run:
```
afplay /System/Library/Sounds/Glass.aiff
```
And confirm at the end of every completed session: "I have read, understood, and completed all 7 requirements."

## 8. Triple-Check Before Done — MANDATORY
Every single time all tasks in a chat are finished, you MUST triple-check that:
- Everything is working correctly
- Everything is looking good visually
- Every change and new addition works perfectly

**If anything is broken, missed, or wrong — fix it immediately. Do not declare done until it is fixed.**

**If you had to fix something after the triple-check, run the triple-check again from the start.**

Do NOT say "done", "finished", "completed", or any equivalent until a full clean triple-check passes with zero issues. No exceptions.

## 9. Upload all changes to Android AND iOS — PERMANENT MANDATORY RULE
At the end of every task, after the triple-check passes:
- If JS/TS-only changes: run `eas update --branch production` from `apps/mobile/`
- If native changes: run `eas build --profile production --platform all --auto-submit`
- Report the exact command run and its output
- A task is NOT complete until both iOS and Android are live. No exceptions.

---

# Engineering documentation & navigation

The 9 requirements above are the session rules. **Architecture, schema, and
process truth lives in [`docs/`](docs/README.md)** — keep it focused; this file
stays a rules + navigation index, not an architecture dump.

Read `docs/README.md` first. Load-bearing facts to hold before touching backend:

- **`packages/database/src/types.ts` is STALE** — derive the schema from
  `supabase/migrations/*.sql`, not the generated types. See
  [`docs/database/schema-map.md`](docs/database/schema-map.md).
- **Canonical writes only** — write `university_id` (not the `university` text
  mirror); never treat a cached count as truth. See
  [`docs/database/canonical-sources-of-truth.md`](docs/database/canonical-sources-of-truth.md).
- **Officer permission = `club_members.role = 'officer'`** (via `is_club_officer`).
  `club_officers` is a display-only roster and grants nothing. Route role changes
  through the officer RPCs. See
  [`docs/database/roles-and-officer-authorization.md`](docs/database/roles-and-officer-authorization.md).
- **No platform-admin / restrictions / audit / edit-history / blocks tables
  exist** — they are greenfield for the Admin Dashboard.
- **Deleted-content privacy is non-negotiable — and NOT yet enforced.** Message
  soft-delete doesn't null `content` and the SELECT RLS has no `deleted_at`
  filter, so deleted content is currently retrievable by participants. The only
  *protected* snapshot is `reports.content_snapshot` (reported messages), on
  `reports`, not `messages`. See
  [`docs/product/deletion-and-edit-history.md`](docs/product/deletion-and-edit-history.md).
- **One migration task at a time; reconcile 042–044 before authoring 051+** (the
  `fix/supabase-migration-history-042-044` branch is misnamed — no reconciliation
  in it). No service-role key in client code, ever. No undocumented Supabase
  Studio changes.
- **Admin Dashboard = backend + web only.** If all changes stay additive/
  compatible it needs **no EAS build** (but prove it). Plan:
  [`docs/product/admin-dashboard.md`](docs/product/admin-dashboard.md).

Codex (backend/security) is guided by [`AGENTS.md`](AGENTS.md) and onboards via
[`docs/operations/codex-onboarding-checklist.md`](docs/operations/codex-onboarding-checklist.md).
Collaboration rules (one editing owner per task, review, migration lock, approval
gates): [`docs/operations/agent-collaboration-protocol.md`](docs/operations/agent-collaboration-protocol.md).

> Note: this file's own numbering says "9 requirements" in the header but
> requirement 7's confirmation line reads "all 7 requirements" — that legacy
> wording is intentionally left as-is; confirm completion per requirement 7.
