/**
 * The route allowlist is the security boundary between push payloads
 * (untrusted) and navigation — these tests pin its rejection behavior.
 */
import { describe, expect, it, vi } from 'vitest';
import { navigateToNotificationTarget, validateNotificationRoute } from '../routes';

const UUID = '123e4567-e89b-42d3-a456-426614174000';

describe('validateNotificationRoute', () => {
  it('accepts every allowlisted screen with a valid UUID param', () => {
    expect(validateNotificationRoute({ screen: 'post', postId: UUID })).toEqual({
      screen: 'post',
      pathname: '/post/[postId]',
      params: { postId: UUID },
    });
    expect(validateNotificationRoute({ screen: 'event', eventId: UUID })?.pathname).toBe(
      '/home/event-detail',
    );
    expect(validateNotificationRoute({ screen: 'club', clubId: UUID })?.pathname).toBe(
      '/club/[clubId]',
    );
    expect(validateNotificationRoute({ screen: 'profile', userId: UUID })?.pathname).toBe(
      '/profile/[userId]',
    );
    expect(validateNotificationRoute({ screen: 'chat', chatId: UUID })?.pathname).toBe(
      '/chat/[chatId]',
    );
    expect(validateNotificationRoute({ screen: 'notifications' })?.pathname).toBe(
      '/home/notifications',
    );
    expect(
      validateNotificationRoute({ screen: 'notificationActors', notificationId: UUID }),
    ).toEqual({
      screen: 'notificationActors',
      pathname: '/home/notification-actors',
      params: { notificationId: UUID },
    });
    // A store-update push (no param) opens the Update screen itself, where
    // "Update now" opens the correct App Store / Play Store listing.
    expect(validateNotificationRoute({ screen: 'update' })?.pathname).toBe(
      '/account-center/update',
    );
  });

  it('a tapped store-update push lands on the Update screen (no inbox underlay)', () => {
    const push = vi.fn();
    const router = { push } as unknown as Parameters<typeof navigateToNotificationTarget>[0];
    navigateToNotificationTarget(router, validateNotificationRoute({ screen: 'update' })!);
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith('/account-center/update');
  });

  it('rejects a grouped-actor route without a valid notificationId', () => {
    expect(validateNotificationRoute({ screen: 'notificationActors' })).toBeNull();
    expect(
      validateNotificationRoute({ screen: 'notificationActors', notificationId: 'not-a-uuid' }),
    ).toBeNull();
  });

  it('opens the exact channel screen when a channelId is present', () => {
    const channel = '223e4567-e89b-42d3-a456-426614174999';
    const route = validateNotificationRoute({ screen: 'chat', chatId: UUID, channelId: channel });
    expect(route?.pathname).toBe('/chat/[chatId]/[channelId]');
    expect(route?.params).toEqual({ chatId: UUID, channelId: channel });
  });

  it('ignores an invalid channelId but keeps the valid chat target', () => {
    const route = validateNotificationRoute({
      screen: 'chat',
      chatId: UUID,
      channelId: '../../evil',
    });
    expect(route?.pathname).toBe('/chat/[chatId]');
    expect(route?.channelId).toBeUndefined();
  });

  it('rejects screens outside the allowlist', () => {
    expect(validateNotificationRoute({ screen: 'settings' })).toBeNull();
    expect(validateNotificationRoute({ screen: '/post/[postId]', postId: UUID })).toBeNull();
    expect(validateNotificationRoute({ screen: 'https://evil.example' })).toBeNull();
  });

  it('rejects raw paths, path traversal and non-UUID params', () => {
    expect(validateNotificationRoute({ screen: 'post', postId: '../../account-center' })).toBeNull();
    expect(validateNotificationRoute({ screen: 'post', postId: 'not-a-uuid' })).toBeNull();
    expect(validateNotificationRoute({ screen: 'post', postId: 42 })).toBeNull();
    expect(validateNotificationRoute({ screen: 'post' })).toBeNull();
    expect(validateNotificationRoute({ screen: 'club', clubId: `${UUID}/extra` })).toBeNull();
  });

  it('never throws on malformed payloads', () => {
    expect(validateNotificationRoute(null)).toBeNull();
    expect(validateNotificationRoute(undefined)).toBeNull();
    expect(validateNotificationRoute('post')).toBeNull();
    expect(validateNotificationRoute(12)).toBeNull();
    expect(validateNotificationRoute([])).toBeNull();
    expect(validateNotificationRoute({})).toBeNull();
  });
});
