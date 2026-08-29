import type { LoadTestConfig } from './config.js';
import { argNumber, argString, assertWriteApproved } from './config.js';
import { classifyError } from './metrics.js';
import { anonClient, withTimeout } from './supabase.js';
import { readManifest } from './seed.js';
import { runScenario, sleep } from './runner.js';

type EmailOperation = 'resend' | 'reset' | 'change-email';

function cooldownSeconds(message: string): number | undefined {
  const match = message.match(/(\d+)\s*(?:seconds?|s)/i);
  return match ? Number(match[1]) : undefined;
}

export async function emailReliability(config: LoadTestConfig, args: Record<string, string | boolean>): Promise<string> {
  assertWriteApproved(config);
  const manifest = readManifest(config, typeof args.manifest === 'string' ? args.manifest : undefined);
  const requested = argString(args, 'operations', 'resend,reset,change-email').split(',').map((x) => x.trim()) as EmailOperation[];
  const operations = requested.filter((x): x is EmailOperation => ['resend', 'reset', 'change-email'].includes(x));
  if (!operations.length) throw new Error('--operations must contain resend, reset, or change-email');
  const users = Math.min(Math.floor(argNumber(args, 'users', Math.min(10, manifest.userIds.length))), manifest.userIds.length);
  const intervalMs = argNumber(args, 'interval-ms', 6_000);
  const prefix = argString(args, 'prefix', `mail-${Date.now()}`);

  return runScenario(config, 'email-reliability', async (metrics) => {
    const outcomes: Array<Record<string, unknown>> = [];
    for (let i = 0; i < users; i += 1) {
      const userId = manifest.userIds[i];
      const email = manifest.emails[i];
      if (!userId || !email) continue;
      const client = anonClient(config, `loadtest-email-${userId}`);
      if (operations.includes('change-email')) {
        const signedIn = await withTimeout(client.auth.signInWithPassword({ email, password: manifest.passwords[i] ?? '' }), config.requestTimeoutMs, `sign in email user ${i}`);
        if (signedIn.error) throw signedIn.error;
      }
      for (const operation of operations) {
        const started = performance.now();
        try {
          let result: { error: any };
          if (operation === 'resend') result = await withTimeout(client.auth.resend({ type: 'signup', email }), config.requestTimeoutMs, `resend ${i}`);
          else if (operation === 'reset') result = await withTimeout(client.auth.resetPasswordForEmail(email), config.requestTimeoutMs, `reset ${i}`);
          else result = await withTimeout(client.auth.updateUser({ email: `${prefix}-${i}-${Date.now()}@${config.emailDomain}`.toLowerCase() }), config.requestTimeoutMs, `change email ${i}`);
          const error = result.error;
          const message = error?.message ?? '';
          metrics.add({ name: operation, ms: performance.now() - started, ok: !error, errorClass: error ? classifyError(error) : undefined, meta: { status: error?.status, code: error?.code, cooldownSeconds: cooldownSeconds(message) } });
          outcomes.push({ operation, userId, ok: !error, status: error?.status, code: error?.code, message, cooldownSeconds: cooldownSeconds(message) });
        } catch (error) {
          metrics.add({ name: operation, ms: performance.now() - started, ok: false, errorClass: classifyError(error) });
          outcomes.push({ operation, userId, ok: false, errorClass: classifyError(error), message: error instanceof Error ? error.message : String(error) });
        }
        if (intervalMs) await sleep(intervalMs);
      }
    }
    return { details: { users, operations, intervalMs, outcomes } };
  });
}
