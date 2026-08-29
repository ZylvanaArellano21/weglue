# Auth email capacity for the rollout

Status: corrected live-state analysis and local parity documentation only. No hosted Supabase setting is changed here.

## Current limits and first-hour budget

Production is already using custom SMTP through Resend (`smtp.resend.com:465`), not Supabase's default mailer. Supabase's documented default-mailer ceiling is **2 emails/hour**, but it is **not applicable** to this project. With custom SMTP, Supabase documents a starting limit of 30 emails/hour that is adjustable through Rate Limits; the documentation states no upper bound or Free-plan restriction, and production is already set to `rate_limit_email_sent = 1000` ([Supabase Auth SMTP](https://supabase.com/docs/guides/auth/auth-smtp)).

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

## Founder answers

- **Current Auth email limits:** custom SMTP is active; `rate_limit_email_sent = 1000/hour`; `smtp_max_frequency = 60s` per identity; `hook_send_email_enabled = false`; `mailer_autoconfirm = false`; `mailer_secure_email_change_enabled = false`; `security_refresh_token_reuse_interval = 10`. Production also reports `rate_limit_verify = 30` and `rate_limit_otp = 30` for verification/OTP requests.
- **500-signup burst:** 650 events are below the Supabase cap by 350. The Resend plan is the real external constraint: Free cannot carry the burst; Pro can, assuming sufficient shared quota.
- **Headroom:** the expected burst leaves 350 Supabase email events in the same hour for additional resends, resets, and later Auth emails. The 60-second cooldown is per identity, not a global burst limiter.
- **Supabase Free without a paid Supabase change:** **Yes.** The Supabase side is already configured for this burst. Any paid upgrade is a separate Resend vendor decision.
- **Outbox or Send Email Hook required:** **No** at approximately 500 burst signups and 50 concurrent active users. Custom SMTP plus a sufficient Resend plan sends synchronously. A Send Email Hook would not bypass `rate_limit_email_sent`; an outbox becomes relevant only if sustained demand exceeds 1,000 Auth email events/hour or delivery needs asynchronous retry control.

## Ranked founder actions

### 1. Confirm the Resend plan; verify the existing sender

In Resend, inspect the account plan and usage. If it is Free, choose between Resend Pro (**$20/month**, Resend cost) and staggered waves. In Resend's Domains area, verify that `weglue.app` remains healthy and that SPF, DKIM, and DMARC records are published. In **Supabase Dashboard → Project → Authentication → Configuration → SMTP Settings**, confirm the existing Resend host, port, sender, and SMTP key are valid; do not copy the secret into this repository. Send a small test only if the founder's operational checklist permits it.

### 2. Optionally raise `rate_limit_email_sent`

Only if Resend Pro quota and observed demand justify it, use **Supabase Dashboard → Project → Authentication → Rate Limits** to raise the hourly email value above 1,000 with provider headroom. No raise is needed for the estimated 650-event burst.

### 3. Stagger onboarding if a Resend upgrade is declined

Release controlled waves and reserve quota for resends, resets, and shared transactional mail. On Resend Free, the hard initial-verification ceiling is 100 students/day; under the 1.3-event planning multiplier, `floor(100 / 1.3) = 76` students/day before transactional-email headroom. With the current Supabase cap and custom SMTP, `floor(1000 / 1.3) = 769` students/hour, so all 500 fit in one expected-demand wave when the Resend plan permits it.

## Do not change

- `security_refresh_token_reuse_interval = 10` / local `refresh_token_reuse_interval = 10`.
- `mailer_autoconfirm = false` / local `enable_confirmations = true`.
- `mailer_secure_email_change_enabled = false`; email change is intentionally single-mail to the new address.
- Production settings through this file. `supabase/config.toml` is local-only parity documentation; hosted Auth settings are managed in the Supabase Dashboard.
- Any secret values such as `smtp_pass`, `jwt_secret`, or the Resend SMTP key; reference names only.
