export type LinkSegment =
  | { type: "text"; value: string }
  | { type: "link"; value: string; href: string };

const URL_CANDIDATE_RE = /(?:https?:\/\/|www\.)[^\s<>"'`‘’“”]+/gi;
const TRAILING_SENTENCE_PUNCTUATION_RE = /[.,!?;:]/;

// The shared package intentionally compiles without DOM typings, while URL is
// available at runtime in the web and native environments that consume it.
declare const URL: new (url: string) => { protocol: string };

function trimCandidate(candidate: string): string {
  let end = candidate.length;
  let unmatchedClosingParentheses = 0;

  for (const character of candidate) {
    if (character === "(") unmatchedClosingParentheses -= 1;
    if (character === ")") unmatchedClosingParentheses += 1;
  }

  while (end > 0) {
    const character = candidate.charAt(end - 1);

    if (TRAILING_SENTENCE_PUNCTUATION_RE.test(character)) {
      end -= 1;
      continue;
    }

    if (character !== ")" || unmatchedClosingParentheses <= 0) break;

    end -= 1;
    unmatchedClosingParentheses -= 1;
  }

  return candidate.slice(0, end);
}

function toSafeHref(value: string): string | null {
  const href = /^www\./i.test(value) ? `https://${value}` : value;

  try {
    const url = new URL(href);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  } catch {
    return null;
  }

  return href;
}

/**
 * Splits plain text into display-preserving text and HTTP(S) link segments.
 * Empty input returns one empty text segment, consistently with other
 * no-link input.
 */
export function linkify(text: string): LinkSegment[] {
  const segments: LinkSegment[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(URL_CANDIDATE_RE)) {
    const candidate = match[0];
    const matchIndex = match.index ?? 0;
    const value = trimCandidate(candidate);
    const href = toSafeHref(value);

    if (!href || value.length === 0) continue;

    if (matchIndex > lastIndex) {
      segments.push({ type: "text", value: text.slice(lastIndex, matchIndex) });
    }
    segments.push({ type: "link", value, href });
    lastIndex = matchIndex + value.length;
  }

  if (lastIndex < text.length || segments.length === 0) {
    segments.push({ type: "text", value: text.slice(lastIndex) });
  }

  return segments;
}
