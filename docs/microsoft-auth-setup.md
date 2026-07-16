# Microsoft Authentication — Activation Guide

The full "Continue with Microsoft" flow is implemented in the app (branch
`feat/microsoft-authentication`). It stays inactive until the three console
steps below are completed — the code detects the disabled provider and shows a
friendly "isn't available yet" message, but **do not ship the branch until
this checklist is done**.

Nothing in this file is secret. Never commit the Azure client secret anywhere
in this repository.

---

## Step 1 — Create the Azure app registration (founder, ~10 minutes)

1. Sign in at https://portal.azure.com with the We Glue Microsoft account.
2. Search for **App registrations** → **New registration**.
3. Fill in:
   - **Name**: `We Glue`
   - **Supported account types**: select
     **"Accounts in any organizational directory (Any Microsoft Entra ID tenant – Multitenant)"**.
     Do **not** include personal Microsoft accounts — We Glue is school/work
     sign-in only. Students at any university can still sign in because every
     university tenant counts as "any organizational directory".
   - **Redirect URI**: choose platform **Web** and enter exactly:
     `https://yoozrnosmqtaiksgcixc.supabase.co/auth/v1/callback`
4. Click **Register**.
5. On the app's **Overview** page, copy the **Application (client) ID** —
   you will paste it into Supabase in Step 2.
6. Go to **Certificates & secrets** → **Client secrets** → **New client
   secret**. Description `supabase`, expiry **24 months**. Copy the secret
   **Value** immediately (it is shown only once). Set a calendar reminder to
   rotate it before expiry — sign-in breaks the day it expires.
7. Go to **Token configuration** → **Add optional claim** → type **ID**:
   - check `email`
   - check `xms_edov` (labelled "Email domain owner verified"); if it isn't
     available as an optional claim in the portal UI, open **Manifest**,
     find `"optionalClaims"` and add `{"name": "xms_edov", "source": null,
     "essential": false}` to the `idToken` array.
   - If the portal asks to "Turn on the Microsoft Graph email permission",
     accept.

   **Why this matters**: Supabase only treats the Microsoft email as verified
   when `xms_edov` is present. Without it, Microsoft users would land on the
   email-verification screen (which is for password accounts) and secure
   auto-linking to existing accounts with the same email would not work.
8. Go to **API permissions** — the defaults (`openid`, `profile`, `email`,
   `User.Read` delegated) are enough. Do not add more. Admin consent is NOT
   required for these.

## Step 2 — Enable the provider in Supabase (founder or Claude, ~2 minutes)

Dashboard path: https://supabase.com/dashboard/project/yoozrnosmqtaiksgcixc
→ **Authentication** → **Sign In / Up** → **Auth Providers** → **Azure**:

- **Enable**: on
- **Client ID**: the Application (client) ID from Step 1.5
- **Client Secret**: the secret Value from Step 1.6
- **Azure Tenant URL**: `https://login.microsoftonline.com/organizations`
  (locks the flow to school/work accounts; personal accounts cannot start it)
- Save.

Alternatively via the Management API (same values):
`PATCH /v1/projects/yoozrnosmqtaiksgcixc/config/auth` with
`external_azure_enabled=true`, `external_azure_client_id=…`,
`external_azure_secret=…`,
`external_azure_url=https://login.microsoftonline.com/organizations`.

## Step 3 — Redirect allowlist (already done)

`weglue://auth/callback` is in the production redirect allowlist and in
`supabase/config.toml`. No action needed; verify it is still listed under
**Authentication → URL Configuration → Redirect URLs**.

---

## Ship checklist (after Steps 1–2)

1. Apply migration `047_microsoft_oauth_onboarding.sql`
   (`supabase db push` from the repo root, or the migration section of the
   release process). The migration is inert for password accounts.
2. Merge `feat/microsoft-authentication` into `main` and push.
3. The feature requires a **new native build** (`expo-web-browser` was added):
   it ships with the already-planned Camera + Notifications release-candidate
   build. Do not OTA it onto old binaries.
4. Test on a physical device with a real school Microsoft account:
   - New Microsoft user from Sign up (Interests → Activities → username →
     Continue with Microsoft) lands on Home with matches, no Confirm Email.
   - Same user logs out, taps Continue with Microsoft on Log in → straight
     to Home.
   - A personal outlook.com account is blocked with the school-email message.

## How eligibility is enforced (reference)

- Personal-account tenants can't start the flow (Tenant URL `organizations`).
- The `before_user_created` auth hook (migration 008, enabled in production)
  rejects any non-.edu email BEFORE the auth user is created — no ghost
  accounts, same rule as password signup.
- `complete_oauth_onboarding` (migration 047) re-checks verified email +
  eligibility server-side before an OAuth account can finish onboarding.
