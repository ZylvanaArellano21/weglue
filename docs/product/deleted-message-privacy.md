# Deleted-Message Privacy — Authoritative Design (v4)

> **Status: DESIGN ONLY. Not implemented.** No migration, no production/data
> change, no mobile change, no OTA publish, no native build, no Supabase deploy.
> This document is the single authoritative artifact for Codex review. It
> supersedes the in-conversation v1–v3 sketches. Implementation is **not**
> approved.
>
> Owner (implementer): Claude · Reviewer: Codex · Decision-maker: founder.
> Migration gate: **no migration 051 until 042–044 are reconciled** (see §12).

## 0. The non-negotiable rule
When a user deletes a message, We Glue must never again *serve* the original —
text, attachment, poll, or shared payload — to any ordinary user (sender,
recipient, officer, club member, participant, non-member preview, reporter,
reported user, or any normal Supabase/iOS/Android/web client) through queries,
Realtime, search, previews, signed URLs, related tables, notifications, or report
records. Only the founder/super-admin may inspect retained originals, through an
audited, platform-admin-gated path that **does not exist yet** (so retained data
stays service-role-only until it does). We Glue cannot erase a file a user already
downloaded, screenshotted, or captured off-platform — that boundary is stated,
not hidden.

## 1. Verified current-state facts (evidence base — all citations real)
The design is grounded in these confirmed facts:

- **Messaging is mobile-only.** `apps/web` has no `messages`/`conversations`
  consumer (grep clean). Web cannot break from message redaction.
- **Mobile filters `deleted_at`.** Every message-loading query uses
  `.is('deleted_at', null)` — `apps/mobile/services/messagingService.ts` lines
  104/107, 449/452, 472/475, 514/519, 590/592, 625/628, 633/636, 644, 648/651,
  655. A hidden row never reaches the renderer.
- **No client-side tombstone.** `MessageBubble.tsx` has no `deletedAt` handling;
  it renders by `messageType` (137–140), guards text with `content ?` (176/219);
  `cardSlot`/`pollSlot` come from `ConversationThread.tsx` (344–352) gated on
  `message_type`. Current UX for a deleted message = it disappears.
- **Message SELECT RLS has NO `deleted_at` filter today** — policy
  `"messages: participants can read"` = `USING (is_conversation_participant(conversation_id))`
  (001:808). This is the core gap.
- **`unsend_message` (040:177)** sets only `deleted_at`/`deleted_by`; it does
  **not** null `content`/`attachment_url`. Prod: 4 soft-deleted messages, all
  retaining `content`.
- **Snapshots live on `reports`, reporter-readable.** `reports` gained
  `content_snapshot`/`attachment_snapshot`/`message_*` (040:810); RLS
  `"reports: users read own"` = `USING (reporter_id = auth.uid())` (033:66), no
  column restriction → the reporter can read the snapshot.
- **`chat-attachments` is private**; SELECT policy
  `"chat-attachments: participants can read"` (040:883) checks only
  `is_conversation_participant((storage.foldername(name))[1])` — no deleted
  check. Path = `{conversation_id}/{uuid}.{ext}`; signed-URL TTL = 1h
  (`chatAttachments.ts:167`). Re-mint of a deleted attachment is possible.
- **True `messages` content columns:** `content, attachment_url, attachment_name,
  attachment_mime, attachment_size, shared_event_id, shared_post_id` (+ poll via
  `polls.message_id`). No `thumbnail`/`link_preview`/`caption`/`shared_club`/
  `file_metadata` columns exist. `message_type` ∈ `{text, image, video, poll,
  file, shared_event, shared_post}` (040:49).
- **No reply/parent column exists** anywhere → replies are not a current feature.
- **`messages` is in `supabase_realtime`** (010:39); `poll_votes` too (010:40).
- **Realtime interactions (050)** use private Broadcast for RSVP/like/comment
  only — not messages.

## 2. Architecture overview
Selected direction: **Approach B — deletion-scrubbing + server orchestration.**
- `messages` remains the canonical, current source of truth. Deletion **mutates
  in place**: snapshot originals out, then redact the row to tombstone-safe
  fields.
- Originals go to **immutable, founder-only** retention (DB history +
  founder-only storage). Not a second active messages table.
- A **first PostgreSQL transaction** achieves DB fail-closed atomically (§4);
  **Edge Function orchestration** performs the physical attachment move that DB
  transactions cannot (§6). The cross-service saga is **not** perfectly atomic.
- Two entry points must both be secure: the OTA-updated **Edge Function**
  (`delete-message`) and the **legacy `unsend_message` RPC** still called by
  installed clients (§5).

---

## 3. (Change #1) Independent deletion-attempt identity
Deletion jobs are **not** keyed permanently by `message_id`. A message may be
deleted, restored, and deleted again — each is its own attempt, all preserved.

```
message_deletion_attempts (
  id              uuid primary key default gen_random_uuid(),
  message_id      uuid not null references messages(id) on delete cascade,
  attempt_no      int  not null,                 -- 1,2,3… per message
  actor_id        uuid references profiles(id),  -- who initiated
  reason          text,
  state           text not null,                 -- see §4 state machine
  entry_point     text not null,                 -- 'edge_function' | 'legacy_rpc'
  has_attachment  boolean not null default false,
  started_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  completed_at    timestamptz,
  failed_at       timestamptz,
  failure_reason  text,
  -- reconciliation metadata
  reconcile_after timestamptz,
  reconcile_tries int not null default 0,
  last_error      text,
  -- restoration metadata (see §7)
  restored_at     timestamptz,
  restored_by     uuid references profiles(id),
  restoration_reason text,
  restoration_result text
)
```

**Active states** (only ONE active attempt per message at a time):
`pending, retained, original_removed, redacted, failed_requires_reconciliation`.
**Non-active (terminal) states:** `completed, restored, aborted`.

**Partial unique constraint** (permits delete → restore → delete again while
keeping history):
```
create unique index uq_active_deletion_attempt
  on message_deletion_attempts(message_id)
  where state in ('pending','retained','original_removed','redacted',
                  'failed_requires_reconciliation');
```
`attempt_no` = `1 + max(attempt_no)` for that `message_id`. Every attempt row is
retained forever (audit/history); nothing is overwritten.

---

## 4. (Change #2) First PostgreSQL transaction — atomic DB fail-closed
One transaction, all-or-nothing. It runs for BOTH entry points:

1. `SELECT … FOR UPDATE` lock the canonical `messages` row.
2. Verify authorization (sender / officer / custom-group admin — existing rules).
3. Create the `message_deletion_attempts` row (`attempt_no`, `entry_point`,
   `has_attachment`), `state = 'pending'`.
4. Snapshot into founder-only history (§internal): original `content`,
   attachment metadata (`attachment_url` path, name, mime, size), poll
   (question/options/votes/voters/totals), shared-object references
   (`shared_event_id`, `shared_post_id`).
5. **Redact every content-bearing field** on `messages`: null `content`,
   `attachment_url`, `attachment_name`, `attachment_mime`, `attachment_size`,
   `shared_event_id`, `shared_post_id`; protect/unlink poll (§9).
6. `deleted_at = now()`, `deleted_by = auth.uid()`.
7. Leave `state = 'pending'` (attachment path) or set `completed` immediately for
   **no-attachment** messages (nothing left to move).

**Either all of the above commit, or none.** The Realtime `UPDATE` emitted by
this transaction carries the already-redacted row → **no sensitive content in the
Realtime payload**. Physical attachment retention/removal is subsequent Storage
orchestration (§6), but **ordinary DB access is fail-closed the instant this
transaction commits** because (a) `content`/attachment cols are null and (b) the
message SELECT RLS now filters `deleted_at IS NULL` (new — see §rollout) and the
deleted-aware storage policy denies new signing.

---

## 5. (Change #3) Explicit state access matrix
Legend: **Hidden** = not returned to ordinary users. **Redacted** = row present
but content-bearing fields null. **Denied** = operation refused. **Founder** =
service-role / future super-admin only, audited. "prev signed URL" = a URL minted
before deletion (self-contained, valid ≤1h until the object is physically
removed).

| Dimension | pending | retained | original_removed | redacted | completed | failed_requires_reconciliation | restored | aborted |
|---|---|---|---|---|---|---|---|---|
| Ordinary message SELECT | Hidden | Hidden | Hidden | Hidden | Hidden | Hidden | Visible (restored) | Normal (never redacted) |
| Non-member preview | Hidden | Hidden | Hidden | Hidden | Hidden | Hidden | Visible | Normal |
| Realtime payload | Redacted | Redacted | Redacted | Redacted | Redacted | Redacted | Full (restored) | Normal |
| New signed-URL | Denied | Denied | Denied (object gone) | Denied | Denied | Denied | Allowed | Allowed |
| Prev signed URL | valid ≤1h | valid ≤1h | **404 (removed)** | 404 | 404 | 404 or ≤1h if move pending | valid | valid |
| Poll q/options/votes | Hidden | Hidden | Hidden | Hidden | Hidden | Hidden | Visible | Normal |
| Report evidence | Founder | Founder | Founder | Founder | Founder | Founder | Founder | Founder |
| Backend/service | Full | Full | Full | Full | Full | Full | Full | Full |
| Founder access | audited | audited | audited | audited | audited | audited | audited | n/a |
| Retry behavior | n/a (txn) | resume move | resume redact-finalize | finalize | none | **retry+alert** | n/a | n/a |
| Restoration eligible | no (in-flight) | no | no | **yes** | **yes** | after reconcile | (already) | n/a |
| Permanent purge eligible | no | no | no | yes | **yes** | after reconcile | via new attempt | n/a |

**Invariant:** no `failed`/incomplete state ever re-exposes content. Content is
re-exposed **only** by an explicit, audited `restored` transition (§7). For
no-attachment messages the lifecycle is `pending → completed` (storage columns
N/A).

---

## 6. (Change #4) Legacy `unsend_message` compatibility
Installed clients call `supabase.rpc('unsend_message')` (`messagingService.ts:194`).
The legacy RPC is **replaced** so it can never do the old insecure soft delete.

**A. No-attachment messages (text / poll / shared_event / shared_post):**
the legacy RPC runs the **complete §4 first transaction** (snapshot + redact text
/ poll / shared references / metadata + `deleted_at` + attempt row) and returns
**success only after DB privacy is complete**. Old-client UX: identical to today
— the message disappears on next `deleted_at`-filtered load — but now secure.

**B. Attachment messages (image / video / file):**
the legacy RPC must **not** report a normal success while the object is still
served. Two candidate strategies (founder/Codex to choose):

- **B1 (recommended): redact-now + reconcile-move + controlled result.** Run the
  §4 first transaction (DB fail-closed immediately: text/poll/shared protected,
  `deleted_at` set, **new signed URLs denied**), enqueue the storage move for the
  reconciler, and return a **controlled `secure_deletion_pending`** result (not a
  plain `success`). The object is no longer newly signable; the reconciler
  physically removes it within seconds; the only residual is a prev-issued signed
  URL (≤1h). Old-client UX: the message vanishes on refresh regardless of the
  result code; a legacy client that only checks for an error may show a transient
  toast, but the DB is already secure and the attachment purge completes async.
- **B2 (strict): fail-closed `secure_deletion_required`.** The RPC performs **no**
  deletion and returns a controlled error telling the client a secure delete is
  required (i.e., update the app). Downside: the user's delete does not take
  effect on old clients — poor UX and the message stays visible.

**Recommendation:** B1. It never performs the insecure soft delete, never returns
plain success while the attachment is newly accessible, protects the DB
immediately, and completes physical purge via the reconciler — all without an
app-store update. OTA-updated clients use the Edge Function (§6) which moves the
object **before** returning success (no residual). We do **not** preserve insecure
behavior to avoid an old-client error. *No other backward-compatible strategy
avoids either a residual (B1) or a non-effective delete (B2); documented as such.*

**Old-client failure behavior (B1):** on RPC error/timeout the client may not
update its UI, but `deleted_at` is already set (or the txn rolled back entirely —
nothing half-done). Re-invocation is idempotent (the active-attempt unique
constraint + state checks make a duplicate call a no-op returning the current
state).

---

## 7. (Change #5) Edge Function `delete-message` orchestration
For OTA-updated clients (strict, move-before-success). Never returns retained
paths or snapshots to the client.

1. **Authenticate** caller JWT.
2. **Authorize** — sender / officer / custom-group admin (existing rules).
3. **Idempotency key** = `(message_id, actor_id, client_attempt_uuid)`; locate or
   create the active `message_deletion_attempts` row.
4. **First PG transaction (§4)** → `pending` (DB fail-closed; content redacted).
5. **Copy attachment** → founder-only retention bucket; **verify** (exists,
   size/etag match) → `retained`.
6. **Delete original** participant-accessible object; **verify** the old path no
   longer resolves → `original_removed`.
7. **Finalize** → `redacted` → `completed`.
8. **Return success only when the privacy guarantee is satisfied** (through step 6
   for attachment messages). Return **minimal status** — never snapshots/paths.

**Timeout / crash / retry / duplicate / reconciliation:**
- Edge Function timeout or crash mid-flight: the attempt row holds the last state;
  DB is already fail-closed from step 4; a durable reconciliation worker resumes
  from the recorded state (copy→verify→delete→verify→finalize), idempotently.
- Duplicate call: the active-attempt unique constraint + per-step state checks
  make it a no-op returning current state.
- Retry: bounded exponential backoff (`reconcile_after`, `reconcile_tries`);
  after N failures → `failed_requires_reconciliation` + critical alert; **content
  stays fail-closed** throughout.
- Copy verified but original-delete fails: retry delete; object un-signable
  meanwhile (deleted-aware policy).
- Original deleted but finalize fails: retry finalize (idempotent); state stays
  ≥`original_removed` (still hidden).

---

## 8. Founder-only deletion history (retention store)
`message_deletion_history` (immutable evidence; **not** an active message source):
original content, attachment path (in founder-only retention), poll snapshot,
shared refs, `attempt_id`, `deleted_at`, actor, reason. Until platform-admin
authorization + audit logging exist: **no dashboard read path, no browser access,
no client access, service-role backend only, no ordinary authenticated grants.**
Later reads go through `admin_read_deleted_message(attempt_id, reason)` (reason
required, audited). Immutable via trigger (no UPDATE/DELETE except the purge RPC).
Permanent purge deletes the row **and** the retained file.

---

## 9. (Change #6) One-to-many report evidence
Replace the 1:1 model. One canonical report → many evidence items.

```
report_evidence (
  id            uuid primary key default gen_random_uuid(),
  report_id     uuid not null references reports(id) on delete cascade,
  evidence_type text not null check (evidence_type in
    ('message_snapshot','attachment','screenshot','poll','file',
     'related_message','other')),
  content_snapshot   text,
  attachment_snapshot jsonb,
  storage_path  text,          -- founder-only retention location
  message_id    uuid,
  conversation_id uuid,
  metadata      jsonb,
  created_at    timestamptz not null default now()
)
```
`reports` stays the workflow source of truth (reason/status/target only).
`report_evidence` is: **ordinary-user / reporter / reported-user / officer /
participant unreadable** (RLS deny-all to `authenticated`); founder/admin readable
only through audited operations; **immutable**; permanently removable only through
an audited purge. **Migration plan for existing snapshots (prod-data → gated by
§12 + explicit approval):** (1) create `report_evidence`; (2) backfill existing
`reports.{content_snapshot,attachment_snapshot,message_*}` → `report_evidence`
(evidence_type `message_snapshot`); (3) **validate** counts + checksums; (4)
`REVOKE SELECT (content_snapshot, attachment_snapshot, message_id,
conversation_id, conversation_type, message_type, message_sender_id) ON reports
FROM authenticated`; (5) only after validation, optionally drop the columns.
**Rollback:** columns retained until validated; re-GRANT to revert. Never drop or
move production evidence without backfill + validation + rollback.

---

## 10. (Change #7) Restoration history
Restoration never deletes deletion attempts or history. `admin_restore_message(
attempt_id, reason)` (super-admin, audited):
1. Read snapshot from history.
2. **Move retained file back** to `chat-attachments/{conv}/{uuid}`, verify. If
   this fails → **abort; message stays deleted** (no partial restore).
3. One PG transaction: restore `content`/attachment cols/`shared_*`; re-insert
   poll + options + votes from snapshot; clear `deleted_at`/`deleted_by`; set the
   attempt `state='restored'`, `restored_at/by`, `restoration_reason`,
   `restoration_result`. Preserve the attempt row and `deleted_at` history.
4. Realtime re-broadcasts (clients' `deleted_at IS NULL` queries pick it up);
   search/previews recompute live from restored `content`.
All-or-nothing across text / attachment / poll / poll options / poll votes /
shared references / search / previews / Realtime. A restored message may later be
deleted again under a **new** attempt (`attempt_no+1`).

---

## 11. (Change #8) SECURITY DEFINER hardening (every privileged object)
Applies to deletion / restoration / purge RPCs, deleted-message & deleted-
attachment helpers, poll helpers, and future admin-read operations:
- `SET search_path` to an explicit safe value (`pg_catalog, public`) or empty +
  fully schema-qualify every object (`public.messages`, `storage.objects`, …).
- `REVOKE ALL ON FUNCTION … FROM PUBLIC`; `GRANT EXECUTE` only to the intended
  role (`authenticated` for the deletion RPC; none/service-role for admin/purge).
- Avoid RLS policy recursion — read state via SECURITY DEFINER helpers
  (`is_deleted_message()`, `is_deleted_attachment()`), mirroring the existing
  `is_conversation_participant` pattern.
- Do **not** leak message existence: helpers return minimal booleans; RPCs return
  minimal status; never return snapshots or storage paths to ordinary clients.
- Test object-shadowing (search_path attacks) and attacker-controlled inputs
  (arbitrary `message_id`, foreign conversation, path injection into
  `storage.foldername`).

---

## 12. (Change #9) Poll privacy
On deleting a poll message: snapshot `polls` + `poll_options` + `poll_votes`
(voter ids + totals) into founder retention, then **guard the SELECT policies of
all three tables** via `is_deleted_message()` SECURITY DEFINER so no participant
can read the question, options, individual votes, voter records, or infer
aggregate totals through any related table. `poll_votes` is in `supabase_realtime`
(010:40) → guarded + message hidden ⇒ no residual vote broadcast/inference.
Notifications referencing the poll message resolve to the hidden/redacted message
(verify preview builders). A reported poll → snapshot in `report_evidence`.
**Restoration:** re-insert poll/options/votes from snapshot, clear guards,
all-or-nothing. **Purge:** delete snapshot + votes permanently + retained files.

---

## 13. (Change #10) Tests (exact)
**Roles:** reporter · reported user · sender · participant · officer ·
custom-group admin · non-member preview · ordinary authenticated nonparticipant ·
service backend · future founder/admin.
**Surfaces per role:** deleted text · attachment paths · file metadata · shared
references · polls (q/options/votes/totals/voters) · report evidence · Realtime
payloads · search · previews (conversation last-message) · new & prev signed URLs.
**Scenarios:** delete text / image / video / file / poll / shared_event /
shared_post; legacy `unsend_message` (A no-attachment, B attachment) vs new Edge
Function; repeated delete→restore→delete (attempt_no increments; history
preserved); duplicate requests (idempotent no-op); failure injection at each saga
step (snapshot, copy, verify, original-delete, finalize); reconciliation drives to
`completed`; rollback; restoration all-or-nothing; permanent purge removes row +
file + evidence. **Method:** Management-API `BEGIN … ROLLBACK` with set JWT claim
for RLS/RPC; two-session live tests for Realtime/Storage; assert denial for every
ordinary role and allow-only-audited for founder.

---

## 14. (Change #11) OTA evidence (verified, non-secret)
| Item | Value |
|---|---|
| Update channel | `production` (eas.json production profile; both store builds on it) |
| Update URL | `u.expo.dev/e9ee8bc0-92ad-4802-8ce0-35735bb8ad47` |
| `runtimeVersion` policy | `fingerprint` |
| iOS store build 22 runtimeVersion | `d644c732e7471dda3cdd6fc4d28e12179fded642` (commit `b352d050`) |
| Android store build 24 runtimeVersion | `6549da75b3646f045f15ac939343b110552836cc` (commit `b352d050`) |
| Current tree fingerprint — iOS | `d644c732…fded642` → **MATCH** |
| Current tree fingerprint — Android | `6549da75…2836cc` → **MATCH** |
| Native changes on main since build commit | none (empty git log over package.json/app.json/ios/android/eas.json/babel/metro) |
| No native dependency change | confirmed — repoint uses already-bundled supabase-js `functions.invoke` (`accountService.ts:320`) |
| Only the deletion call site changes | `messagingService.ts:194` `rpc('unsend_message')` → `functions.invoke('delete-message')` |
| OTA rollback | `eas update:rollback` / republish prior update on `production` |
| Installed-build compatibility | both 22/24 receive the update (fingerprint identical) |

**Guardrail:** publish the deletion OTA only from a tree whose fingerprint is
still `d644c732`/`6549da75`; if any native change piggybacks, delivery to 22/24
breaks. Re-verify with `eas fingerprint:generate` at publish time. **No OTA is
deployed by this document.**

---

## 15. (Change #12) Migration gate
No migration 051 (or any new migration) is prepared or numbered until 042–044 are
reconciled at statement/hash level. **Current reconciliation status:** local
042/043/044 are pristine (single files, working tree == HEAD, single introducing
commits `e4f9acb1`/`53a88cfd`); remote *effect* is confirmed applied
(`universities`, `app_config`, `university_id`, `delete_own_account_atomic`, and
the `reports` snapshot columns all exist in prod); the **stored-statement byte/
hash comparison is still pending** the founder-run `supabase migration list` /
`supabase db pull`. No mismatch is proven, so no `supabase migration repair` is
proposed.

---

## 16. Coordinated rollout & rollback (one privacy release)
Ship together so no interim state leaks (text-safe/attachment-leaks,
attachment-safe/text-leaks, DB-safe/Realtime-leaks, message-hidden/report-
snapshot-or-poll-tables-leak):
1. Create `message_deletion_attempts`, `message_deletion_history`,
   `report_evidence`; backfill + validate report evidence.
2. Add message SELECT RLS `deleted_at IS NULL` + deleted-aware storage policy +
   `is_deleted_message()`/`is_deleted_attachment()` helpers + poll guards.
3. `REVOKE` reports snapshot columns (after evidence backfill validated).
4. Replace `unsend_message` (secure) + deploy `delete-message` Edge Function +
   reconciliation worker.
5. OTA repoint of the mobile call site (fingerprint-verified).
6. Backfill the existing 4 soft-deleted messages (prod-data, separate approval).
**Rollback** reverses in dependency order; restore-from-history before removing
any redaction; re-GRANT reports columns; drop new objects last.

## 17. Open questions (for founder/Codex)
1. Legacy attachment strategy: **B1 (recommended)** vs B2.
2. Signed-URL residual: accept ≤1h for legacy B1 callers, or lower `SIGNED_TTL`?
3. Exact-path equality assumption: confirm `messages.attachment_url` always
   equals `storage.objects.name` (both = `{conv}/{uuid}.{ext}`) so the deleted-
   aware helper matches reliably.
4. Founder retention bucket: new private bucket vs prefix in `chat-attachments`
   with deny-all-participant policy.
5. Custom-group-admin authorization rule for deletion — confirm exact current
   definition (uses `conversations.created_by`?).
6. Notification preview builders (031/046): confirm none embed message `content`
   directly.

## 18. Codex review package pointer
Codex should evaluate against this document: OTA feasibility (§14), Edge Function
authorization (§7), idempotency & attempt identity (§3), state machine & access
matrix (§4–5), Storage/PostgreSQL failure states (§7), founder history access
(§8), report evidence (§9), poll privacy (§12), RLS & SECURITY DEFINER hardening
(§11), Realtime (§4/§5), restoration (§10), permanent purge (§8–10), and existing
mobile compatibility (§1/§6/§14). **Codex verdict is external and pending.**
