# Day 10B Restriction-Enforcement Hotfix — Production Release Report

**Released 2026-08-01.** Migration **060** applied to Production. Database-only. No OTA, no native build, no environment change.

---

## 1. Pull requests and merge commits

| PR | Title | Merge commit |
|---|---|---|
| **#12** | fix(security): guard create_poll and lock down check_club_inactivity | `56bb220b` |
| **#13** | fix(security): renumber restriction-enforcement hotfix 059 → 060 | `1f6cdf22` |

`main` HEAD `1f6cdf22`. Vercel Production deployment of `1f6cdf22` — **success**. Approved commits `3d5efc3f` and `1b7f641a` landed unchanged in #12; #13 is a pure renumber with no behavioural change.

### Why a second PR was required

While this hotfix was in review, **PR #11 (`feat: add web messages experience`) merged at 19:13:12Z and applied `059_messages_web_security_and_suggestions` to Production** — after the pre-merge verification and five minutes before #12 merged. GitHub reported #12 as `CLEAN` because there was no file conflict: #11 touched `apps/web` and `apps/mobile`, this hotfix touched `supabase/`. The collision was in the **migration version number**, which git cannot see.

Supabase keys applied migrations by version. A file still numbered `059` would have been treated as already applied and **silently skipped** — the security fix would never have run. That is exactly the quiet-failure class this migration exists to eliminate. Renumbered to **060**.

The two migrations do not overlap. 059 adds `get_message_suggestions`, `search_message_people` and `search_message_content` — all read-only, all already calling `public.current_student_can_access_app()`, all revoked from PUBLIC/anon and granted only to `authenticated` and `service_role`. They satisfy every coverage invariant.

---

## 2. Migration ledger

| Before | After |
|---|---|
| 055, 056, 057, 058, **059** (`messages_web_security_and_suggestions`) | … 059, **060** (`restriction_enforcement_hotfix`) |

Migration **051 remains absent** (0 rows in the ledger, 0 files in the tree). 060 was applied **exactly once**; no other migration was proposed or applied.

---

## 3. Migration 060 application result

Applied cleanly, no errors. Post-conditions self-verified inside the migration (it aborts the transaction if any invariant fails) and independently re-verified from the Production catalog below.

---

## 4. Exact `create_poll` signature (Production, post-apply)

```
public.create_poll(
  p_conversation_id uuid, p_channel_id uuid, p_question text, p_options text[],
  p_allow_multiple boolean     DEFAULT false,
  p_start_at       timestamptz DEFAULT NULL,
  p_end_at         timestamptz DEFAULT NULL,
  p_client_tag     uuid        DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql · SECURITY DEFINER · VOLATILE
pronargs = 8 · pronargdefaults = 4 · overloads = 1
```

Identical to the pre-fix signature: same parameter names, same order, same defaults, same return type. No client contract changed.

---

## 5. Before / after grant matrix (Production)

| Function | | PUBLIC | anon | authenticated | service_role |
|---|---|---|---|---|---|
| `create_poll` | before | ✅ `=X/` | ❌ | ✅ | ✅ |
| | **after** | ❌ | ❌ | ✅ | ✅ |
| `create_poll__inner` | **after** | ❌ | ❌ | ❌ | ✅ |
| `check_club_inactivity` | before | ✅ `=X/` | ✅ | ✅ | ✅ |
| | **after** | ❌ | ❌ | ❌ | ✅ |

`check_club_inactivity` final ACL: `postgres=X/postgres | service_role=X/postgres`.

**`create_poll`** — 1 overload, 8 params, 4 defaults, exact names, `json`, guard present, delegates to inner, `authenticated` ✅, `anon` ❌, PUBLIC ❌, `service_role` ✅.
**`create_poll__inner`** — exists, retains the original implementation (all three inserts into `messages`, `polls`, `poll_options`), retains the participant check and the `not_authenticated` error, unreachable by PUBLIC/anon/authenticated, `service_role` ✅.
**`check_club_inactivity`** — unreachable by PUBLIC/anon/authenticated, `service_role` ✅, **0 cron jobs, 0 triggers, 0 function callers** — no scheduler was added.

---

## 6. SECURITY DEFINER inventory (Production)

| | |
|---|---|
| Student-reachable SECDEF functions | 113 |
| **Guarded wrappers** | **48** |
| `__inner` functions | 48 |
| Orphaned inners (no wrapper) | **0** |
| Student-reachable inners | **0** |
| Wrappers with drifted signature | **0** |
| Wrappers missing the guard | **0** |
| **Unauthorized exposures** | **0** |
| Unresolved expected wrapper targets | **0** |
| Silently swallowed resolution errors | **0** |

**Student-reachable SECDEF writers: 4 — all justified exceptions, none unguarded:**

| Function | Reachable by | Justification |
|---|---|---|
| `auth_signup_status` | PUBLIC, anon, authenticated | Pre-authentication signup flow |
| `ensure_profile` | PUBLIC, anon, authenticated | Runs during sign-in, before restriction state exists |
| `replace_pending_signup` | PUBLIC, anon, authenticated | Pre-authentication signup flow |
| `delete_own_account_atomic` | authenticated only | Account deletion must work while restricted (App Store 5.1.1(v)) |

PUBLIC-executable SECDEF functions excluding trigger functions: **11** — the 3 pre-auth writers above plus 8 read-only RLS predicates (`is_conversation_participant`, `can_post_in_channel`, `is_club_member`, `is_club_officer`, `is_channel_club_officer`, `recent_club_preview_message_ids`, `can_manage_chat_invitation`, `preview_chat_invitation`). The raw count of 50 PUBLIC-executable SECDEF functions is dominated by **39 trigger functions**, which the database fires and no client can invoke.

---

## 7. Production before / after counts

| Table | Before | After |
|---|---|---|
| profiles | 65 | 65 |
| auth users | 66 | 66 |
| account_restrictions | 0 | 0 |
| admin_audit_events | 2 | 2 |
| clubs | 6 | 6 |
| messages | 104 | 104 |
| polls | 8 | 8 |
| poll_options | 17 | 17 |
| user_blocks | 0 | 0 |
| universities | 1 | 1 |

**Every count unchanged.** Active restrictions 0 · restriction audit events 0 · `banned_until` 0 · migration 051 absent · Lone Star College the sole university.

---

## 8. Confirmations

- **No club-inactivity process ran.** `clubs_warned` = 0, `clubs_inactive` = 0, both before and after. `check_club_inactivity()` was never executed against Production, and no cron job schedules it.
- **No poll was created.** `polls` 8 → 8, `poll_options` 17 → 17, `messages` 104 → 104. The restriction guard was exercised **only on the shadow database** (49/49, including a suspended and a platform-blocked participant both denied), never in Production.
- No account restricted · no session revoked · no QA restriction created · no user block changed · no profile or auth user created · no `banned_until` written · `ADMIN_WRITES_ENABLED` untouched · migration 058 byte-unchanged · no OTA · no native build · migration 051 not deployed.

---

## 9. Tests

060 harness **49/49** · SECDEF coverage **19/19** · 058 **87/87** · 057 **95/95** · concurrency **17/17** · web **843/843** · mobile **63/63** · type-checks **4/4** · `next build` **57/57** · Expo iOS + Android exports pass · idempotency 3× clean · secret scan clean.

**Negative controls still fail against a pre-fix database** — coverage suite 5 failures naming `create_poll` *and* `check_club_inactivity`; 060 harness 15 failures including a restricted student who created 3 polls and a student call to `check_club_inactivity` that EXECUTED.

---

## 10. Blockers

**None.**

## 11. Non-blocking findings

1. **PR #11 changed 4 mobile files** (`messages/index.tsx`, `ChatListItem.tsx`, `useChats.ts`, `chatService.ts`). Those are merged to main but **not published to devices**. That work may need its own OTA — it is not part of this hotfix and nothing was published.
2. **Migration 060's coverage block aborts if run on a database where a test harness has run**, because the harness helper `t_ok` is a SECDEF writer granted to `authenticated`. Zero Production impact (no `t_*` functions exist there) and idempotency is clean on a real database. Left unpatched deliberately — it would alter an approved security migration.
3. **`ADMIN_WRITES_ENABLED` could not be read directly** (no Vercel CLI or token available). Evidence it remains false: the read is `process.env.ADMIN_WRITES_ENABLED === "true"` (strict, fail-closed), and `account_restrictions` = 0 with `admin_audit_events` = 2 proves no administrator write has ever occurred. Direct confirmation requires founder Vercel access.
4. **The `EXCEPTION WHEN OTHERS THEN NULL` pattern in migration 006** is the same silent-failure class that hid both defects. Untouched here; worth a sweep of older migrations.
5. **`check_club_inactivity` still has no scheduler.** 006's `cron.schedule` never registered. 060 deliberately does not switch it on — enabling club soft-deletion is a product decision.

---

## 12. Controlled-validation preparation — re-run

| Check | Result |
|---|---|
| `create_poll` bypass closed | ✅ guarded, PUBLIC/anon revoked, inner unreachable |
| `check_club_inactivity` unreachable to students and anonymous callers | ✅ PUBLIC/anon/authenticated all revoked |
| SECURITY DEFINER sweep passes | ✅ 0 unauthorized exposures, 0 unresolved targets |
| Production at zero restrictions | ✅ 0 total, 0 active, 0 `banned_until` |
| QA candidates still technically safe | ✅ both unchanged, all counters 0 |
| Four-action validation sequence still valid | ✅ unchanged |

**QA candidates (sanitized, unchanged since the original preparation):**

| Masked id | Masked email | Last sign-in | clubs / posts / msgs / convs / follows / polls / restrictions |
|---|---|---|---|
| `2b2c0aee…` | `ca***@school.edu` | 2026-07-28 | 0 / 0 / 0 / 0 / 0 / 0 / 0 — **recommended** |
| `2c3c9854…` | `sa***@school.edu` | 2026-07-25 | 0 / 0 / 0 / 0 / 0 / 0 / 0 — backup |

**Predicted permanent evidence — unchanged:**
- **2** restriction-history rows, both ending `lifted`, 0 active
- **4** correlation groups (suspend, unsuspend, block, unblock)
- **8** audit events — **4 measured** from the `admin_tx_*` RPCs (one per action) plus **4** from the Auth revocation leg (`attempt` + `success`, on suspend and block only; lifts do not revoke)

**The founder must still privately confirm credentials for the selected masked QA account.** Nothing in the database records who holds a password.

---

## 13. Recommendation

# GO for the controlled Production validation

The `create_poll` bypass is closed and verified from the Production catalog; `check_club_inactivity` is internal-only with no scheduler introduced; the SECURITY DEFINER sweep reports zero unauthorized exposures and zero unresolved wrapper targets; Production data is byte-for-byte unchanged.

**Administrator writes remain disabled and the controlled validation has not been performed.** Enabling `ADMIN_WRITES_ENABLED` and executing the four-action sequence both remain pending founder approval.
