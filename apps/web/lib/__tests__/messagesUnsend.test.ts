import { describe, expect, it } from "vitest";
import { UnsendError, unsendFailureMessage } from "../messages/service";

/**
 * Bug 1 — the copy shown when an unsend genuinely did not happen.
 *
 * The requirement is specific: the explanation has to be human-readable, must
 * not use technical or database language, and must not fall back on generic
 * "Something went wrong. Try again." wording. Because the message has just been
 * restored into the thread, it also has to tell the person the content is still
 * there — that is the part a generic sentence hides.
 */
describe("unsend failure copy", () => {
  const cases: Array<[ConstructorParameters<typeof UnsendError>[0], string]> = [
    ["not_permitted", "own messages"],
    ["already_gone", "already been removed"],
    ["offline", "not connected"],
    ["unknown", "couldn’t be unsent"],
  ];

  it.each(cases)("explains the %s case in plain language", (kind, fragment) => {
    const copy = unsendFailureMessage(new UnsendError(kind));
    expect(copy).toContain(fragment);
  });

  it("never uses generic or technical wording for any cause", () => {
    const banned = [
      /something went wrong/i,
      /try again later\.?$/i,
      /\berror\b/i,
      /\bfailed\b/i,
      /\bstatus\b/i,
      /\brequest\b/i,
      /\bserver\b/i,
      /\bdatabase\b/i,
      /\brow\b/i,
      /\bRLS\b/i,
      /\bnull\b/i,
      /\b\d{3}\b/,
    ];
    const kinds: Array<ConstructorParameters<typeof UnsendError>[0]> = [
      "not_permitted",
      "already_gone",
      "offline",
      "unknown",
    ];
    for (const kind of kinds) {
      const copy = unsendFailureMessage(new UnsendError(kind));
      for (const pattern of banned) {
        expect(copy, `"${copy}" (${kind}) must not match ${pattern}`).not.toMatch(pattern);
      }
      // A real sentence, not a fragment or a code.
      expect(copy.length).toBeGreaterThan(30);
      expect(copy.trim()).toMatch(/[.!]$/);
    }
  });

  /**
   * An unrecognised throwable must still produce the same considered wording
   * rather than leaking whatever `message` the thrown value happened to carry.
   */
  it("does not leak an unexpected error's own message", () => {
    const copy = unsendFailureMessage(new Error('duplicate key value violates unique constraint "messages_pkey"'));
    expect(copy).not.toContain("constraint");
    expect(copy).toContain("couldn’t be unsent");
  });
});
