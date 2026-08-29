import { randomUUID } from 'node:crypto';
import type { LoadTestConfig } from './config.js';
import { argNumber, argString, assertWriteApproved } from './config.js';
import { Metrics, classifyError } from './metrics.js';
import { serviceClient, anonClient, withTimeout } from './supabase.js';
import { runScenario, sleep } from './runner.js';

type Arrival = 'all' | 'ramp' | 'nat';

function arrivalDelay(index: number, count: number, mode: Arrival, durationMs: number): number {
  if (mode === 'all' || count <= 1) return 0;
  if (mode === 'ramp') return Math.round((index / (count - 1)) * durationMs);
  return Math.round(index * Math.max(25, durationMs / Math.max(1, count)));
}

async function onboardingWrites(config: LoadTestConfig, client: ReturnType<typeof anonClient>, userId: string, index: number, metrics: Metrics): Promise<void> {
  const interestRows = [{ user_id: userId, interest: 'Photography' }, { user_id: userId, interest: 'Technology and Computer' }];
  const activityRows = [{ user_id: userId, activity: 'Study Groups' }, { user_id: userId, activity: 'Networking' }];
  const profile = await client.from('profiles').update({ full_name: `Burst Student ${index}`, university_id: config.universityId, onboarding_completed: true }).eq('id', userId);
  if (profile.error) throw profile.error;
  const interests = await client.from('user_interests').insert(interestRows);
  if (interests.error) throw interests.error;
  const activities = await client.from('user_activities').insert(activityRows);
  if (activities.error) throw activities.error;
  metrics.count('onboarding_authenticated_path');
}

async function fallbackOnboarding(config: LoadTestConfig, userId: string, index: number, metrics: Metrics): Promise<void> {
  const admin = serviceClient(config);
  const profile = await admin.from('profiles').update({ full_name: `Burst Student ${index}`, university_id: config.universityId, onboarding_completed: true }).eq('id', userId);
  if (profile.error) throw profile.error;
  const interests = await admin.from('user_interests').insert([{ user_id: userId, interest: 'Photography' }, { user_id: userId, interest: 'Technology and Computer' }]);
  if (interests.error) throw interests.error;
  const activities = await admin.from('user_activities').insert([{ user_id: userId, activity: 'Study Groups' }, { user_id: userId, activity: 'Networking' }]);
  if (activities.error) throw activities.error;
  metrics.count('onboarding_service_fallback_path');
}

export async function signupBurst(config: LoadTestConfig, args: Record<string, string | boolean>): Promise<string> {
  assertWriteApproved(config);
  const count = Math.floor(argNumber(args, 'count', 500));
  const mode = argString(args, 'arrival', 'all') as Arrival;
  const durationMs = argNumber(args, 'duration-ms', 60_000);
  const natConcurrency = Math.max(1, Math.floor(argNumber(args, 'nat-concurrency', 20)));
  if (!['all', 'ramp', 'nat'].includes(mode)) throw new Error('--arrival must be all, ramp, or nat');
  const prefix = argString(args, 'prefix', `burst-${Date.now()}-${randomUUID().slice(0, 8)}`);

  return runScenario(config, `signup-burst-${mode}`, async (metrics) => {
    const signup = async (index: number): Promise<void> => {
      const delay = arrivalDelay(index, count, mode, durationMs);
      if (delay) await sleep(delay);
      const email = `${prefix}-${index}@${config.emailDomain}`.toLowerCase();
      const password = `Burst-${randomUUID().replace(/-/g, '').slice(0, 18)}a!1`;
      const client = anonClient(config, `loadtest-signup-${prefix}-${index}`);
      const started = performance.now();
      try {
        const result = await withTimeout(client.auth.signUp({ email, password, options: { data: {
          username: `lt_${prefix}_${index}`.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 40),
          full_name: `Burst Student ${index}`,
          interests: ['Photography', 'Technology and Computer'],
          activities: ['Study Groups', 'Networking'],
        } } }), config.requestTimeoutMs, `signup ${index}`);
        const error = result.error;
        if (error) {
          metrics.add({ name: 'signup', ms: performance.now() - started, ok: false, errorClass: classifyError(error), meta: { status: error.status, code: error.code, email } });
          metrics.count('verification_emails_rejected');
          return;
        }
        const user = result.data.user;
        if (!user) throw new Error('signUp returned no user');
        if (user.identities && user.identities.length === 0) {
          metrics.add({ name: 'signup', ms: performance.now() - started, ok: false, errorClass: 'auth/fake_success_existing_user', meta: { status: 200, email } });
          metrics.count('verification_emails_rejected');
          return;
        }
        metrics.add({ name: 'signup', ms: performance.now() - started, ok: true, meta: { status: 200, email, userId: user.id, session: Boolean(result.data.session) } });
        metrics.count('verification_emails_accepted');
        const onboardingStarted = performance.now();
        try {
          if (result.data.session) await onboardingWrites(config, client, user.id, index, metrics);
          else await fallbackOnboarding(config, user.id, index, metrics);
          metrics.add({ name: 'onboarding-writes', ms: performance.now() - onboardingStarted, ok: true });
        } catch (error) {
          metrics.add({ name: 'onboarding-writes', ms: performance.now() - onboardingStarted, ok: false, errorClass: classifyError(error), meta: { userId: user.id } });
        }
      } catch (error) {
        metrics.add({ name: 'signup', ms: performance.now() - started, ok: false, errorClass: classifyError(error), meta: { email } });
        metrics.count('verification_emails_rejected');
      }
    };

    if (mode === 'nat') {
      let next = 0;
      const worker = async (): Promise<void> => { while (next < count) { const index = next; next += 1; await signup(index); } };
      await Promise.all(Array.from({ length: Math.min(natConcurrency, count) }, () => worker()));
    } else {
      await Promise.all(Array.from({ length: count }, (_, index) => signup(index)));
    }
    return { details: { count, arrival: mode, durationMs, natConcurrency, errorClasses: metrics.errorClasses('signup') } };
  });
}
