import { randomUUID } from 'node:crypto';
import type { LoadTestConfig } from './config.js';
import { argNumber, argString, assertWriteApproved } from './config.js';
import { Metrics, classifyError, percentile } from './metrics.js';
import { anonClient, serviceClient, withTimeout } from './supabase.js';
import { runScenario, sleep } from './runner.js';

// ============================================================================
// auth-email — staging Auth email-capacity tests (Model A realistic / Model B stress).
//
// Recipients are Resend's designated test address `delivered+<label>@resend.dev`
// (simulated delivery, no real inbox) so thousands can be sent safely. Controlled
// bounce/complaint addresses (`bounced+`, `complained+`) are available via
// --error-fraction for a small error sample.
//
// Requires SUPABASE_ACCESS_TOKEN for the Management-API `auth.users` state checks.
// Assumes production parity is already set on the project: custom SMTP active,
// before_user_created hook enabled, mailer_autoconfirm = false,
// rate_limit_email_sent raised (1000 for A, 5000 for B).
// ============================================================================

type Op = 'signup' | 'resend' | 'reset' | 'change-email';

type Recipient = { email: string; password: string; userId?: string; client: ReturnType<typeof anonClient> };

async function mgmt(config: LoadTestConfig, sql: string): Promise<any[]> {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) throw new Error('auth-email requires SUPABASE_ACCESS_TOKEN');
  const res = await fetch(`https://api.supabase.com/v1/projects/${config.stagingRef}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  let body: any;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!res.ok || (body && body.message)) throw new Error(`mgmt query failed: ${typeof body === 'string' ? body : body.message}`);
  return Array.isArray(body) ? body : [];
}

function classifyAuth(err: any): { klass: string; status?: number; code?: string; cooldown?: number } {
  const status = err?.status;
  const code = err?.code;
  const msg = String(err?.message ?? err ?? '').toLowerCase();
  const cd = msg.match(/(\d+)\s*(?:seconds?|s)\b/);
  let klass = 'ok';
  if (status === 429 || msg.includes('rate limit') || msg.includes('too many') || msg.includes('for security purposes')) {
    klass = msg.includes('email') || code === 'over_email_send_rate_limit' ? '429_email' : '429_other';
  } else if (status && status >= 500) klass = '5xx';
  else if (msg.includes('timeout') || err?.code === 'TIMEOUT') klass = 'timeout';
  else if (status && status >= 400) klass = `4xx_${code ?? status}`;
  else if (status) klass = 'ok';
  return { klass, status, code, cooldown: cd ? Number(cd[1]) : undefined };
}

async function record(metrics: Metrics, op: Op, started: number, err: any, meta: Record<string, unknown> = {}) {
  const c = classifyAuth(err);
  const ok = !err;
  metrics.add({ name: op, ms: performance.now() - started, ok, errorClass: ok ? undefined : c.klass, meta: { ...meta, status: c.status, code: c.code, cooldown: c.cooldown } });
  if (!ok) {
    metrics.count(`${op}_fail`);
    metrics.count(`err_${c.klass}`);
  } else {
    metrics.count(`${op}_ok`);
  }
  return c;
}

async function authUsersState(config: LoadTestConfig, emailLike: string): Promise<Record<string, number>> {
  const rows = await mgmt(config, `
    select
      count(*)::int                                             as total,
      count(*) filter (where email_confirmed_at is not null)::int as confirmed,
      count(*) filter (where confirmation_sent_at is not null)::int as confirmation_sent,
      count(*) filter (where recovery_sent_at is not null)::int  as recovery_sent,
      count(*) filter (where email_change <> '' )::int           as email_change_pending,
      count(*) filter (where email_change_sent_at is not null)::int as email_change_sent,
      count(*) filter (where banned_until is not null)::int      as banned
    from auth.users where email like '${emailLike}'
  `);
  return rows[0] ?? {};
}

export async function authEmail(config: LoadTestConfig, args: Record<string, string | boolean>): Promise<string> {
  assertWriteApproved(config);
  const model = (argString(args, 'model', 'a').toLowerCase() === 'b' ? 'b' : 'a') as 'a' | 'b';
  const runId = `${Date.now().toString(36)}${randomUUID().slice(0, 4)}`;
  const domain = argString(args, 'recipient-domain', 'resend.dev');
  const mailbox = argString(args, 'recipient-mailbox', 'delivered');
  const signupCount = Math.floor(argNumber(args, 'signups', 500));
  const concurrency = Math.max(1, Math.floor(argNumber(args, 'concurrency', 12)));
  // Global signup arrival pacing. Model A = a realistic launch-day trickle
  // (default one signup every 4 s ≈ 500 over ~33 min, well inside a 1 h window);
  // Model B = as fast as the pool allows (0).
  const signupIntervalMs = Math.max(0, argNumber(args, 'signup-interval-ms', model === 'a' ? 4000 : 0));
  const cooldownWaitMs = Math.max(0, argNumber(args, 'cooldown-wait-ms', 75_000));
  const errorFraction = Math.min(0.5, Math.max(0, argNumber(args, 'error-fraction', 0)));
  const emailLike = `${mailbox}+lt${runId}%@${domain}`;

  const addr = (label: string, idx: number): string => {
    const box = errorFraction > 0 && (idx % Math.round(1 / errorFraction) === 0) ? (idx % 2 ? 'bounced' : 'complained') : mailbox;
    return `${box}+lt${runId}-${label}${idx}@${domain}`.toLowerCase();
  };
  const password = () => `LtMail-${randomUUID().replace(/-/g, '').slice(0, 18)}a!1`;

  return runScenario(config, `auth-email-model-${model}`, async (metrics) => {
    const phases: Array<Record<string, unknown>> = [];
    const recipients: Recipient[] = [];

    // ---- Phase: SIGNUP (verification emails) ----
    const signupPhaseStart = performance.now();
    const doSignup = async (idx: number): Promise<void> => {
      if (signupIntervalMs) {
        const due = signupPhaseStart + idx * signupIntervalMs;
        const wait = due - performance.now();
        if (wait > 0) await sleep(wait);
      }
      const email = addr('s', idx);
      const pw = password();
      const client = anonClient(config, `lt-mail-${runId}-${idx}`);
      const t0 = performance.now();
      try {
        const res = await withTimeout(client.auth.signUp({
          email, password: pw,
          options: { data: { username: `lt_mail_${runId}_${idx}`.slice(0, 40), full_name: `LT Mail ${idx}` } },
        }), config.requestTimeoutMs, `signup ${idx}`);
        await record(metrics, 'signup', t0, res.error, { email });
        if (!res.error && res.data.user && (res.data.user.identities?.length ?? 1) > 0) {
          recipients.push({ email, password: pw, userId: res.data.user.id, client });
        } else if (!res.error) {
          metrics.count('signup_fake_success_existing');
        }
      } catch (e) {
        await record(metrics, 'signup', t0, e, { email });
      }
    };

    const runPool = async (n: number, fn: (i: number) => Promise<void>, poolSize: number) => {
      let next = 0;
      const worker = async () => { while (next < n) { const i = next++; await fn(i); } };
      await Promise.all(Array.from({ length: Math.min(poolSize, n) }, worker));
    };

    let phaseStart = Date.now();
    await runPool(signupCount, doSignup, concurrency);
    phases.push({ phase: 'signup', requested: signupCount, ...metrics.table('signup'), errors: metrics.errorClasses('signup'), wallMs: Date.now() - phaseStart, usersReady: recipients.length });

    // ---- Phase: RESEND #1 (Model A: ~100, Model B: 500) ----
    const resendTargets = model === 'a' ? Math.min(100, recipients.length) : Math.min(500, recipients.length);
    if (cooldownWaitMs) { metrics.count('cooldown_wait_ms', cooldownWaitMs); await sleep(cooldownWaitMs); }
    phaseStart = Date.now();
    metrics.samples.length && 0;
    const preResend1 = metrics.samples.filter((s) => s.name === 'resend').length;
    await runPool(resendTargets, async (i) => {
      const r = recipients[i]; if (!r) return;
      const t0 = performance.now();
      try { const res = await withTimeout(r.client.auth.resend({ type: 'signup', email: r.email }), config.requestTimeoutMs, `resend1 ${i}`); await record(metrics, 'resend', t0, res.error, { email: r.email, round: 1 }); }
      catch (e) { await record(metrics, 'resend', t0, e, { email: r.email, round: 1 }); }
    }, concurrency);
    const resend1 = metrics.samples.filter((s) => s.name === 'resend').slice(preResend1);
    phases.push({ phase: 'resend#1', requested: resendTargets, count: resend1.length, ok: resend1.filter((s) => s.ok).length, p50: percentile(resend1.map((s) => s.ms), 50), p95: percentile(resend1.map((s) => s.ms), 95), errors: tally(resend1), wallMs: Date.now() - phaseStart });

    // ---- Phase: RESEND #2 (Model B only: 500) ----
    if (model === 'b') {
      if (cooldownWaitMs) await sleep(cooldownWaitMs);
      phaseStart = Date.now();
      const preResend2 = metrics.samples.filter((s) => s.name === 'resend').length;
      await runPool(Math.min(500, recipients.length), async (i) => {
        const r = recipients[i]; if (!r) return;
        const t0 = performance.now();
        try { const res = await withTimeout(r.client.auth.resend({ type: 'signup', email: r.email }), config.requestTimeoutMs, `resend2 ${i}`); await record(metrics, 'resend', t0, res.error, { email: r.email, round: 2 }); }
        catch (e) { await record(metrics, 'resend', t0, e, { email: r.email, round: 2 }); }
      }, concurrency);
      const resend2 = metrics.samples.filter((s) => s.name === 'resend').slice(preResend2);
      phases.push({ phase: 'resend#2', requested: Math.min(500, recipients.length), count: resend2.length, ok: resend2.filter((s) => s.ok).length, p50: percentile(resend2.map((s) => s.ms), 50), p95: percentile(resend2.map((s) => s.ms), 95), errors: tally(resend2), wallMs: Date.now() - phaseStart });
    }

    // ---- Phase: PASSWORD RESET (Model A: ~50, Model B: 500) ----
    const resetTargets = model === 'a' ? Math.min(50, recipients.length) : Math.min(500, recipients.length);
    if (cooldownWaitMs) await sleep(cooldownWaitMs);
    phaseStart = Date.now();
    const preReset = metrics.samples.filter((s) => s.name === 'reset').length;
    await runPool(resetTargets, async (i) => {
      const r = recipients[i]; if (!r) return;
      const t0 = performance.now();
      try { const res = await withTimeout(r.client.auth.resetPasswordForEmail(r.email), config.requestTimeoutMs, `reset ${i}`); await record(metrics, 'reset', t0, res.error, { email: r.email }); }
      catch (e) { await record(metrics, 'reset', t0, e, { email: r.email }); }
    }, concurrency);
    const reset = metrics.samples.filter((s) => s.name === 'reset').slice(preReset);
    phases.push({ phase: 'password-reset', requested: resetTargets, count: reset.length, ok: reset.filter((s) => s.ok).length, p50: percentile(reset.map((s) => s.ms), 50), p95: percentile(reset.map((s) => s.ms), 95), errors: tally(reset) });

    // ---- Phase: EMAIL-CHANGE (Model B only: 500) ----
    // Needs a session; mailer_autoconfirm is off, so this cohort is created
    // confirmed via the admin API (no signup email) then signed in.
    if (model === 'b') {
      if (cooldownWaitMs) await sleep(cooldownWaitMs);
      phaseStart = Date.now();
      const admin = serviceClient(config);
      const changeCohort: Recipient[] = [];
      await runPool(500, async (i) => {
        const email = `${mailbox}+lt${runId}-c${i}@${domain}`.toLowerCase();
        const pw = password();
        try {
          const created = await withTimeout(admin.auth.admin.createUser({ email, password: pw, email_confirm: true, user_metadata: { username: `lt_chg_${runId}_${i}`.slice(0, 40) } }), config.requestTimeoutMs, `admin create ${i}`);
          if (created.error || !created.data.user) { metrics.count('change_cohort_create_fail'); return; }
          const c = anonClient(config, `lt-chg-${runId}-${i}`);
          const si = await withTimeout(c.auth.signInWithPassword({ email, password: pw }), config.requestTimeoutMs, `chg signin ${i}`);
          if (si.error) { metrics.count('change_cohort_signin_fail'); return; }
          changeCohort.push({ email, password: pw, userId: created.data.user.id, client: c });
        } catch { metrics.count('change_cohort_setup_error'); }
      }, concurrency);

      const preChange = metrics.samples.filter((s) => s.name === 'change-email').length;
      await runPool(changeCohort.length, async (i) => {
        const r = changeCohort[i]; if (!r) return;
        const newEmail = `${mailbox}+lt${runId}-cnew${i}@${domain}`.toLowerCase();
        const t0 = performance.now();
        try { const res = await withTimeout(r.client.auth.updateUser({ email: newEmail }), config.requestTimeoutMs, `change ${i}`); await record(metrics, 'change-email', t0, res.error, { from: r.email, to: newEmail }); }
        catch (e) { await record(metrics, 'change-email', t0, e, { from: r.email }); }
      }, concurrency);
      const change = metrics.samples.filter((s) => s.name === 'change-email').slice(preChange);
      phases.push({ phase: 'email-change', cohortReady: changeCohort.length, count: change.length, ok: change.filter((s) => s.ok).length, p50: percentile(change.map((s) => s.ms), 50), p95: percentile(change.map((s) => s.ms), 95), errors: tally(change) });
    }

    // ---- Auth-state verification + recovery probe ----
    await sleep(3000);
    const usersState = await authUsersState(config, emailLike).catch((e) => ({ error: String(e) }));
    // Recovery probe: after all the load, does a fresh signup still succeed?
    const recStart = performance.now();
    let recovery: Record<string, unknown>;
    try {
      const c = anonClient(config, `lt-mail-${runId}-recovery`);
      const res = await withTimeout(c.auth.signUp({ email: addr('recover', 999999), password: password() }), config.requestTimeoutMs, 'recovery signup');
      const cc = classifyAuth(res.error);
      recovery = { ok: !res.error, class: cc.klass, status: cc.status, ms: Math.round(performance.now() - recStart) };
    } catch (e) {
      recovery = { ok: false, class: classifyAuth(e).klass, ms: Math.round(performance.now() - recStart) };
    }

    const totalEmailOps = ['signup', 'resend', 'reset', 'change-email'].reduce((n, op) => n + metrics.samples.filter((s) => s.name === op).length, 0);
    const totalOk = ['signup', 'resend', 'reset', 'change-email'].reduce((n, op) => n + metrics.samples.filter((s) => s.name === op && s.ok).length, 0);

    return {
      details: {
        model,
        runId,
        recipientPattern: `${mailbox}+lt${runId}-*@${domain}`,
        errorFraction,
        rateLimitEmailSent: model === 'a' ? 1000 : 5000,
        phases,
        totals: {
          emailTriggeringCalls: totalEmailOps,
          succeeded: totalOk,
          failed: totalEmailOps - totalOk,
          successRate: totalEmailOps ? Number((totalOk / totalEmailOps).toFixed(4)) : 0,
          err_429_email: metrics.counters.get('err_429_email') ?? 0,
          err_429_other: metrics.counters.get('err_429_other') ?? 0,
          err_5xx: metrics.counters.get('err_5xx') ?? 0,
          err_timeout: metrics.counters.get('err_timeout') ?? 0,
        },
        perOp: {
          signup: metrics.table('signup'),
          resend: metrics.table('resend'),
          reset: metrics.table('reset'),
          'change-email': metrics.table('change-email'),
        },
        authUsersState: usersState,
        recoveryProbe: recovery,
        note: 'Recipients are Resend simulated-delivery test addresses. Resend-side delivery/bounce stats are NOT cross-checked here (sending-only staging key). GoTrue-side accept/latency/state only.',
      },
    };
  });
}

function tally(samples: Array<{ ok: boolean; errorClass?: string; meta?: any }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of samples) {
    if (s.ok) continue;
    const k = s.errorClass ?? 'unknown';
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}
