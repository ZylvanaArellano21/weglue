import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Who the mobile "Certain people" picker may offer.
 *
 * Found in QA: the picker was fed `others`, which filters the viewer out of the
 * conversation roster. In a single-officer Officers chat that left it showing
 * "No eligible people", so selecting `certain` could only ever grant posting
 * access to nobody — and the officer could not grant it to themselves. Web has
 * always offered `details.participants`, i.e. the whole roster including the
 * viewer, so the two platforms disagreed about the same control.
 *
 * The rule, on both platforms: eligible = EVERY participant of THIS
 * conversation, viewer included, and nobody from any other chat.
 *
 * `info.tsx` is a screen component and this suite has no React renderer, so the
 * contract is pinned against the source. That is the same approach
 * `messagesSuggestions.test.ts` already uses for screen-level guarantees.
 */
const source = (relativePath: string) =>
  readFileSync(decodeURIComponent(new URL(relativePath, import.meta.url).pathname), 'utf8');

const infoScreen = source('../../app/chat/[chatId]/info.tsx');

/** The `participants={...}` value handed to the permission editor. */
const pickerFeed = (() => {
  const editor = infoScreen.slice(infoScreen.indexOf('<PermissionEditor'));
  const match = editor.match(/participants=\{([\s\S]*?)\}\n/);
  return match?.[1] ?? '';
})();

describe('Certain people eligibility (mobile)', () => {
  it('feeds the picker the conversation roster, not the self-excluding list', () => {
    expect(pickerFeed).toContain('eligiblePosters');
    // `others` is the viewer-excluding list; it must not drive this control.
    expect(pickerFeed).not.toContain('others');
  });

  it('derives eligibility from this conversation and never filters the viewer out', () => {
    const declaration = infoScreen.slice(
      infoScreen.indexOf('const eligiblePosters'),
      infoScreen.indexOf('const eligiblePosters') + 260,
    );
    expect(declaration).toContain('chatDetails?.participants');
    // The defect was exactly this filter. It must not come back.
    expect(declaration).not.toMatch(/user_id\s*!==\s*userId/);
  });

  it('keeps `others` self-excluding, because the roster and follow states rely on it', () => {
    const declaration = infoScreen.slice(
      infoScreen.indexOf('const others'),
      infoScreen.indexOf('const others') + 200,
    );
    expect(declaration).toMatch(/user_id\s*!==\s*userId/);
  });

  it('scopes eligibility to the conversation, so another chat cannot leak in', () => {
    // The only source is this conversation's own participant list — never the
    // club member roster, which would pull in people from the Members chat.
    expect(pickerFeed).not.toContain('members');
    expect(pickerFeed).not.toContain('clubMembers');
  });

  it('still defaults an Officers chat to "Everyone in this chat"', () => {
    const options = infoScreen.slice(infoScreen.indexOf('const permissionOptions'));
    const officersBranch = options.slice(0, options.indexOf(': ['));
    expect(officersBranch).toContain('Everyone in this chat');
    expect(officersBranch).not.toContain('Only officers');
    // `everyone` is listed first, which is what the sheet selects by default.
    expect(options.indexOf("'everyone'")).toBeLessThan(options.indexOf("'certain'"));
  });
});
