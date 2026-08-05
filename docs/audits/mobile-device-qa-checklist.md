# Mobile physical-device QA checklist — PR #29 (event permission parity)

Scope: the mobile scenarios that **cannot** be proven by the automated suites.
Everything provable at the data layer is already covered by
`supabase/scripts/test_069_web_permission_parity.sql`,
`test_070_cross_platform_event_permission_parity.sql`, the vitest suites, and
the local persona API matrix. Those runs establish that the *backend refuses*
the wrong caller. What remains is device-only: rendering, gesture, navigation,
push delivery, cache eviction on a real client, and OS-level behaviour.

**Do not run this against production accounts.** Use the disposable club and
the seven persona roles below.

## Accounts to prepare

| Role | Setup |
| --- | --- |
| Club officer | officer of the QA club |
| Club member | member, never selected |
| Selected member | member, on a selected event's audience |
| Unselected club member | member, deliberately not on that audience |
| Club non-member | same campus, not in the club |
| Former member | was a member, left after the event was created |
| Historical selected recipient | was selected, then left the club |

Events: one `everyone`, one `members`, one `specific` (selected member +
historical recipient), one already ended.

## Why these need a device

`iOS` and `Android` columns: **Both** means run it twice — the platforms differ
in cache eviction, push handling, and deep-link routing, which is exactly where
these scenarios can diverge.

| # | Scenario | Role | Setup | Action | Expected result | Failure indicators | Both OS? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Selected-member search | Officer | Create event, choose **Selected members** | Type a partial username, then a partial full name | Only current club members appear; results match both partials | Non-members appear; own account appears; empty results for a valid partial | Both |
| 2 | Search excludes the creator | Officer | Same picker | Search own username | Own account never listed | Officer can select themselves | One (iOS) |
| 3 | Multi-select | Officer | Picker open | Select 3 members | All 3 chip in; count is right | Selection replaces instead of adds | Both |
| 4 | Duplicate prevention | Officer | Picker open | Tap the same member twice | Selected once; second tap deselects or no-ops | Duplicate chips; save rejected with an opaque error | Both |
| 5 | Removal | Officer | 3 selected | Remove one, save | Saves with 2; removed person loses access | Removed chip reappears after save | Both |
| 6 | Audience badge — single | Selected member | Selected event live | Open Home, Calendar, Saved, detail | Exactly **one** red "Selected members only" badge per card | Two badges on one card; badge missing on a surface | **Both** |
| 7 | Badge on past events | Any eligible | Ended selected event | Open club Past section | Badge still shown | Badge disappears once past | Both |
| 8 | Selected-event visibility | Unselected member | Selected event live | Scroll Home, open club profile, search | Event never appears | Any card, title, or image visible | **Both** |
| 9 | Selected-event visibility | Non-member | Same | Same | Event never appears | Same | Both |
| 10 | Members-only preview | Non-member | Members-only event | Open club profile | Preview card with one red "Members only" badge; not tappable through to detail | Card opens full detail; badge missing | **Both** |
| 11 | Restricted action guidance | Non-member | Same preview | Tap RSVP / Save / Going | Approved join guidance appears; nothing mutates | Silent no-op, raw error text, or the action succeeding | Both |
| 12 | Attendee restriction | Non-member | Members-only event with attendees | Try to reach Going/attendees | Never reachable; no names or counts shown | Attendee names or a non-zero count visible | **Both** |
| 13 | Historical recipient retention | Historical recipient | Left club, still on audience | Open the selected event | Still opens; content intact | Access lost purely from leaving | **Both** |
| 14 | Officer edits with a former recipient attached | Officer | Same event | Change only the title, save | Saves; former recipient still listed and still has access | Save rejected; recipient silently dropped from the list | **Both** |
| 15 | Recipient removal | Officer → historical recipient | Same event | Remove the former recipient, save | They lose access on next open | Retains access after removal | Both |
| 16 | Cannot re-add an ineligible person | Officer | Same event | Try to re-add the former member | Rejected with a clear message | Accepted, or a raw DB error string shown | Both |
| 17 | Join transition | Non-member → member | Members-only event visible as preview | Tap Join | Access appears **without** re-login; card becomes openable | Requires app restart or logout to update | **Both** |
| 18 | Leave transition | Member → non-member | Member of the club, cards loaded | Leave the club | Restricted cards, detail, saves, attendees and club chat data disappear before any refetch completes | Stale card or detail flashes with real content | **Both** |
| 19 | Officer demotion | Officer → member | Demoted from another device | Reopen the event editor | Officer-only actions gone immediately | Still able to open the picker or save an edit | **Both** |
| 20 | Audience removal while the event is open | Selected member | Detail screen open in the foreground | Officer removes them from another device | Open detail clears; no stale payload remains | Content stays on screen until manual navigation | **Both** |
| 21 | Cache clearing | Selected member | Access lost as in 20 | Background the app, reopen | Event absent everywhere: Home, Saved, Calendar, notifications | Reappears from persisted cache | **Both** |
| 22 | Saved Events after access loss | Selected member | Event saved, then access removed | Open Saved Events | Entry gone; no title or image | Saved row still rendered | **Both** |
| 23 | Notification after access loss | Selected member | Had an event notification, then removed | Open notifications | Notification gone; no preview text | Preview still readable | **Both** |
| 24 | Push notification content | Selected member | Trigger an event push, then remove access | Observe the OS notification and tap it | No further pushes; tapping an old one lands on a safe unavailable state | Push body leaks the event; tap opens real content | **Both** |
| 25 | Deep link after access loss | Unselected / former | Have the event URL | Open the deep link | Safe unavailable state — never a partial render | Title or details flash before the error | **Both** |
| 26 | Exact expiration | Member | Event ending in ~2 minutes | Watch across the end time | At the exact end it becomes past — no RSVP, no cancel | Still RSVP-able a minute past; or expires early | **Both** |
| 27 | Upcoming → Past movement | Member | Same event | After the end time, check Home, Upcoming, club Past | Leaves Home and Upcoming, appears in club Past | Lingers in Upcoming or vanishes entirely | **Both** |
| 28 | RSVP history retained | Member | RSVP'd before it ended | After expiry, view the event | Prior RSVP still shown as history | History wiped | Both |
| 29 | Past audience privacy | Unselected member | Ended selected event | Try Home, club Past, deep link | Still invisible after it ended | Expiry loosens the audience rule | **Both** |
| 30 | Central Time correctness | Member | One event in CST (January), one in CDT (July) | Compare displayed end time to the club's local time | Both correct; no one-hour drift | An hour off on either side of the DST change | **Both** |
| 31 | Offline / poor network | Selected member | Access removed while offline | Reconnect | Clears on reconnect; no stale content served meanwhile | Offline cache serves the event indefinitely | Both |

## Sign-off

Record for each row: **Passed / Failed / Blocked**, device model, OS version,
and build number. A row that cannot be exercised is *Blocked*, never *Passed*.
Rows 6, 8, 10, 12, 13, 14, 17–27, 29, 30 are the merge-blocking set — they are
the ones with no automated equivalent.
