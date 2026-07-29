# Admin Dashboard — private entry gateway

A pre-authentication concealment layer in front of the We Glue Admin Dashboard.
**Defense in depth only.** It replaces nothing.

---

## 1. What it does

Without a valid entry ticket, the Admin Dashboard **does not exist** to the
outside world: every `/admin` page and every `/admin/api/*` endpoint returns an
ordinary `404`. The only way to lift that concealment is to visit a private path
— known only from the `ADMIN_ENTRY_PATH` environment variable — and submit the
correct access phrase.

## 2. What it explicitly does NOT do

Passing the gateway grants **no authorization whatsoever**. It only allows
`/admin` routes to stop returning 404 and begin rendering their own login/MFA
flow. Every pre-existing gate still runs, unchanged and in the same order:

| # | Gate | Where |
|---|---|---|
| 1 | `ADMIN_PORTAL_ENABLED === "true"` | `adminEnv.ts` |
| 2 | Validated Supabase session (`getUser()`) | `secureAdmin.ts` |
| 3 | Immutable founder UUID allowlist (`ADMIN_FOUNDER_USER_IDS`) — authoritative | `adminEnv.ts` |
| 4 | Exact founder email match (`ADMIN_FOUNDER_EMAILS`) — an AND check, never an alternative grant | `adminEnv.ts` |
| 5 | TOTP MFA at `aal2` | `secureAdmin.ts` |
| 6 | Recent MFA for sensitive reveal/search | `requireRecentMfa` |
| 7 | `ADMIN_WRITES_ENABLED === "true"` for every mutation | `secureAdmin.ts` |

**A correct phrase with the wrong Supabase identity receives no data.** Nothing
in `entryGate.ts` is read by `adminEnv.ts`, `secureAdmin.ts`, or any loader,
action or route. `lib/admin/__tests__/entryGateIsolation.test.ts` holds the
gateway open and re-asserts all seven gates to prove it.

---

## 3. Environment variables

All **server-only**. Never prefixed `NEXT_PUBLIC_`. Set for **Production** and
**Preview**.

| Name | Required | Purpose |
|---|---|---|
| `ADMIN_ENTRY_PATH` | yes | The private external path, e.g. `/` + a long unguessable string. Validated: must be absolute, safe charset, and not under `/_next`, `/api`, `/admin`, `/auth`, `/wgx-`. |
| `ADMIN_ENTRY_SECRET_HASH` | yes | Salted **scrypt** digest of the phrase. The plaintext is never stored. |
| `ADMIN_ENTRY_COOKIE_SECRET` | yes | HMAC key protecting the ticket. Must be ≥ 32 chars or it is treated as unconfigured. |
| `ADMIN_ENTRY_COOKIE_TTL_MINUTES` | no | Ticket lifetime. Default **10**, clamped to 1–60. |

**Fail-closed:** if any of the three required values is absent or invalid, the
gateway refuses every submission *and* `/admin` stays 404 — the dashboard becomes
unreachable rather than open.

### Generating the secrets

```bash
node apps/web/scripts/generate-admin-entry-secrets.mjs
```

Prompts twice with echo **off**, then prints only the hash and a fresh cookie
secret. The phrase is never echoed, stored, logged, or written to disk. Choose
`ADMIN_ENTRY_PATH` yourself and type it straight into Vercel.

---

## 4. Route design

```
EXTERNAL (secret, env-only)          INTERNAL (fixed, in source)
────────────────────────────         ──────────────────────────────
$ADMIN_ENTRY_PATH        ──rewrite──▶ /wgx-entry   (Route Handler, runtime=nodejs)
/admin, /admin/**        ──────────▶  concealed by notFound() unless ticket valid
/wgx-entry (direct hit)  ──rewrite──▶ /wgx-404     (deliberately NOT a real route)
```

- The configured path appears **nowhere** in source, navigation, `robots.txt`,
  any sitemap, page metadata, or any client bundle.
- The rewrite (not a redirect) keeps the private path out of `Location` headers.
- `/wgx-entry` reached directly is concealed, so knowing the internal name is
  useless without the configured path *and* the phrase.

### Why `/admin` is concealed in the app layer, not by a middleware rewrite

`NextResponse.rewrite()` stamps an **`x-middleware-rewrite`** header on the
response. A genuine 404 carries no such header, so a rewrite-based concealment
would itself announce that `/admin` is special. Instead the `/admin` layout and
each `/admin/api/*` route call `notFound()`, which makes Next render its own 404
for the requested URL. Middleware still short-circuits these requests **before**
the Supabase session lookup, so probing `/admin` costs no auth round-trip.

> Internal route names must **not** start with `_`. Next.js App Router treats
> `_`-prefixed folders as private and excludes them from routing entirely, which
> silently leaves the gateway unbuilt. (This bit us during implementation.)

### Two leaks found and fixed during implementation

1. **Metadata leak.** Next resolves a segment's `metadata` independently of
   whether it renders, so the static export emitted
   `<title>We Glue Admin</title>` and `noindex` onto the concealed 404. Replaced
   with a ticket-aware `generateMetadata()` that returns `{}` while concealed.
2. **405 disclosure.** The POST-only endpoints answered `GET` with `405 Method
   Not Allowed`, which reveals a route exists where a nonexistent path returns
   404. Both now export a `GET` that calls `notFound()`.

---

## 5. Cookie design

| Property | Value | Why |
|---|---|---|
| Name | `wg_x1` | Opaque; must not hint at an administration area |
| Value | `base64url(payload).base64url(HMAC-SHA256)` | Payload is `{v,iat,exp,jti}` — **no phrase, no hash, no identity, no session** |
| `HttpOnly` | yes | Unreadable from JavaScript |
| `Secure` | Preview + Production | Off for local `http` only (`VERCEL_ENV`/`VERCEL`) |
| `SameSite` | `Strict` | No cross-site submission |
| `Path` | `/admin` | Useless anywhere else; covers `/admin/api/*` |
| `Max-Age` | ~600 s | Short-lived; re-enter the gateway after expiry |

Verification uses `crypto.subtle.verify` (constant-time w.r.t. the MAC) and
rejects: malformed values, extra structure, wrong version, bad signature,
signatures of the wrong length, a different signing key, and any expired ticket.

---

## 6. Brute-force protection

- **scrypt** (N=16384, r=8, p=1, 32-byte key) — ~64 MiB and tens of ms per guess.
  This is the primary control.
- **Uniform 250 ms delay** on every submission, applied before any input-dependent
  branch, to slow guessing and flatten timing.
- **5 failures per 15-minute rolling window → 15-minute lockout**, keyed by an
  HMAC of the client address (truncated), so no raw IP is held in memory or logs.
- **Identical generic response** (`401`, `"That phrase was not accepted."`) for a
  wrong phrase, a lockout, and a malformed submission. A prober cannot detect the
  lockout. *Lockout is silent by design.*
- Tracker is bounded to 5 000 keys with oldest-first eviction, so an IP spray
  cannot grow memory without limit.

### Honest limitation

The limiter is **per server instance, in memory**. This project has no durable
shared store (Vercel KV is discontinued; no Marketplace Redis is provisioned), so
a globally consistent counter is not available without adding infrastructure.

- Fluid Compute reuses instances, so a single attacker hitting one region is
  throttled effectively.
- An attacker spreading requests across many cold instances/regions can exceed
  5 attempts per window **in aggregate**.
- Counters reset on redeploy or instance recycle.

If a hard global bound is ever required: provision a Marketplace Redis, or add a
Vercel Firewall rate-limiting rule on the private path, and replace
`recordAttempt`/`isLockedOut`. Nothing else needs to change.

### Security events

`console.warn("[security] {...}")` with `evt`, `ts`, `client` (hashed), and
optionally `failures` / `locked`. By construction the payload cannot contain the
phrase, the hash, a cookie value, a password, a TOTP code, or message content.

```
[security] {"evt":"admin_entry.lockout","ts":"…","client":"dnTGGc5H731YljAUs7pWuc","failures":5,"locked":true}
```

---

## 7. Lock / Sign Out

`lockAdminPortal()` is the dashboard's single combined Lock-portal / Sign-out
action (explicit button **and** inactivity auto-lock). It now also deletes the
entry ticket — unconditionally, even if the Supabase sign-out fails, so
concealment never outlives an explicit lock. After locking:

- `/admin` returns `404` again
- the private entry path must be used again
- Gmail/password **and** TOTP MFA are still required

---

## 8. `robots.txt`

The `Disallow: /admin` line was **removed**, deliberately. It was public,
world-readable disclosure that an administration area exists, defeating the
concealment. There is nothing left for a crawler to reach. Admin responses are
still kept out of indexes after the gateway is passed by the `X-Robots-Tag`
header, page metadata, and `Cache-Control: no-store`.

---

## 9. Residual risk (accepted, documented)

1. **A determined observer can infer that `/admin` matches a route.** The
   concealed 404 is produced by a thrown `notFound()`, whose document shape
   (`<html id="__next_error__">`, ~5.6 KB) differs from an unmatched route's 404
   (~7.5 KB). No admin wording, title, header, or identity leaks — but the
   *shape* differs. Both available options leak something (the alternative leaks
   an `x-middleware-rewrite` header naming an internal route); this one leaks
   strictly less. Closing it fully would require overriding the site-wide 404
   page, which is out of scope for this change.
2. **Admin JS chunks remain fetchable under `/_next/static`** by anyone who knows
   a content-hashed filename. Chunk names are referenced only from admin pages,
   which now 404, so discovery requires guessing hashes. Inherent to Next.js.
3. **Rate limiting is not globally durable** — see §6.

---

## 10. Verification performed

| Check | Result |
|---|---|
| Web unit tests | **302 / 302** (21 files → 24 files) |
| Web type-check | clean |
| Web production build | 0 errors; 1 pre-existing `@supabase/supabase-js` Edge warning (untouched by this change) |
| Live route-security suite | **50 / 50** |
| Static secret scan | **19 / 19** |

Live suite covers: all `/admin` pages + all three APIs return 404 without a
ticket; no `x-middleware-rewrite`; no title/wording leak; header set identical to
an unmatched path; internal routes concealed; `robots.txt` clean; every public and
student route unchanged; gateway asks only for a phrase with **zero client JS**;
wrong phrase → generic 401 with no cookie; correct phrase → exactly one
HttpOnly/Strict/`Path=/admin`/`Max-Age=600` cookie containing no phrase; tampered
and expired tickets rejected; empty cookie (post-lock) rejected; with a ticket the
portal switch still fails closed and the API still returns a JSON denial;
repeated wrong phrases lock out while staying generic.
