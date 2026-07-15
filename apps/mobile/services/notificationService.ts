import { supabase } from '../lib/supabase';
import { dateInAppTz, dayDiff, todayInAppTz } from '../lib/timezone';

export type NotificationGroup = 'New' | 'Yesterday' | 'Last week' | 'Earlier';

export interface NotificationSender {
  id: string;
  username: string;
  avatar_url: string | null;
}

// How the viewer relates to the notification's actor — drives the row's
// action button (Follow back / Requested / nothing when already following).
export type ActorFollowState = 'not_following' | 'pending' | 'following';

export interface AppNotification {
  id: string;
  /** Open set: the server-side notification_types registry (migration 046)
   * is authoritative; unknown values render with the generic fallback. */
  type: string;
  sender: NotificationSender | null;
  reference_id: string | null;
  entity_type: 'event' | 'club' | 'message' | 'post' | null;
  /** Pre-rendered copy from the DB trigger (club/chat notifications) —
   * shown verbatim when present. */
  message: string | null;
  /** Structured destination from the server (validated client-side before
   * navigating — see lib/notifications/routes.ts). */
  route: Record<string, unknown> | null;
  /** Grouped rows ("Camila and 4 others liked your post"): total actions. */
  group_count: number;
  actor_follow_state: ActorFollowState;
  is_read: boolean;
  created_at: string;
}

export interface NotificationSection {
  group: NotificationGroup;
  data: AppNotification[];
}

export async function getNotifications(userId: string): Promise<NotificationSection[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select(`
      id, type, entity_id, entity_type, read, created_at, message, route, group_count,
      profiles!notifications_actor_id_fkey(id, username, avatar_url)
    `)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error || !data) return [];

  // One extra round-trip: how the viewer relates to each actor, so rows can
  // render Follow back / Requested correctly without N queries.
  const actorIds = [
    ...new Set(
      (data as any[]).map((n) => n.profiles?.id).filter(Boolean) as string[],
    ),
  ];
  const followStateMap = new Map<string, ActorFollowState>();
  if (actorIds.length > 0) {
    const { data: myFollows } = await supabase
      .from('follows')
      .select('following_id, status')
      .eq('follower_id', userId)
      .in('following_id', actorIds);
    for (const f of (myFollows ?? []) as any[]) {
      followStateMap.set(
        f.following_id,
        f.status === 'accepted' ? 'following' : 'pending',
      );
    }
  }

  // Group by calendar day in America/Chicago (device/UTC drift previously
  // made every notification created *today* vanish — no bucket matched it).
  const today = todayInAppTz();

  const groups: Record<NotificationGroup, AppNotification[]> = {
    New: [],
    Yesterday: [],
    'Last week': [],
    Earlier: [],
  };

  for (const n of data as any[]) {
    const notifDay = dateInAppTz(new Date(n.created_at));
    const daysAgo = dayDiff(notifDay, today);

    const notification: AppNotification = {
      id: n.id,
      type: n.type,
      sender: n.profiles
        ? { id: n.profiles.id, username: n.profiles.username, avatar_url: n.profiles.avatar_url }
        : null,
      reference_id: n.entity_id ?? null,
      entity_type: n.entity_type ?? null,
      message: n.message ?? null,
      route: n.route ?? null,
      group_count: n.group_count ?? 1,
      actor_follow_state: n.profiles
        ? followStateMap.get(n.profiles.id) ?? 'not_following'
        : 'not_following',
      is_read: n.read,
      created_at: n.created_at,
    };

    if (daysAgo <= 0) groups['New'].push(notification);
    else if (daysAgo === 1) groups['Yesterday'].push(notification);
    else if (daysAgo <= 7) groups['Last week'].push(notification);
    else groups['Earlier'].push(notification);
  }

  return (Object.entries(groups) as [NotificationGroup, AppNotification[]][])
    .filter(([, items]) => items.length > 0)
    .map(([group, data]) => ({ group, data }));
}

// Accept a pending follow request. The DB trigger (migration 031) replaces
// the follow_request notification and notifies the requester.
export async function acceptFollowRequest(requesterId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('follows')
    .update({ status: 'accepted' })
    .eq('follower_id', requesterId)
    .eq('following_id', userId)
    .eq('status', 'pending');
  if (error) throw error;
}

// Decline a pending follow request — deletes the follows row; the DB trigger
// removes the stale follow_request notification.
export async function declineFollowRequest(requesterId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('follows')
    .delete()
    .eq('follower_id', requesterId)
    .eq('following_id', userId)
    .eq('status', 'pending');
  if (error) throw error;
}

export async function markNotificationsRead(userId: string): Promise<void> {
  await supabase
    .from('notifications')
    .update({ read: true })
    .eq('user_id', userId)
    .eq('read', false);
}

/** Mark ONE notification read (on open) — realtime UPDATE syncs other devices. */
export async function markNotificationRead(notificationId: string): Promise<void> {
  await supabase
    .from('notifications')
    .update({ read: true })
    .eq('id', notificationId)
    .eq('read', false);
}

// ─── Notification preferences (synced across devices; enforced server-side
//     in enqueue_push — flipping a toggle here changes real push delivery) ───

export interface NotificationPreferences {
  push_enabled: boolean;
  push_messages: boolean;
  push_social: boolean;
  push_clubs: boolean;
  push_events: boolean;
  push_social_proof: boolean;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  push_enabled: true,
  push_messages: true,
  push_social: true,
  push_clubs: true,
  push_events: true,
  push_social_proof: false,
};

export async function getNotificationPreferences(
  userId: string,
): Promise<NotificationPreferences> {
  const { data, error } = await supabase
    .from('notification_preferences')
    .select('push_enabled, push_messages, push_social, push_clubs, push_events, push_social_proof')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  // Missing row = server defaults (user_wants_push mirrors these exactly).
  return data ?? DEFAULT_NOTIFICATION_PREFERENCES;
}

export async function updateNotificationPreference(
  userId: string,
  current: NotificationPreferences,
  patch: Partial<NotificationPreferences>,
): Promise<void> {
  const { error } = await supabase
    .from('notification_preferences')
    .upsert(
      { user_id: userId, ...current, ...patch, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    );
  if (error) throw error;
}
