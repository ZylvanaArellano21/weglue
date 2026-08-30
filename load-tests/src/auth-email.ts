import { randomUUID } from 'node:crypto';
import type { LoadTestConfig } from './config.js';
import { argNumber, argString, assertWriteApproved } from './config.js';
import { Metrics, percentile } from './metrics.js';
import { anonClient, serviceClient, withTimeout } from './supabase.js';
import { runScenario, sleep } from './runner.js';

// ============================================================================
// auth-email — staging Auth email-capacity tests (Model A realistic / Model B stress).
//
// Two independent ceilings were characterised on the hosted Auth service:
//   1. per-IP `over_request_rate_limit` on auth.signUp  — ~8 burst, ~7/min
//      sustained from ONE origin. NOT on resetPasswordForEmail. admin.* bypasses.
//   2. `rate_limit_email_sent` (per project, per hour)   — 1000 (A) / 5000 (B).
//
// So single-origin volume for signup-verification emails is driven through
// `admin.inviteUserByEmail` (same GoTrue -> Resend SMTP pipeline, same
// rate_limit_email_sent bucket, no per-IP cap). The REAL auth.signUp path
// (+ before_user_created hook + confirmation template) is validated with a
// small paced cohort. Recipients are Resend's simulated-delivery test address
// `delivered+<label>@resend.dev` — no real inboxes.
//
// Requires SUPABASE_ACCESS_TOKEN for the auth.users state checks.
// ============================================================================

type Op = 'invite' | 'signup' | 'resend' | 'reset' | 'change-email';

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

function classify(err: any): { klass: string; status?: number; code?: string; cooldown?: number } {
  if (!err) return { klass: 'ok' };
  const status = err?.status;
  const code = err?.code;
  const msg = String(err?.message ?? err ?? '').toLowerCase();
  const cd = msg.match(/(\d+)\s*(?:seconds?|s)\b/);
  let klass: string;
  if (code === 'over_email_send_rate_limit' || (status === 429 && /email/.test(msg))) klass = '429_email_bucket';
  else if (code === 'over_request_rate_limit') klass = '429_per_ip_request';
  else if (status === 429) klass = '429_other';
  else if (status && status >= 500) klass = '5xx';
  else if (msg.includes('timeout') || err?.code === 'TIMEOUT') klass = 'timeout';
  else if (status && status >= 400) klass = `4xx_${code ?? status}`;
  else klass = `err_${code ?? status ?? 'unknown'}`;
  return { klass, status, code, cooldown: cd ? Number(cd[1]) : undefined };
}

function rec(metrics: Metrics, op: Op, t0: number, err: any, meta: Record<string, unknown> = {}): string {
  const c = classify(err);
  metrics.add({ name: op, ms: performance.now() - t0, ok: !err, errorClass: err ? c.klass : undefined, meta: { ...meta, status: c.status, code: c.code, cooldown: c.cooldown } });
  metrics.count(err ? `${op}_fail` : `${op}_ok`);
  if (err) metrics.count(c.klass);
  return c.klass;
}

async function paced<T>(n: number, ratePerMin: number, concurrency: number, fn: (i: number) => Promise<void>, onTick: (done: number, n: number) => void): Promise<void> {
  const gapMs = ratePerMin > 0 ? 60_000 / ratePerMin : 0;
  const start = Date.now();
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < n) {
      const i = next++;
      if (gapMs) {
        const wait = start + i * gapMs - Date.now();
        if (wait > 0) await sleep(wait);
      }
      await fn(i);
      done += 1;
      if (done % 50 === 0 || done === n) onTick(done, n);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, n)) }, worker));
}

export async function authEmail(config: LoadTestConfig, args: Record<string, string | boolean>): Promise<string> {
  assertWriteApproved(config);
  const model = (argString(args, 'model', 'a').toLowerCase() === 'b' ? 'b' : 'a') as 'a' | 'b';
  const runId = `${Date.now().toString(36)}${randomUUID().slice(0, 4)}`;
  const domain = argString(args, 'recipient-domain', 'resend.dev');
  const mailbox = argString(args, 'recipient-mailbox', 'delivered');
  const emailLike = `${mailbox}+lt${runId}%@${domain}`;
  const addr = (label: string, i: number) => `${mailbox}+lt${runId}-${label}${i}@${domain}`.toLowerCase();
  const pw = () => `LtMail-${randomUUID().replace(/-/g, '').slice(0, 18)}a!1`;

  const isA = model === 'a';
  const inviteCount = Math.floor(argNumber(args, 'invites', isA ? 500 : 1500));
  const inviteRatePerMin = argNumber(args, 'invite-rate-per-min', isA ? 13 : 0); // A: ~13/min stays well under 1000/hr with headroom; B: 0 = max
  const inviteConcurrency = Math.max(1, Math.floor(argNumber(args, 'invite-concurrency', isA ? 1 : 4)));
  const realSignups = Math.floor(argNumber(args, 'real-signups', 24));
  const signupIntervalMs = Math.max(0, argNumber(args, 'signup-interval-ms', 9000)); // just under the per-IP burst
  const resetCount = Math.floor(argNumber(args, 'resets', isA ? 100 : 500));
  const changeCount = Math.floor(argNumber(args, 'changes', isA ? 0 : 500));
  const cooldownWaitMs = Math.max(0, argNumber(args, 'cooldown-wait-ms', 75_000));
  const rateLimitTarget = argNumber(args, 'rate-limit-email-sent', isA ? 1000 : 5000);

  const admin = serviceClient(config);
  const tick = (label: string) => (done: number, n: number) => {
    const bucket = metrics.counters.get('429_email_bucket') ?? 0;
    const perIp = metrics.counters.get('429_per_ip_request') ?? 0;
    process.stderr.write(`[${new Date().toISOString().slice(11, 19)}] ${label} ${done}/${n}  ok=${metrics.counters.get(`${label}_ok`) ?? metrics.counters.get('invite_ok') ?? 0} 429bucket=${bucket} 429ip=${perIp} 5xx=${metrics.counters.get('5xx') ?? 0}\n`);
  };
  let metrics!: Metrics;

  return runScenario(config, `auth-email-model-${model}`, async (m) => {
    metrics = m;
    const phases: Array<Record<string, unknown>> = [];
    const bucketState = async (tag: string) => {
      const s = await mgmt(config, `select
        count(*)::int total,
        count(*) filter (where invited_at is not null)::int invited,
        count(*) filter (where confirmation_sent_at is not null)::int confirmation_sent,
        count(*) filter (where recovery_sent_at is not null)::int recovery_sent,
        count(*) filter (where email_change <> '')::int email_change_pending,
        count(*) filter (where email_change_sent_at is not null)::int email_change_sent,
        count(*) filter (where email_confirmed_at is not null)::int confirmed
        from auth.users where email like '${emailLike}'`).catch((e) => [{ error: String(e) }]);
      return { tag, ...(s[0] ?? {}) };
    };

    // ---- Phase 1: invite volume (signup-verification-email proxy) ----
    let phaseStart = Date.now();
    await paced(inviteCount, inviteRatePerMin, inviteConcurrency, async (i) => {
      const t0 = performance.now();
      try { const r = await withTimeout(admin.auth.admin.inviteUserByEmail(addr('inv', i)), config.requestTimeoutMs, `invite ${i}`); rec(metrics, 'invite', t0, r.error, {}); }
      catch (e) { rec(metrics, 'invite', t0, e); }
    }, tick('invite'));
    const inv = metrics.samples.filter((s) => s.name === 'invite');
    phases.push({
      phase: 'invite-volume', requested: inviteCount, ok: inv.filter((s) => s.ok).length,
      wallSec: Math.round((Date.now() - phaseStart) / 1000),
      effectiveRatePerHour: Math.round((inv.length / Math.max(1, (Date.now() - phaseStart) / 1000)) * 3600),
      p50: percentile(inv.map((s) => s.ms), 50), p95: percentile(inv.map((s) => s.ms), 95), p99: percentile(inv.map((s) => s.ms), 99),
      errors: errTally(metrics, 'invite'),
    });

    // ---- Phase 2: real auth.signUp cohort (path + hook + confirmation template) ----
    phaseStart = Date.now();
    const real: Array<{ email: string; client: ReturnType<typeof anonClient> }> = [];
    for (let i = 0; i < realSignups; i += 1) {
      if (signupIntervalMs && i > 0) await sleep(signupIntervalMs);
      const email = addr('rs', i);
      const client = anonClient(config, `lt-mail-${runId}-rs-${i}`);
      const t0 = performance.now();
      try {
        const r = await withTimeout(client.auth.signUp({ email, password: pw(), options: { data: { username: `lt_m_${runId}_rs${i}`.slice(0, 40) } } }), config.requestTimeoutMs, `signup ${i}`);
        rec(metrics, 'signup', t0, r.error, { email });
        if (!r.error && (r.data.user?.identities?.length ?? 0) > 0) real.push({ email, client });
      } catch (e) { rec(metrics, 'signup', t0, e, { email }); }
    }
    // hook negative check
    let hookBlocked = 0;
    for (let i = 0; i < 3; i += 1) {
      try { const r = await anonClient(config, `lt-hook-${runId}-${i}`).auth.signUp({ email: `lt${runId}-edu${i}@student.example.edu`, password: pw() }); if (r.error?.status === 422) hookBlocked += 1; }
      catch { /* ignore */ }
      await sleep(9000);
    }
    const sg = metrics.samples.filter((s) => s.name === 'signup');
    phases.push({ phase: 'real-signup', requested: realSignups, ok: sg.filter((s) => s.ok).length, cohort: real.length, hookBlockedEdu: `${hookBlocked}/3`, p50: percentile(sg.map((s) => s.ms), 50), p95: percentile(sg.map((s) => s.ms), 95), errors: errTally(metrics, 'signup') });

    // ---- Phase 3: resend on the real cohort ----
    if (real.length) {
      if (cooldownWaitMs) await sleep(cooldownWaitMs);
      phaseStart = Date.now();
      for (let i = 0; i < real.length; i += 1) {
        const t0 = performance.now();
        try { const r = await withTimeout(real[i]!.client.auth.resend({ type: 'signup', email: real[i]!.email }), config.requestTimeoutMs, `resend ${i}`); rec(metrics, 'resend', t0, r.error, {}); }
        catch (e) { rec(metrics, 'resend', t0, e); }
        await sleep(1500);
      }
      const rs = metrics.samples.filter((s) => s.name === 'resend');
      phases.push({ phase: 'resend', requested: real.length, ok: rs.filter((s) => s.ok).length, p50: percentile(rs.map((s) => s.ms), 50), p95: percentile(rs.map((s) => s.ms), 95), errors: errTally(metrics, 'resend') });
    }

    // ---- Phase 4: password reset (confirmed cohort via admin, then anon reset burst) ----
    phaseStart = Date.now();
    const resetEmails: string[] = [];
    await paced(resetCount, 0, 6, async (i) => {
      const email = addr('rst', i);
      try { const r = await admin.auth.admin.createUser({ email, password: pw(), email_confirm: true, user_metadata: { username: `lt_m_${runId}_rst${i}`.slice(0, 40) } }); if (!r.error) resetEmails.push(email); }
      catch { /* ignore */ }
    }, () => {});
    await paced(resetEmails.length, 0, 8, async (i) => {
      const t0 = performance.now();
      try { const r = await withTimeout(anonClient(config, `lt-rst-${runId}-${i}`).auth.resetPasswordForEmail(resetEmails[i]!), config.requestTimeoutMs, `reset ${i}`); rec(metrics, 'reset', t0, r.error, {}); }
      catch (e) { rec(metrics, 'reset', t0, e); }
    }, tick('reset'));
    const rst = metrics.samples.filter((s) => s.name === 'reset');
    phases.push({ phase: 'password-reset', cohort: resetEmails.length, ok: rst.filter((s) => s.ok).length, wallSec: Math.round((Date.now() - phaseStart) / 1000), p50: percentile(rst.map((s) => s.ms), 50), p95: percentile(rst.map((s) => s.ms), 95), errors: errTally(metrics, 'reset') });

    // ---- Phase 5: email-change (Model B) ----
    if (changeCount > 0) {
      phaseStart = Date.now();
      const changeCohort: Array<{ client: ReturnType<typeof anonClient> }> = [];
      await paced(changeCount, 0, 6, async (i) => {
        const email = addr('chg', i);
        const password = pw();
        try {
          const c = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { username: `lt_m_${runId}_chg${i}`.slice(0, 40) } });
          if (c.error) return;
          const client = anonClient(config, `lt-chg-${runId}-${i}`);
          const si = await client.auth.signInWithPassword({ email, password });
          if (!si.error) changeCohort.push({ client });
        } catch { /* ignore */ }
      }, () => {});
      await paced(changeCohort.length, 0, 8, async (i) => {
        const t0 = performance.now();
        try { const r = await withTimeout(changeCohort[i]!.client.auth.updateUser({ email: addr('cnew', i) }), config.requestTimeoutMs, `change ${i}`); rec(metrics, 'change-email', t0, r.error, {}); }
        catch (e) { rec(metrics, 'change-email', t0, e); }
      }, tick('change-email'));
      const ch = metrics.samples.filter((s) => s.name === 'change-email');
      phases.push({ phase: 'email-change', cohort: changeCohort.length, ok: ch.filter((s) => s.ok).length, wallSec: Math.round((Date.now() - phaseStart) / 1000), p50: percentile(ch.map((s) => s.ms), 50), p95: percentile(ch.map((s) => s.ms), 95), errors: errTally(metrics, 'change-email') });
    }

    // ---- recovery probe + auth-state verification ----
    await sleep(3000);
    const state = await bucketState('after');
    let recovery: Record<string, unknown>;
    const rp0 = performance.now();
    try { const r = await withTimeout(admin.auth.admin.inviteUserByEmail(addr('recover', 999999)), config.requestTimeoutMs, 'recovery'); recovery = { via: 'invite', ok: !r.error, class: classify(r.error).klass, ms: Math.round(performance.now() - rp0) }; }
    catch (e) { recovery = { via: 'invite', ok: false, class: classify(e).klass, ms: Math.round(performance.now() - rp0) }; }

    const ops: Op[] = ['invite', 'signup', 'resend', 'reset', 'change-email'];
    const total = ops.reduce((n, o) => n + metrics.samples.filter((s) => s.name === o).length, 0);
    const totalOk = ops.reduce((n, o) => n + metrics.samples.filter((s) => s.name === o && s.ok).length, 0);

    return {
      details: {
        model, runId,
        recipientPattern: `${mailbox}+lt${runId}-*@${domain}`,
        rateLimitEmailSentTarget: rateLimitTarget,
        phases,
        totals: {
          emailTriggeringCalls: total, succeeded: totalOk, failed: total - totalOk,
          successRate: total ? Number((totalOk / total).toFixed(4)) : 0,
          err_429_email_bucket: metrics.counters.get('429_email_bucket') ?? 0,
          err_429_per_ip_request: metrics.counters.get('429_per_ip_request') ?? 0,
          err_429_other: metrics.counters.get('429_other') ?? 0,
          err_5xx: metrics.counters.get('5xx') ?? 0,
          err_timeout: metrics.counters.get('timeout') ?? 0,
        },
        perOp: Object.fromEntries(ops.map((o) => [o, metrics.table(o)])),
        authUsersState: state,
        recoveryProbe: recovery,
        note: 'Signup-verification volume driven via admin.inviteUserByEmail (same GoTrue->Resend SMTP pipeline + rate_limit_email_sent bucket; no per-IP cap). Real auth.signUp path validated by the small real-signup cohort. Resend-side delivery/bounce not cross-checked (sending-only staging key).',
      },
    };
  });
}

function errTally(metrics: Metrics, op: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of metrics.samples) {
    if (s.name !== op || s.ok) continue;
    out[s.errorClass ?? 'unknown'] = (out[s.errorClass ?? 'unknown'] ?? 0) + 1;
  }
  return out;
}
