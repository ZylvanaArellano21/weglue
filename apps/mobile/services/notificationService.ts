import { supabase } from '../lib/supabase';

export type NotificationGroup = 'Yesterday' | 'Last week' | 'Earlier';

export interface NotificationSender {
  id: string;
  username: string;
  avatar_url: string | null;
}

export interface AppNotification {
  id: string;
  type: 'follow_request' | 'follow_accepted' | 'like' | 'comment' | 'event_rsvp' | 'new_event' | 'new_message' | 'gluemate';
  sender: NotificationSender | null;
  reference_id: string | null;
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
      id, type, entity_id, read, created_at,
      profiles!notifications_actor_id_fkey(id, username, avatar_url)
    `)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error || !data) return [];

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart.getTime() - 86400000);
  const weekStart = new Date(todayStart.getTime() - 7 * 86400000);

  const groups: Record<NotificationGroup, AppNotification[]> = {
    Yesterday: [],
    'Last week': [],
    Earlier: [],
  };

  for (const n of data as any[]) {
    const date = new Date(n.created_at);
    const notification: AppNotification = {
      id: n.id,
      type: n.type,
      sender: n.profiles
        ? { id: n.profiles.id, username: n.profiles.username, avatar_url: n.profiles.avatar_url }
        : null,
      reference_id: n.entity_id ?? null,
      is_read: n.read,
      created_at: n.created_at,
    };

    if (date >= yesterdayStart && date < todayStart) {
      groups['Yesterday'].push(notification);
    } else if (date >= weekStart && date < yesterdayStart) {
      groups['Last week'].push(notification);
    } else if (date < yesterdayStart) {
      groups['Earlier'].push(notification);
    }
  }

  return (Object.entries(groups) as [NotificationGroup, AppNotification[]][])
    .filter(([, items]) => items.length > 0)
    .map(([group, data]) => ({ group, data }));
}

export async function acceptFollowRequest(requesterId: string, userId: string): Promise<void> {
  await supabase
    .from('follows')
    .update({ status: 'accepted' })
    .eq('follower_id', requesterId)
    .eq('following_id', userId);
}

export async function markNotificationsRead(userId: string): Promise<void> {
  await supabase
    .from('notifications')
    .update({ read: true })
    .eq('user_id', userId)
    .eq('read', false);
}
