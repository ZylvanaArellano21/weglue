# Deleted-Message Privacy — Authoritative Design (v8)

> **Status: DESIGN ONLY. Not implemented.** No migration, no production/data
> change, no mobile change, no OTA publish, no native build, no Supabase deploy.
> Single authoritative artifact for Codex review; supersedes v1–v6. **No migration
> 051, implementation, Edge Function, Supabase policy, production-data backfill,
> OTA, or deployment until 042–044 are statement/hash reconciled (§16).**
>
> Owner (implementer): Claude · Reviewer: Codex · Decision-maker: founder.

## 0. The non-negotiable rule
After a user deletes a message, We Glue must never again *serve* the original —
text, attachment, poll, shared payload — to any ordinary user through queries,
Realtime, search, previews, signed URLs, related tables, notifications/pushes, or
report records. Only the founder/super-admin may inspect retained originals via a
future audited, platform-admin-gated path (retained data stays service-role-only
until it exists). **Boundaries, stated honestly:** We Glue cannot recall content
already downloaded, cached, screenshotted, or copied off-platform; cannot recall a
push already delivered; cannot delete a file it does not host (external /
`file://`).

**Polarity (authoritative):** ordinary product queries and RLS **require
`deleted_at IS NULL`** (exclude deleted rows). Deleted rows are reachable **only**
through future founder/admin history mechanisms, never ordinary product queries.

---

## 1. Corrected current-client query facts (design does NOT depend on client filtering)
A prior draft's "every mobile query filters `deleted_at`" was false. Verified:

| Surface | Function | Filters `deleted_at`? |
|---|---|---|
| Modern thread | `getThreadMessages` (`messagingService.ts:107`) | Yes |
| Direct messages | `getDirectMessages` (`chatService.ts:401`) | **NO** |
| Non-member preview | `getNonMemberPreview` (`chatService.ts:511`) | **NO** |
| Channel messages | `getChannelMessages` (`channelService.ts:312`) | **NO** |
| Media/files/shared/poll-ids/search | `messagingService.ts` 452/475/519/592/628+ | Yes |
| Web unread | `useUnreadSummary.ts:82` `INSERT ON public.messages` + `get_unread_summary` | INSERT-only; RPC must exclude deleted |

**Backend RLS + canonical redaction are mandatory and sufficient on their own.**
Message SELECT RLS gains `deleted_at IS NULL`; redaction nulls content.

## 2. Architecture overview
Approach B — deletion-scrubbing + server orchestration. `messages` stays canonical;
deletion snapshots originals to immutable founder-only retention (DB history + a
dedicated bucket `deleted-message-retention`, §14) then redacts to tombstone-safe
fields. A **first PostgreSQL transaction** makes ordinary DB access fail-closed
atomically (§4); **Edge Function orchestration** (§8) performs the physical
attachment move Postgres cannot. Storage+PostgreSQL is **not** atomic. Both entry
points must be secure: OTA **Edge Function** (`delete-message`) and the **legacy
`unsend_message` RPC** (§5b).

Grounding facts (citations real): message SELECT RLS lacks `deleted_at` filter
(001:808); `unsend_message` (040:177) nulls nothing; snapshots on `reports`
(040:810), reporter-readable (033:66); `chat-attachments` private, participant-read
policy no deleted check (040:883); signed-URL TTL 1h (`chatAttachments.ts:167`);
message content cols = `content, attachment_url, attachment_name, attachment_mime,
attachment_size, shared_event_id, shared_post_id`; `message_type` ∈
`{text,image,video,poll,file,shared_event,shared_post}` (040:49); no reply column;
`messages`+`poll_votes` in `supabase_realtime` (010:39/40); push body from
`NEW.content` (046:1020). Prod: 13 attachment rows — 11 standard, 2 `file://`.

## 3. Current message-deletion & custom-group authorization (cited — preserve as-is)
From `unsend_message` (040:156–180) + group RPCs (040:144,371–477). The new secure
paths MUST reuse exactly this:

| Actor | Delete a message | Manage custom group | Source |
|---|---|---|---|
| Message **sender** | own message (any type) | — | `sender_id=auth.uid()` (040:172) |
| **Conversation creator = custom-group admin** (`group`) | **any** message in that group | add/remove participants, rename, delete group, transfer on leave | `type='group' AND created_by=auth.uid()` (040:175,144,381,410,452,477) |
| **Ordinary group participant** | own messages only | none | not creator |
| **Club officer** (`club_group`/`officer_chat`) | **any** message | via officer RPCs | `is_club_officer(club_id)` (040:174) |
| **Official-chat participant** (non-officer) | own messages only | none | sender-only fallthrough |
| **Future platform admin** | (greenfield) via audited path | — | not yet a concept |

Custom groups: **single admin** = `conversations.created_by` (040:14/89); leaving
transfers admin (040:442–452). Do not change unless the founder explicitly directs.

---

## 4. Preflight, then the initial PostgreSQL transaction
**Preflight failures create NO deletion attempt** (§4a). The first transaction
(§4b) runs only after preflight passes.

### 4a. Preflight (before any attempt exists — Change #2/#3/#4/#5)
Under a short lock / read, establish that the deletion can proceed safely:
- Verify **authorization** (§3).
- **Classify + safely map the attachment** (§6): Category A (managed, mappable),
  B (external/`file://`, nothing to move), or C (appears managed but unmappable).
- Validate the request; confirm the source object exists where a managed mapping
  requires it.

**If authorization fails, the request is invalid, the source object is missing at
preflight, mapping cannot be safely established, the provider is unsupported, or
the attachment is Category C → return a real error and:**
- create **no** `message_deletion_attempt`, **no** deletion history,
- perform **no** canonical redaction, set **no** `deleted_at`,
- perform **no** Storage mutation, **no** push cleanup,
- create **no** dead-lettered attempt,
- expose no content, path, or message-existence information beyond the minimum
  authorized error response.

Optional logging uses a **separate** security-audit or `data_health_diagnostics`
path (§6C), never `message_deletion_attempts`.

### 4b. First PostgreSQL transaction (only after preflight passes; atomic)
One transaction, all-or-nothing, both entry points:
1. `SELECT … FOR UPDATE` lock the `messages` row (re-confirm authorization + that
   the attachment is still Category A managed / B / none — never C here).
2. Compute `attempt_no = 1 + coalesce(max,0)` **inside the lock**; insert
   `message_deletion_attempts` (`idempotency_key`, `entry_point`,
   `attachment_category ∈ {managed, external, none}` §6), `state='pending'`.
3. Snapshot to founder history: `content`; attachment mapping (§6); poll
   question/options/votes/voters/totals; shared refs.
4. Redact canonical content-bearing fields (null all §2 content cols); protect/
   unlink poll (§9).
5. `deleted_at=now()`, `deleted_by=auth.uid()`.
6. Category B/none → `state='completed'`. Category A → `state='pending'` (→ §8).

Any failure inside §4b rolls back the whole transaction — **never a history-only
or redaction-only remnant**. Realtime UPDATE carries the redacted row. DB
fail-closed at commit. (If preflight-class evidence — e.g. missing source object —
is somehow discovered inside §4b before redaction, the transaction rolls back and
raises: still no attempt, no redaction.)

## 5. Deletion attempt identity
```
message_deletion_attempts ( id uuid pk, message_id uuid, attempt_no int,
  idempotency_key text, actor_id uuid, reason text, state text, entry_point text,
  attachment_category text,           -- 'managed' | 'external' | 'none' (NEVER 'unmappable' — Category C creates no attempt, §4a/§6C)
  started_at, updated_at, completed_at, failed_at, failure_reason,
  -- lease + retry (§8)
  claimed_by text, claim_token uuid, claimed_at timestamptz, claim_expires_at timestamptz,
  retry_count int default 0, next_retry_at timestamptz, last_error text, last_attempt_at timestamptz,
  -- dead-letter / manual (§8, Change #2)
  requires_manual_reconciliation boolean not null default false,
  dead_lettered_at timestamptz, dead_letter_reason text, dead_lettered_by text,
  -- restoration (§10-restore)
  restored_at, restored_by, restoration_reason, restoration_result )
```
Constraints: `unique(message_id, attempt_no)`; `unique(idempotency_key)`; partial
unique **active** index over `state in (pending,retained,original_removed,redacted,
failed_requires_reconciliation)`.

**Active states:** `pending, retained, original_removed, redacted,
failed_requires_reconciliation`. **Terminal:** `completed, restored, purged,
aborted`. (Dead-letter is `failed_requires_reconciliation` +
`requires_manual_reconciliation=true`/`dead_lettered_at` — §8.)

### 5b. (Change #4) Exact legacy idempotency-key rule
Old clients send no UUID. The **server** derives a deterministic key from the
deletion-attempt identity — **never `message_id` alone**:
```
idempotency_key = 'legacy:' || message_id || ':' || attempt_no
```
Rule (all inside the `SELECT … FOR UPDATE` lock, §4):
1. Lock the canonical message; inspect its lifecycle.
2. If a **compatible active attempt** exists → reuse it (same `attempt_no`/key);
   repeated calls do not create a new attempt.
3. If the message is **already securely deleted** (redacted + `deleted_at`) →
   return **idempotent success**; create no new attempt/key.
4. If it was **restored** since → compute the **next** `attempt_no` → new key
   `legacy:{id}:{n+1}`.
5. **Concurrent callers** cannot create duplicate attempt numbers: `attempt_no`
   is computed under the row lock and `unique(message_id, attempt_no)` +
   `unique(idempotency_key)` reject a race; the loser reads and returns the
   winner's attempt.
6. **Managed-attachment** legacy call → throw the **B2 `secure_deletion_required`**
   error and **create no deletion attempt or key**; modify nothing.
7. **Competing actors** follow §3 authorization; an equally-authorized caller
   reuses the active attempt, otherwise a controlled conflict is returned.

Edge Function path requires a **real client idempotency key** (unique-enforced;
duplicate returns the existing attempt).

---

## 6. (Change #5/#10) Attachment classification, mapping, fail-closed
Storage policies and workers use the immutable **attempt/history mapping** only —
**never** the redacted canonical row to discover a path later.
```
message_attachment_map ( id uuid pk, attempt_id uuid, message_id uuid,
  storage_provider text, original_bucket text, original_object_path text,
  retained_bucket text, retained_object_path text,
  external_url_type text,   -- null|'http'|'file'|'other'
  original_url text, size bigint, mime text, checksum text,
  copy_status text, copy_verified_at timestamptz,
  delete_status text, delete_verified_at timestamptz,
  mapping_confidence text,  -- 'high'|'low'|'none'
  mapping_error text )
```
**A. Managed and mapped** (`chat-attachments/{conv}/{uuid}.ext`, confidence high):
retention copy → verify (size+checksum) → original delete → verify gone → finalize.

**B. External / device-local** (`file://`, third-party, non-We-Glue host — prod: 2
`file://`): redact canonical URL + metadata; **do not claim deletion of the
external/device-local file**; preserve historical metadata in founder history where
appropriate; add a **data-health diagnostic**; **prevent future `file://`
records** (client validation + insert CHECK/trigger — separate task).
`state='completed'`.

**C. Appears managed but unmappable** (confidence none) — a **preflight** failure
(§4a), detected **before any attempt exists**. V1 behavior:
- return a **real error**; return **no** deletion success,
- **create no deletion attempt** and **no deletion history**,
- **leave the canonical message unchanged**; leave `deleted_at` unchanged,
- perform **no** Storage mutation and **no** push cleanup,
- create only a **separate safe data-health/manual-review diagnostic** (below).

**Quarantine is NOT part of v1** — a separate quarantine system requires a future
reviewed design. Category C is therefore **excluded** from deletion-attempt
dead-letter conditions, reconciliation-worker automatic claims, and the post-attempt
failure taxonomy (§8).

**Category-C diagnostic (design-only; NOT a generic diagnostics platform):**
```
data_health_diagnostics ( id uuid pk, diagnostic_type text,   -- e.g. 'unmappable_attachment'
  related_entity_type text, related_entity_id uuid, severity text,
  safe_metadata jsonb, status text,                            -- 'open'|'resolved'
  created_at timestamptz, resolved_at timestamptz )
```
It lives **outside** `message_deletion_attempts` and is **never** claimable by the
deletion worker. `safe_metadata` must **not** expose message content, retained
content, attachment secrets, signed URLs, or service-role information.

Privacy redaction ≠ physical deletion of an object outside We Glue's control.

---

## 7. (Change #3) State matrix — honest signed-URL semantics
A prev-issued signed URL (self-contained JWT, ≤1h) stays usable **until the
original object is verified removed** (`original_removed`). **Deletion success is
never reported before original-object removal is verified** (Category A).

| Dimension | pending | retained | original_removed | redacted | completed | failed_requires_reconciliation |
|---|---|---|---|---|---|---|
| Ordinary DB SELECT (all loaders) | Hidden | Hidden | Hidden | Hidden | Hidden | Hidden |
| Non-member preview | Hidden | Hidden | Hidden | Hidden | Hidden | Hidden |
| Canonical text | null | null | null | null | null | null |
| New signed-URL | Denied | Denied | Denied | Denied | Denied | Denied |
| **Prev-issued signed-URL** | valid ≤1h | valid ≤1h | **invalid (verified removed)** | invalid | invalid | invalid if removed; else ≤1h until move done |
| Realtime msg payload | Redacted | Redacted | Redacted | Redacted | Redacted | Redacted |
| Realtime poll-vote | Guarded | Guarded | Guarded | Guarded | Guarded | Guarded |
| Poll visibility | Hidden | Hidden | Hidden | Hidden | Hidden | Hidden |
| Report evidence | Founder | Founder | Founder | Founder | Founder | Founder |
| Notification/push | scrubbed | scrubbed | scrubbed | scrubbed | scrubbed | scrubbed |
| Retry | n/a(txn) | resume move | resume finalize | finalize | none | see §8 (retryable vs dead-letter) |
| Restoration eligible | no | no | no | yes | yes | after manual reconcile |
| Purge eligible | no | no | no | yes | yes | after manual reconcile |

Terminal `restored`/`purged`/`aborted` (only before redaction commits) as before.
No failed state exposes DB content or a new signed URL; the only residual is a
prev-issued URL until `original_removed`.

---

## 8. (Change #1/#2/#3/#5) Edge Function + lease-based reconciliation
**Never hold a DB row lock during Storage network I/O.** Lease + retry + dead-letter
fields live on `message_deletion_attempts` (§5).

### 8a. `delete-message` Edge Function
JWT verify → authorize (§3) → require+enforce unique idempotency key → claim/locate
the active attempt → first PG txn (§4) → `pending` → (A) retention copy + verify
(size+checksum) → `retained` → delete original + verify gone → `original_removed`
→ finalize → `redacted` → `completed`. Minimal status; never retained paths/
snapshots. Duplicate invocation → idempotent no-op. **Return success only when We
Glue no longer serves the original.** Not atomic across Storage+PostgreSQL.

### 8b. Lease/timeout defaults (initial; adjust only with a documented reason)
- **Claim lease: 5 minutes.** **Heartbeat: every 60 s.** **Renew when < 2 min
  remain** (heartbeat CAS extend requiring the valid `claim_token`).
- **Per-Storage-operation timeout ≈ 90–120 s.** **Work unit = one message
  attachment/object per claim.**
- **No long database transaction during Storage work.** Stale workers cannot
  update after lease loss (CAS rejects). Expired leases may be recovered by another
  worker. Long workflows decomposed into bounded steps. **Respect Edge wall-clock
  and idle-time limits; do not treat background execution as guaranteed beyond
  platform limits.**

### 8c. Exact automatic-worker claim predicate
A worker may claim an attempt **only when all hold**:
- `state` is **retryable** (`pending`, `retained`, `original_removed`, or
  `failed_requires_reconciliation`),
- `requires_manual_reconciliation = false`,
- `dead_lettered_at IS NULL`,
- `next_retry_at IS NULL OR next_retry_at <= now()`,
- `claim_expires_at IS NULL OR claim_expires_at < now()`,
- `retry_count < automatic_retry_limit`.

Claim flow (Change #1): short PG txn → select ONE eligible attempt `… FOR UPDATE
SKIP LOCKED LIMIT 1` → assign lease (`claim_token`, `claimed_by`, `claimed_at`,
`claim_expires_at`) → **commit immediately** → Storage work **outside** any txn →
**compare-and-set** transitions require matching `id` + `claim_token` + expected
`state`; zero rows updated ⇒ stale worker aborts.

**Scope (Change #7):** the predicate applies **only to rows in
`message_deletion_attempts`**. Workers must **never** claim security-audit events,
`data_health_diagnostics`, unauthorized requests, or Category-C diagnostics — none
of which are deletion attempts — and never a **dead-lettered** attempt unless an
audited manual retry has cleared `requires_manual_reconciliation`.

### 8d. Retryable failure vs dead-letter — active-saga only (Change #2/#3/#4/#5/#6)
This taxonomy applies **only after an authorized attempt exists and §4b
committed**. It **never** includes: unauthorized requests, Category-C preflight
failures, invalid input, or unsupported/preflight attachment-mapping failures —
those are **preflight** (§4a) and create no attempt.
- **Retryable failure** (active saga): temporary network error, Storage **5xx**,
  request timeout, lease loss, recoverable worker crash, temporary verification
  failure. Set `state='failed_requires_reconciliation'`, increment `retry_count`,
  set `next_retry_at = now() + backoff(retry_count)`, record `last_error`.
  Automatic workers may reclaim (predicate §8c).
- **Transition to dead-letter/manual** when **any**: `retry_count >= max_retry`
  (default **8**); OR attempt age > `max_attempt_age` (default **24 h**); OR a
  **non-retryable active-saga** error — repeated checksum mismatch, missing
  retained copy after redaction, integrity-invariant failure, or a **permanent
  post-attempt Storage failure** (§8e case B). Set
  `requires_manual_reconciliation=true`, `dead_lettered_at=now()`,
  `dead_letter_reason`, `dead_lettered_by='worker'`; raise a **critical alert**.
  Never automatically retry a permanent failure forever; never re-expose canonical
  content automatically.
- **Once dead-lettered:** automatic workers must not claim it; Cron must ignore it;
  only an **explicit audited manual retry** may clear `requires_manual_reconciliation`
  and schedule **one** controlled attempt (reset `next_retry_at`, keep history);
  the future Admin Dashboard shows it as a **critical unresolved privacy
  operation**. **Manual restore** eligible (if redaction committed);
  **purge** eligible after manual reconciliation.
- **Schedule:** Supabase Cron invokes the worker every 1–2 min (open question:
  external runner). No attempt remains indefinitely stuck without visibility/
  alerting.

### 8e. Permanent Storage `4xx` classification (Change #5) — not automatically one category
- **A. Preflight `4xx`** (source object missing before attempt creation; caller
  lacks authorization; object mapping invalid before deletion begins): this is a
  **preflight** case (§4a) → **no attempt, no redaction, no history, no mutation**;
  return a real error; optional safe diagnostic. It is **not** a deletion-attempt
  failure or dead-letter.
- **B. Post-attempt `4xx`** (original object becomes unavailable after retention/
  redaction work began; retained object disappears during an active saga; permanent
  provider rejection after canonical redaction committed): behavior depends on
  whether the privacy guarantee can be **proven** —
  - if the original is **verified absent** and canonical data is **redacted**, the
    worker may continue toward safe finalization (privacy already satisfied);
  - if object state **cannot be proven**, enter **manual reconciliation**
    (dead-letter per §8d);
  - do **not** automatically retry permanent failures forever; **never re-expose
    canonical content automatically**.

---

## 9. Poll privacy
Cover `polls`, `poll_options`, `poll_votes`, `cast_poll_vote`, totals, voter
identities, Realtime (`poll_votes` 010:40), notifications, report evidence, restore,
purge. **Every permissive SELECT policy on the three poll tables AND `cast_poll_vote`
must check deletion state** via `is_deleted_message()` SECURITY DEFINER so no
participant can read/infer question/options/votes/voters/totals or vote on a deleted
poll. Snapshot to founder history on delete; restore re-inserts (all-or-nothing);
purge deletes snapshot+votes+files.

## 10. (Change #6) Structured push provenance & cleanup
Today: message pushes AFTER INSERT ON messages (046:41); body from `NEW.content`
(046:1020); matching relies on `dedupe_key`. **Future `push_queue` schema** — add
**nullable** structured provenance:
`source_type`, `source_message_id`, `source_conversation_id`, `source_channel_id`,
`source_event_id` (when relevant).
**Indexes (at least):** `idx_push_queue_source_message` on `source_message_id`;
composite `(source_type, source_message_id)`; plus the index supporting pending-job
deletion/scrubbing (`(source_message_id) WHERE status='pending'`).
**Function changes:** `enqueue_push` accepts + populates the structured provenance;
`handle_message_push` sets `source_type='message'`, `source_message_id`, and
conversation/channel ids when available; **retry paths preserve** the structured
provenance; deletion cleanup **must not rely only on parsing `dedupe_key`**.
**Existing queue rows (compatibility):** parse `dedupe_key` only when its format is
verified; **never scrub/delete unrelated jobs on an ambiguous match**; mark
unparseable rows for data-health/manual review; **already-delivered pushes cannot be
recalled**.
**On deletion:** cancel unsent message pushes (by `source_message_id`, else
verified-parse fallback); scrub pending `body`+`title`; ensure retry cannot
regenerate original content (source row is redacted); update/hide user-readable
notification rows; keep only generic non-content metadata where product requires.

### Restoration (all-or-nothing, founder-only, audited)
`admin_restore_message(attempt_id, reason)`: move retained file back + verify (fail
⇒ stays deleted); one PG txn restores content/attachment/`shared_*` + re-inserts
poll/options/votes; clears `deleted_at`; sets `state='restored'` +
`restored_at/by/reason/result`. Deletion attempts + `deleted_at` history preserved;
a restored message may be deleted again (new attempt). Covers text/attachment/poll/
options/votes/shared/search/previews/Realtime.

## 11. One-to-many report evidence + migration
`reports` = canonical workflow (reason/status/target). One report → many private
`report_evidence` rows (`evidence_type`, related entity, `content_snapshot`,
`storage_bucket`/`storage_path`, `checksum`, `metadata`). RLS: reporter/reported-
user/officer/participant/ordinary-authenticated **unreadable** (deny-all); founder/
admin via future **audited RPC**; **immutable**; audited irreversible purge. **No
final architecture depends on reporter-readable `reports` retaining snapshot
columns.** Migration: create → backfill → validate counts → validate checksums →
verify every source has a destination → only then null/remove reporter-readable
snapshot values → rollback preserves evidence privately and **never re-exposes** it.

## 12. SECURITY DEFINER hardening (every new helper/RPC)
Explicit safe `search_path`; schema-qualify; `REVOKE ALL … FROM PUBLIC`; minimal
EXECUTE grants (service-role/none for admin/purge; `authenticated` only for the user
delete RPC); **no browser service-role**; no policy recursion; no object-shadowing;
minimal status return; **never** return snapshots/paths to ordinary users; attacker-
input tests (foreign `message_id`, path injection into `storage.foldername`). Covers
deletion/restoration/purge/Storage/poll/report-evidence/deleted-message &
-attachment helpers/future admin-read.

---

## 13. Tests
Roles: sender · ordinary participant · group creator/admin · club officer ·
official-chat participant · non-member preview · reporter · reported user · ordinary
authenticated nonparticipant · service backend · future founder/admin.

**Core:** every state (§7) · message SELECT · `getDirectMessages` ·
`getChannelMessages` · `getNonMemberPreview` · text · attachment metadata ·
external/`file://` · polls/options/votes · report evidence · Realtime
(messages+poll_votes+web unread) · search · media/files · prior signed URL before
vs after original-delete · new-sign denial · copy/original-delete verification ·
retained-bucket denial · restoration · permanent purge · rollback · SECURITY
DEFINER hardening · custom-group authorization (each actor).

**Preflight — no attempt created (Change #3/#4/#5):**
- **Unauthorized delete creates zero mutations** — no attempt, no history, no
  dead-letter, no redaction, no `deleted_at`, no Storage change, no push change;
  denied-action audit (if any) exposes no message existence/content/path.
- **Category-C request creates no deletion attempt** and only an approved **safe
  diagnostic**; the diagnostic contains **no** sensitive content or path.
- **Preflight missing Storage object creates no attempt** (no redaction/mutation).
- Automatic workers **never claim** `data_health_diagnostics` or audit events.

**Post-attempt Storage failure (Change #5):** a permanent post-attempt Storage
failure **enters manual reconciliation** where safety cannot be proven (else safe
finalization if original verified absent + redacted); permanent failures are not
retried forever; canonical content is never re-exposed automatically.

**Legacy idempotency (Change #4):** duplicate legacy call (idempotent, one attempt)
· concurrent legacy calls (no duplicate `attempt_no`) · restore-then-delete-again
(new attempt/key) · actor conflicts (authz/conflict) · managed-attachment legacy
call throws B2 **with zero data changes** (no `deleted_at`/content/attachment/poll/
push mutation, no attempt/key created).

**Push cleanup (Change #7):** pending push linked by `source_message_id` is
cancelled/scrubbed · an unrelated push is untouched · an unparseable legacy row is
**not** removed · retries cannot regenerate deleted content · notification rows/
preview routes do not serve deleted content · rollback does not re-expose stored
push bodies.

**Worker timeout/crash (Change #8):** timeout during retention copy · crash after
copy before original-delete · crash after original-delete before finalization ·
heartbeat renewal · heartbeat failure · lease expiration · stale claim-token
rejection (CAS zero rows) · duplicate workers · **dead-letter not auto-reclaimed** ·
manual retry re-enables exactly one controlled attempt · max-retry transition to
manual reconciliation.

Method: Management-API `BEGIN … ROLLBACK` with set JWT claim for RLS/RPC; two-session
live tests for Realtime/Storage; assert denial for every ordinary role, allow-only-
audited for founder.

## 14. Retention bucket
Initial name **`deleted-message-retention`** (private; may change only if repo
naming standards require). No ordinary/participant/officer access, no public URLs,
no browser service-role, no ordinary signed-URL generation; access only via future
audited founder/admin operations. **No automatic purge in v1** (deliberate audited
manual op).

## 15. Operational visibility (future Admin Dashboard — design only)
Fields: attempt ID · message · state · actor · reason · started · age · retry_count
· next_retry · claim owner (`claimed_by`) · claim expiration (`claim_expires_at`) ·
`requires_manual_reconciliation` · `dead_lettered_at`/reason · last_error ·
attachment mapping status · retention-copy status · original-delete status ·
redaction status · push cleanup status · report-evidence status · poll cleanup
status · manual retry · manual reconciliation · restore · purge · audit history ·
critical alerts (dead-letter = critical unresolved privacy op). **Not built here.**

## 16. Migration gate
No migration 051, implementation, Edge Function, Supabase policy, production-data
backfill, OTA, or deployment until 042–044 are **statement/hash reconciled**.
Status: local 042/043/044 pristine (commits `e4f9acb1`/`53a88cfd`, working tree ==
HEAD); remote *effect* confirmed applied; **byte/hash comparison pending founder-run
`supabase migration list` / `supabase db pull`**; no mismatch proven → no `migration
repair` proposed.

## 17. OTA evidence (verified; unchanged since v5)
Channel `production`. Store builds: iOS 22 runtime `d644c732…`, Android 24 runtime
`6549da75…` (commit `b352d050`). Current tree fingerprints **match** both. **Latest
production OTA targets OLDER runtimes** (iOS `d16bac8d…` build 21, Android
`de50834c…` build 22/23) → a **new OTA must be published per current store runtime**;
verify with `eas fingerprint:generate` at publish time. Repoint is JS-only
(`messagingService.ts:194` → `functions.invoke('delete-message')`, already-bundled
supabase-js) — **no native module / no native EAS build**; rollback via `eas
update:rollback`. **No OTA deployed here.**

## 18. Coordinated rollout & rollback
One privacy release (attempts + attachment_map + history + report_evidence +
`deleted-message-retention`; report-evidence backfill/validate; message SELECT RLS
`deleted_at IS NULL` + deleted-aware storage policy + `is_deleted_message()`/
`is_deleted_attachment()` + poll guards + `push_queue` `source_*` + indexes + scrub;
replace `unsend_message` B2 + `delete-message` Edge + lease worker + Cron; OTA
repoint per runtime; backfill 4 existing soft-deleted rows — prod-data, separate
approval). No interim window may leak text/attachment/Realtime/report-snapshot/poll/
push. Rollback reverses in dependency order; restore-from-history before removing
redaction; never re-expose report evidence.

## 19. Open questions
1. Reconciliation runner: Supabase Cron + Edge vs external runner.
2. Confirm defaults: lease 5 min / heartbeat 60 s / renew < 2 min / op 90–120 s /
   max_retry 8 / max_attempt_age 24 h.
3. B2 pre-OTA old-client UX acceptable (managed-attachment delete errors).
4. Audit `get_unread_summary` + notification preview builders exclude deleted
   `content`.
5. Category-B `file://` prevention (client validation + insert CHECK).
6. Retained-bucket purge cadence (manual-only v1).

## 20. Codex review package pointer
Evaluate: §1 client facts · §3 authorization · §4 first-txn · §5/§5b idempotency ·
§6 attachment categories/mapping · §7 signed-URL semantics · §8 lease worker +
retryable/dead-letter split + claim predicate + defaults · §9 poll · §10 push
provenance/cleanup + restore · §11 report evidence · §12 SECURITY DEFINER · §13
tests · §14 bucket · §15 op visibility · §16 gate · §17 OTA. **Codex verdict is
external and pending.**
