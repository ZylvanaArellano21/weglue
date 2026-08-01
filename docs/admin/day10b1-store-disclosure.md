# Day 10B1 — Store & Legal Disclosure Package
## Student-to-student blocking

**Branch:** `safety/student-blocking`
**Date:** 2026-07-31
**Status:** public documents updated in the repo. **No store console was accessed or modified.**

---

## 0. Evidence basis — read this first

| Source | Available? | Used for |
|---|---|---|
| Repo public documents (Privacy Policy, Terms, Child Safety) | ✅ read directly | the "current" column for **documents** |
| `apps/mobile/ios/WeGlue/PrivacyInfo.xcprivacy` | ✅ read directly | the on-device iOS privacy manifest |
| **App Store Connect → App Privacy answers** | ❌ **not available** | — |
| **Google Play Console → Data safety answers** | ❌ **not available** | — |
| Exported store record or founder screenshots | ❌ none in repo | — |

**Therefore:** every statement below about a *document* is verified against the repo. Every statement about a *store console answer* is marked **UNVERIFIED** and expressed as "what it must say", never as "what it currently says." No console answer is asserted, and nothing was submitted.

---

## 1. What Day 10B1 actually stores

This is the whole factual basis for the disclosure. `user_blocks` has **three columns**:

| Column | Type | Personal data? |
|---|---|---|
| `blocker_id` | uuid → profiles | **yes** — a user identifier |
| `blocked_id` | uuid → profiles | **yes** — a user identifier |
| `created_at` | timestamptz | timestamp |

No free text. No reason field. No IP, device, location, contact or advertising identifier. Rows are **deleted by FK cascade** when either account is deleted.

**Conclusion that drives everything below:** Day 10B1 adds *more of a data category the app already collects and must already declare* (**User ID**, linked to the user, for app functionality). It does **not** add a new data category.

---

## 2. Privacy Policy — UPDATED ✅

`apps/web/app/privacy-policy/page.tsx` — new section **"Blocking Another Student"**, covering every point required:

| Required | Covered |
|---|---|
| A user may block another user | ✅ with all four entry points named |
| We store blocker ID, blocked ID, creation timestamp | ✅ named explicitly, "exactly three pieces of information" |
| Used for safety, abuse prevention, app functionality | ✅ |
| The blocked person is not notified | ✅ |
| Block relationships are not publicly visible | ✅ incl. "no public count" |
| Only the blocker manages their list | ✅ |
| Blocking removes existing follows both directions | ✅ incl. the Gluemate consequence |
| Unblocking does not restore prior follows | ✅ |
| Prevents direct discovery/communication, but NOT official club or event information | ✅ with the officer example |
| Active block rows deleted when either account is deleted | ✅ |
| No ad identifier, contacts, precise location, third-party tracking | ✅ |
| **Does NOT promise absolute invisibility outside We Glue** | ✅ explicit paragraph on already-known public image URLs |

---

## 3. Community Guidelines — CREATED ✅

**Did not exist before.** New at `apps/web/app/community-guidelines/page.tsx`, linked from the landing-page Legal footer.

| Required | Covered |
|---|---|
| Students may block users who make them uncomfortable | ✅ "no reason needed, no need to report first" |
| Reporting and blocking are separate actions | ✅ its own section, plus "Blocking is not a report" |
| Blocking is immediate and does not notify | ✅ |
| Users may still share clubs, groups, official events | ✅ under "What blocking does not do" |
| We Glue may independently moderate reported behavior | ✅ "We act independently of whether you blocked the person" |
| Blocking does not guarantee deletion of historical shared-group content | ✅ stated plainly |

---

## 4. Terms of Use — MINIMAL UPDATE ✅

Audited `packages/shared/src/legal/termsAndConditions.ts` (354 lines, 23 sections).

| Requirement | Finding | Action |
|---|---|---|
| Prohibit harassment, threats, impersonation, stalking, abusive contact | **Already present** — §4 prohibits "Harass, threaten, stalk, bully, defame, abuse, impersonate, or intimidate"; §5 Zero-Tolerance lists cyberbullying, harassment, threats, abuse | none |
| Require compliance with community standards | **Already present** — §4, §5, §6 | none |
| We Glue may restrict accounts or remove content | **Already present** — §7, §12, §22 | none |
| **Distinguish user blocking from administrator enforcement** | **MISSING** | ✅ **added to §12** |
| **Must not claim administrator suspension exists yet** | See below | ✅ no change needed |

**On the "do not claim suspension exists" check:** §7 and §22 say We Glue *may* suspend or terminate access. That is a **reservation of right**, which is accurate today — access can be ended by other means — and is not a claim that a self-service administrator suspension feature exists. No wording implies a suspension console. **No change required**, and none was made. This must be re-examined in Day 10B2 when suspension actually ships.

**Added to §12:**
- users may block other users; blocking and reporting are separate actions
- blocking is immediate, not notified, and prevents direct contact only
- blocking does not remove either person from shared clubs/events/groups and does not hide official information
- **blocking is your choice about your own account — it is NOT a We Glue enforcement action and does not by itself cause us to review the other person**

---

## 5. Apple — App Privacy assessment

### 5.1 Verified fact from the repo

`apps/mobile/ios/WeGlue/PrivacyInfo.xcprivacy` currently contains:

```xml
<key>NSPrivacyCollectedDataTypes</key>
<array/>          <!-- EMPTY -->
<key>NSPrivacyTracking</key>
<false/>
```

**Observation, stated carefully.** The on-device manifest declares **no collected data types at all**, while the app demonstrably collects an email address, a username and user content. That is a **pre-existing gap that Day 10B1 did not create and does not depend on** — and it is *not* the same artifact as the App Store Connect App Privacy answers, which are maintained separately and which I cannot see. Flagged as a non-blocking finding for the founder to reconcile; **not changed here**, because changing a native manifest is out of Day 10B1 scope and would alter the native build.

### 5.2 Current vs required

| Field | Current | Required for Day 10B1 | Change? |
|---|---|---|---|
| Data type: **Identifiers → User ID** | **UNVERIFIED** (console not accessible) | **Collected** | Only if not already selected |
| Linked to the user | **UNVERIFIED** | **Yes** | Only if not already set |
| Used for **App Functionality** | **UNVERIFIED** | **Yes** | Only if not already set |
| Used for **Analytics / Product Personalization / Advertising** | **UNVERIFIED** | **No** — blocking adds none of these | Do **not** add |
| Used for **Tracking** (`NSPrivacyTracking`) | `false` (verified in manifest) | **stays false** | none |
| New data **category** introduced by 10B1 | — | **NONE** | — |

**Assessment: no NEW category is required.** `user_blocks` stores identifiers the app already collects and already needs to declare. Day 10B1 does **not** justify adding *Contact Info*, *Location*, *Contacts*, *Sensitive Info*, *Purchases*, or *Usage Data* on its own.

> Deliberately **not** claimed: that "no change is required." That would assert something about the console I cannot see. If **Identifiers → User ID / Linked / App Functionality** is already selected — which is very likely, since the app has authenticated accounts — then no change is needed. The founder must confirm.

**"Security/fraud prevention" purpose:** Apple's App Privacy has no such purpose option (that is a Google concept). Blocking maps to **App Functionality** on Apple. Do not invent a purpose.

### 5.3 Exact founder console steps

1. App Store Connect → **We Glue** → **App Privacy** → *Edit*
2. Under **Data Types**, confirm **Identifiers → User ID** is checked.
3. Open **User ID** → confirm **"Used for App Functionality"** and **"Linked to the user's identity"**.
4. Confirm **"Used for Tracking"** is **NO**.
5. If all four already hold → **no change**; note the date checked. Otherwise apply only the missing ones.
6. Save. (Republishing App Privacy does **not** require a new binary.)

---

## 6. Google Play — Data safety assessment

### 6.1 Current vs required

| Field | Current | Required for Day 10B1 | Change? |
|---|---|---|---|
| **Personal info → User IDs** — Collected | **UNVERIFIED** | **Yes** | Only if not already set |
| Shared with third parties | **UNVERIFIED** | **No** (accurate: no third party receives block data) | Confirm it stays No |
| Processed ephemerally | **UNVERIFIED** | **No** — block rows are stored | Confirm |
| Required or optional | **UNVERIFIED** | **Optional** — blocking is user-initiated | Confirm |
| Purpose: **App functionality** | **UNVERIFIED** | **Yes** | Only if not already set |
| Purpose: **Fraud prevention, security, and compliance** | **UNVERIFIED** | **Defensible and appropriate** — blocking is an anti-abuse control | Recommended, only if honest for the app overall |
| Purpose: Advertising / Analytics / Personalization | **UNVERIFIED** | **No** | Do **not** add |
| Data is encrypted in transit | **UNVERIFIED** | **Yes** (Supabase over HTTPS) | Confirm |
| Users can request data deletion | **UNVERIFIED** | **Yes** (in-app + web form, both live) | Confirm |
| New data **category** introduced by 10B1 | — | **NONE** | — |

**Assessment: no NEW category is required**, for the same reason as Apple. Play's *App activity → Other user-generated content* is **not** required: a block row contains no user-authored content, only two identifiers and a timestamp. Do not over-declare.

### 6.2 Exact founder console steps

1. Play Console → **We Glue** → **Policy → App content → Data safety** → *Manage*
2. **Data collection**: confirm **Personal info → User IDs** = *Collected*.
3. For **User IDs**: *Shared* = **No**; *Processed ephemerally* = **No**; *Required or optional* = **Optional**.
4. Purposes: **App functionality** ✔; **Fraud prevention, security, and compliance** ✔ (if accurate app-wide).
5. **Security practices**: *Encrypted in transit* = **Yes**; *Users can request data deletion* = **Yes**.
6. Save → **Submit for review**. Data safety changes are reviewed independently of a binary release.

---

## 7. App Review notes (draft — for the founder to paste)

```
WHAT CHANGED IN THIS VERSION
Student-to-student blocking. Students can block another student, which prevents
direct discovery and direct contact between the two accounts. This is our
user-controls-for-objectionable-content mechanism (Guideline 1.2), alongside the
existing in-app reporting flow.

WHERE TO FIND IT
1. Block from a profile
   Search tab -> search any student -> open their profile -> "•••" (top right)
   -> Block -> confirm.
2. Block from a direct conversation
   Messages tab -> open any direct chat -> "•••" (top right) -> Block.
3. Report and block together
   Profile "•••" -> Report -> choose "Report and block".
4. See and manage blocked accounts
   Profile -> Privacy Center -> Blocked Accounts.
5. Unblock
   Privacy Center -> Blocked Accounts -> Unblock, or the profile "•••" menu.

WHAT BLOCKING DOES
- The blocked student is not notified. There is no notification or indicator.
- Neither account can find the other in search, discovery, or by direct link.
- Neither can start a new direct conversation or send a new direct message.
- Any existing follow between them is removed in both directions.
- Both students remain in any clubs, events and group chats they already share,
  and official club/event information stays visible to both. This is
  deliberate: a student must not lose their club's meeting times or safety
  announcements because they blocked an officer.

PRIVACY
Blocking stores only the two account IDs and a timestamp. Nothing is shared with
third parties. No advertising identifier, contacts, precise location or
third-party tracking is used. Blocked-account records are deleted when either
account is deleted.

ACCOUNT DELETION is unchanged and remains available in-app at
Profile -> Account Center -> Delete Account.

TEST ACCOUNT: appreview@myschool.edu (password provided in App Review sign-in)
To test blocking, sign in and search for any other student account.
```

## 8. Play review notes (draft — for the founder to paste)

```
WHAT CHANGED
Student-to-student blocking, our user-controls mechanism for unwanted contact.

WHERE TO FIND IT
- Block from a profile: Search -> open a student profile -> "•••" -> Block
- Block from a chat:    Messages -> open a direct chat -> "•••" -> Block
- Report and block:     profile "•••" -> Report -> "Report and block"
- Manage/unblock:       Profile -> Privacy Center -> Blocked Accounts

BEHAVIOUR
Blocking is immediate and silent — the blocked user is not notified. It prevents
mutual discovery and all new direct messaging, and removes any existing follow
in both directions. Students stay in shared clubs, events and group chats, and
official club/event information remains visible to both, by design.

DATA SAFETY
The feature stores only two user IDs and a timestamp. Not shared with third
parties, not used for advertising or analytics, deleted when either account is
deleted. Our Data safety declaration covers this under Personal info -> User IDs
(app functionality; fraud prevention, security and compliance).

Community Guidelines: https://weglue.app/community-guidelines
Privacy Policy:       https://weglue.app/privacy-policy

TEST ACCOUNT: appreview@myschool.edu
```

---

## 9. Summary

| Item | Status |
|---|---|
| Privacy Policy | ✅ **updated and committed** |
| Community Guidelines | ✅ **created and committed** (did not exist) |
| Terms of Use §12 | ✅ **updated and committed** |
| Terms — suspension wording | ✅ reviewed, **no change needed** |
| Account-deletion documentation | ✅ reviewed, **unaffected by 10B1** |
| App Review notes | ✅ drafted (founder pastes) |
| Play review notes | ✅ drafted (founder pastes) |
| Apple App Privacy | ⚠️ **founder must verify** — no new category required |
| Play Data safety | ⚠️ **founder must verify** — no new category required |
| iOS `PrivacyInfo.xcprivacy` empty `NSPrivacyCollectedDataTypes` | ⚠️ **pre-existing finding**, not introduced or fixed here |

**No store console was accessed. No console answer is claimed. Nothing was submitted.**
