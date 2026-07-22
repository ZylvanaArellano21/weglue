# Open Uncertainties (NOT yet verified from the repo)

These were **not** confirmed during the discovery audit. They are listed instead
of guessed. Each has a concrete verification step. Resolve before building the
part of the dashboard that depends on it. (This is deliverable #30 and the input
to Codex's first read-only work — see codex-onboarding-checklist.md.)

| # | Uncertainty | How to verify | Blocks |
|---|---|---|---|
| 1 | ~~legacy chat tables dead?~~ **RESOLVED** | Dropped in migration 010:662–664 (`CASCADE`); prod REST → HTTP 404. Absent. | — |
| 2 | ~~onboarding canonical/synced?~~ **RESOLVED** | Canonical = `onboarding_completed` (027). Web `explore-clubs:253` wrongly writes legacy `onboarding_complete`; readers use `onboarding_completed`. No sync trigger. Prod: 8 rows `false/true`. Fix = own security task. | (was) user admin |
| 3 | **PARTIALLY RESOLVED (messages).** Message deletes are soft (`deleted_at`), content NOT nulled, SELECT RLS lacks `deleted_at` filter → participants CAN read deleted content via query/Realtime/signed-URL. Still open: hard-vs-soft for posts/comments/events/clubs/conversations/channels. | Read delete paths + RLS + client queries; two-session test. | Deleted Content feature; privacy guarantee |
| 4 | Exact allowed values for `conversations.type`, `messages.message_type`, `club_members.role`, `follows.status`, `event_rsvps.status`. | Read CHECK constraints / inserts in migrations; sample prod distinct values. | Filters across dashboard |
| 5 | How is "president" modeled? (a `club_members.role` value? a `club_officers.role_title`?) | Grep migrations + both apps for "president". | `admin_transfer_club_presidency` |
| 6 | Gluemate reciprocity: is `follows` one-sided or mutual, and what do `status` values mean (pending/accepted/blocked?)? | Read follow RPCs + client logic. | Gluemates admin |
| 7 | Does `types.ts` match prod exactly? What tables/columns/policies/functions exist in prod but not in migration files (drift)? | Regenerate types from prod; dump `pg_policies`/`pg_proc`/`pg_trigger`/`storage.policies` and diff vs migrations. | All backend work |
| 8 | 042–044 statement/hash divergence — does prod's applied SQL byte-match the committed files? (Branch `fix/supabase-migration-history-042-044` is misnamed and holds NO reconciliation — 0-file diff vs main.) | `supabase migration list` + statement-hash compare (needs founder-run link). Prod object-existence already confirms the *effect* of 042–044 is applied. | Authoring 051+ |
| 9 | Storage: exact bucket policies and whether a deleted-message attachment's signed URL can still be minted. Attachments confirmed private + signed-URL (`chatAttachments.ts:189`); avatars/club images public (`getPublicUrl`). | Dump `storage.buckets` + `storage.objects` policies from prod. | Media admin, purge, deleted-content privacy |
| 10 | Which of the unmerged branches' backend changes are actually live in prod vs. branch-only. | Diff each branch's migrations/functions against prod. | Accurate baseline |
| 11 | Meeting schedule: do current clients read legacy `meeting_*` columns or `meeting_schedule` JSONB (or both)? | Grep both apps. | Club edit (meeting) |
| 12 | Exact `notifications`/push pipeline behavior (046): what triggers create rows, delivery/token lifecycle. | Read migration 046 fully + `send-push`. | Notifications admin |
| 13 | Full RPC/trigger inventory and their SECURITY DEFINER/`search_path` posture (048 hardened some). | Enumerate `pg_proc` from prod. | Safe `admin_*` RPC design |

## Explicitly NOT assumed
- That any entity other than `messages`/`club_photos` supports soft-delete.
- That the founder can currently read all reports without the service-role key
  (they cannot, via a normal session).
- That `club_officers` grants any permission (it does not).
- That `types.ts` reflects prod (it does not).
