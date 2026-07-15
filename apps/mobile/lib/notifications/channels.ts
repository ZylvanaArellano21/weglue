/**
 * Android notification channels — created once at startup (no-op on iOS and
 * on repeat calls). Channel ids must match the send-push Edge Function's
 * CATEGORY_CHANNEL map; Android ignores later importance edits, so these
 * four cover the product without channel sprawl.
 */
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

const BRAND_TEAL = '#0FA6A6';

export async function ensureAndroidChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;

  await Notifications.setNotificationChannelAsync('messages', {
    name: 'Messages',
    description: 'Direct messages, group chats and club chat activity.',
    importance: Notifications.AndroidImportance.HIGH,
    sound: 'default',
    vibrationPattern: [0, 250, 250, 250],
    lightColor: BRAND_TEAL,
    showBadge: true,
  });

  await Notifications.setNotificationChannelAsync('events', {
    name: 'Events & reminders',
    description: 'Event reminders, RSVP deadlines, changes and cancellations.',
    importance: Notifications.AndroidImportance.HIGH,
    sound: 'default',
    vibrationPattern: [0, 250, 250, 250],
    lightColor: BRAND_TEAL,
    showBadge: true,
  });

  await Notifications.setNotificationChannelAsync('clubs', {
    name: 'Clubs & social activity',
    description: 'Club posts, announcements, followers, likes and comments.',
    importance: Notifications.AndroidImportance.DEFAULT,
    sound: 'default',
    lightColor: BRAND_TEAL,
    showBadge: true,
  });

  await Notifications.setNotificationChannelAsync('account', {
    name: 'Account activity',
    description: 'Important activity about your account.',
    importance: Notifications.AndroidImportance.HIGH,
    sound: 'default',
    lightColor: BRAND_TEAL,
    showBadge: true,
  });
}
