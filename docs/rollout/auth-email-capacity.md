# Auth email capacity for the rollout

Status: acceptance-spec update and local parity documentation only. No hosted Supabase setting is changed here. The email-capacity requirement is not passed by the realistic model alone.

## Current limits and first-hour budget

Production is already using custom SMTP through Resend (`smtp.resend.com:465`), not Supabase's default mailer. Supabase's documented default-mailer ceiling is **2 emails/hour**, but it is **not applicable** to this project. With custom SMTP, Supabase documents a starting limit of 30 emails/hour that is adjustable through Rate Limits; the documentation states no upper bound or Free-plan restriction, and production is already set to `rate_limit_email_sent = 1000` ([Supabase Auth SMTP](https://supabase.com/docs/guides/auth/auth-smtp)).

### Acceptance model A — realistic launch hour (production parity)

Planning assumption for the first hour:

- 500 signups × 1 verification email = 500 events.
- 20% resends = 100 events.
- 10% password-reset confusion = 50 events.
- Total: **650 email events**. Email-change confirmations are later demand; with `mailer_secure_email_change_enabled = false`, each change sends one email to the new address.

| Constraint | Current limit | Effect on 650 events |
| --- | ---: | --- |
| Supabase built-in SMTP | 2/hour | **Not applicable**; production uses Resend custom SMTP |
| Supabase `rate_limit_email_sent` | 1,000/hour | 650 fits; **350/hour headroom** |
| `smtp_max_frequency` | 60 seconds per identity | Does not bite distinct users; limits one user's rapid resends, alongside the client resend cooldown |
| Resend Free | 100 emails/day | 650-event burst is impossible; even 500 initial verifications exceed the plan |
| Resend Pro | 50,000 emails/month, $20/month | 650 in one hour and roughly 500 verified students/day fit, subject to shared transactional volume |

The Resend account quota is likely shared with edge-function transactional mail using `RESEND_API_KEY` / `RESEND_TRANSACTIONAL_FROM`; subtract that expected volume from the Resend daily/monthly budget.

This model fits the current production Supabase `rate_limit_email_sent = 1000/hour` with 350/hour of Supabase-side headroom. It is production-parity evidence only; it does not pass the stronger email-capacity requirement below.

### Acceptance model B — stress / headroom test

The originally approved stronger test is 500 initial verification emails + 500 resend #1 + 500 resend #2 + 500 password resets + 500 email-change messages: approximately **2,500 Auth email-triggering requests** before any additional retry/headroom. This is a staging test only.

On staging, keep custom SMTP through the current Resend configuration and attempt a higher configurable Auth email limit, targeting `rate_limit_email_sent = 5000/hour`. Record whether Supabase accepts that value with the current Free plan plus custom SMTP. Do not change production from 1,000/hour during this work. Staging must mirror production's secure-email-change state: `mailer_secure_email_change_enabled = false` / local `double_confirm_changes = false`; with secure email change disabled, each email change is one message to the new address.

If staging accepts and reliably exercises 5,000/hour (or the exact lower/higher value Supabase accepts), the later founder approval request must name the exact production change: **Supabase Dashboard → Project → Authentication → Rate Limits → email-sent/hour (`rate_limit_email_sent`), from 1,000 to the accepted staging value**. That request is contingent on a Resend plan that explicitly supports the burst: Resend Free is not sufficient; at minimum Resend Pro (or a higher/explicitly quota-approved plan) and confirmation of 5,000-send burst capacity plus shared transactional headroom are prerequisites. This document does not make that production change.

## Founder answers

- **Current Auth email limits:** custom SMTP is active; `rate_limit_email_sent = 1000/hour`; `smtp_max_frequency = 60s` per identity; `hook_send_email_enabled = false`; `mailer_autoconfirm = false`; `mailer_secure_email_change_enabled = false`; `security_refresh_token_reuse_interval = 10`. Production also reports `rate_limit_verify = 30` and `rate_limit_otp = 30` for verification/OTP requests.
- **Realistic 500-signup burst:** 650 events are below the current Supabase cap by 350. This production-parity model fits, but it is not the final capacity pass gate. The Resend plan is the real external constraint: Free cannot carry the burst; Pro can, assuming sufficient shared quota.
- **Stress/headroom model:** 2,500 Auth email-triggering requests must be validated on staging against a target 5,000/hour Auth limit. Do not infer a production pass from the 650-event result.
- **Supabase Free without a paid Supabase change:** **Yes for the realistic 650-event model only.** The stronger model still requires the staging limit-acceptance and reliability test; production remains at 1,000/hour unless separately approved later.
- **Outbox or Send Email Hook required:** Not decided yet; this remains TEST-FIRST. Direct SMTP is PREFERRED because it is simpler, and is expected to be sufficient — but this is not yet proven.

## Staging test matrix

Staging must use custom SMTP through the current Resend setup, mirror `mailer_secure_email_change_enabled = false` / `double_confirm_changes = false`, and test both acceptance models independently. Capture for every row: accepted/rejected request counts, end-to-end and provider latency percentiles, error classes (including rate-limit, provider 4xx, quota, invalid-recipient, timeout, and transient 5xx), and GoTrue pool behavior/saturation.

| Test | Auth email-triggering workload | Staging Auth limit | Required capture |
| --- | ---: | ---: | --- |
| Model A: realistic launch hour | 500 verification + 100 resends + 50 resets = **650** | Current parity value: 1,000/hour | Accept/reject counts, latency, error classes, GoTrue pool |
| Model B: stress/headroom | 500 verification + 500 resend #1 + 500 resend #2 + 500 password reset + 500 email change = **2,500** | Attempt target **5,000/hour**; record the exact value Supabase accepts | Accept/reject counts, latency, error classes, GoTrue pool, and accepted-limit result |

**PASS = both models validated on staging.** Model A fitting under 1,000/hour is necessary production-parity evidence, not a pass for the email-capacity requirement.

## Direct SMTP and outbox / Send Email Hook — test-first

Direct SMTP is PREFERRED because it is simpler, and is expected to be sufficient — but this is not yet proven. Staging must test all of the following:

1. Burst throughput at the Model B stress workload.
2. Provider REJECTION: Resend 4xx, quota exhaustion, and invalid recipient.
3. Provider TIMEOUT / transient 5xx.
4. Auth-state outcome after a FAILED email delivery: does GoTrue leave the user recoverable (unconfirmed and able to resend), or does it leave a broken/corrupt Auth state for signup confirmation, password reset, or email change?

Decision rule: if direct SMTP remains reliable under all four tests, leave it alone. If an SMTP/provider failure can materially break or corrupt a required Auth flow, the remediation trigger is to return with the SMALLEST email-delivery isolation architecture. Do not design that architecture in this capacity document.

## Ranked founder actions

### 1. Confirm the Resend plan; verify the existing sender

In Resend, inspect the account plan and usage. If it is Free, choose between Resend Pro (**$20/month**, Resend cost) and staggered waves. In Resend's Domains area, verify that `weglue.app` remains healthy and that SPF, DKIM, and DMARC records are published. In **Supabase Dashboard → Project → Authentication → Configuration → SMTP Settings**, confirm the existing Resend host, port, sender, and SMTP key are valid; do not copy the secret into this repository. Send a small test only if the founder's operational checklist permits it.

### 2. Stage, measure, and only then propose a production limit change

Use staging to attempt the Model B target of 5,000/hour and record the exact accepted Auth email limit. Do not raise production during this work. If both staging models pass and the Resend plan has confirmed burst capacity, bring the exact proposed production change (`rate_limit_email_sent`, Dashboard → Authentication → Rate Limits → email-sent/hour, 1,000 → accepted staging value) to the founder for approval later.

### 3. Stagger onboarding if a Resend upgrade is declined

Release controlled waves and reserve quota for resends, resets, and shared transactional mail. On Resend Free, the hard initial-verification ceiling is 100 students/day; under the 1.3-event planning multiplier, `floor(100 / 1.3) = 76` students/day before transactional-email headroom. With the current Supabase cap and custom SMTP, `floor(1000 / 1.3) = 769` students/hour, so all 500 fit in one expected-demand wave when the Resend plan permits it.

## Do not change

- `security_refresh_token_reuse_interval = 10` / local `refresh_token_reuse_interval = 10`.
- `mailer_autoconfirm = false` / local `enable_confirmations = true`.
- `mailer_secure_email_change_enabled = false`; email change is intentionally single-mail to the new address.
- Enabling double-confirm (secure) email change is tracked as a **SEPARATE security decision** to be made before final release — out of scope for capacity work.
- Production settings through this file. `supabase/config.toml` is local-only parity documentation; hosted Auth settings are managed in the Supabase Dashboard.
- Any secret values such as `smtp_pass`, `jwt_secret`, or the Resend SMTP key; reference names only.
