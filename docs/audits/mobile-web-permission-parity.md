# Mobile–Web Permission Parity Checklist

This is the live implementation record for `fix/web-permission-parity`.  Mobile
and web are compared with the shared Supabase database before each change.  A
status of **investigating** is deliberately not treated as a product decision.

## Confirmed shared product rules

| Domain | Feature / actor | Correct product behavior | Mobile now | Web now | Backend now | Existing implementation to reuse | Planned correction | Test coverage | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Events | Selected audience / creator | A new selected recipient is an active, unblocked, current member of the event club and is not the creator. | Now calls the canonical RPC only from `app/home/new-event.tsx`. | Already used the canonical RPC. | `search_event_audience_members` and audience trigger are canonical. | Existing RPC and audience trigger. | Replaced only the mobile event-audience lookup; ordinary people search remains unchanged. | `eventAudienceMembers.test.ts`, `test_069_web_permission_parity.sql`, `test_070_cross_platform_event_permission_parity.sql`. | Fixed cross-platform |
| Events | Selected audience / officer | Only a current officer may search and edit selected recipients, subject to the existing event-edit rule. | `updateEvent`/`deleteEvent` in `services/eventService.ts` re-read `club_members` live before mutating; picker calls the RPC only. | `useOfficerClubs` limits the host list and `createEvent`/`updateEvent` in `hooks/useCreateEvent.ts` re-check officer server-side. | `is_club_officer(club_id)` gates events INSERT (001), UPDATE and DELETE (063); the picker RPC raises `only_club_officers_can_select_event_members`. | Existing RPC and `is_club_officer`. | None — all three layers already agree and every check reads current membership, so demotion takes effect immediately. | `test_069_web_permission_parity.sql` (non-officer refused, non-officer UPDATE affects 0 rows, demoted officer refused, officer positive control); persona API matrix rows "picker · ordinary member is refused" and "officer auth · …". | **Already correct — verified** |
| Events | Historical recipient / former member | Existing unchanged recipient remains allowed after leaving; newly added recipient must be currently eligible; removed recipient cannot be re-added unless eligible. | Restores IDs and labels (with an inaccessible-profile fallback) in `getEventForEdit`. | Preserves IDs in the existing edit hook. | `070` updates the existing validator to check only IDs newly added relative to the same club. | Existing audience trigger. | No second audience table/function; update trigger semantics and both edit restorations. | `test_070_cross_platform_event_permission_parity.sql`. | Fixed cross-platform |
| Events | Selected-event read / selected recipient | Selected recipient, creator, and only audited officer exception can read. Other users receive no event payload. | RLS-governed reads. | Event access layer and RLS-governed queries. | `070` keeps the internal predicate but revokes it from clients; policies use caller-bound `private.can_current_user_access_event`. | Canonical event access predicate. | Safe internal predicate plus caller-bound policy wrapper, not parallel rules. | `test_069_web_permission_parity.sql`, `test_070_cross_platform_event_permission_parity.sql`. | Fixed in backend |
| Events | Selected-event access loss | Audience removal clears event, attendees, saves, notifications, and open detail before refetch. | Existing synchronization host now removes sensitive query roots first. | Existing `eventSync` now removes event-shaped roots before refetch. | `070` sends an opaque `{}` campus sync through the existing 066 topic on an audience change. | Existing `eventSync` and access-sync infrastructure. | Clear-first extension of existing cache/realtime paths; no second subscription. | `eventSync.test.ts`, student synchronization tests, `test_070_cross_platform_event_permission_parity.sql`. | Fixed cross-platform |
| Events | Members-only event / non-member | Hidden from Home; club-profile preview is labelled; cannot open, save, RSVP, or see attendees; join updates access and leave removes it. | `clubService` carries `can_open` and `app/club/[clubId]/index.tsx` blocks navigation when false. | `EventCard`/`ClubRightColumn` route `can_open === false` to `onRestricted`; `useClubEventsFeed` zeroes `attendee_count`/`attendee_preview` for those rows. | 069/070 RLS hides the row from Home and discovery; `get_club_profile_events` is the only preview surface and returns `can_open = false`. | Existing event access, RPC, badge. | None to behavior. Every enforcement point verified; one payload-shape question is escalated rather than guessed (see below). | `test_069_web_permission_parity.sql` (Home hidden, 2 preview cards, RSVP refused, join grants access, leave revokes it); persona API matrix: non-member Home browser-verified to show only the everyone event. | **Already correct — verified** (founder resolved the presentation question: complete card, restricted actions) |
| Events | Event audience labels / eligible viewer | Restricted audience label is shown once, including past events; selected events never render for ineligible viewers. | New reusable `components/events/EventAudienceBadge.tsx` is used by Home, Calendar/Saved, and detail cards; club profile uses its existing banner. | Existing `EventAudienceBadge` and event cards. | Audience is enforced separately. | Existing web badge; new single mobile badge because none existed. | Added mobile component without duplicate labels. | Mobile typecheck and visual QA required. | Fixed on mobile |
| Events | Expiration / all actors | `event_end_at <= server now` is past; past events retain data/audience, leave Home/Upcoming, enter club Past, and prohibit RSVP insert/delete. | `eventDisplay`, Home, calendar, saved, weekly, club profile, RSVP, and detail paths now carry/use `event_end_at`. | Existing canonical timestamp helper remains unchanged. | RSVP predicate already used `> now`; 070 protects derivation on all updates. | Existing `event_end_at`, display helper, RSVP predicate. | Corrected mobile canonical helper/data shape only; retained web implementation. | `eventDisplay.test.ts`, existing web datetime tests, SQL 069/070 harnesses. | Fixed cross-platform |
| Events | Event end timestamp / client | `event_end_at` is server-derived from Chicago date/end-time and cannot be client overridden. | Continues to write date/time shape only. | Continues to write date/time shape only. | 070 recreates the existing trigger for every INSERT/UPDATE, overwriting direct values. | Existing derivation trigger. | Follow-up migration avoids editing committed 069. | `test_070_cross_platform_event_permission_parity.sql`. | Fixed in backend |
| Events | RSVP / expired or unauthorized | RLS and mutation predicate reject unauthorized/new-or-cancelled RSVP at exact end boundary. | `rsvpToEvent` now reads server `event_end_at` and applies `isEventPastAt` (`lib/eventDisplay.ts`, `endMs <= now`). | `lib/datetime.ts` `isEventPastAt` is byte-identical in semantics. | `can_current_user_mutate_event_rsvp` requires `event_end_at > now()` on INSERT, UPDATE and DELETE (070). | Existing mutation predicate and canonical helper. | None — all three layers treat exact equality as past, so the boundary is consistent. | `test_069_web_permission_parity.sql` (INSERT, DELETE and UPDATE all blocked at the exact boundary; live-event cancel succeeds as the discriminator); `eventDisplay.test.ts` and `datetime.test.ts` cover the CST and CDT boundary. | **Already correct — verified** |
| Events | Home and discovery | Queries return only accessible, non-past events; UI never relies solely on hidden rows. | Home uses `event_end_at > now()` and includes the timestamp in its model. | Uses 069 discovery query. | 069 discovery filters `event_end_at > now()` and RLS. | Existing discovery/RLS. | Mobile data retrieval aligned to the existing backend rule. | Mobile event-display tests; SQL RLS harness. | Fixed on mobile |
| Events | Club profile / history | Club profile separates exact past/upcoming while retaining audience policy and permitted members-only preview. | Uses `get_club_profile_events`, carries `event_end_at`, blocks `can_open=false` preview navigation, and splits with the canonical helper. | Existing 069 club-profile RPC. | Existing RPC/RLS. | Existing RPC and mobile helper. | Removed direct mobile event read only from the club-profile flow. | SQL 069 harness; mobile typecheck/manual QA required. | Fixed on mobile |
| Events | Direct links, saves, attendees, activity | No selected event payload through IDs, saves, RSVPs, interests/activities, notification, or attendee routes after access loss. | `getEventAttendees`/`savedEventsService` read under RLS; `lib/studentSynchronization.ts` removes event roots before refetch. | `useEventAttendees` resolves an unauthorized direct URL to `event_unavailable` rather than a misleading empty list; `hooks/eventSync.ts` removes roots before refetch. | Every secondary route resolves through `can_current_user_access_event` (070): events, event_rsvps, saved_events, event_activities, event_interests and the notifications policy. | Existing access predicate and eventSync. | None — each route was driven negatively and returned an empty payload, with authorized positive controls proving the assertions are not vacuous. | `test_069_web_permission_parity.sql` (attendees, activity/interest tags, notifications, direct id — each with a positive control); persona API matrix: 4 direct-link personas, attendee rows, saved-event insert, all with no leaked strings in the response body. | **Already correct — verified** |

## Whole-application audit ledger

This is the read-only cross-platform review performed before expanding the
event parity work. A row marked **Already correct** has a shared RPC/RLS source
of truth or equivalent mobile/web callers; it was deliberately not rewritten.
The current patch only changes the rows marked **Fixed** below.

| Domain | Feature / actor | Correct behavior and canonical source | Mobile evidence | Web evidence | Backend evidence | Change / tests | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Authentication | Signup, login, verification, restoration | Supabase Auth owns credential/session state; neither client authorizes another account from local state. | `app/auth/*`, `lib/supabase.ts` | `app/actions/auth.ts`, `lib/authFlow.ts` | `001_initial_schema.sql`, `005_email_validation.sql`, `027_auth_signup_hardening.sql` | Existing auth suites; no confirmed divergence. | Already correct on mobile and web |
| Account access | Suspended, deleted, campus eligibility | `my_access_state()` is self-bound and RLS is the enforcement point; client routing is explanatory only. | `services/accessService.ts`, `app/_layout.tsx` | `lib/auth/restrictionGuard.ts`, `app/restricted/*` | `058_admin_restrictions.sql`, `061_restriction_reasons_account_deletion.sql` | Existing restriction-guard tests; no change. | Already correct cross-platform |
| Home | Posts and blocked/private content | Posts are university scoped in the feeds and the final privacy/block/lifecycle decision is RLS. | `services/postService.ts`, `hooks/useHomePostsFeed.ts` | `hooks/useHomePostsFeed.ts`, `components/home/HomeClient.tsx` | `057_student_blocking.sql`, `069_web_permission_parity.sql` post policy | Existing post/block suites; no change. | Already correct cross-platform |
| Home | Event visibility and lifecycle | Event rows are RLS-governed; upcoming uses canonical `event_end_at`. | `services/eventService.ts` | `hooks/useHomeEventsFeed.ts` | `069_web_permission_parity.sql`, `070_cross_platform_event_permission_parity.sql` | `eventDisplay.test.ts`, SQL 069/070 harnesses. | Fixed cross-platform |
| Events | Everyone / members / selected reads | One canonical event predicate; members-only preview exists only in the club-profile RPC; selected is allow-list private. | `services/eventService.ts`, `services/clubService.ts` | `permissions/eventAccess.ts`, `hooks/useEventDetail.ts` | 070 caller-bound event predicate and `get_club_profile_events` | SQL 069/070 harnesses. | Fixed cross-platform |
| Events | Create/edit/delete officer authority | Officers are the existing host/editor authority and event RLS remains the mutation backstop. | `app/home/new-event.tsx`, `services/eventService.ts` | `hooks/useCreateEvent.ts`, `components/home/ComposeEventModal.tsx` | existing events policies plus `validate_event_specific_audience` | SQL picker/validation checks. | Already correct; audience validation fixed in backend |
| Events | Selected-recipient search | Current eligible club members only, not creator, with username/full-name partial match; server verifies officer. | `services/eventService.ts`, `app/home/new-event.tsx` | `hooks/useCreateEvent.ts`, `ComposeEventModal.tsx` | `069_web_permission_parity.sql` `search_event_audience_members` | mobile RPC unit test; SQL 069 harness. | Fixed on mobile; already correct on web/backend |
| Events | Historical selected recipients | Unchanged former recipient remains; only newly-added IDs are current-member checked. | `getEventForEdit` in `services/eventService.ts` | `useEventForEdit` | 070 replaces existing validator semantics | SQL 070 harness. | Fixed cross-platform |
| Events | RSVP, attendee, save and direct ID access | Reads/mutations follow caller-bound event access; RSVP mutation is strictly before end timestamp. | `services/eventService.ts`, `savedEventsService.ts` | `hooks/useEventAttendees.ts`, `hooks/useSavedEvents.ts` | 070 RLS policies | SQL 069/070 harnesses. | Fixed in backend; mobile timestamp UX fixed |
| Events | Audience labels | Eligible rows have one red label; no selected row is rendered to an ineligible account. | `components/events/EventAudienceBadge.tsx` and event cards | existing `components/home/EventAudienceBadge.tsx` | RLS prevents unauthorized source rows | Mobile typecheck; web existing visual tests/manual QA. | Fixed on mobile; already correct on web |
| Events | Past/history and Chicago time | Exact boundary is past; historical data/audience persist; server derives Chicago UTC timestamp. | `lib/eventDisplay.ts`, Calendar/Saved/Club services | existing `lib/permissions/eventAccess.ts`, calendar/saved hooks | 069 timestamp + 070 every-update trigger | mobile expiry test; SQL 069/070 harnesses. | Fixed cross-platform |
| Posts | Author create/edit/delete, comments, likes, tags, reporting | Existing author/participant RLS and server report path are common to both clients; official club posts intentionally remain shared-context content across a personal block. | `services/postService.ts`, `services/reportService.ts` | `hooks/useCreatePost.ts`, `hooks/usePostActions.ts`, `hooks/useReport.ts` | `057_student_blocking.sql`, `064_report_resolution_enforcement.sql`, 069 post policy | Existing post/block/report tests; no confirmed mismatch. | Already correct cross-platform |
| Clubs | Discovery, public profile, join/leave and officer state | Club RPCs/RLS define membership/officer facts; existing realtime clears membership-dependent conversations. | `services/clubService.ts`, `hooks/useClubMembership.ts` | `lib/clubs/clubService.ts`, `hooks/useClubMembership.ts` | `029_event_visibility_and_leave_club.sql`, `032_fix_leave_club_officer_count.sql`, `054_atomic_last_officer_protection.sql` | Existing club tests; cache clearing extended below. | Already correct; cache convergence fixed cross-platform |
| Profiles | Private profile, associated content and direct route | Profile/post RLS returns no row where block/privacy/lifecycle forbids access; UI uses the same safe-unavailable outcome. | `services/profileService.ts`, `app/profile/[userId].tsx` | `hooks/useUserProfile.ts`, `components/profile/UserProfileClient.tsx` | `026_profile_privacy_interests_recs.sql`, `057_student_blocking.sql` | Existing profile/block suites; no confirmed mismatch. | Already correct cross-platform |
| Following and Gluemates | Request/accept/unfollow and block consequence | Follow rows are RLS-protected; block RPC atomically removes both follow directions and does not restore them on unblock. | `services/followService.ts`, `services/blockService.ts` | `hooks/useBlocking.ts`, `lib/blocking.ts` | `057_student_blocking.sql` | Existing `blocking.test.ts`; no change. | Already correct cross-platform |
| Blocking | Profile/search/DM interaction | Block source is the self-bound RPC; symmetric interaction guard is used for DM and searches, without revealing who blocked whom. | `services/blockService.ts`, `services/searchService.ts` | `lib/blocking.ts` | `057_student_blocking.sql` | Existing blocking and message tests; no change. | Already correct cross-platform |
| Reporting | Post/message reports | Existing server RPC/report rows are the durable authorization path, with client email only a courtesy follow-up. | `services/reportService.ts`, `services/messagingService.ts` | `hooks/useReport.ts`, `messages/service.ts` | `055_durable_admin_audit.sql`, `064_report_resolution_enforcement.sql` | Existing report/admin tests; no change. | Already correct cross-platform |
| Direct messages | Pair eligibility, participant history and sending | Direct messages use participant RLS and a server block guard; no client can create a blocked-pair DM. | `services/chatService.ts`, `services/messagingService.ts` | `lib/messages/service.ts` | `057_student_blocking.sql`, `059_messages_web_security_and_suggestions.sql` | Existing message security tests; cache removal extended below. | Already correct; cache convergence fixed cross-platform |
| Club/officer chats and channels | Membership/role access, channel management/posting | Participant/channel RPCs are canonical; messages RLS permits only active participant rows and posting permission function. | `services/channelService.ts`, `hooks/useClubRealtimeSync.ts` | `lib/messages/service.ts`, `hooks/useClubRealtime.ts` | `040_messaging_overhaul.sql`, `041_club_conversation_hub.sql`, `059_messages_web_security_and_suggestions.sql` | Existing message/channel tests; cache removal tests added. | Already correct; cache convergence fixed cross-platform |
| Custom group chats | Create/add/remove/leave/archive | Existing RPCs check creator/participants, block relationship, and account status. | `services/messagingService.ts` | `lib/messages/service.ts` | `057_student_blocking.sql` group functions | Existing message tests; no change. | Already correct cross-platform |
| Notifications | Recipient eligibility, preview and open target | Notification RLS filters event rows by current event access and client enrichment also reads target under RLS. | `services/notificationService.ts` | `hooks/useNotifications.ts`, `NotificationsModal.tsx` | 070 notification policy; `046_complete_notifications_system.sql` | SQL 069/070 harnesses; cache removal tests. | Fixed for event access; otherwise already correct |
| Search | People, clubs, message content, selected-member candidates | Existing scoped search RPCs are caller-bound and block/restriction-aware. Event search hook is retained legacy/unrendered; its server inner query is audience filtered. | `services/searchService.ts`, `services/chatService.ts` | `hooks/useDiscoverySearch.ts`, `messages/service.ts` | `057_student_blocking.sql`, `059_messages_web_security_and_suggestions.sql`, 069 selected search RPC | SQL 069 harness and existing message tests; selected picker fixed above. | Already correct except selected-event picker |
| Saved content | Events/posts after lifecycle or lost audience | RLS is current-access-based; clients drop old payloads rather than merely invalidating. | `services/savedEventsService.ts`, `lib/studentSynchronization.ts` | `hooks/useSavedEvents.ts`, `hooks/eventSync.ts` | 070 saved-event policy | cache tests and SQL 069 harness. | Fixed cross-platform |
| Realtime | Membership/role/audience/access loss | Existing club/campus channels are reused; broadcast contains `{}` only, then clients clear and RLS-refetch. | `StudentSynchronizationHost.tsx`, `useClubRealtimeSync.ts` | `app/providers.tsx`, `useClubRealtime.ts` | 066 synchronization channel + 070 event-audience trigger | mobile/web student synchronization tests; SQL 070 catalog test. | Fixed cross-platform |
| Direct links / stale cache | Event, profile, conversation and notification targets | Direct rows are RLS guarded; selected-event access loss drops cache before refetch, preventing payload flash. | event detail routes + `lib/studentSynchronization.ts` | event detail hooks + `eventSync.ts` | RLS in 057/059/069/070 | SQL event RLS and cache-removal tests. | Fixed cross-platform for confirmed event gap; otherwise already correct |
| Admin/officer capability | Student vs platform-admin and officer-only actions | Existing separate admin and student gates remain deliberately separate; no shared client-side bypass is introduced. | `services/accessService.ts`, officer hooks | `platformAdminGuard.ts`, admin server actions | `053_platform_admin_accounts.sql`, `056_atomic_admin_mutations.sql`, `058_admin_restrictions.sql` | Existing admin/restriction suites; no change. | Already correct cross-platform |

## Resolved — members-only club-profile presentation (founder, 2026-08-05)

The question raised by the previous pass ("does the members-only preview keep
full description/location, or drop to title + date only?") has been **resolved by
the founder in favour of the complete presentation**, matching mobile.

A club non-member sees the **complete** members-only event on the club profile:
image, title, full description, date, start and end time, building, room,
location, club identity, and the red "Members only" badge. Nothing is redacted.

Only the **actions** are restricted: the card does not open, RSVP/Going is
refused, Save is not offered, and attendee identities and counts stay hidden.
Tapping the restricted control returns the guidance message and runs no
mutation.

This is now locked in by an assertion in `test_069_web_permission_parity.sql`
("members-only club-profile information was redacted from a non-member"), which
was confirmed to fail when the RPC is altered to blank `description` for
`can_open = false`. Row 16 above is updated accordingly.

## Update 2 — full mobile→web permission parity sweep (2026-08-05)

Mobile is the source of truth. The parity mechanism across almost every domain
is that **both clients call the same Supabase RLS policies and RPCs**, so a
client cannot diverge on an enforced rule — it can only diverge where a rule is
implemented purely in client code. This sweep therefore concentrated on
client-only surfaces (conditional rendering, query filters, cache invalidation,
realtime listeners, navigation guards) and verified the rest reduces to shared
backend enforcement.

Columns: Domain | Feature | Actor | Preconditions | Mobile (source of truth) | Current web | Backend enforcement | Match | Existing implementation reused | Change required | Files changed | Tests | Status

| Domain | Feature | Actor | Preconditions | Mobile (source of truth) | Current web | Backend enforcement | Match | Reused | Change | Files | Tests | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Auth | Signup / login / session restore | Any | — | `lib/supabase.ts`, `app/auth/*` | `app/actions/auth.ts`, `lib/authFlow.ts` | Supabase Auth owns credentials; `is_educational_email` gates domain | Match | Supabase Auth | None | — | existing auth suites | Already correct — no change |
| Auth | Suspended / deleted / restricted account | Restricted user | account acted on | `services/accessService.ts` + `_layout` guard | `lib/auth/restrictionGuard.ts` + middleware | `my_access_state()` self-bound; RLS is the enforcement point | Match | `my_access_state` | None | — | restriction-guard tests | Already correct — no change |
| Auth | Direct URL to a guarded page | Signed-out / restricted | — | Expo Router guard | `middleware.ts` catch-all matcher `/((?!_next/static\|_next/image\|favicon.ico\|...).*)` | RLS returns no rows regardless of route | Match | existing middleware | None | — | persona matrix direct-link rows | Already correct — no change |
| Home | Posts (private account, blocked, lifecycle) | Any student | — | `services/postService.ts` | `hooks/useHomePostsFeed.ts` | 069 `posts: read respecting privacy, blocking, and lifecycle` | Match | single posts policy | None | — | existing post/block suites | Already correct — no change |
| Home | Members-only event excluded from feed | Non-member | event `members` | RLS-governed feed | RLS-governed feed | 070 `events: visibility-aware read` | Match | event predicate | None | — | 069 harness; browser-verified non-member Home | Already correct — no change |
| Home | Selected event excluded everywhere | Unselected / non-member | event `specific` | RLS-governed | RLS-governed | 070 caller-bound predicate | Match | event predicate | None | — | 069 harness + persona matrix | Already correct — no change |
| Events | Members-only club-profile card shows full info | Non-member | on club profile | Card shows image, title, date, times, location, red badge; no description field in the mobile card model | Card shows image, title, **description**, date, times, location, club identity, red badge | `get_club_profile_events` returns the full row with `can_open=false` | Match (web is a superset by design; founder confirmed nothing may be redacted) | existing RPC | None — do not redact | — | `eventAccess.test.ts` | Already correct — no change |
| Events | Restricted card does not open | Non-member | `can_open=false` | `onPress` → `onRestricted()`, no navigation | `openEvent` → `onRestricted?.()`, no navigation | RLS would return no row anyway | Match | existing handler | None | — | `eventAccess.test.ts` | Already correct — no change |
| Events | Restricted RSVP / Going control | Non-member | `can_open=false` | Control routes to `onRestricted` | Control routes to `onRestricted`; label "Join to RSVP" | `can_current_user_mutate_event_rsvp` rejects | Match | existing handler | None to mechanics | — | 069 harness; persona matrix | Already correct — no change |
| Events | Restricted-control guidance copy | Non-member | taps restricted control | Static toast: "This event is for club members only…" | **Was** the same static string; **now** dynamic per founder | n/a (copy) | Mismatch vs founder spec | existing `eventRestrictionMessage` + existing Toast | Web now emits "Join {Club Name} to be able to attend this event." | `lib/permissions/eventAccess.ts`, `components/clubs/ClubProfileClient.tsx` | `eventAccess.test.ts` (5 cases incl. trim + fallback) | Fixed in web |
| Events | Save on a restricted card | Non-member | `can_open=false` | No Save control on the club-profile card | Save button already gated by `event.can_open` and not rendered | `saved_events` RLS requires event access | Match | existing gate | None | — | `eventAccess.test.ts` `canSaveEvent` | Already correct — no change |
| Events | Going count / attendee identities | Non-member | members-only | Not rendered on the club-profile card | `can_view_attendees=false`, counts zeroed, "Join the club to view attendees." | `event_rsvps` SELECT bound to event access | Match | existing mapping | None | — | 069 harness attendee rows | Already correct — no change |
| Events | Red audience badge placement | Any eligible viewer | restricted visibility | Badge keyed to **visibility**, rendered once on the image | `EventAudienceBadge` keyed to `event.visibility`, rendered once | n/a | Match | existing badge | None | — | existing tests | Already correct — no change |
| Events | Join transition | Non-member → member | joins club | Membership refresh re-runs RLS reads | `useClubRealtime` removes + invalidates membership caches | `club_members` drives the predicate live | Match | existing realtime hook | None | — | 069 harness join case | Already correct — no change |
| Events | Leave transition | Member → non-member | leaves club | Caches cleared, then refetch | Same clear-then-refetch | RLS revokes immediately | Match | existing hook | None | — | 069 harness leave case | Already correct — no change |
| Events | Officer create / edit / delete | Officer vs member | — | Live `club_members` re-check before mutating | `useOfficerClubs` + server re-check | `is_club_officer` on INSERT/UPDATE/DELETE | Match | `is_club_officer` | None | — | 069 harness (non-officer + demoted officer) | Already correct — no change |
| Events | Historical selected recipient | Former member | still on audience | IDs restored in `getEventForEdit` | IDs preserved in the edit hook | 070 validates only newly added IDs | Match | audience trigger | None | — | 070 harness; persona matrix | Already correct — no change |
| Events | Expiration boundary | Any | `event_end_at` reached | `isEventPastAt` `endMs <= now` | identical semantics | `event_end_at > now()` for RSVP mutation | Match | canonical helper | None | — | boundary tests + 069 harness | Already correct — no change |
| Posts | Comments / likes / tags / reporting | Author, viewer | — | `services/postService.ts`, `reportService.ts` | `usePostActions.ts`, `useReport.ts` | 057/064/069 policies | Match | existing policies | None | — | existing suites | Already correct — no change |
| Clubs | Join / leave | Any student | — | `leave_club` RPC | `leave_club` RPC | race-safe RPC + 054 last-officer trigger | Match | same RPC | None | — | existing club tests | Already correct — no change |
| Clubs | Officer assignment / removal | Officer | — | `add_club_officer` / `remove_club_officer` | **same two RPCs** | RPCs authorize internally | Match | same RPCs | None | — | existing tests | Already correct — no change |
| Clubs | Club editing | Officer | — | direct `clubs` update | direct `clubs` update | `clubs FOR UPDATE USING (is_club_officer(id))` | Match | existing policy | None | — | — | Already correct — no change |
| Profiles | Private profile / pending vs accepted follower | Viewer | target private | RLS-governed reads | RLS-governed; privacy flags drive UI only | 026/057 policies | Match | existing policies | None | — | existing profile suites | Already correct — no change |
| Social | Block / unblock | Either party | — | `block_user`, `unblock_user`, `current_user_blocks`, `get_my_blocked_users`, `target_is_blocked_from_current_user` | **identical five RPCs** | 057 block model | Match | same RPCs | None | — | `blocking.test.ts` | Already correct — no change |
| Messages | Sending / reading / participation | Participant | — | direct `messages` insert | direct `messages` insert | messages RLS + `can_post_in_channel` | Match | same policies | None | — | existing message tests | Already correct — no change |
| Messages | Former member / former officer access | Former participant | removed | membership triggers remove participant rows | `useClubRealtime` drops `messages`/`conversationHub`/`clubChannels`/`chatDetails` | participant RLS | Match | existing hook | None | — | existing tests | Already correct — no change |
| Messages | Group management (add/remove participant, archive, invitations) | Participant | — | RPCs exist and are used | **web does not implement these features** | RPCs authorize internally when called | Not a permission mismatch — a feature-scope gap | — | None (building them is feature work, not parity) | — | — | Product decision required |
| Search | People / clubs scope, blocked and restricted filtering | Any student | — | `search_discovery` etc. | **same RPCs** | caller-bound, block/restriction aware | Match | same RPCs | None | — | existing tests | Already correct — no change |
| Notifications | Recipient eligibility and event-target filtering | Recipient | — | RLS-filtered | RLS-filtered | 070 notifications policy | Match | single policy | None | — | 069 harness (with positive control) | Already correct — no change |
| Saved content | Access lost after audience change | Former recipient | — | roots removed before refetch | roots removed before refetch | `saved_events` RLS | Match | existing eventSync | None | — | 069 harness | Already correct — no change |
| Realtime / cache | Officer promotion / demotion, join, leave | Any | club change | `useClubRealtimeSync` + officer-status refresh | `useClubRealtime` removes + invalidates `officerClubs`, `clubMemberList`, `myClubs`, chat roots | `club_members` is authoritative | Match | existing hook | None | — | existing tests | Already correct — no change |
| Realtime / cache | Attendee list after access change | Any | campus sync fires | `eventAttendees` is in mobile's invalidate roots | **was missing** from web's invalidate roots (only in the clear path) | RLS still filters on refetch | Mismatch | existing roots list | Added `eventAttendees` to web roots | `lib/studentSynchronization.ts` | `studentSynchronization.test.ts` | Fixed in web |
| Realtime / cache | Discovery search after block / restriction / deletion | Any | campus sync fires | `discoverySearch` is in mobile's invalidate roots | **was never invalidated** on web (30s stale window) | `search_discovery` filters on refetch, so no leak — but the cached page could keep showing a now-hidden person | Mismatch | existing roots list | Added `discoverySearch` to web roots | `lib/studentSynchronization.ts` | `studentSynchronization.test.ts` | Fixed in web |

### Observations recorded, deliberately not acted on

1. **Restricted detail-view copy differs across platforms.** Web's
   `EventDetailModal` shows "This event is for club members only. Join the club
   to RSVP and view attendees."; mobile's event detail shows "Join the club to
   RSVP". Both are passive state labels, not the restricted-control response the
   founder specified, and a non-member cannot reach either view (the card does
   not open). Changing them was out of scope; flagging for a copy decision.
2. **Mobile's club-profile toast still uses the old static string.** The founder
   specified the new dynamic message in the context of web. Mobile is the source
   of truth and was not edited — and any mobile copy change would need an OTA,
   which is not authorized. If the founder wants the wording identical on both
   platforms, that is a separate mobile task.
3. **`clubs FOR UPDATE` has `USING` but no `WITH CHECK`** (001). An officer could
   in principle update columns such as `university_id` on their own club. This is
   identical on both platforms, so it is not a parity defect, and adding a policy
   would have created the overlapping RLS this task forbids. Raised for a
   separate hardening task.


## Sensitive Mutation and Identity Integrity Audit (2026-08-05)

Threat model: the client is not trusted. Every row below was exercised as a real
`authenticated` caller — SQL with a JWT claim, and PostgREST over HTTP — i.e.
exactly what DevTools, a patched bundle, or a hand-written request can send.
Nothing here depends on a hidden input, a disabled button, a TypeScript type, or
a route guard.

Method: the live catalog was read first (57 public tables, RLS on all of them),
then each protected column was actually attacked before and after the fix.
PostgreSQL reuses a policy's `USING` expression as its `WITH CHECK` when none is
given, so self-bound predicates such as `user_id = auth.uid()` already prevent
moving a row to another user — that whole class needed **no** change and got
none. The real gap was columns the policies never mention.

### Fixed — migration 072 (protected identity immutability)

One generic `private.reject_protected_identity_change()` guard, attached to six
tables. Existing RLS still decides WHO may write; the guard decides WHICH COLUMNS
can never change afterwards. It is SECURITY INVOKER on purpose, so trusted paths
(SECURITY DEFINER RPCs/triggers owned by postgres, service_role maintenance,
migrations) are unaffected and keep working.

| Table | Column | Actor who could rewrite it | Consequence | Now |
| --- | --- | --- | --- | --- |
| profiles | university_id | any student, own row | move self to another university | blocked |
| profiles | email_verified | any student, own row | self-assert verification | blocked |
| profiles | is_seed | any student, own row | forge seed/demo status | blocked |
| profiles | created_at | any student, own row | rewrite account history | blocked |
| clubs | university_id | club officer | move a club to another university | blocked |
| clubs | created_at | club officer | rewrite club history | blocked |
| clubs | member_count | club officer | inflate discovery ranking | blocked |
| clubs | is_seed / claimed | club officer | forge seed/claimed status | blocked |
| events | created_by | club officer | reassign event authorship | blocked |
| events | club_id | officer of two clubs | move an event between clubs | blocked |
| club_members | user_id | club officer | reassign a membership to another person | blocked |
| club_members | club_id | club officer | move a membership to another club | blocked |
| posts | created_at | post author | rewrite post history | blocked |
| event_rsvps | id | RSVP owner | rewrite an attendance primary key | blocked |
| all six | id | as above | rewrite a primary key | blocked explicitly |

### Already secure — verified, deliberately not duplicated

| Attack | Why it already fails |
| --- | --- |
| Change `profiles.id` / edit another user's profile | `id = auth.uid()` is reused as the WITH CHECK |
| Change `posts.author_id`, edit another author's post | `author_id = auth.uid()` reused as WITH CHECK |
| Reassign `event_rsvps.user_id`, `notifications.user_id` | self-bound predicates reused as WITH CHECK |
| Member self-promotes to officer | `is_club_officer(club_id)` is false for a member |
| Non-member / non-officer / former officer edits a club | officer predicate reads `club_members` live |
| Officer of another club edits this club | predicate is per-club |
| Add self to a private conversation | `conversation_participants` insert policy |
| Forge a follow or a block on someone else's behalf | self-bound insert policies |
| Save an event for another user | `saved_events` self-bound policy |
| Update any `reports` row | that permissive policy is granted to `service_role` only, not `authenticated` |
| Change a university row | `universities` has no UPDATE policy for clients |
| Unauthenticated club edit | HTTP 401 |

### Deliberately NOT changed

`posts.club_id` is writable by any student on insert and update. This is not a
defect: both clients let any user tag any active club (the picker lists all
active clubs with no membership filter), and the audit already records official
club posts as intentionally shared-context content across a personal block.
Locking it would break a shipped feature and change post audience rules, which
this task excludes. One consequence is worth a product decision rather than a
silent change: because migration 069's posts SELECT policy treats
`club_id IS NOT NULL` as a bypass of the private-account and blocking branch, a
private account can make one of its posts campus-visible by tagging a club.
**Product decision required** — is that intended for private accounts?

### Club schema classification

| Class | Columns |
| --- | --- |
| A — officer-editable content | name, description, avatar_url, banner_url, cover_image_url, meeting_day, meeting_time_start, meeting_time_end, meeting_location, meeting_building, meeting_room, meeting_schedule, is_active (mobile's soft delete) |
| B — system-controlled via an approved path | member_count (update_club_member_count), university text (sync_university_name), updated_at, last_activity_at, inactivity_warned_at |
| C — immutable protected identity | id, university_id, created_at, is_seed, claimed |
| D — product decision | handle (public slug / search identifier): no client writes it today and it is not an authorization scope, so it was left officer-editable rather than locked. Confirm whether it should become immutable. |

Note: `clubs` has no `created_by` column, so there is no club creator field to
protect — club ownership is expressed entirely through `club_members.role`.

### Verification

- `test_072_protected_identity.sql` — catalog + behaviour, including the
  founder's Nature Club -> Forest Club rename with club id, university,
  members, officers and events all still connected afterwards; a mixed
  `name + university_id` request that must reject wholesale and persist neither
  field; and wrong-actor cases (member, non-member, other-club officer, former
  officer).
- Negative control: neutering the guard's body while leaving its triggers
  registered makes the behaviour harness fail on "officer moved a club to
  another university", so the assertions are not vacuous.
- HTTP club-manipulation matrix: 20/20, every protected field rejected with
  HTTP 403 and the club name unchanged after every attempt.
- Persona API matrix re-run with 072 applied: 38/38, no regression.

### Harness defect found and fixed along the way

The compact 057 fixture leaves **RLS disabled on `clubs` and `club_members`**.
Any earlier local assertion about who may edit a club was therefore vacuous —
no policy was consulted at all. `test_072_protected_identity.sql` now enables
RLS and recreates the owning policies (001 clubs update, 034 club_members
update, 063 events update) before testing, so its wrong-actor cases are real.


## Blocking, Shared Content, Private Club Tags and Club Identity (2026-08-05, migration 073)

Columns: Actor | Block direction | Shared context | Mobile | Web | Backend | Reused | Mismatch | Correction | Tests | Status

| Actor | Block dir. | Shared context | Mobile | Web | Backend | Reused | Mismatch | Correction | Tests | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Blocked student reads blocker's club-tagged post | either | club profile / direct link / saved / notification / shared message | RLS-governed | RLS-governed | **069 let `club_id IS NOT NULL` bypass the blocking branch** | `blocked_user_ids()` (already symmetric) | **Yes — real leak** | 073 evaluates blocking FIRST for every post, club-tagged included | `test_073` negative + positive control | **Fixed in backend** |
| Ordinary viewer reads a private author's club-tagged post | none | club profile | allowed | allowed | exception kept | same policy | No | none | `test_073` positive control | Already correct — no change |
| Non-follower reads a private author's personal post | none | anywhere | hidden | hidden | privacy branch | same policy | No | none | `test_073` | Already correct — no change |
| Blocker / blocked profile row | either | any | hidden | hidden | 058 `profiles` policy hides the row both ways | 058 | No | none | existing | Already correct — no change |
| People search finds the blocker | either | search | filtered | filtered | block-aware RPCs | 057 RPCs | No | none | existing | Already correct — no change |
| Shared post/event in a message | either | DM / group | fetches target; renders **"This post is no longer available."** / **"This event is no longer available."** | **rendered a "View shared post" link from the id alone, never checking access** | RLS on the embedded row | mobile wording + existing `useQuery` | **Yes** | web now resolves availability (id-only select, no payload) and renders the same canonical wording | web type-check/build; wording matches mobile verbatim | **Fixed in web** |
| Unblock restores access | either | all surfaces | subscribes `sync:access:<uid>` | subscribes `sync:access:<uid>` | **`user_blocks` emitted no signal at all** | 066 topic + both existing listeners | **Yes** | 073 broadcasts an opaque `{}` to BOTH parties on INSERT/DELETE | `test_073` catalog assertion | **Fixed in backend** |
| Club rename | n/a | club | officer edits name | officer edits name | handle was client-supplied and globally unique | existing officer RLS + 072 guard | **Yes** | 073 derives handle from name atomically; university-scoped uniqueness | `test_073` + 20/20 club matrix | **Fixed in backend** |
| Duplicate club name at same university | n/a | club | — | — | none | 073 normalization | **Yes** | rejected outright, **never** numbered | `test_073` (create + rename, case/whitespace variants) | **Fixed in backend** |
| Same club name at a different university | n/a | club | — | — | globally unique handle blocked it | 073 scoped indexes | **Yes** | allowed | `test_073` | **Fixed in backend** |
| Officer supplies handle directly | n/a | club | — | — | trusted | 073 derivation trigger | **Yes** | always re-derived from the name | `test_073` | **Fixed in backend** |
| Officer moves club/university, rewrites id | n/a | club | — | — | 072 guard | 072 | No | none | club matrix 20/20 | Already correct — no change |
| Structural identity of a blocked person in club members / group participants | either | shared club or chat | not verified this pass | not verified this pass | 058 hides the profile row entirely, so shared lists lose the person | — | **Unresolved** | none — see below | — | **Product decision required** |

### Contracts introduced by 073

- **Name normalization:** `public.normalized_club_name(text)` = lower + trim + internal whitespace collapsed. `Forest Club`, `forest club`, `FOREST CLUB`, `" Forest Club "`, `Forest     Club` all collide **within one university**.
- **Handle derivation:** `public.club_handle_from_name(text)` strips every non-alphanumeric character, preserving the officer's capitalisation. `Nature Club → NatureClub`, `Forest Club → ForestClub`, `Robotics 2026 → Robotics2026`. Comparison is case-insensitive.
- **Atomicity:** one BEFORE trigger sets the handle from the name on the same statement, so name and handle always move together or not at all. A client-supplied handle is overwritten, never trusted.
- **No invented numbers:** a collision raises `club_name_already_exists_at_university` (SQLSTATE 23505). Nothing is renamed, nothing is suffixed, nothing partially saves. Two university-scoped unique indexes remain the concurrent-safe guarantee.

### Existing-data inspection

Checked before adding the indexes: **zero** normalized name or handle collisions among the clubs present in the local chain. This check ran against a fresh local reset of migrations 001→073 plus QA seed, **not** against production — production must be re-checked with the same two queries before this migration is applied remotely.

### Handle-based lookup audit

`grep` across both apps found **no** handle-based lookup anywhere: every club read, route, deep link, notification and saved reference uses the immutable club id. Making the handle university-scoped therefore introduces no ambiguity and required no route changes.

### RESOLVED — structural identity under a block (founder, 2026-08-06, migration 074)

The previous pass diagnosed but did not change this: migration 058 hides a blocked person's `profiles` row in both directions, so they disappeared entirely from club member lists, officer lists and group participant lists. The founder has resolved it in favour of **preserving minimal structural identity in authorized shared contexts only**. Implemented in migration 074 — see the dedicated section below.

## Genuine product ambiguities

- There is no user-visible mobile event-search result surface: `useDiscoveryEvents`
  remains an unused legacy hook. Its server inner query is still audience-filtered,
  but it has no audience-badge UI to change. It was not revived or redesigned.
- The current product contract deliberately retains historical group/club-chat
  context across a personal block and keeps official club posts as shared-context
  content. These are explicit migration comments and were not broadened here.


## Shared-Context Identity, Directional Blocking, and Message Content Types (2026-08-06, migration 074)

Mobile is the source of truth; every change below lands on both platforms.

### 1. Structural identity in authorized shared contexts

**The general `profiles` SELECT policy (058) is unchanged.** A blocked person's
profile, posts, weekly events and general search presence remain inaccessible in
both directions. What 074 restores is only the identity a shared space needs in
order to be readable at all.

| Reader | Authorization | Returns | Refuses |
| --- | --- | --- | --- |
| `public.club_shared_identities(p_club_id)` | `auth.uid()` + `current_student_can_access_app()`. Mirrors the CURRENT `club_members` SELECT rule (`USING (true)` for authenticated) — neither broadened nor narrowed. | `id, username, full_name, avatar_url, role` for **current** members only | former members; ineligible accounts; anonymous callers |
| `public.conversation_shared_identities(p_conversation_id)` | `auth.uid()` + `is_conversation_participant()` — the existing conversation rule | `id, username, full_name, avatar_url` for participants + active-message senders | non-participants get **zero rows**; private rosters never leak |

Both take **only a scope argument** — there is no viewer parameter, so
impersonation is structurally impossible (asserted: passing `p_viewer` is a
hard error). Both are `SECURITY DEFINER` with a fixed empty `search_path`.
Neither returns bio, posts, events, interests, activities, follow state,
privacy flags, email, university or any administrative column. **Neither
discloses that a block exists**: every current member/participant is returned,
so the result is byte-identical with or without one.

Client changes replace ONLY the data source that RLS had emptied:

| Surface | Was | Now |
| --- | --- | --- |
| web `getClubMemberList` | `profiles!inner` — dropped the row, and `count` under-reported the club | `club_members` + `club_shared_identities` |
| mobile `getClubMembers` | `profiles!inner`, username search via `profiles.username` | `club_members` (unchanged ordering/pagination) + `club_shared_identities`; search resolves through the same source |
| web `getConversationDetail` | `profiles!user_id` embedded null | fills only the null participants |
| web `getThread` / `getSharedMessages`, mobile `getThreadMessages` / media / files | `sender.username` fell back to `""` | falls back to shared identity |

No list or card was redesigned.

### 2. Directional blocked-profile outcomes

| Viewer | Backend signal | State |
| --- | --- | --- |
| Was blocked | profile row absent; `current_user_blocks` = **false** | canonical `UNAVAILABLE_TITLE` / `UNAVAILABLE_BODY` — byte-identical to deleted and never-existed, so the state cannot disclose which occurred. No posts, weekly events, Follow, Message or Unblock. |
| Created the block | profile row absent; `current_user_blocks` = **true** | new `YOU_BLOCKED_TITLE` / `YOU_BLOCKED_BODY` + **Unblock** |

The directional question uses the **existing** `current_user_blocks` RPC — no
new backend surface. It is true only for the person who created the block, so
"target blocked viewer" is never expressed as a state. Unblock calls the same
`useUnblockUser` / `unblockMutation` as the profile menu (web's two entry points
now share one `runUnblock`), so there is exactly one unblock implementation and
073's access-sync convergence applies unchanged. Both clients wait for the
directional answer before rendering, so the blocker never flashes the generic
state first.

### 3. Every shared-message content type

| Type | Native or reference | Owner | Protected by | Block applies | Behaviour while blocked | After unblock |
| --- | --- | --- | --- | --- | --- | --- |
| `text` | native | sender | `messages` participant RLS | **no** (by product contract) | history remains readable | unchanged |
| `poll` | native + `polls`/`poll_options`/`poll_votes` | sender | messages RLS + 067 poll policies | **no** (same contract) | history remains readable | unchanged |
| `image` | reference → Storage object | sender (`storage.objects.owner`) | `chat-attachments` SELECT policy → `private.active_chat_attachment_readable` | **yes (074)** | row kept; payload refused; canonical unavailable card | restored |
| `video` | reference → Storage object | sender | same | **yes (074)** | same | restored |
| `file` | reference → Storage object | sender | same | **yes (074)** | same | restored |
| `shared_post` | reference → `posts.id` | post author | posts SELECT policy (069 + 073) | yes (already) | id-only probe returns nothing; "This post is no longer available." | restored |
| `shared_event` | reference → `events.id` | event club | events SELECT policy (070) | yes (already) | id-only probe returns nothing; "This event is no longer available." | restored |

Ordinary text and poll history is deliberately **not** hidden: 040 and 057
record retaining shared conversation history across a personal block as the
product contract. Profile and personal-content access remain blocked
independently.

### 4. Attachment / storage findings

| # | Finding | Severity | Status |
| --- | --- | --- | --- |
| 1 | `chat-attachments` storage SELECT authorized on "active message + participant" and **never considered blocking**. Two students who had blocked each other but still shared a club or group chat could each fetch the other's image/video/file bytes — in-app, via a signed URL, or by replaying the object path straight at Storage. | **High — confirmed leak** | **Fixed (074)** — the existing helper is corrected in place, so the single existing storage policy starts refusing. Both directions. |
| 2 | Mobile cached signed URLs for 60s in a module-level `Map` that was **never cleared on an access change**, so a URL minted while authorized stayed reusable after a block. | Low — bounded by TTL | **Fixed** — `clearSignedAttachmentCache()` now runs inside `clearPermissionSensitiveStudentContent`. |
| 3 | `messages`, `clubMembers`/`clubMemberList` were not in either client's permission-sensitive clear roots, so the new identity and restricted-sender results could survive a block. | Low | **Fixed** — added to both roots lists. |

Verified NOT vulnerable: the `chat-attachments` bucket is **private**
(`public = false`), so no permanent public URL exists; `messages.attachment_url`
stores the storage PATH, never a URL; both clients render exclusively through
short-lived signed URLs (60s on each); no service-role key appears anywhere in
mobile or in web client code.

**Provenance limitation, stated plainly.** Every OFFICIAL share flow keeps a
reference to the original record — `shared_post_id`, `shared_event_id`, and an
attachment whose `storage.objects.owner` is the uploader — so the original
owner's RLS is what decides access, and 074 secures all of them. If a third
party screenshots, downloads and re-uploads someone else's media as a NEW file,
the new object's owner is the re-uploader and the database stores no link back
to the original author. **The application cannot infer ownership it does not
record, and this document does not claim otherwise.** That is a content-policy
and reporting problem, not an access-control one.

### 5. Verification

- Full local chain **001→074 including 067 and 068** — the first time these
  harnesses have run against the chain production actually has. Four
  environment gaps had to be bridged first (see
  `test_full_chain_grants_bridge.sql`).
- SQL harnesses green: 069, 070, 072, 073, 073 handle matrix (26/26), 074.
- HTTP matrices **47/47** (`matrix_074_http.py`) as real `authenticated`
  students over PostgREST and Storage: directional blocking, shared-context
  identity, all message types, direct storage access, club manipulation.
- Negative controls, both confirmed to FAIL the suite:
  restoring 067's block-blind attachment helper → 074 catalog check fails and
  HTTP D2 mints a signed URL for a blocked pair (the original leak);
  removing the participant gate from the conversation reader → HTTP B6/B7 fail.
- web 905/905, mobile 99/99, both type-checks clean, `next build` clean.

### 6. Production duplicate preflight for 073 (read-only, 2026-08-06)

Run against project `yoozrnosmqtaiksgcixc` ("We Glue") through an explicitly
read-only transaction (`current_user = supabase_read_only_user`,
`transaction_read_only = on`, `pg_is_in_recovery = false`). Production's ledger
is **68 migrations, latest `068`** — 069, 070, 072, 073 and 074 are NOT applied.
Nothing was created, updated, deleted, renamed or repaired.

| Check | Result |
| --- | --- |
| Duplicate normalized names within a university | **0** |
| Duplicate derived handles within a university | **0** |
| Empty or NULL club names | **0** |
| Empty derived handles | **0** |
| Clubs with NULL `university_id` | **0** |
| Valid cross-university duplicates | 0 (production has one university) |
| **Handles 073 would rewrite** | **6 of 6** |

**073 can be applied with no rename and no invented number.**

CORRECTION to the previous pass: applying 073 does **not** rewrite any existing
handle. `trg_clubs_derive_handle` is a BEFORE INSERT OR UPDATE trigger, so it
only fires when a club is created or edited; the two unique indexes are built
over the values already stored. Verified on the full local chain — after 001→075
the seeded clubs still hold their original hyphenated handles. The six rows
below are the ones whose handle *will* change **the next time an officer edits
that club**, not on the day 073 is applied. Four of them currently carry a handle
that does not match their own name — pre-existing drift from earlier renames:

| Club | Current handle | Derived handle |
| --- | --- | --- |
| Business Club | `business-club` | `BusinessClub` |
| Chess Club | `stock-market-club` | `ChessClub` |
| Clay Club | `nature-club` | `ClayClub` |
| Dog Club | `dog-club` | `DogClub` |
| Film club | `clay-club` | `Filmclub` |
| Tech Club | `number-club` | `TechClub` |

Re-verified for this pass: no handle-based lookup exists in either client. The
handle appears only as display text (`@{club.handle}`) and as one ILIKE field in
admin club search, alongside name. Every club read, route, deep link,
notification and saved reference is keyed by the immutable club id, so the
rewrite changes no route and no relationship.

The exact queries are committed at
`supabase/scripts/preflight_073_production_duplicates.sql`.


## Attachment Link Replay, Fresh-Database Permissions, Migration Order, Club Profile (2026-08-06)

### 1. Old attachment links kept working after a block — CONFIRMED, then FIXED

The founder's scenario was run exactly as written, and step 4 succeeded:

| Step | Result |
| --- | --- |
| 1-2 Lola holds a working signed image/video/file link | HTTP 200, bytes returned |
| 3 Silvana blocks Lola | — |
| 4 **the same link is replayed** | **HTTP 200, bytes returned** |

**Root cause.** A Supabase signed URL is a self-contained token. Storage
validates its signature and expiry and serves the object *without* re-evaluating
the bucket's RLS policy. Migration 074's blocking check was therefore correct and
still bypassable by anyone who had kept a link — for the whole TTL, and for a
link that could have been minted with any expiry the client asked for.

**Fix — the official delivery path no longer mints a link at all.** Both clients
now fetch `/storage/v1/object/authenticated/…` carrying the viewer's own access
token, so the `chat-attachments` policy runs on **every request**:

| | Was | Now |
| --- | --- | --- |
| web | `createSignedUrl(path, 60)` → `<img src=…>` | `storage.download(path)` → `blob:` URL, revoked on unmount |
| mobile | `createSignedUrl` + in-memory URL cache | authenticated `downloadAsync` into an app-private cache file; non-200 is treated as refused |

A `blob:` URL is not a credential: it resolves only inside that browsing context
and dies with the tab. Android file opening keeps working through a new
`openAttachmentExternally()` helper (`content://` grant via
`FileSystem.getContentUriAsync`), so no call site lost behaviour.

Proven by `supabase/scripts/matrix_attachment_replay.py` — **21/21**, including
the replay itself as an *asserted* fact so nobody reverts to signed URLs, plus
positive controls (the author and an unrelated participant still fetch), unblock
restoration, removed participants, deleted messages and unauthenticated fetches.
Browser-verified on a production build: while blocked the row renders
"This attachment is no longer available." with **0 blob images and 0 signed
URLs**; after unblock the image returns.

**Not claimed:** We Glue cannot recall a file the viewer already downloaded,
screenshotted or re-shared before the block. Nothing server-side can.

### 2. A fresh database could not run the product — FIXED (migration 075)

Every migration here assumed the old Supabase default privileges
(anon/authenticated/service_role got full DML on each new public table);
055/057/058/061/063 say so and REVOKE them back off the protected tables.
Current Supabase images grant `Dxtm` only, so a database built from this chain
had RLS policies everywhere and **no table privileges at all** — `authenticated`
could not read `posts`, `profiles` or `clubs`, and PostgREST answered "permission
denied" before any policy was consulted. A disaster-recovery rebuild would not
have come up. It stayed invisible because production still carries the old
defaults and the test fixture issued a blanket grant.

**Migration 075 grants privileges derived mechanically from `pg_policy`** — role
by role, table by table, command by command. A privilege is granted only where a
policy already authorises that role for that command; tables with no client
policy (admin audit, restrictions, deletion cases/jobs, email outbox, content
lifecycle, push pipeline, rate limits, chat invitations) appear nowhere and stay
unreachable. `user_blocks` is left to 057, which grants it SELECT and only
SELECT. There is no `ON ALL TABLES` anywhere.

`anon` is confined to the pre-authentication surface: SELECT on `universities`,
`clubs`, `club_interests`, `app_config` and INSERT on `deletion_requests`.

RPCs needed no change: of the 72 `supabase.rpc(...)` names both clients call, 65
already had explicit EXECUTE grants and the remaining 7 are service-role admin
routines that are correctly denied to students.

Verified by `test_075_client_table_privileges.sql` on a database built from
migrations **alone**. It is deliberately paired — ~90 positive checks that the
product's tables are reachable, and negative checks that protected/admin/
service-only tables are not, that `anon` cannot touch student content, that
`user_blocks` stays RPC-only, and — the mechanical one — **that no client role
holds a privilege without a policy authorising it**, which a blanket grant fails
immediately. The migration re-runs the protected-table half of that as a
fail-closed self-check, so a clean install aborts rather than shipping a readable
audit log.

`test_full_chain_grants_bridge.sql` is **deleted**: real migration coverage
replaced it, and all six pre-existing harnesses now pass with no bridge.

### 3. Migration 071 / PR #30 ordering — no renumbering needed

Neither PR was modified. Analysis (`supabase/scripts/check_migration_order.py`,
read-only, reads Git refs only):

- **No duplicate versions.** 071 exists only in PR #30.
- **No dependency either way.** 071 touches only the two pg_cron installer
  functions; 069–075 never reference cron or vault.
- PR #29 has an interior gap at 071 that it cannot see, and vice versa.
- Production is at **068**, so every pending version is above the high-water
  mark and a single `supabase db push` applies 069→075 in numeric order.

Proven, not asserted: PR #30's 071 was copied into the local chain (never
committed to this branch), `supabase db reset` applied
`069,070,071,072,073,074,075` in order, and all seven SQL harnesses plus both
HTTP matrices passed on that combined chain.

**Approved deployment order**

1. Merge PR #30 and PR #29 into `main` in either order — merge order does not matter.
2. Verify `main` contains 069, 070, 071, 072, 073, 074, 075 with no gap.
3. Apply **once**: `supabase db push` covering the whole 069→075 range.
4. Only then deploy web / consider a mobile release.

**The condition, and the only real hazard:** do not apply either PR's migrations
to production on its own. Applying one alone raises the high-water mark and turns
the other PR's versions into out-of-order inserts that `supabase db push` refuses
without `--include-all`.

### 4. Club profile stuck on its loading skeleton — DEV-SERVER ARTIFACT, with proof

Diagnosed to a definite answer rather than left as "local only".

**It is not data, not permissions, and not a failing query.** Every one of the
eight requests `getClubProfile()` makes returns HTTP 200 as a real authenticated
student, on a database built from migrations alone — driven request by request in
the new `supabase/scripts/matrix_club_profile.py` (**11/11**, including a negative
control that `anon` cannot read the roster). In the browser, 46 Supabase requests
completed with zero errors while the page still showed the skeleton, and the
React Query cache showed the club query had never been registered: the subtree
never finished hydrating, so React kept the server-rendered output — the skeleton.

**It is not the frontend source either.** A missing `<Suspense>` boundary around
the `useSearchParams()`-reading body looked like the cause and appeared to fix it
under `next dev`. It did not survive scrutiny:

| Environment | Boundary | Result |
| --- | --- | --- |
| `next dev` | absent | skeleton (first observation) |
| `next dev` | present | renders |
| `next dev` | absent | skeleton |
| **`next build` + `next start`** | **absent** | **renders** |
| `next build` + `next start` | present | renders |
| `next dev` (later, same source) | absent | renders |

The dev result is **non-deterministic** and the production build renders
correctly with the boundary absent — which is the shipped source. The failure
tracks `next dev`'s on-demand route compilation (the dev log shows
`✓ Compiled /club/[clubId]` on the same request that served the page), not the
component. **No source change was kept**, because none of them was the fix. The
same was re-checked for the messages thread: broken once under `next dev`,
correct on the production build without any change.

Recorded as an observation, deliberately not "fixed": `ClubProfileClient` and
`MessagesClient` read `useSearchParams()` in a nested body without a Suspense
boundary, while `UserProfileClient`, `OwnProfileClient` and `HomeClient` all have
one and document why. Adding it is defensible practice — Next.js asks for it —
but it fixes nothing observable here, so it belongs to a separate consistency
task rather than to this one.

### 5. Verification

- Full clean chain 001→075 from migrations alone, no fixture, no bridge.
- SQL harnesses: 069, 070, 072, 073, 073 handle matrix (26/26), 074, 075 — all green.
- HTTP matrices: shared-context/blocking **47/47**, attachment replay **21/21**,
  club-profile data path **11/11**.
- All seven new/updated harnesses registered in `harness_manifest.py` (29 total).
- web tsc clean, mobile tsc clean, web 913/913, mobile 103/103, `next build` clean.
