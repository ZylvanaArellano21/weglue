import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// Fix 4 — regression guards on the exact navigation targets. Rendering this
// screen needs a full expo-router + auth-store harness, so (matching this
// repo's existing convention for RN screen regressions, e.g.
// unreadCategories.test.ts) this asserts against the source text directly:
// the point isn't runtime behavior of unrelated code, it's "did the specific
// route string that caused the video-recorded bug come back."
const source = (relativePath: string) =>
  readFileSync(decodeURIComponent(new URL(relativePath, import.meta.url).pathname), 'utf8');

describe('Invite screen — destination and dedup regressions', () => {
  const src = source('../[token].tsx');

  it('never navigates into the Main chat thread (default_channel_id must not be interpolated into the route)', () => {
    expect(src).not.toMatch(/\/chat\/\$\{result\.conversation_id\}\/\$\{result\.default_channel_id\}/);
  });

  it('navigates to the Members sub-channels hub (conversation_id only) on a successful join', () => {
    expect(src).toMatch(/router\.replace\(`\/chat\/\$\{result\.conversation_id\}\?fromInvite=1`/);
  });

  it('Back/close and the error-state action both land on Messages → Group, not Single', () => {
    const matches = src.match(/\/\(tabs\)\/messages\?filter=group/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
    expect(src).not.toMatch(/router\.replace\('\/\(tabs\)\/messages'/);
  });

  it('guards the join+navigate branch against re-running for the same token in one mount', () => {
    expect(src).toMatch(/joinedTokenRef/);
  });

  it('clears the pending invite on terminal failures but not silently on every catch', () => {
    expect(src).toMatch(/TERMINAL_INVITE_ERRORS/);
  });
});

describe('Messages tab — filter param regression', () => {
  const src = source('../../(tabs)/messages/index.tsx');

  it('reads an initial filter from route params instead of always defaulting to single', () => {
    expect(src).toMatch(/useLocalSearchParams<\{\s*filter\?:/);
    expect(src).toMatch(/filterParam === 'group'/);
  });
});
