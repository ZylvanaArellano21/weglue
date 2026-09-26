import type { SyntheticManifest } from '../src/types.js';

export const manifestFixture: SyntheticManifest = {
  schemaVersion: 2,
  namespace: 'wg-loadtest-contract-test',
  seed: 1481492026,
  stagingRef: 'cwwmuxxqxovhcnnardlj',
  universityId: '00000000-0000-4000-8000-000000000001',
  universityName: 'Load Test University',
  createdAt: '2026-09-25T00:00:00.000Z',
  seededAt: '2026-09-25T00:00:00.000Z',
  users: Array.from({ length: 250 }, (_, index) => ({ index, id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, email: `wg-loadtest-wg-loadtest-contract-test-${index}@loadtest.invalid`, password: 'x' })),
  clubIds: Array.from({ length: 5 }, (_, index) => `10000000-0000-4000-8000-00000000000${index}`),
  clubSizes: [5, 25, 75, 150, 250],
  eventIds: Array.from({ length: 100 }, (_, index) => `20000000-0000-4000-8000-${String(index).padStart(12, '0')}`),
  postIds: Array.from({ length: 300 }, (_, index) => `30000000-0000-4000-8000-${String(index).padStart(12, '0')}`),
  conversationIds: Array.from({ length: 5 }, (_, index) => `40000000-0000-4000-8000-00000000000${index}`),
  channelIds: Array.from({ length: 5 }, (_, index) => `50000000-0000-4000-8000-00000000000${index}`),
  messageIds: [],
};

export function sampleContext(journey: string, entityIndex = 3, userIndex = 7) {
  return {
    session: { userIndex, userId: manifestFixture.users[userIndex]!.id, accessToken: 'token' },
    manifest: manifestFixture,
    action: { sequence: 42, userIndex, journey, entityIndex, thinkTimeMs: 9_000, clientTag: 'wg-loadtest-contract-test:1:42' },
    namespace: manifestFixture.namespace,
    nowIso: '2026-09-25T00:00:00.000Z',
    cycle: 0,
    clientTag: '00000000-0000-5000-8000-000000000000',
    sentAt: 1_790_000_000_000,
  };
}
