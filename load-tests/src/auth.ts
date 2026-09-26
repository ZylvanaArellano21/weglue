import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { TOKEN_REFRESH_JITTER_MS } from './constants.js';
import { readManifest } from './synthetic.js';
import { userClient } from './supabase.js';
import type { LoadTestConfig, SessionBundle } from './types.js';

type Session = SessionBundle['sessions'][number];

function writeBundle(path: string, bundle: SessionBundle): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(bundle)}\n`, { encoding: 'utf8', mode: 0o600 });
  chmodSync(path, 0o600);
}

export function readSessions(config: LoadTestConfig): SessionBundle {
  if (!existsSync(config.sessionsFile)) throw new Error('Session bundle is missing; run prepare-auth first');
  const bundle = JSON.parse(readFileSync(config.sessionsFile, 'utf8')) as SessionBundle;
  if (bundle.schemaVersion !== 2 || bundle.namespace !== config.namespace || bundle.stagingRef !== config.stagingRef || bundle.seed !== config.seed) {
    throw new Error('Session bundle identity mismatch');
  }
  return bundle;
}

/**
 * Real password sign-in for each synthetic user, paced below the staging
 * per-IP Auth rate limit and performed outside every measurement window.
 */
export async function prepareSessions(config: LoadTestConfig, pause: (ms: number) => Promise<unknown> = delay): Promise<SessionBundle> {
  const manifest = readManifest(config.manifestFile, config);
  const sessions: Session[] = [];
  const users = manifest.users.slice(0, config.requestedUsers);
  for (const [position, user] of users.entries()) {
    if (position > 0) await pause(config.authSignInIntervalMs);
    const client = userClient(config);
    const signedIn = await client.auth.signInWithPassword({ email: user.email, password: user.password });
    if (signedIn.error) throw new Error(`sign in synthetic user ${user.index}: ${signedIn.error.message}`);
    const session = signedIn.data.session;
    if (!session || session.user.id !== user.id) throw new Error(`Synthetic user ${user.index} session identity mismatch`);
    sessions.push({ userIndex: user.index, userId: user.id, accessToken: session.access_token, refreshToken: session.refresh_token, expiresAt: session.expires_at ?? 0 });
  }
  const bundle: SessionBundle = { schemaVersion: 2, namespace: config.namespace, seed: config.seed, stagingRef: config.stagingRef, generatedAt: new Date().toISOString(), sessions };
  writeBundle(config.sessionsFile, bundle);
  return bundle;
}

/**
 * Normal refresh-token rotation for every session expiring before `requiredUntilSeconds`.
 * Only the supervisor refreshes (between plateaus), so no two processes ever
 * race on one rotating refresh token. Refreshes are spaced by the interval
 * derived from the verified per-IP token-refresh limit, plus jitter.
 */
export async function refreshSessionsUntil(
  config: LoadTestConfig,
  requiredUntilSeconds: number,
  random: () => number,
  pause: (ms: number) => Promise<unknown> = delay,
): Promise<{ refreshed: number; bundle: SessionBundle }> {
  const bundle = readSessions(config);
  let refreshed = 0;
  for (const session of bundle.sessions) {
    if (session.expiresAt >= requiredUntilSeconds) continue;
    if (refreshed > 0) await pause(config.tokenRefreshIntervalMs + Math.floor(random() * TOKEN_REFRESH_JITTER_MS));
    const client = userClient(config);
    const result = await client.auth.refreshSession({ refresh_token: session.refreshToken });
    if (result.error || !result.data.session) throw new Error(`refresh synthetic user ${session.userIndex}: ${result.error?.message ?? 'no session'}`);
    if (result.data.session.user.id !== session.userId) throw new Error(`Synthetic user ${session.userIndex} refresh identity mismatch`);
    session.accessToken = result.data.session.access_token;
    session.refreshToken = result.data.session.refresh_token;
    session.expiresAt = result.data.session.expires_at ?? 0;
    refreshed += 1;
  }
  const next = { ...bundle, generatedAt: new Date().toISOString() };
  writeBundle(config.sessionsFile, next);
  return { refreshed, bundle: next };
}

export function jwtExpiration(token: string): number {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as { exp?: number };
    return Number(payload.exp ?? 0);
  } catch {
    return 0;
  }
}

/** Every session the plateau needs must be valid through the plateau plus a safety margin. */
export function assertSessionsCover(bundle: SessionBundle, users: number, requiredUntilSeconds: number): void {
  if (bundle.sessions.length < users) throw new Error(`Expected at least ${users} sessions, received ${bundle.sessions.length}`);
  for (let index = 0; index < users; index += 1) {
    const session = bundle.sessions[index];
    if (!session || session.userIndex !== index) throw new Error(`Session bundle is not ordered by user index at ${index}`);
    if (jwtExpiration(session.accessToken) < requiredUntilSeconds) throw new Error('One or more access tokens will expire before the plateau and safety margin complete');
  }
}
