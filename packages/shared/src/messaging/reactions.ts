/**
 * The reaction vocabulary, shared by mobile and web so the quick bar and the
 * full picker are identical on both platforms.
 *
 * Product decision: 👎 is NOT in the quick bar — it lives only in the full
 * picker's first group. Everything else in the quick bar is a positive/neutral
 * acknowledgement.
 */

/** The five quick reactions shown on long-press / hover. No 👎 here. */
export const QUICK_REACTIONS = ['❤️', '👍', '😂', '😮', '🎉'] as const;

export type QuickReaction = (typeof QUICK_REACTIONS)[number];

/** The curated "full" set — every common reaction plus 👎. Grouped for
 *  scanability; the first group is the one the quick bar draws from (plus 👎). */
export const EMOJI_GROUPS: { label: string; emojis: string[] }[] = [
  {
    label: 'Reactions',
    emojis: ['❤️', '👍', '👎', '😂', '😮', '🎉', '🔥', '👏', '🙏', '💯', '✅', '👀'],
  },
  {
    label: 'Smileys',
    emojis: ['😀', '😅', '😊', '😍', '🥰', '😎', '🤩', '😭', '😢', '😤', '😴', '🤔', '😬', '🙃', '😇', '🤗'],
  },
  {
    label: 'Gestures',
    emojis: ['🤝', '✌️', '🤞', '🤙', '👌', '🫶', '🙌', '💪', '🫡', '👋'],
  },
  {
    label: 'Hearts & symbols',
    emojis: ['🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '💔', '⭐', '🌟', '✨', '⚡'],
  },
  {
    label: 'Life',
    emojis: ['🎊', '🥳', '🍕', '☕', '📚', '🎓', '🏀', '⚽', '🎵', '🌈', '🌸', '💐'],
  },
];

/** Every emoji the full picker can produce — used to validate a reaction
 *  before it is sent so the UI and the DB CHECK constraint never disagree. */
export const ALL_REACTION_EMOJIS: readonly string[] = Array.from(
  new Set(EMOJI_GROUPS.flatMap((group) => group.emojis)),
);
