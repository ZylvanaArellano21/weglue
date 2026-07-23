# Deleted-Message Privacy — Authoritative Design (v6)

> **Status: DESIGN ONLY. Not implemented.** No migration, no production/data
> change, no mobile change, no OTA publish, no native build, no Supabase deploy.
> Single authoritative artifact for Codex review; supersedes v1–v5. **No migration
> 051, Edge Function, policy change, OTA, or data backfill until 042–044 are
> statement/hash reconciled (§16).**
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
push already delivered to a device; and cannot delete a file it does not host
(external / `file://` device-local).

---

## 1. Corrected current-client query facts (design does NOT depend on client filtering)
Verified — a prior draft's "every mobile query filters `deleted_at`" was false:

| Surface | Function | Filters `deleted_at`? |
|---|---|---|
| Modern thread | `getThreadMessages` (`messagingService.ts:107`) | Yes |
| Direct messages | `getDirectMessages` (`chatService.ts:401`) | **NO** |
| Non-member preview | `getNonMemberPreview` (`chatService.ts:511`) | **NO** |
| Channel messages | `getChannelMessages` (`channelService.ts:312`) | **NO** |
| Media / files / shared / poll-ids / search | `messagingService.ts` 452/475/519/592/628+ | Yes |
| Web unread | `useUnreadSummary.ts:82` `INSERT ON public.messages` + `get_unread_summary` RPC | INSERT-only sub; RPC must exclude deleted |

**Backend RLS + canonical redaction are mandatory and sufficient on their own.**
The message SELECT RLS gains `deleted_at IS NULL` (new); redaction nulls content.

## 2. Architecture overview
Approach B — deletion-scrubbing + server orchestration. `messages` stays
canonical; deletion snapshots originals to **immutable founder-only retention** (DB
history + a dedicated bucket `deleted-message-retention`, §14) then redacts the row
to tombstone-safe fields. A **first PostgreSQL transaction** makes ordinary DB
access fail-closed atomically (§4); **Edge Function orchestration** (§8) performs
the physical attachment move Postgres cannot. The Storage+PostgreSQL saga is **not**
atomic. Two entry points must both be secure: OTA **Edge Function**
(`delete-message`) and the **legacy `unsend_message` RPC** (§6b).

Grounding facts (citations real): message SELECT RLS lacks `deleted_at` filter
(001:808); `unsend_message` (040:177) nulls nothing; snapshots on `reports`
(040:810), reporter-readable (033:66); `chat-attachments` private, participant-read
policy no deleted check (040:883); signed-URL TTL 1h (`chatAttachments.ts:167`);
`messages` content cols = `content, attachment_url, attachment_name,
attachment_mime, attachment_size, shared_event_id, shared_post_id`; `message_type`
∈ `{text,image,video,poll,file,shared_event,shared_post}` (040:49); no reply column;
`messages`+`poll_votes` in `supabase_realtime` (010:39/40); push body from
`NEW.content` (046:1020). Prod: 13 attachment rows — 11 standard paths, 2 `file://`
device URIs (unmanaged).

---

## 3. (Change #9) Current message-deletion & custom-group authorization (cited — preserve as-is)
From `unsend_message` (040:156–180) and the group RPCs (040:144, 371–477). **The
new secure paths MUST reuse exactly this authorization.**

| Actor | Delete a message | Manage custom group | Source |
|---|---|---|---|
| Message **sender** | own message, any conversation type | — | `m.sender_id = auth.uid()` (040:172) |
| **Conversation creator = custom-group admin** (`group` type) | **any** message in that group | add/remove participants, rename, delete group, transfer on leave | `type='group' AND created_by=auth.uid()` (040:175, 144, 381, 410, 452, 477) |
| **Ordinary group participant** | own messages only | none | not creator |
| **Club officer** (`club_group`/`officer_chat`) | **any** message in that chat | via officer RPCs | `is_club_officer(club_id)` (040:174) |
| **Official-chat participant** (non-officer) | own messages only | none | falls through to sender-only |
| **Future platform admin** | (greenfield) via audited admin path | — | not yet a concept |

Custom groups have a **single administrator** = `conversations.created_by`
(040:14/89); leaving transfers admin (040:442–452). Do not change this behavior
unless the founder explicitly directs it.

---

## 4. (Change #2 first-txn) Initial PostgreSQL transaction (atomic; no partial state)
One transaction, all-or-nothing, both entry points:
1. `SELECT … FOR UPDATE` lock the `messages` row.
2. Verify authorization (§3).
3. Compute `attempt_no = 1 + coalesce(max,0)` (inside the lock); insert
   `message_deletion_attempts` (`idempotency_key`, `entry_point`,
   attachment category §7), `state='pending'`.
4. Snapshot to founder history: `content`; **attachment mapping (§6)**; poll
   question/options/votes/voters/totals; shared refs.
5. Redact canonical content-bearing fields (null `content`, `attachment_url`,
   `attachment_name`, `attachment_mime`, `attachment_size`, `shared_event_id`,
   `shared_post_id`); protect/unlink poll (§9).
6. `deleted_at = now()`, `deleted_by = auth.uid()`.
7. Category B (external/device-local) or no-attachment → `state='completed'`.
   Category A (managed) → `state='pending'` for §8. Category C (unmappable) →
   **roll back everything and raise error** (§7C) — no deletion recorded.

If any step fails, the whole transaction rolls back — **never a history-only or
redaction-only remnant**. Realtime UPDATE carries the already-redacted row (no
original content). DB access fail-closed at commit.

## 5. (Change #2) Deletion attempt identity & deterministic legacy idempotency
```
message_deletion_attempts ( id uuid pk, message_id uuid, attempt_no int,
  idempotency_key text, actor_id uuid, reason text, state text, entry_point text,
  attachment_category text,           -- 'managed' | 'external' | 'unmappable' | 'none'
  started_at, updated_at, completed_at, failed_at, failure_reason,
  -- lease + retry (§8)
  claimed_by text, claim_token uuid, claimed_at timestamptz, claim_expires_at timestamptz,
  retry_count int default 0, next_retry_at timestamptz, last_error text, last_attempt_at timestamptz,
  -- restoration (§10)
  restored_at, restored_by, restoration_reason, restoration_result )
```
Constraints: `unique(message_id, attempt_no)`; `unique(idempotency_key)`; partial
unique **active** index over `state in (pending,retained,original_removed,redacted,
failed_requires_reconciliation)`.

**Edge Function path:** requires a real client idempotency key; uniqueness enforced;
a duplicate request returns the existing attempt.

**Legacy `unsend_message` (no idempotency key) — deterministic server behavior:**
1. `SELECT … FOR UPDATE` lock the message.
2. If a **compatible active attempt** exists → reuse/resume it (return its state).
3. If the message is **already securely deleted** (redacted + `deleted_at`) →
   return **idempotent success** (no-op).
4. If it was **restored** since → create the **next** attempt number.
5. If a **competing active attempt by another actor** exists → return a controlled
   **conflict** (or reuse per §3 authorization if the caller is equally
   authorized).
6. If the message has a **We-Glue-managed attachment** → throw the **B2
   `secure_deletion_required`** error, modifying **nothing**: not `deleted_at`, not
   content, not attachment metadata, not poll data, not push state.

Documented: duplicate call (idempotent), network retry (idempotent),
restore-then-delete (new attempt), concurrent-actor (conflict/reuse per authz).

---

## 6. (Change #4/#5) Attachment classification, mapping, and fail-closed behavior
**Do not use the redacted canonical message row to discover an object path later.**
Storage policies and workers use the immutable **attempt/history mapping** only.

```
message_attachment_map ( id uuid pk, attempt_id uuid, message_id uuid,
  storage_provider text,        -- 'supabase' | 'external' | 'device_local'
  original_bucket text, original_object_path text,
  retained_bucket text, retained_object_path text,
  external_url_type text,       -- null | 'http' | 'file' | 'other'
  original_url text, size bigint, mime text, checksum text,
  copy_status text, copy_verified_at timestamptz,
  delete_status text, delete_verified_at timestamptz,
  mapping_confidence text,      -- 'high' | 'low' | 'none'
  mapping_error text )
```

**Category A — managed and mapped:** known Supabase bucket + object path (parses to
`chat-attachments/{conv}/{uuid}.ext`, `mapping_confidence='high'`). Full path:
retention copy → verify (size+checksum) → original delete → verify gone →
finalize.

**Category B — external / device-local** (`file://`, third-party URL, non-We-Glue
host — prod-verified: 2 `file://` device URIs): redact the canonical URL + metadata;
**do not claim deletion of the external/device-local file**; preserve historical
metadata in founder-only history where appropriate; add a **data-health
diagnostic**; **prevent future `file://` production records** (client validation +
a CHECK/trigger rejecting `file:`/non-storage schemes on insert — separate task).
`state='completed'` after DB redaction (nothing to move).

**Category C — appears managed but unmappable** (unexpected shape, missing object,
`mapping_confidence='none'`): **do not report successful deletion; do not guess the
path; fail with a real error;** create/update a reconciliation diagnostic; require
manual review; **preserve content unchanged** unless a separately approved
fail-closed **quarantine** workflow exists. The first txn (§4 step 7) rolls back.

**Privacy redaction ≠ physical deletion.** Category B/C: We Glue controls only the
DB reference (redacted); it makes no claim to have deleted an object outside its
control.

---

## 7. (Change #3) State matrix — honest signed-URL semantics
Corrected: an incomplete state does **not** magically invalidate previously issued
signed URLs. A prev-issued URL (self-contained JWT, ≤1h TTL) remains usable **until
the original object is verified removed** (`original_removed`). **Deletion success
is never reported before original-object removal is verified** (Category A).

| Dimension | pending | retained | original_removed | redacted | completed | failed_requires_reconciliation |
|---|---|---|---|---|---|---|
| Ordinary DB SELECT (all loaders) | Hidden | Hidden | Hidden | Hidden | Hidden | Hidden |
| Non-member preview | Hidden | Hidden | Hidden | Hidden | Hidden | Hidden |
| Canonical text | null | null | null | null | null | null |
| New signed-URL | Denied | Denied | Denied | Denied | Denied | Denied |
| **Prev-issued signed-URL** | **valid ≤1h** | **valid ≤1h** | **invalid (object removed+verified)** | invalid | invalid | invalid if removed; else ≤1h until move done |
| Realtime msg payload | Redacted | Redacted | Redacted | Redacted | Redacted | Redacted |
| Realtime poll-vote | Guarded | Guarded | Guarded | Guarded | Guarded | Guarded |
| Poll visibility | Hidden | Hidden | Hidden | Hidden | Hidden | Hidden |
| Report evidence | Founder | Founder | Founder | Founder | Founder | Founder |
| Notification/push | scrubbed | scrubbed | scrubbed | scrubbed | scrubbed | scrubbed |
| Retry | n/a(txn) | resume move | resume finalize | finalize | none | **retry+alert** |
| Restoration eligible | no | no | no | yes | yes | after reconcile |
| Purge eligible | no | no | no | yes | yes | after reconcile |

Terminal `restored` (content visible again, via audited restore) and `purged`
(gone even to founder) and `aborted` (only before redaction commits) as in v5.
**No failed state exposes DB content or a new signed URL**; the only residual is a
prev-issued URL until `original_removed` — explicitly documented, not hidden.
After successful deletion We Glue no longer serves the original from the old path;
content already downloaded/cached/screenshotted/copied off-platform cannot be
erased.

---

## 8. (Change #1) Edge Function + lease-based reconciliation (no DB lock during Storage)
### 8a. `delete-message` Edge Function
Verify JWT → authorize (§3) → require + enforce unique idempotency key → claim/
locate the active attempt → **first PG txn (§4)** → `pending` → (Category A) storage
retention copy + verify (size+checksum) → `retained` → delete original + verify
gone → `original_removed` → finalize → `redacted` → `completed`. Return **minimal
status**; never retained paths/snapshots. Duplicate invocation → idempotent no-op
returns state. **Return success only when We Glue no longer serves the original.**
Timeout/crash after any step → DB already fail-closed; the lease worker (below)
resumes. **Not atomic across Storage+PostgreSQL.**

### 8b. Lease-based reconciliation worker
**Never hold `FOR UPDATE SKIP LOCKED` (or any row lock) while doing Storage
network I/O.** Lease fields live on `message_deletion_attempts` (§5).

Claim flow:
1. Worker opens a **short** PG transaction.
2. Select ONE eligible attempt (`state IN (pending,retained,original_removed,
   failed_requires_reconciliation)` AND `next_retry_at <= now()` AND
   (`claim_expires_at IS NULL` OR `claim_expires_at < now()`)) `ORDER BY started_at
   FOR UPDATE SKIP LOCKED LIMIT 1`.
3. Row lock used **only to assign the lease**.
4. Generate a unique `claim_token` (uuid); set `claimed_by`, `claimed_at`,
   `claim_expires_at = now() + lease_duration`.
5. Commit immediately (releases the row lock).
6. Perform Storage work **outside** any transaction.
7. **Compare-and-set** state updates require matching `id` + `claim_token` +
   expected current `state`:
   `UPDATE … SET state=$next, … WHERE id=$id AND claim_token=$tok AND state=$expected`.
   Zero rows updated ⇒ **stale worker** (lease expired / reassigned) ⇒ abort quietly.
8. Expired lease ⇒ another worker may re-claim (step 2 condition).

Specify: **lease_duration** ≈ 2–5 min (must exceed a single storage op);
**renewal** via a heartbeat CAS extend if a step runs long; **eligible states** as
above; **retry limit** N (e.g. 8) via `retry_count`; **exponential backoff** via
`next_retry_at`; **max age** threshold → **dead-letter** = sticky
`failed_requires_reconciliation` + **critical alert**; **manual** retry /
reconciliation / restore / permanent purge via founder RPCs; **audit** every
transition. **Schedule:** Supabase Cron invoking the worker Edge Function every
1–2 min (open question: external runner alternative). No attempt remains
indefinitely stuck without visibility/alerting.

---

## 9. (Change #8) Poll privacy
Cover `polls`, `poll_options`, `poll_votes`, `cast_poll_vote`, totals, voter
identities, Realtime (`poll_votes` 010:40), notifications, report evidence, restore,
purge. **Every permissive SELECT policy on the three poll tables AND
`cast_poll_vote` must check deletion state** via `is_deleted_message()` SECURITY
DEFINER so no participant can read/infer question/options/votes/voters/totals or
vote on a deleted poll. Snapshot to founder history on delete; restore re-inserts
from snapshot (all-or-nothing); purge deletes snapshot+votes+files.

## 10. (Change #6) Structured push provenance & cleanup
`push_queue` today lacks a reliable structured message relationship (body from
`NEW.content` 046:1020; matching relies on `dedupe_key`). Add fields:
`source_type`, `source_message_id`, `source_conversation_id`, `source_channel_id`,
`source_event_id` (where relevant).
- **New message pushes:** populate structured `source_*` at enqueue; **do not rely
  on `dedupe_key` parsing**.
- **Existing queued rows (compatibility):** parse only when the format is verified;
  **do not delete unrelated push jobs**; identify unparseable rows → mark for
  data-health/manual review.
- **On deletion:** cancel unsent message pushes (by `source_message_id` when
  present, else verified-parse fallback); scrub pending `body`+`title`; ensure
  retry cannot regenerate original content (the source row is redacted); update/
  hide user-readable notification rows; keep only generic non-content metadata
  where product requires. **Delivered pushes cannot be recalled** (documented).

## 11. (Change #7) One-to-many report evidence + migration
`reports` stays the canonical workflow table; one report → many private
`report_evidence` rows (`evidence_type`, related entity, `content_snapshot`,
`storage_bucket`/`storage_path`, `checksum`, `metadata`). RLS: reporter / reported-
user / officer / participant / ordinary-authenticated **unreadable** (deny-all);
founder/admin readable only via a future **audited RPC**; **immutable**; purge only
via audited irreversible op. **No final architecture depends on reporter-readable
`reports` retaining snapshot columns.** Migration: create → backfill → validate
counts → validate checksums → verify every source row has a destination → only then
null/remove the reporter-readable snapshot values → rollback preserves evidence in
the private table and **never re-exposes** it on the public row. (Correct linked
docs done: `canonical-sources-of-truth.md`.)

## 12. (Change #10) SECURITY DEFINER hardening (every new helper/RPC)
Explicit safe `search_path`; schema-qualify all objects; `REVOKE ALL … FROM
PUBLIC`; minimal EXECUTE grants (service-role/none for admin/purge; `authenticated`
only for the user delete RPC); **no browser service-role**; no policy recursion (use
SECURITY DEFINER helpers); no object-shadowing; minimal status return; **never**
return content snapshots or Storage paths to ordinary users; attacker-input tests
(foreign `message_id`, path injection into `storage.foldername`). Covers deletion /
restoration / purge / Storage / poll / report-evidence / deleted-message &
-attachment helpers / future admin-read.

---

## 13. (Change #13) Tests
Roles: sender · ordinary participant · group creator/admin · club officer ·
official-chat participant · non-member preview · reporter · reported user · ordinary
authenticated nonparticipant · service backend · future founder/admin.
Scenarios: **worker claims · duplicate workers · expired-lease recovery ·
stale-claim-token rejection (CAS zero-rows) · Edge timeout after copy · crash after
original deletion · redaction retry · dead-letter alert · manual retry · legacy
duplicate delete (idempotent) · legacy managed-attachment error with ZERO data
changes · restore-then-delete-again · prior signed URL before vs after
original-delete · structured push cleanup · unparseable legacy push rows · external
URL behavior · `file://` behavior · unmappable managed attachment failure ·
custom-group authorization (each actor) · SECURITY DEFINER hardening ·
report-evidence migration (count+checksum) · poll privacy · Realtime (messages +
poll_votes + web unread) · rollback**. Method: Management-API `BEGIN … ROLLBACK`
with set JWT claim for RLS/RPC; two-session live tests for Realtime/Storage; assert
denial for every ordinary role, allow-only-audited for founder.

## 14. (Change #14) Retention bucket
Initial name: **`deleted-message-retention`** (private; may change only if
repository naming standards require). Policies: no ordinary/participant/officer
access, no public URLs, no browser service-role, no ordinary signed-URL generation;
access only via future audited founder/admin operations. **No automatic purge in
v1** — purge is a deliberate, audited, manual operation.

## 15. (Change #11) Operational visibility (future Admin Dashboard — design only)
Deletion-attempts view fields: attempt ID · message · state · actor · reason ·
started · age · retry_count · next_retry · claim owner (`claimed_by`) · claim
expiration (`claim_expires_at`) · last_error · attachment mapping status · retention-
copy status · original-delete status · redaction status · push cleanup status ·
report-evidence status · poll cleanup status · manual retry · manual reconciliation
· restore · purge · audit history · critical alerts. **Not built in this task.**

## 16. (Change #15) Migration gate
No migration 051, implementation, Edge Function, policy change, OTA, or data
backfill until 042–044 are **statement/hash reconciled**. Status: local 042/043/044
pristine (single files, working tree == HEAD, commits `e4f9acb1`/`53a88cfd`); remote
*effect* confirmed applied; **byte/hash comparison pending founder-run `supabase
migration list` / `supabase db pull`**; no mismatch proven → no `migration repair`
proposed.

## 17. OTA evidence (verified; unchanged from v5)
Production channel `production`. Store builds: iOS 22 runtime `d644c732…`, Android
24 runtime `6549da75…` (commit `b352d050`). Current tree fingerprints **match**
both. **Latest production OTA currently targets OLDER runtimes** (iOS `d16bac8d…`
build 21, Android `de50834c…` build 22/23) → a **new OTA must be published per
current store runtime** (`d644c732`/`6549da75`); verify with `eas
fingerprint:generate` at publish time. Repoint is JS-only (`messagingService.ts:194`
→ `functions.invoke('delete-message')`, already-bundled supabase-js); **no native
module / no native EAS build**; rollback via `eas update:rollback`. Before OTA:
legacy §6b behavior; after: secure Edge orchestrator. **No OTA deployed here.**

## 18. Coordinated rollout & rollback
Ship as one privacy release (attempts + attachment_map + history + report_evidence +
`deleted-message-retention` bucket; report-evidence backfill/validate; message
SELECT RLS `deleted_at IS NULL` + deleted-aware storage policy +
`is_deleted_message()`/`is_deleted_attachment()` + poll guards + `push_queue`
`source_*` + scrub; replace `unsend_message` B2 + `delete-message` Edge Function +
lease worker; OTA repoint per runtime; backfill 4 existing soft-deleted rows —
prod-data, separate approval). No interim window may leak text/attachment/
Realtime/report-snapshot/poll/push. Rollback reverses in dependency order; restore-
from-history before removing redaction; never re-expose report evidence.

## 19. Open questions
1. Reconciliation runner: Supabase Cron + Edge Function vs external queue runner.
2. Lease duration + heartbeat-renewal threshold.
3. Confirm B2 pre-OTA old-client UX acceptable (managed-attachment delete errors).
4. `get_unread_summary` + notification preview builders exclude deleted `content` —
   audit both.
5. Category-B `file://` prevention mechanism (client validation + insert CHECK).
6. Retained-bucket purge cadence (manual-only in v1).

## 20. Codex review package pointer
Evaluate against: §1 client facts · §3 authorization · §4 first-txn · §5 idempotency
· §6 attachment categories/mapping · §7 signed-URL semantics · §8 lease worker · §9
poll · §10 push · §11 report evidence · §12 SECURITY DEFINER · §13 tests · §14
bucket · §15 op visibility · §16 migration gate · §17 OTA. **Codex verdict is
external and pending.**
