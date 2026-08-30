import { randomUUID } from 'node:crypto';
import type { LoadTestConfig } from './config.js';
import { argNumber, argString, assertWriteApproved } from './config.js';
import { Metrics, percentile } from './metrics.js';
import { anonClient, serviceClient, withTimeout } from './supabase.js';
import { runScenario, sleep } from './runner.js';

// ============================================================================
// signup-real — the ACTUAL We Glue signup path at scale.
//
// Each iteration replicates apps/mobile/app/onboarding/signup.tsx:
//   1. rpc auth_signup_status(email, username)
//   2. auth.signUp(email, password, { data: { username, full_name, interests[],
//      activities[], agreed_to_terms: true }, emailRedirectTo })
//
// Then verifies the signup triggers server-side (handle_new_user + the
// before_user_created hook + resolve_signup_university_id):
//   - every auth.users row has a public.profiles row (no silent trigger failure)
//   - profiles.university_id = the single-campus launch university
//   - profiles.onboarding_completed = true, agreed_to_terms = true, agreed_at set
//   - user_interests / user_activities persisted from signup metadata
//   - confirmation_sent_at set
//
// --mode paced  : 500 signups paced at the sustainable single-origin rate
//                 (per-IP over_request_rate_limit ceiling). Proves account
//                 creation + trigger correctness at 500 scale. With 500 real
//                 distinct IPs the per-IP limit is a non-factor; only the
//                 per-project rate_limit_email_sent applies.
// --mode burst  : the campus / shared-NAT resilience scenario — K signups from
//                 ONE origin as fast as possible, measuring the burst allowance,
//                 the failure rate, recovery time, and collateral damage to an
//                 interleaved "legitimate" signup.
// ============================================================================

const INTERESTS = ['Photography', 'Technology and Computer', 'Music'];
const ACTIVITIES = ['Study Groups', 'Networking'];

async function mgmt(config: LoadTestConfig, sql: string): Promise<any[]> {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) throw new Error('signup-real requires SUPABASE_ACCESS_TOKEN');
  const res = await fetch(`https://api.supabase.com/v1/projects/${config.stagingRef}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  let body: any; try { body = JSON.parse(text); } catch { body = text; }
  if (!res.ok || (body && body.message)) throw new Error(`mgmt query failed: ${typeof body === 'string' ? body : body.message}`);
  return Array.isArray(body) ? body : [];
}

function cls(err: any): string {
  if (!err) return 'ok';
  const s = err?.status; const code = err?.code; const m = String(err?.message ?? '').toLowerCase();
  if (code === 'over_request_rate_limit') return '429_per_ip_request';
  if (code === 'over_email_send_rate_limit' || (s === 429 && /email/.test(m))) return '429_email_bucket';
  if (s === 429) return '429_other';
  if (s && s >= 500) return '5xx';
  if (m.includes('timeout') || err?.code === 'TIMEOUT') return 'timeout';
  if (code === 'user_already_exists') return 'user_already_exists';
  if (s && s >= 400) return `4xx_${code ?? s}`;
  return `err_${code ?? s ?? 'unknown'}`;
}

export async function signupReal(config: LoadTestConfig, args: Record<string, string | boolean>): Promise<string> {
  assertWriteApproved(config);
  const rawMode = argString(args, 'mode', 'paced');
  const mode = (rawMode === 'burst' ? 'burst' : rawMode === 'classroom' ? 'classroom' : 'paced') as 'paced' | 'burst' | 'classroom';
  const runId = `${Date.now().toString(36)}${randomUUID().slice(0, 4)}`;
  const domain = argString(args, 'recipient-domain', 'resend.dev');
  const count = Math.floor(argNumber(args, 'count', mode === 'burst' ? 80 : 500));
  const intervalMs = Math.max(0, argNumber(args, 'interval-ms', mode === 'burst' ? 0 : 9000));
  const burstConcurrency = Math.max(1, Math.floor(argNumber(args, 'burst-concurrency', 10)));
  const emailLike = `sr-${runId}-%@${domain}`;

  const email = (i: number) => `sr-${runId}-${i}@${domain}`.toLowerCase();
  const uname = (i: number) => `sr_${runId}_${i}`.replace(/[^a-z0-9_]/gi, '_').slice(0, 30);
  const pw = () => `Signup-${randomUUID().replace(/-/g, '').slice(0, 16)}a!1`;

  return runScenario(config, `signup-real-${mode}`, async (metrics) => {
    const doSignup = async (i: number): Promise<void> => {
      const client = anonClient(config, `sr-${runId}-${i}`);
      const t0 = performance.now();
      try {
        // step 1: the real app's pre-check RPC
        const st0 = performance.now();
        const status = await withTimeout(client.rpc('auth_signup_status', { p_email: email(i), p_username: uname(i) }), config.requestTimeoutMs, `status ${i}`);
        metrics.add({ name: 'auth_signup_status', ms: performance.now() - st0, ok: !status.error, errorClass: status.error ? cls(status.error) : undefined });
        // step 2: the real signUp with real metadata
        const r = await withTimeout(client.auth.signUp({
          email: email(i), password: pw(),
          options: {
            data: { username: uname(i), full_name: uname(i), interests: INTERESTS, activities: ACTIVITIES, agreed_to_terms: true },
            emailRedirectTo: 'https://staging.weglue.app/auth/confirm',
          },
        }), config.requestTimeoutMs, `signup ${i}`);
        const klass = cls(r.error);
        const fakeSuccess = !r.error && (r.data.user?.identities?.length ?? 0) === 0;
        metrics.add({ name: 'signup', ms: performance.now() - t0, ok: !r.error && !fakeSuccess, errorClass: r.error ? klass : (fakeSuccess ? 'fake_success_existing' : undefined), meta: { i } });
        metrics.count(r.error ? klass : (fakeSuccess ? 'fake_success' : 'signup_ok'));
      } catch (e) {
        metrics.add({ name: 'signup', ms: performance.now() - t0, ok: false, errorClass: cls(e), meta: { i } });
        metrics.count(cls(e));
      }
    };

    let recovery: Record<string, unknown> | undefined;
    let collateral: Record<string, unknown> | undefined;
    let classroom: Record<string, unknown> | undefined;

    if (mode === 'classroom') {
      // The SHIPPED We Glue journey on ONE public IP, tested exactly as-is:
      //   signup -> (read email) -> verify via email link -> congrats ->
      //   (return to app) -> MANUAL login with credentials -> app.
      // signup and sign-in share the per-IP over_request_rate_limit bucket, so
      // the manual-login wave draws on a bucket the signup wave already spent.
      // This measures the impact; it does not motivate an onboarding change.
      const admin = serviceClient(config);
      const students = Math.floor(argNumber(args, 'count', 30));
      const signupGapMs = argNumber(args, 'signup-gap-ms', 6000);   // instructor: "sign up now" — ~3 min for 30
      const readEmailMs = argNumber(args, 'read-email-ms', 90_000); // students check their inbox
      const verifyGapMs = argNumber(args, 'verify-gap-ms', 4000);
      const returnMs = argNumber(args, 'return-ms', 30_000);        // "now log back in"
      const loginGapMs = argNumber(args, 'login-gap-ms', 5000);

      type S = { i: number; email: string; password: string; client: ReturnType<typeof anonClient>; verifySession: boolean; verifyOk: boolean; loginOk: boolean };
      const roster: S[] = [];
      const signupBlocked: number[] = []; // indices that got over_request_rate_limit at signup

      const doOneSignup = async (i: number, isRetry: boolean): Promise<S | null> => {
        const client = anonClient(config, `cr-${runId}-${isRetry ? 'rs' : ''}${i}`);
        const password = pw();
        const t0 = performance.now();
        try {
          await withTimeout(client.rpc('auth_signup_status', { p_email: email(i), p_username: uname(i) }), config.requestTimeoutMs, `status ${i}`).catch(() => {});
          const r = await withTimeout(client.auth.signUp({
            email: email(i), password,
            options: { data: { username: uname(i), full_name: uname(i), interests: INTERESTS, activities: ACTIVITIES, agreed_to_terms: true }, emailRedirectTo: 'https://staging.weglue.app/auth/confirm' },
          }), config.requestTimeoutMs, `signup ${i}`);
          const k = cls(r.error);
          metrics.add({ name: isRetry ? 'cr_signup_retry' : 'cr_signup', ms: performance.now() - t0, ok: !r.error, errorClass: r.error ? k : undefined });
          metrics.count(r.error ? `${isRetry ? 'cr_signup_retry' : 'cr_signup'}_${k}` : (isRetry ? 'cr_signup_retry_ok' : 'cr_signup_ok'));
          if (!r.error) { const s: S = { i, email: email(i), password, client, verifySession: false, verifyOk: false, loginOk: false }; roster.push(s); return s; }
          if (!isRetry && k === '429_per_ip_request') signupBlocked.push(i);
          return null;
        } catch (e) {
          metrics.add({ name: isRetry ? 'cr_signup_retry' : 'cr_signup', ms: performance.now() - t0, ok: false, errorClass: cls(e) });
          metrics.count(`${isRetry ? 'cr_signup_retry' : 'cr_signup'}_${cls(e)}`);
          return null;
        }
      };

      const doOneVerify = async (s: S, tag: string): Promise<void> => {
        const t0 = performance.now();
        try {
          const link = await admin.auth.admin.generateLink({ type: 'signup', email: s.email, password: s.password });
          const th = link.data?.properties?.hashed_token;
          if (!th) { metrics.add({ name: tag, ms: performance.now() - t0, ok: false, errorClass: 'no_token' }); metrics.count(`${tag}_no_token`); return; }
          const vo = await withTimeout(anonClient(config, `cr-${runId}-v-${tag}-${s.i}`).auth.verifyOtp({ type: 'signup', token_hash: th }), config.requestTimeoutMs, `verify ${s.i}`);
          const k = cls(vo.error);
          metrics.add({ name: tag, ms: performance.now() - t0, ok: !vo.error, errorClass: vo.error ? k : undefined });
          metrics.count(vo.error ? `${tag}_${k}` : `${tag}_ok`);
          if (!vo.error) { s.verifyOk = true; s.verifySession = !!vo.data.session; if (s.verifySession) metrics.count('cr_verify_session_established'); }
        } catch (e) { metrics.add({ name: tag, ms: performance.now() - t0, ok: false, errorClass: cls(e) }); metrics.count(`${tag}_${cls(e)}`); }
      };

      const doOneLogin = async (s: S, tag: string): Promise<void> => {
        const t0 = performance.now();
        try {
          const li = await withTimeout(anonClient(config, `cr-${runId}-l-${tag}-${s.i}`).auth.signInWithPassword({ email: s.email, password: s.password }), config.requestTimeoutMs, `login ${s.i}`);
          const k = cls(li.error);
          metrics.add({ name: tag, ms: performance.now() - t0, ok: !li.error, errorClass: li.error ? k : undefined });
          metrics.count(li.error ? `${tag}_${k}` : `${tag}_ok`);
          if (!li.error) s.loginOk = true;
        } catch (e) { metrics.add({ name: tag, ms: performance.now() - t0, ok: false, errorClass: cls(e) }); metrics.count(`${tag}_${cls(e)}`); }
      };

      // --- wave 1: signup ---
      const w1 = Date.now();
      for (let i = 0; i < students; i += 1) {
        if (i > 0) { const w = w1 + i * signupGapMs - Date.now(); if (w > 0) await sleep(w); }
        await doOneSignup(i, false);
      }
      process.stderr.write(`[${new Date().toISOString().slice(11, 19)}] classroom signup ${roster.length}/${students} ok, 429ip=${metrics.counters.get('cr_signup_429_per_ip_request') ?? 0}\n`);

      const signupWaveRoster = [...roster];
      process.stderr.write(`[${new Date().toISOString().slice(11, 19)}] classroom signup ${roster.length}/${students} ok, 429ip=${metrics.counters.get('cr_signup_429_per_ip_request') ?? 0}\n`);

      await sleep(readEmailMs);

      // --- wave 2: verify — the student clicks the email link (/verify). The
      //     shipped app then shows the congrats screen and (via confirmed.tsx)
      //     signs any session out; the student returns and logs in manually. ---
      const w2 = Date.now();
      for (let n = 0; n < signupWaveRoster.length; n += 1) {
        if (n > 0) { const w = w2 + n * verifyGapMs - Date.now(); if (w > 0) await sleep(w); }
        await doOneVerify(signupWaveRoster[n]!, 'cr_verify');
      }
      const verifyBlocked = signupWaveRoster.filter((s) => !s.verifyOk);
      process.stderr.write(`[${new Date().toISOString().slice(11, 19)}] classroom verify ${metrics.counters.get('cr_verify_ok') ?? 0}/${signupWaveRoster.length} ok, 429ip=${metrics.counters.get('cr_verify_429_per_ip_request') ?? 0}\n`);

      await sleep(returnMs);

      // --- wave 3: the MANUAL login the shipped flow requires after
      //     verification. Shares the per-IP bucket with wave 1 (signup). ---
      const w3 = Date.now();
      let loginOnset429 = -1;
      for (let n = 0; n < signupWaveRoster.length; n += 1) {
        if (n > 0) { const w = w3 + n * loginGapMs - Date.now(); if (w > 0) await sleep(w); }
        const before = metrics.counters.get('cr_login_429_per_ip_request') ?? 0;
        await doOneLogin(signupWaveRoster[n]!, 'cr_login');
        if (loginOnset429 < 0 && (metrics.counters.get('cr_login_429_per_ip_request') ?? 0) > before) loginOnset429 = n;
      }
      const needRetry = signupWaveRoster.filter((s) => !s.loginOk && s.verifyOk);
      const firstPassInApp = signupWaveRoster.filter((s) => s.loginOk).length;
      process.stderr.write(`[${new Date().toISOString().slice(11, 19)}] classroom login ${metrics.counters.get('cr_login_ok') ?? 0}/${signupWaveRoster.length} ok, 429ip=${metrics.counters.get('cr_login_429_per_ip_request') ?? 0}\n`);

      // --- wave 4: RETRY the students the per-IP limit actually blocked, after
      //     a real pause, at a gentle pace — did their retry succeed? ---
      const retryPauseMs = argNumber(args, 'retry-pause-ms', 60_000);
      const retryGapMs = argNumber(args, 'retry-gap-ms', 8000);
      let signupRetryOk = 0; let verifyRetryOk = 0; let loginRetryOk = 0;
      await sleep(retryPauseMs);
      // 4a: retry the blocked signups (then verify + login the ones that now go through)
      for (let j = 0; j < signupBlocked.length; j += 1) {
        if (j > 0) await sleep(retryGapMs);
        const s = await doOneSignup(signupBlocked[j]!, true);
        if (s) { signupRetryOk += 1; await sleep(retryGapMs); await doOneVerify(s, 'cr_verify_retry'); if (s.verifyOk) { verifyRetryOk += 1; await sleep(retryGapMs); await doOneLogin(s, 'cr_login_retry'); if (s.loginOk) loginRetryOk += 1; } }
      }
      // 4b: retry the blocked verifies (then login)
      for (let j = 0; j < verifyBlocked.length; j += 1) {
        if (j > 0) await sleep(retryGapMs);
        const s = verifyBlocked[j]!;
        await doOneVerify(s, 'cr_verify_retry');
        if (s.verifyOk) { verifyRetryOk += 1; await sleep(retryGapMs); await doOneLogin(s, 'cr_login_retry'); if (s.loginOk) loginRetryOk += 1; }
      }
      // 4c: retry any per-IP-blocked logins
      for (let j = 0; j < needRetry.length; j += 1) {
        if (j > 0) await sleep(retryGapMs);
        await doOneLogin(needRetry[j]!, 'cr_login_retry');
        if (needRetry[j]!.loginOk) loginRetryOk += 1;
      }
      process.stderr.write(`[${new Date().toISOString().slice(11, 19)}] classroom retry: signupBlocked ${signupRetryOk}/${signupBlocked.length} back in, verifyBlocked ${verifyRetryOk} verified, loginRetryOk=${loginRetryOk}\n`);

      // --- separate bucket-recovery PROBE: how long until a brand-new signup
      //     from this origin succeeds again (NOT a retry of a blocked student). ---
      const recStart = Date.now();
      let bucketRecoveredMs = -1;
      for (let a = 0; a < 25; a += 1) {
        const r = await anonClient(config, `cr-${runId}-probe-${a}`).auth.signUp({ email: `sr-${runId}-probe${a}@${domain}`, password: pw() });
        if (!r.error) { bucketRecoveredMs = Date.now() - recStart; break; }
        await sleep(3000);
      }

      const signupPerIp = metrics.counters.get('cr_signup_429_per_ip_request') ?? 0;
      const verifyPerIp = metrics.counters.get('cr_verify_429_per_ip_request') ?? 0;
      const loginPerIp = metrics.counters.get('cr_login_429_per_ip_request') ?? 0;
      classroom = {
        students,
        shippedFlow: 'signup -> verify via email link -> congrats -> return -> manual login. Tested exactly as shipped; onboarding unchanged.',
        signup: { ok: metrics.counters.get('cr_signup_ok') ?? 0, per_ip_429: signupPerIp, email_429: metrics.counters.get('cr_signup_429_email_bucket') ?? 0, ...metrics.table('cr_signup') },
        verify: { ok: metrics.counters.get('cr_verify_ok') ?? 0, per_ip_429: verifyPerIp, rate_limit_verify_429: metrics.counters.get('cr_verify_429_other') ?? 0, ...metrics.table('cr_verify') },
        manualLogin: { ok: metrics.counters.get('cr_login_ok') ?? 0, per_ip_429: loginPerIp, onsetAtStudentIndex: loginOnset429, emailNotConfirmed: metrics.counters.get('cr_login_4xx_email_not_confirmed') ?? 0, ...metrics.table('cr_login') },
        blockedThenRetried: {
          signup: { blocked: signupBlocked.length, retriedBackIn: signupRetryOk },
          verify: { blocked: verifyBlocked.length, retriedVerified: verifyRetryOk },
          login: { perIpBlocked: needRetry.length, retriedIn: loginRetryOk },
          retryPauseMs, retryGapMs,
        },
        firstPassInApp,
        finalInAppAfterRetryWave: roster.filter((s) => s.loginOk).length,
        bucketRecoveryProbeMs: bucketRecoveredMs,
        note: 'per_ip_429 counts = students hit by over_request_rate_limit at that step. blockedThenRetried = whether those EXACT students succeeded on a paced retry after retryPauseMs. bucketRecoveryProbeMs is a SEPARATE measurement: how long until a brand-new signup works again (not a blocked student).',
      };
    } else if (mode === 'paced') {
      const start = Date.now();
      let done = 0;
      for (let i = 0; i < count; i += 1) {
        if (intervalMs && i > 0) {
          const wait = start + i * intervalMs - Date.now();
          if (wait > 0) await sleep(wait);
        }
        await doSignup(i);
        done += 1;
        if (done % 25 === 0 || done === count) {
          process.stderr.write(`[${new Date().toISOString().slice(11, 19)}] signup ${done}/${count} ok=${metrics.counters.get('signup_ok') ?? 0} 429ip=${metrics.counters.get('429_per_ip_request') ?? 0} 429email=${metrics.counters.get('429_email_bucket') ?? 0} 5xx=${metrics.counters.get('5xx') ?? 0}\n`);
        }
      }
    } else {
      // burst: K signups from one origin as fast as the pool allows
      const start = Date.now();
      let next = 0;
      const worker = async () => { while (next < count) { const i = next++; await doSignup(i); } };
      await Promise.all(Array.from({ length: burstConcurrency }, worker));
      const burstMs = Date.now() - start;
      metrics.count('burst_ms', burstMs);

      // recovery probe: how long until a signup succeeds again from this origin
      const recStart = Date.now();
      let recovered = -1;
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const c = anonClient(config, `sr-${runId}-rec-${attempt}`);
        const r = await c.auth.signUp({ email: `sr-${runId}-rec${attempt}@${domain}`, password: pw() });
        if (!r.error) { recovered = Date.now() - recStart; break; }
        await sleep(3000);
      }
      recovery = { recoveredAfterMs: recovered, note: recovered < 0 ? 'did not recover within 90s' : `first success ${(recovered / 1000).toFixed(0)}s after burst` };

      // collateral: during a fresh identical burst, does an interleaved single
      // "legit" signup from the same origin get blocked?
      await sleep(20000);
      let legitOk = 0; let legitBlocked = 0;
      const bstart = Date.now();
      const bg = (async () => {
        let n = 0;
        while (Date.now() - bstart < 15000) { const c = anonClient(config, `sr-${runId}-bg-${n}`); await c.auth.signUp({ email: `sr-${runId}-bg${n++}@${domain}`, password: pw() }).catch(() => {}); }
      })();
      await sleep(2000);
      for (let k = 0; k < 5; k += 1) {
        const c = anonClient(config, `sr-${runId}-legit-${k}`);
        const r = await c.auth.signUp({ email: `sr-${runId}-legit${k}@${domain}`, password: pw() });
        if (r.error?.code === 'over_request_rate_limit') legitBlocked += 1; else if (!r.error) legitOk += 1;
        await sleep(2500);
      }
      await bg;
      collateral = { legitOk, legitBlocked, of: 5, note: 'a legit signup interleaved with a same-origin burst' };
    }

    // ---- server-side trigger verification ----
    await sleep(4000);
    const v = await mgmt(config, `
      with u as (select id, email, confirmation_sent_at, email_confirmed_at from auth.users where email like '${emailLike}'),
      p as (select * from public.profiles where id in (select id from u))
      select
        (select count(*) from u)::int                                          as auth_users,
        (select count(distinct lower(email)) from u)::int                       as distinct_emails,
        (select count(*) from u where confirmation_sent_at is not null)::int    as confirmation_sent,
        (select count(*) from u where email_confirmed_at is not null)::int      as email_confirmed,
        (select count(*) from p)::int                                           as profiles,
        (select count(*) from u where id not in (select id from p))::int        as orphaned_auth_users,
        (select count(*) from p where university_id = '75398568-867d-4cf9-b688-78e6bfbedb01')::int as profiles_launch_campus,
        (select count(*) from p where university_id is null)::int               as profiles_null_university,
        (select count(*) from p where onboarding_completed)::int                as onboarding_completed,
        (select count(*) from p where agreed_to_terms and agreed_at is not null)::int as agreed_terms,
        (select count(*) from p where coalesce(username,'') <> '')::int         as username_set,
        (select count(*) from p where email_domain = 'resend.dev')::int         as email_domain_ok,
        (select count(*) from public.user_interests where user_id in (select id from u))::int  as interest_rows,
        (select count(*) from public.user_activities where user_id in (select id from u))::int as activity_rows,
        (select count(*) from (select username from p group by username having count(*)>1) d)::int as dup_usernames
    `).catch((e) => [{ error: String(e) }]);

    const sg = metrics.samples.filter((s) => s.name === 'signup');
    const okCount = sg.filter((s) => s.ok).length;
    const errTally: Record<string, number> = {};
    for (const s of sg) if (!s.ok) errTally[s.errorClass ?? 'unknown'] = (errTally[s.errorClass ?? 'unknown'] ?? 0) + 1;

    return {
      details: {
        mode, runId, count, intervalMs,
        signups: {
          attempted: sg.length, ok: okCount, failed: sg.length - okCount,
          successRate: sg.length ? Number((okCount / sg.length).toFixed(4)) : 0,
          p50: percentile(sg.filter((s) => s.ok).map((s) => s.ms), 50),
          p95: percentile(sg.filter((s) => s.ok).map((s) => s.ms), 95),
          p99: percentile(sg.filter((s) => s.ok).map((s) => s.ms), 99),
          errors: errTally,
        },
        authSignupStatusRpc: metrics.table('auth_signup_status'),
        triggerVerification: v[0] ?? {},
        recovery, collateral, classroom,
        note: mode === 'paced'
          ? 'Paced at the single-origin per-IP ceiling. triggerVerification.profiles must equal auth_users; profiles_launch_campus / onboarding_completed / agreed_terms must equal profiles; orphaned_auth_users and dup_usernames must be 0.'
          : mode === 'burst'
            ? 'Shared-NAT / campus-dorm burst. recovery.recoveredAfterMs and collateral.legitBlocked quantify the blast radius of the per-IP over_request_rate_limit.'
            : 'Classroom journey on one IP. Compare classroom.verify.session_established (students already logged in after the link) vs classroom.login_redundant.per_ip_429 (the app forcing a second auth on the shared bucket).',
      },
    };
  });
}
