/**
 * Correction 3: exact-destination suppression must cover every route the
 * server can produce, and must never suppress when nothing relevant is open.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { isDestinationOpen } from '../bannerSuppression';
import { setActiveThread, clearActiveThread } from '../activeThread';
import { setActiveDestination, clearActiveDestination } from '../activeDestination';
import { validateNotificationRoute } from '../routes';

const POST_ID = '123e4567-e89b-42d3-a456-426614174000';
const EVENT_ID = '223e4567-e89b-42d3-a456-426614174000';
const CHAT_ID = '323e4567-e89b-42d3-a456-426614174000';
const CHANNEL_ID = '423e4567-e89b-42d3-a456-426614174000';

beforeEach(() => {
  clearActiveThread(CHAT_ID);
  clearActiveDestination('post', POST_ID);
  clearActiveDestination('event', EVENT_ID);
  clearActiveDestination('home');
});

describe('isDestinationOpen', () => {
  it('null route (no server route) falls to the Home-surface bucket', () => {
    expect(isDestinationOpen(null)).toBe(false);
    setActiveDestination('home');
    expect(isDestinationOpen(null)).toBe(true);
  });

  it('suppresses a post banner only for the exact open post', () => {
    const route = validateNotificationRoute({ screen: 'post', postId: POST_ID });
    expect(isDestinationOpen(route)).toBe(false);
    setActiveDestination('post', POST_ID);
    expect(isDestinationOpen(route)).toBe(true);
    // A DIFFERENT post must still banner.
    const otherPost = validateNotificationRoute({ screen: 'post', postId: EVENT_ID });
    expect(isDestinationOpen(otherPost)).toBe(false);
  });

  it('suppresses an event banner only for the exact open event', () => {
    const route = validateNotificationRoute({ screen: 'event', eventId: EVENT_ID });
    expect(isDestinationOpen(route)).toBe(false);
    setActiveDestination('event', EVENT_ID);
    expect(isDestinationOpen(route)).toBe(true);
  });

  it('suppresses a chat banner only for the exact open conversation/channel', () => {
    const route = validateNotificationRoute({ screen: 'chat', chatId: CHAT_ID });
    expect(isDestinationOpen(route)).toBe(false);
    setActiveThread(CHAT_ID, null);
    expect(isDestinationOpen(route)).toBe(true);
    // A channel-scoped push for a DIFFERENT channel in the same conversation
    // must still banner (mirrors isViewingThread's own channel rule).
    const channelRoute = validateNotificationRoute({ screen: 'chat', chatId: CHAT_ID, channelId: CHANNEL_ID });
    expect(isDestinationOpen(channelRoute)).toBe(false);
  });

  it('club/profile/notifications routes fall to the Home-surface bucket', () => {
    const clubRoute = validateNotificationRoute({ screen: 'club', clubId: POST_ID });
    expect(isDestinationOpen(clubRoute)).toBe(false);
    setActiveDestination('home');
    expect(isDestinationOpen(clubRoute)).toBe(true);
  });

  it('does not cross-suppress unrelated buckets', () => {
    setActiveDestination('post', POST_ID);
    const eventRoute = validateNotificationRoute({ screen: 'event', eventId: EVENT_ID });
    expect(isDestinationOpen(eventRoute)).toBe(false); // Home not active, different bucket
  });
});
