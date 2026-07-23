# Deleted-Message Privacy — Authoritative Design (v5)

> **Status: DESIGN ONLY. Not implemented.** No migration, no production/data
> change, no mobile change, no OTA publish, no native build, no Supabase deploy.
> This is the single authoritative artifact for Codex review; it supersedes
> v1–v4. **No migration 051 is prepared or numbered until 042–044 are
> statement/hash reconciled (§19).**
>
> Owner (implementer): Claude · Reviewer: Codex · Decision-maker: founder.

## 0. The non-negotiable rule
After a user deletes a message, We Glue must never again *serve* the original —
text, attachment, poll, or shared payload — to any ordinary user (sender,
recipient, participant, officer, club member, non-member preview, reporter,
reported user, or any normal Supabase/iOS/Android/web client) through queries,
Realtime, search, previews, signed URLs, related tables, notifications/pushes, or
report records. Only the founder/super-admin may inspect retained originals via an
audited, platform-admin-gated path that **does not exist yet** (retained data
stays service-role-only until it does). Boundary stated, not hidden: We Glue
cannot recall a file already **downloaded, screenshotted, or captured
off-platform**, nor a **push already delivered** to a device.

---

## 1. (Change #1) Corrected current-client query facts — the design must NOT depend on clients filtering `deleted_at`
A prior draft claimed "every mobile message-loading query filters `deleted_at`."
**That was false.** Verified behavior:

| Surface | Function / location | Filters `deleted_at`? |
|---|---|---|
| Modern thread loader | `getThreadMessages` — `messagingService.ts:107` | **Yes** (`.is('deleted_at', null)`) |
| Direct messages | `getDirectMessages` — `chatService.ts:401` | **NO** |
| Non-member club preview | `getNonMemberPreview` — `chatService.ts:511` | **NO** |
| Channel messages | `getChannelMessages` — `channelService.ts:312` | **NO** |
| Conversation media | `getConversationMedia` — `messagingService.ts:452` | Yes |
| Conversation files | `getConversationFiles` — `messagingService.ts:475` | Yes |
| Shared events | `getConversationSharedEvents` — `messagingService.ts:519` | Yes |
| Poll history (ids) | `getConversationPollIds` — `messagingService.ts:592` | Yes (`messages.deleted_at`) |
| Search | `searchConversation` — `messagingService.ts:628/636/644/651/658` | Yes |
| Web unread Realtime | `useUnreadSummary.ts:82` subscribes `INSERT ON public.messages`; count via `get_unread_summary` RPC | subscription is INSERT-only (delete UPDATE doesn't fire it); RPC must exclude deleted |

**Conclusion:** at least three loaders (`getDirectMessages`, `getNonMemberPreview`,
`getChannelMessages`) return deleted rows today. Therefore **backend RLS +
canonical redaction are mandatory and sufficient on their own**; the design does
not rely on any client filtering `deleted_at`. The message SELECT RLS gains
`deleted_at IS NULL` (new) and canonical redaction nulls content — so a redacted,
hidden row is safe even for the non-filtering loaders and for direct PostgREST.

---

## 2. Architecture overview
Approach B — **deletion-scrubbing + server orchestration**:
- `messages` stays canonical/current. Deletion mutates in place: snapshot out →
  redact to tombstone-safe fields.
- Originals go to **immutable, founder-only** retention (DB history + a
  **dedicated founder-only storage bucket**, §6).
- A **first PostgreSQL transaction** makes ordinary DB access fail-closed
  atomically (§4). **Edge Function orchestration** performs the physical
  attachment move Postgres can't (§8). The cross-service saga is **not** atomic.
- Two entry points must both be secure: OTA **Edge Function** (`delete-message`)
  and the **legacy `unsend_message` RPC** (§6).

Verified current-state facts the design rests on (citations real):
message SELECT RLS has no `deleted_at` filter (001:808); `unsend_message` (040:177)
nulls nothing; snapshots are on `reports` (040:810), reporter-readable (033:66);
`chat-attachments` private, participant-read policy with no deleted check
(040:883); signed-URL TTL 1h (`chatAttachments.ts:167`); `messages` content
columns = `content, attachment_url, attachment_name, attachment_mime,
attachment_size, shared_event_id, shared_post_id`; `message_type` ∈
`{text,image,video,poll,file,shared_event,shared_post}` (040:49); no reply column;
`messages` & `poll_votes` in `supabase_realtime` (010:39/40); push body from
`NEW.content` (046:1020–1026). Prod: 13 attachment messages — 11 standard storage
paths, **2 nonstandard `file://` device URIs (unmanaged, not in storage)**.

---

## 3. (Change #2) Independent deletion attempts
```
message_deletion_attempts (
  id               uuid primary key default gen_random_uuid(),
  message_id       uuid not null references messages(id) on delete cascade,
  attempt_no       int  not null,
  idempotency_key  text not null,
  actor_id         uuid references profiles(id),
  reason           text,
  state            text not null,            -- §7 state machine
  entry_point      text not null,            -- 'edge_function' | 'legacy_rpc'
  has_managed_attachment boolean not null default false,
  started_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  completed_at timestamptz, failed_at timestamptz, failure_reason text,
  reconcile_after timestamptz, reconcile_tries int not null default 0, last_error text,
  restored_at timestamptz, restored_by uuid references profiles(id),
  restoration_reason text, restoration_result text
)
```
Constraints: **`unique (message_id, attempt_no)`**; **`unique (idempotency_key)`**;
**partial unique active attempt**:
```
create unique index uq_active_deletion_attempt on message_deletion_attempts(message_id)
  where state in ('pending','retained','original_removed','redacted','failed_requires_reconciliation');
```
`attempt_no = 1 + coalesce(max(attempt_no),0)` **computed inside the locked
transaction** (§4 step: after `SELECT … FOR UPDATE` on the message). Supports
delete → restore → delete-again (new attempt). **Concurrency:** duplicate call
(same `idempotency_key`) → the unique index makes it a no-op returning current
state; competing distinct calls → the partial-unique-active index rejects the
second, which then reads and returns the in-flight attempt.

**Active states:** `pending, retained, original_removed, redacted,
failed_requires_reconciliation`. **Terminal states:** `completed, restored,
purged, aborted`.

---

## 4. (Change #3) Initial PostgreSQL transaction (atomic; no partial state)
One transaction — all-or-nothing — for both entry points:
1. `SELECT … FOR UPDATE` lock the `messages` row.
2. Verify authorization (sender / officer / custom-group admin — existing rules).
3. Compute `attempt_no`; insert `message_deletion_attempts` (`idempotency_key`,
   `entry_point`, `has_managed_attachment`), `state='pending'`.
4. Snapshot to founder-only history: `content`; **attachment metadata + object
   mapping (§5)**; poll question/options/votes/voters/totals; shared refs
   (`shared_event_id`, `shared_post_id`).
5. Redact every canonical content-bearing field: null `content`, `attachment_url`,
   `attachment_name`, `attachment_mime`, `attachment_size`, `shared_event_id`,
   `shared_post_id`; protect/unlink poll (§12).
6. `deleted_at = now()`, `deleted_by = auth.uid()`.
7. No-managed-attachment messages (text/poll/shared/`file://` unmanaged) →
   `state='completed'`. Managed-attachment messages → stay `state='pending'` for
   §8 storage orchestration.

**If any step fails, the whole transaction rolls back** — never a history-only or
redaction-only remnant. The Realtime `UPDATE` this emits carries the
already-redacted row → **no original content in the Realtime payload**. Ordinary
DB access is fail-closed at commit (content null + message SELECT RLS
`deleted_at IS NULL` + deleted-aware storage policy denying new signing).

---

## 5. (Change #5) Canonical attachment object mapping
Do **not** assume `messages.attachment_url == storage.objects.name`. Snapshot an
explicit immutable mapping per attempt:
```
message_attachment_map (
  id uuid pk, attempt_id uuid references message_deletion_attempts(id),
  message_id uuid, storage_provider text,        -- 'supabase' | 'external' | 'device_local'
  bucket text, original_path text,               -- e.g. chat-attachments / {conv}/{uuid}.ext
  retained_bucket text, retained_path text,       -- founder-only retention (§6)
  is_external boolean not null default false, external_url text,
  size bigint, mime text, checksum text,
  copy_state  text,   -- 'n/a'|'pending'|'copied'|'verified'|'failed'
  delete_state text,  -- 'n/a'|'pending'|'deleted'|'verified'|'failed'
  copied_at timestamptz, deleted_at_storage timestamptz
)
```
**Backfill/classification of current records (prod-verified: 13 total):**
- **11 standard** `chat-attachments/{conv}/{uuid}.ext` → `supabase`, managed;
  normal copy+delete+verify path.
- **2 `file:///var/mobile/…` device URIs** → `device_local`, **unmanaged**: no
  We Glue storage object exists → **redact the `attachment_url` immediately; no
  copy/delete possible**; mark `copy_state/delete_state='n/a'`, `is_external=true`.
- **UUID-path-like records** that parse to a valid bucket/path → managed path.
- **Records that cannot be mapped automatically** (unexpected shape, missing
  object) → **fail closed → `failed_requires_reconciliation`** and manual review;
  **never treated as successfully deleted.**
External deletion control: for `device_local`/`external`, We Glue controls only
the DB reference (redacted); it cannot move/delete an object outside its storage.
Documented, not claimed otherwise.

---

## 6. (Change #6) Dedicated founder-only retention bucket
A **separate private bucket** (e.g. `deleted-retention`), **not** a prefix inside
`chat-attachments`. Policies: no ordinary authenticated access; no participant/
officer access; no public URLs; **no browser-side service-role**; no ordinary
client signed-URL generation; access only via future audited founder/admin
operations; deliberate restoration (§10) and purge paths.

## 6b. (Change #4) Legacy `unsend_message` compatibility — honest B2
- **No We-Glue-managed-attachment messages** (text/poll/shared_event/shared_post,
  and the `device_local`/external cases where there is nothing to move): the
  legacy RPC executes the **complete §4 DB-only snapshot+redact flow** and returns
  **success only after DB privacy completes**. Old-client UX: unchanged in effect.
- **We-Glue-managed-attachment messages** (image/video/file in `chat-attachments`):
  the legacy RPC **throws an actual RPC error** (e.g.
  `raise exception 'secure_deletion_required' using errcode='P0001'`). It **does
  not** return a success-shaped result and **does not** perform the old insecure
  `deleted_at`-only behavior. The user must use the OTA-updated Edge Function
  path. **Old-client behavior:** the delete surfaces an error toast and the
  message remains visible (nothing changed) until the app receives the OTA. This
  is honest: we do not fake success or leave the attachment served.
- **External / pass-through (`file://`/non-managed) URLs:** identified explicitly
  via the mapping (§5); We Glue **redacts the URL immediately** (DB-only path
  above returns success) and does **not** claim to move/delete an object it does
  not host; documents that no external deletion control exists.

---

## 7. (Change #7) State matrix
`aborted` is allowed **only before canonical redaction commits** (authz/pre-lock
failure). Once redaction commits, an attempt ends only via `completed`,
`failed_requires_reconciliation`→reconcile, `restored`, or `purged` — never normal
abortion. **No failed state exposes content.**

| Dimension | pending | retained | original_removed | redacted | completed | failed_reconc | restored | purged | aborted |
|---|---|---|---|---|---|---|---|---|---|
| Ordinary SELECT | Hidden | Hidden | Hidden | Hidden | Hidden | Hidden | Visible | Hidden(gone) | Normal |
| Non-member preview | Hidden | Hidden | Hidden | Hidden | Hidden | Hidden | Visible | Hidden | Normal |
| Web unread sub (INSERT-only) | unaffected¹ | ” | ” | ” | ” | ” | ” | ” | ” |
| Realtime msg payload | Redacted | Redacted | Redacted | Redacted | Redacted | Redacted | Full | — | Normal |
| Realtime poll-vote | Guarded | Guarded | Guarded | Guarded | Guarded | Guarded | Live | — | Normal |
| New signed-URL | Denied | Denied | Denied(gone) | Denied | Denied | Denied | Allowed | Denied | Allowed |
| Prev signed-URL | ≤1h | ≤1h | **404** | 404 | 404 | 404/≤1h | valid | 404 | valid |
| Canonical text | null | null | null | null | null | null | restored | null | present |
| Poll visibility | Hidden | Hidden | Hidden | Hidden | Hidden | Hidden | Visible | Hidden | Normal |
| Report evidence | Founder | Founder | Founder | Founder | Founder | Founder | Founder | removed | Founder |
| Notification visibility | scrubbed² | scrubbed | scrubbed | scrubbed | scrubbed | scrubbed | n/a | scrubbed | normal |
| Retry | n/a(txn) | resume move | resume finalize | finalize | none | **retry+alert** | n/a | n/a | n/a |
| Restoration eligible | no | no | no | **yes** | **yes** | after reconcile | (is) | **no** | n/a |
| Purge eligible | no | no | no | yes | **yes** | after reconcile | via new attempt | (done) | n/a |

¹ Web unread subscribes to `INSERT` only; a delete `UPDATE` never fires it;
`get_unread_summary` must exclude deleted. ² Pending push rows scrubbed/cancelled
(§13); delivered pushes cannot be recalled.

---

## 8. (Change #8) Edge Function `delete-message` orchestration
Steps (returns minimal status; never retained paths/snapshots):
1. Verify JWT. 2. Authorize (sender/officer/custom-group admin). 3. Idempotency
key `(message_id, actor_id, client_attempt_uuid)`; claim/locate the active
attempt. 4. **First PG txn (§4)** → `pending` (DB fail-closed). 5. Storage
retention **copy** to `deleted-retention`; **verify** via size + checksum where
possible → `retained`. 6. **Delete** original object; **verify** old path no
longer resolves → `original_removed`. 7. Finalize DB state → `redacted` →
`completed`. 8. **Return success only when We Glue no longer serves the original to
ordinary users** (through step 6 for managed attachments; immediately after §4 for
non-managed).
**Failure/edge behavior:** duplicate invocation → idempotency no-op returns state;
network/Edge timeout or process crash → DB already fail-closed from step 4;
reconciliation worker (§9) resumes from recorded state; copy-verify fail → retry,
don't advance; original-delete fail → retry, object un-signable meanwhile;
finalize fail → retry (idempotent). **The Storage+PostgreSQL saga is explicitly
NOT one atomic transaction.**

---

## 9. (Change #9) Durable reconciliation worker
- **Mechanism:** a scheduled Edge Function invoked by Supabase Cron (pg_cron
  `net.http_post`) — decision in open questions if a queue table + external runner
  is preferred.
- **Schedule:** e.g. every 1–2 min. **Job-claim query:** `SELECT … FROM
  message_deletion_attempts WHERE state IN ('pending','retained','original_removed',
  'failed_requires_reconciliation') AND reconcile_after <= now() ORDER BY
  started_at FOR UPDATE SKIP LOCKED LIMIT N`. **Locking:** `FOR UPDATE SKIP
  LOCKED` prevents double-processing.
- **Eligible states:** the active set above. **Retry:** bounded
  (`reconcile_tries`) with **exponential backoff** (`reconcile_after`).
  **Max age:** after a threshold or max tries → **dead-letter**
  (`failed_requires_reconciliation` sticky) + **critical alert**.
- **Idempotent transitions:** each step checks current storage/DB state before
  acting. **Alerts:** critical alert on dead-letter / stuck jobs. **Founder
  dashboard visibility (§18):** state, age, tries, last error. **Manual:** retry /
  restore / purge RPCs. **Audit:** every transition writes an audit row.
  **Worker failure:** claimed-but-unfinished jobs are re-eligible after
  `reconcile_after` (no permanent lock). **No attempt remains indefinitely stuck
  without visibility/alerting.**

---

## 10. (Change #7) Restoration — preserves history, all-or-nothing
`admin_restore_message(attempt_id, reason)` (super-admin, audited):
1. Read snapshot + mapping from history. 2. **Move retained file back** to the
original path; verify. If it fails → **abort; message stays deleted** (no partial
restore). 3. One PG txn: restore `content`/attachment cols/`shared_*`; re-insert
poll+options+votes from snapshot; clear `deleted_at`/`deleted_by`; set attempt
`state='restored'`, `restored_at/by`, `restoration_reason`, `restoration_result`.
**Deletion attempts and `deleted_at` history are preserved** (never deleted). A
restored message may be deleted again under a **new** attempt. All-or-nothing
across text / attachment / poll / options / votes / shared refs / search /
previews / Realtime.

---

## 11. (Change #10 + #11) One-to-many report evidence + migration
`reports` remains the canonical workflow table (reason/status/target only). One
report → many private evidence rows:
```
report_evidence ( id uuid pk, report_id uuid references reports(id) on delete cascade,
  evidence_type text check (evidence_type in
    ('message_snapshot','attachment','screenshot','poll','file','related_message','other')),
  related_entity_type text, related_entity_id uuid,
  content_snapshot text, storage_bucket text, storage_path text,
  metadata jsonb, checksum text, created_at timestamptz not null default now() )
```
RLS: **reporter / reported-user / officer / participant / ordinary-authenticated
unreadable** (deny-all to `authenticated`); founder/admin readable **only through a
future audited RPC**; **immutable**; purgeable only via an audited irreversible
operation.
**Migration (prod-data → gated by §19 + explicit approval) — column-`REVOKE` is
NOT the final architecture:** (1) create `report_evidence`; (2) **backfill** all
existing `reports.{content_snapshot,attachment_snapshot,message_*}` →
`report_evidence`; (3) **validate counts**; (4) **validate checksums / deterministic
comparison**; (5) verify every source row has a destination; (6) only then remove
or null the sensitive snapshot data from reporter-readable `reports` rows; (7)
rollback path preserves data **without re-exposing evidence** (e.g. keep it in the
private table, never restore the public columns on rollback); (8) `reports` keeps
status/reason/target/workflow. Correct any linked doc that still says snapshot
fields live on `messages` (already corrected in `schema-map.md`,
`reports-and-moderation.md`, `conversations-channels-messages.md`,
`deletion-and-edit-history.md`).

---

## 12. (Change #12) Poll privacy
Surfaces: `polls`, `poll_options`, `poll_votes`, aggregate totals, voter
identities, `cast_poll_vote` RPC, Realtime publication (`poll_votes` in
`supabase_realtime` 010:40), notifications, poll history, report evidence,
deleted-message helpers. **Deletion:** snapshot poll+options+votes+voters+totals to
founder history; guard the SELECT policies of **all three** tables via
`is_deleted_message()` SECURITY DEFINER so no participant can read or infer
question/options/individual votes/voter identities/totals through any table or via
`cast_poll_vote` (which must reject a deleted poll). Guarded + message-hidden ⇒ no
residual `poll_votes` Realtime leak. **Restoration:** re-insert from snapshot,
clear guards, all-or-nothing. **Purge:** delete snapshot + votes + retained files
permanently.

---

## 13. (Change #13) Notification & push cleanup
Current: message pushes are AFTER-INSERT-on-`messages` → push-only (no inbox rows)
(046:41); the push **body is built from `NEW.content`** (046:1020–1026) and stored
in **`push_queue.body`** via `enqueue_push` (046:437). On deletion:
- **Cancel pending push jobs:** update/delete `push_queue` rows for the message
  where `status='pending'` (scrub `body`/`title` or set cancelled).
- Ensure future notification reads / `get_unread_summary` / conversation previews
  / unread summaries return generic-or-no deleted content; routes cannot fetch
  deleted content (redaction + RLS make the underlying row null/hidden).
- **Boundary:** pushes already delivered to devices (lock-screen payloads) cannot
  be recalled — documented.
- **Tests (§17):** prove pending push body is scrubbed and no new push/notification
  serves deleted content after deletion.

---

## 14. (Change #14) Realtime coverage
- `messages`: soft-delete UPDATE fires on the publication; because §4 nulls content
  **before commit**, the payload has **no original content**. Prove via two-session
  assert.
- `poll_votes`: guarded + message hidden ⇒ deleted poll activity cannot leak.
- Web unread subscription (`useUnreadSummary.ts:82`) is **INSERT-only** → a delete
  UPDATE never fires it; it holds no message content (only bumps a count); the
  `get_unread_summary` RPC must exclude deleted messages.
- Mobile invalidation/refetch: after a delete UPDATE, refetches hit the redacted
  row / RLS-hidden row → nothing sensitive; follow-up queries by ordinary
  subscribers cannot retrieve history/evidence (RLS deny + null content).

---

## 15. (Change #15) SECURITY DEFINER hardening (every new helper/RPC)
Deletion / restoration / purge RPCs, Storage helpers, poll helpers,
report-evidence helpers, deleted-message/-attachment helpers, future admin-read:
explicit safe `search_path` (`pg_catalog, public` or empty + fully schema-qualify);
schema-qualify all objects; `REVOKE ALL … FROM PUBLIC`; grant only the intended
role (none/service-role for admin/purge; `authenticated` only for the user delete
RPC); no object-shadowing; no RLS recursion (read state via SECURITY DEFINER
helpers); avoid message-existence leakage; minimal status return; **never** return
content snapshots or Storage paths to ordinary users; test object-shadowing +
attacker-controlled inputs (foreign `message_id`, path injection into
`storage.foldername`).

---

## 16. (Change #16) OTA evidence (corrected & verified)
| Item | Value |
|---|---|
| Production channel | `production` (both store builds + updates on it) |
| iOS store build 22 runtime | `d644c732…fded642` (commit `b352d050`) |
| Android store build 24 runtime | `6549da75…2836cc` (commit `b352d050`) |
| Current tree fingerprint iOS / Android | `d644c732…` / `6549da75…` → **MATCH** |
| **Latest production OTA update targets** | iOS `d16bac8d…` (build **21**) · Android `de50834c…` (build **22/23**) — **OLDER runtimes**, group "Launch stability…" |
| Implication | the existing latest production OTA does **not** target current store builds 22/24; **a new OTA must be published for each current store runtime** (`d644c732` iOS, `6549da75` Android) |
| Publish-time verification | re-run `eas fingerprint:generate --platform ios/android`; publish only if it still equals `d644c732`/`6549da75` |
| Native module change | none (repoint uses already-bundled supabase-js `functions.invoke`, cf. `accountService.ts:320`) |
| Native EAS build required | **no** |
| Only-the-deletion-call-site changes | `messagingService.ts:194` `rpc('unsend_message')` → `functions.invoke('delete-message')` |
| Rollback | `eas update:rollback` / republish prior update on `production` |
| Before OTA received | client still calls legacy `unsend_message` → §6b behavior (no-attachment: secure; managed-attachment: hard error) |
| After OTA received | client calls the secure Edge Function orchestrator (move-before-success) |

**No OTA is deployed by this document.**

---

## 17. (Change #17) Exact tests
**Roles:** sender · ordinary participant · group creator · custom-group admin ·
club officer · official-chat participant · non-member preview · reporter ·
reported user · ordinary authenticated nonparticipant · service backend · future
founder/admin.
**Scenarios:** concurrent attempts · duplicate Edge calls · attempt-number race
(two txns) · restore-then-delete-again · transaction failure injection · every
state in §7 · message SELECT · `getDirectMessages` · `getChannelMessages` ·
`getNonMemberPreview` · text · attachment metadata · **external/`file://`
pass-through URLs** · polls/options/votes · report evidence · Realtime (messages +
poll_votes + web unread) · push_queue scrub · notification previews · search ·
media/files · prior signed URL (≤1h) · new-signing denial · copy verification ·
original-deletion verification · retained-bucket denial · restoration ·
permanent purge · worker reconciliation (incl. dead-letter/alert) · rollback ·
SECURITY DEFINER hardening (search_path/shadowing/attacker input).
**Method:** Management-API `BEGIN … ROLLBACK` with set JWT claim for RLS/RPC;
two-session live tests for Realtime/Storage; assert denial for every ordinary role
and allow-only-audited for founder.

---

## 18. (Change #18) Operational visibility (future Admin Dashboard — design only)
Deletion-attempts view: filter by state; stuck-job age; retry count; last error;
attachment retention status (copy/delete verification); redaction status; report-
evidence status; manual retry; manual reconciliation; restore; purge; audit
history; critical alerts. **Not built in this task.**

---

## 19. (Change #19) Migration gate
No migration 051 or implementation until 042–044 are **statement/hash
reconciled**. Current status: local 042/043/044 pristine (single files, working
tree == HEAD, commits `e4f9acb1`/`53a88cfd`); remote *effect* confirmed applied
(`universities`, `app_config`, `university_id`, `delete_own_account_atomic`,
`reports` snapshot columns exist in prod); **byte/statement-hash comparison pending
the founder-run `supabase migration list` / `supabase db pull`**. No mismatch
proven → no `supabase migration repair` proposed.

---

## 20. Coordinated rollout & rollback (one privacy release)
Ship together so no interim state leaks: create `message_deletion_attempts` +
`message_attachment_map` + `message_deletion_history` + `report_evidence` +
`deleted-retention` bucket; backfill/validate report evidence; add message SELECT
RLS `deleted_at IS NULL` + deleted-aware storage policy + `is_deleted_message()`/
`is_deleted_attachment()` helpers + poll guards + `push_queue` scrub; replace
`unsend_message` (B2) + deploy `delete-message` Edge Function + reconciliation
worker; OTA-repoint the mobile call site (fingerprint-verified, per current
runtime); backfill the 4 existing soft-deleted messages (prod-data, separate
approval). No window may leave text-safe/attachment-leaks,
attachment-safe/text-leaks, DB-safe/Realtime-leaks, message-hidden/report-snapshot-
or-poll-tables-leak, or message-hidden/push-body-leaks. **Rollback** reverses in
dependency order; restore-from-history before removing redaction; never re-expose
report evidence on rollback.

## 21. Open questions (founder/Codex)
1. Signed-URL residual for legacy no-attachment vs managed: B2 chosen for managed
   (hard error) — confirm the resulting old-client UX is acceptable pre-OTA.
2. Reconciliation runner: Supabase Cron + Edge Function vs external queue runner.
3. Retention bucket name/prefix and lifecycle (purge job cadence).
4. Exact custom-group-admin authorization rule for deletion (`conversations.created_by`?).
5. `get_unread_summary` + notification preview builders: confirm they exclude/omit
   deleted `content` (audit both).
6. The 2 `file://` records: redact-only now, or also flag for data-quality cleanup.

## 22. Codex review package pointer
Evaluate against this doc: corrected client facts (§1), attempt identity (§3),
first-txn atomicity (§4), attachment mapping (§5), retention bucket (§6), legacy
B2 (§6b), state matrix (§7), Edge orchestration (§8), reconciliation worker (§9),
restoration (§10), report evidence + migration (§11), poll privacy (§12), push
cleanup (§13), Realtime (§14), SECURITY DEFINER (§15), OTA (§16), tests (§17),
operational visibility (§18), migration gate (§19). **Codex verdict is external and
pending.**
