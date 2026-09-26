import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { SYNTHETIC_EMAIL_LOCAL_PREFIX, SYNTHETIC_PREFIX } from './constants.js';
import { uuidFromSha256Hex } from '../k6/lib/uuid.js';
import type { LoadTestConfig, SyntheticManifest } from './types.js';

/** Name-based UUID shared with the k6 script (k6/lib/uuid.js). */
export function deterministicUuid(namespace: string, kind: string, index: number | string): string {
  return uuidFromSha256Hex(createHash('sha256').update(`${namespace}:${kind}:${index}`).digest('hex'));
}

export function syntheticEmail(config: Pick<LoadTestConfig, 'namespace' | 'emailDomain'>, index: number): string {
  return `${SYNTHETIC_EMAIL_LOCAL_PREFIX}${config.namespace}-${index}@${config.emailDomain}`.toLowerCase();
}

export function syntheticPassword(namespace: string, seed: number, index: number): string {
  const digest = createHash('sha256').update(`${namespace}:${seed}:password:${index}`).digest('base64url').slice(0, 24);
  return `Wg!${digest}9a`;
}

export function syntheticUsername(namespace: string, index: number): string {
  return `${namespace.replaceAll('-', '_')}_${index}`.slice(0, 40);
}

/** Content marker carried by every campaign-generated message. */
export function actionMessagePrefix(namespace: string): string {
  return `${namespace}:action:`;
}

export function assertSyntheticManifest(manifest: SyntheticManifest, config: LoadTestConfig): void {
  if (manifest.schemaVersion !== 2) throw new Error('Unsupported synthetic manifest schema');
  if (manifest.namespace !== config.namespace || !manifest.namespace.startsWith(SYNTHETIC_PREFIX)) throw new Error('Manifest namespace mismatch');
  if (manifest.stagingRef !== config.stagingRef) throw new Error('Manifest staging ref mismatch');
  if (manifest.universityId !== config.universityId) throw new Error('Manifest university mismatch');
  if (manifest.seed !== config.seed) throw new Error('Manifest seed mismatch');
  if (!Number.isFinite(Date.parse(manifest.seededAt))) throw new Error('Manifest seededAt watermark is missing');
  for (const user of manifest.users) {
    if (user.email !== syntheticEmail(config, user.index)) throw new Error(`Non-synthetic or unexpected manifest email: ${user.email}`);
  }
  if (manifest.conversationIds.length !== manifest.clubIds.length || manifest.channelIds.length !== manifest.clubIds.length) {
    throw new Error('Manifest conversation/channel list does not match the club list');
  }
}

export function readManifest(path: string, config: LoadTestConfig): SyntheticManifest {
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as SyntheticManifest;
  assertSyntheticManifest(manifest, config);
  return manifest;
}
