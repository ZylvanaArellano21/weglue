import { Alert } from 'react-native';

// ─── Blocking copy + confirmation prompts (ONE source for iOS and Android) ───
//
// Every block/unblock entry point in the app routes through here, so the
// wording cannot drift between the profile menu, the conversation menu, the
// report flow and Settings. There is no Platform.OS branch: both stores get
// identical text.
//
// TWO RULES THIS FILE ENFORCES BY CONSTRUCTION:
//
//  1. The blocked person is never told. No copy anywhere says or implies that
//     a notification is sent, because none is.
//  2. UNAVAILABLE STATES ARE INDISTINGUISHABLE. `UNAVAILABLE_TITLE` /
//     `UNAVAILABLE_BODY` are used for a blocked account, a deleted account and
//     an account that never existed. If they differed, the blocked person could
//     tell which had happened, which is the one thing a block must not leak.

export const UNAVAILABLE_TITLE = 'This account isn’t available';
export const UNAVAILABLE_BODY =
  'This account can’t be viewed right now.';

/** Composer replacement in a direct conversation. Identical for BOTH parties. */
export const DM_UNAVAILABLE_TEXT = 'You can’t reply to this conversation.';

/**
 * Replacement for an image / video / file attachment whose payload the viewer
 * may not read. Same wording family as the existing shared post/event cards
 * ("This post is no longer available."), and identical for BOTH parties, so it
 * never discloses the direction of a block. The message row itself is kept, as
 * historical context; only the payload is withheld — and it is withheld by the
 * storage policy, not by this string.
 */
export const ATTACHMENT_UNAVAILABLE_TEXT = 'This attachment is no longer available.';

/**
 * Profile state shown to the person who CREATED a block, in place of the
 * generic unavailable state. The blocked person never sees this — they get
 * UNAVAILABLE_TITLE/UNAVAILABLE_BODY, which is indistinguishable from a deleted
 * or never-existed account.
 */
export const YOU_BLOCKED_TITLE = 'You blocked this student';
export const YOU_BLOCKED_BODY =
  'You won’t see their profile, posts or weekly events while they’re blocked. Unblock to see them again.';

export const BLOCKED_EMPTY_TITLE = 'You haven’t blocked anyone';
export const BLOCKED_EMPTY_BODY =
  'People you block will appear here. They won’t be told, and you can unblock them at any time.';

function displayName(username?: string | null, fullName?: string | null): string {
  if (username && username.trim()) return `@${username.trim()}`;
  if (fullName && fullName.trim()) return fullName.trim();
  return 'this account';
}

/**
 * Confirm before blocking.
 *
 * The body states exactly what blocking does and — just as importantly — what
 * it does NOT do, because the two most common support questions are "will they
 * know?" and "did I just leave the club?". Both are answered up front.
 */
export function confirmBlock(opts: {
  username?: string | null;
  fullName?: string | null;
  onConfirm: () => void;
}): void {
  const who = displayName(opts.username, opts.fullName);
  Alert.alert(
    `Block ${who}?`,
    `They won’t be able to message you or find your profile, and you won’t see theirs. ` +
      `They won’t be told.\n\n` +
      `You’ll both stay in any clubs, events and group chats you already share.`,
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Block', style: 'destructive', onPress: opts.onConfirm },
    ],
  );
}

/**
 * Confirm before unblocking.
 *
 * Says plainly that nothing is restored. Unblocking looks like an "undo" and is
 * not one — the follows and the Gluemate relationship are gone for good, and a
 * user who expects them back would read the result as a bug.
 */
export function confirmUnblock(opts: {
  username?: string | null;
  fullName?: string | null;
  onConfirm: () => void;
}): void {
  const who = displayName(opts.username, opts.fullName);
  Alert.alert(
    `Unblock ${who}?`,
    `They’ll be able to find your profile and message you again.\n\n` +
      `This won’t restore your previous Gluemate connection.`,
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Unblock', onPress: opts.onConfirm },
    ],
  );
}

/** Shown when the RPC itself failed (offline, transport, server error). */
export function blockFailedAlert(action: 'block' | 'unblock'): void {
  Alert.alert(
    action === 'block' ? 'Couldn’t block' : 'Couldn’t unblock',
    'Something went wrong. Check your connection and try again.',
  );
}

/**
 * Success confirmation. Deliberately does NOT mention notifications at all —
 * saying "they weren't notified" invites the thought that they might have been.
 */
export function blockSucceededAlert(username?: string | null, fullName?: string | null): void {
  Alert.alert('Blocked', `${displayName(username, fullName)} has been blocked.`);
}
