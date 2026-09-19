import { supabase } from '../lib/supabase';
import { dateInAppTz, dayDiff, todayInAppTz } from '../lib/timezone';
import { resolveNotificationVisual, type NotificationVisual, type NotificationVisualActor, type NotificationVisualEntity } from '@weglue/shared';

export type NotificationGroup = 'New' | 'Yesterday' | 'Last week' | 'Earlier';

export interface NotificationSender {
  id: string;
  username: string;
  avatar_url: string | null;
}

export interface NotificationActor {
  id: string;
  displayName: string;
  username: string;
  avatarUrl: string | null;
}

interface PersistedNotificationActorRow {
  notification_id: string;
  actor_id: string;
  created_at: string;
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
  entity_type: 'event' | 'club' | 'message' | 'post' | 'comment' | null;
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
  actors: NotificationVisualActor[];
  actorCount: number;
  entity: NotificationVisualEntity | null;
  visual: NotificationVisual;
}

export interface NotificationSection {
  group: NotificationGroup;
  data: AppNotification[];
}

export async function getNotifications(userId: string): Promise<NotificationSection[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select(`
      id, type, actor_id, entity_id, entity_type, read, created_at, message, route, group_count, group_actors,
      profiles!notifications_actor_id_fkey(id, username, avatar_url)
    `)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error || !data) return [];

  const rows = data as any[];
  const notificationIds = rows.map((n) => n.id).filter(Boolean) as string[];
  const { data: persistedActorRows, error: persistedActorError } = notificationIds.length
    ? await supabase
      .from('notification_actors')
      .select('notification_id, actor_id, created_at')
      .in('notification_id', notificationIds)
      .order('created_at', { ascending: false })
    : { data: [] as any[], error: null };
  const persistedActorsByNotification = new Map<string, PersistedNotificationActorRow[]>();
  for (const actor of (persistedActorRows ?? []) as PersistedNotificationActorRow[]) {
    const actors = persistedActorsByNotification.get(actor.notification_id) ?? [];
    actors.push(actor);
    persistedActorsByNotification.set(actor.notification_id, actors);
  }
  const actorIdsForRow = (n: any): string[] => {
    const persisted = persistedActorsByNotification.get(n.id) ?? [];
    const legacy = Array.isArray(n.group_actors) ? n.group_actors : [];
    // The representative is the current actor_id; remaining actors are most
    // recent first. The legacy array is oldest-first because 046 appends.
    const useLegacy = Boolean(persistedActorError) || (persisted.length === 0 && legacy.length > 0);
    const candidates = useLegacy
      ? [n.profiles?.id ?? n.actor_id, ...legacy.slice().reverse()]
      : [n.profiles?.id ?? n.actor_id, ...persisted.map((a) => a.actor_id)];
    return [...new Set(candidates.filter(Boolean) as string[])];
  };
  const allActorIds = [...new Set(rows.flatMap(actorIdsForRow))];
  const eventTypes = ['new_event', 'event_updated', 'event_reminder_tomorrow', 'event_reminder_hour', 'event_reminder_now', 'event_last_chance', 'event_canceled', 'event_rsvp'];
  const eventIds = [...new Set(rows.filter((n) => n.entity_type === 'event' || eventTypes.includes(n.type)).map((n) => n.entity_id).filter(Boolean) as string[])];
  const postIds = [...new Set(rows.filter((n) => n.entity_type === 'post' || n.type === 'club_post').map((n) => n.entity_id).filter(Boolean) as string[])];
  const conversationIds = [...new Set(rows.filter((n) => n.entity_type === 'message' || ['group_chat_added', 'chat_invite_joined'].includes(n.type)).map((n) => n.entity_id).filter(Boolean) as string[])];
  // club_photo's entity_id is the club_photos ROW (migration 144), not the
  // club itself — resolved separately below via a club_photos join, same as
  // how message_reply's entity_id is a message id, not a conversation id.
  const clubIds = [...new Set(rows.filter((n) => n.type !== 'club_photo' && (n.entity_type === 'club' || ['club_joined', 'member_joined', 'club_chat_added', 'officer_chat_added', 'officer_role', 'officer_removed', 'club_removed', 'club_inactive'].includes(n.type))).map((n) => n.entity_id).filter(Boolean) as string[])];
  const photoIds = [...new Set(rows.filter((n) => n.type === 'club_photo').map((n) => n.entity_id).filter(Boolean) as string[])];
  // message_reply's entity_id is the reply MESSAGE (migration 129); resolve it
  // to its conversation so the tap opens the thread scrolled to that message.
  const replyMessageIds = [...new Set(rows.filter((n) => n.type === 'message_reply').map((n) => n.entity_id).filter(Boolean) as string[])];
  const { data: replyMsgRows } = replyMessageIds.length
    ? await supabase.from('messages').select('id, conversation_id').in('id', replyMessageIds)
    : { data: [] as any[] };
  const replyMsgConversation = new Map<string, string>((replyMsgRows ?? []).map((m: any) => [m.id, m.conversation_id]));
  const [{ data: actorRows }, { data: eventRows }, { data: clubRows }, { data: postRows }, { data: conversationRows }, { data: photoRows }] = await Promise.all([
    allActorIds.length ? supabase.from('profiles').select('id, username, avatar_url').in('id', allActorIds) : Promise.resolve({ data: [] as any[] }),
    eventIds.length ? supabase.from('events').select('id, clubs!inner(id, name, avatar_url)').in('id', eventIds) : Promise.resolve({ data: [] as any[] }),
    clubIds.length ? supabase.from('clubs').select('id, name, avatar_url').in('id', clubIds) : Promise.resolve({ data: [] as any[] }),
    postIds.length ? supabase.from('posts').select('id, clubs(id, name, avatar_url)').in('id', postIds) : Promise.resolve({ data: [] as any[] }),
    conversationIds.length ? supabase.from('conversations').select('id, clubs(id, name, avatar_url)').in('id', conversationIds) : Promise.resolve({ data: [] as any[] }),
    photoIds.length ? supabase.from('club_photos').select('id, clubs(id, name, avatar_url)').in('id', photoIds) : Promise.resolve({ data: [] as any[] }),
  ]);
  const actorMap = new Map<string, NotificationVisualActor>((actorRows ?? []).map((p: any) => [p.id, { id: p.id, username: p.username, avatar_url: p.avatar_url ?? null }]));
  const eventMap = new Map<string, NotificationVisualEntity>((eventRows ?? []).map((e: any) => [e.id, { id: e.clubs.id, name: e.clubs.name, avatar_url: e.clubs.avatar_url ?? null }]));
  const clubMap = new Map<string, NotificationVisualEntity>((clubRows ?? []).map((c: any) => [c.id, { id: c.id, name: c.name, avatar_url: c.avatar_url ?? null }]));
  const postClubMap = new Map<string, NotificationVisualEntity>((postRows ?? []).filter((p: any) => p.clubs).map((p: any) => [p.id, { id: p.clubs.id, name: p.clubs.name, avatar_url: p.clubs.avatar_url ?? null }]));
  const conversationClubMap = new Map<string, NotificationVisualEntity>((conversationRows ?? []).filter((c: any) => c.clubs).map((c: any) => [c.id, { id: c.clubs.id, name: c.clubs.name, avatar_url: c.clubs.avatar_url ?? null }]));
  const photoClubMap = new Map<string, NotificationVisualEntity>((photoRows ?? []).filter((p: any) => p.clubs).map((p: any) => [p.id, { id: p.clubs.id, name: p.clubs.name, avatar_url: p.clubs.avatar_url ?? null }]));

  // One extra round-trip: how the viewer relates to each actor, so rows can
  // render Follow back / Requested correctly without N queries.
  const actorIds = [...new Set((data as any[]).map((n) => n.profiles?.id).filter(Boolean) as string[])];
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

  for (const n of rows) {
    const notifDay = dateInAppTz(new Date(n.created_at));
    const daysAgo = dayDiff(notifDay, today);

    const sender = n.profiles ? { id: n.profiles.id, username: n.profiles.username, avatar_url: n.profiles.avatar_url } : null;
    const actorIds = actorIdsForRow(n);
    const actorCount = actorIds.length;
    const actors = actorIds
      .map((id: string) => actorMap.get(id)).filter(Boolean) as NotificationVisualActor[];
    const entity = n.entity_type === 'event'
      ? eventMap.get(n.entity_id) ?? null
      : n.type === 'club_post' || n.entity_type === 'post'
        ? postClubMap.get(n.entity_id) ?? null
        : n.type === 'club_photo'
          ? photoClubMap.get(n.entity_id) ?? null
          : n.entity_type === 'message' || ['group_chat_added', 'chat_invite_joined'].includes(n.type)
            ? conversationClubMap.get(n.entity_id) ?? clubMap.get(n.entity_id) ?? null
            : clubMap.get(n.entity_id) ?? null;
    const notification: AppNotification = {
      id: n.id,
      type: n.type,
      sender,
      reference_id: n.entity_id ?? null,
      entity_type: n.entity_type ?? null,
      message: n.message ?? null,
      group_count: n.group_count ?? 1,
      actor_follow_state: n.profiles
        ? followStateMap.get(n.profiles.id) ?? 'not_following'
        : 'not_following',
      is_read: n.read,
      created_at: n.created_at,
      actors,
      actorCount,
      entity,
      route: actorCount > 1
        ? { screen: 'notificationActors', notificationId: n.id }
        : n.type === 'message_reply' && n.entity_id && replyMsgConversation.has(n.entity_id)
          ? { screen: 'chat', chatId: replyMsgConversation.get(n.entity_id), messageId: n.entity_id }
          : n.route ?? null,
      visual: resolveNotificationVisual({ type: n.type, group_count: n.group_count, actor: sender, actors, entity }),
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

/**
 * Return the full persisted actor set for a grouped notification. The
 * representative is first, followed by the remaining actors in recency
 * order. Pagination is applied after that ordering so page boundaries are
 * stable even when the representative is the newest actor.
 */
export async function getNotificationActors(
  notificationId: string,
  limit = 50,
  offset = 0,
): Promise<NotificationActor[]> {
  const safeLimit = Math.max(0, Math.floor(limit));
  const safeOffset = Math.max(0, Math.floor(offset));
  if (!safeLimit) return [];

  const { data: notification } = await supabase
    .from('notifications')
    .select('actor_id, group_actors')
    .eq('id', notificationId)
    .maybeSingle();
  if (!notification) return [];

  const { data: persisted, error: persistedError } = await supabase
    .from('notification_actors')
    .select('actor_id, created_at')
    .eq('notification_id', notificationId)
    .order('created_at', { ascending: false });
  const legacy = Array.isArray((notification as any).group_actors)
    ? (notification as any).group_actors as string[]
    : [];
  const useLegacy = Boolean(persistedError) || ((persisted ?? []).length === 0 && legacy.length > 0);
  const candidates = useLegacy
    ? [(notification as any).actor_id, ...legacy.slice().reverse()]
    : [(notification as any).actor_id, ...(persisted ?? []).map((a: any) => a.actor_id)];
  const actorIds = [...new Set(candidates.filter(Boolean) as string[])].slice(safeOffset, safeOffset + safeLimit);
  if (!actorIds.length) return [];

  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, full_name, username, avatar_url')
    .in('id', actorIds);
  const profileMap = new Map((profiles ?? []).map((profile: any) => [profile.id, profile]));
  return actorIds
    .map((id) => profileMap.get(id))
    .filter(Boolean)
    .map((profile: any) => ({
      id: profile.id,
      displayName: profile.full_name?.trim() || profile.username,
      username: profile.username,
      avatarUrl: profile.avatar_url ?? null,
    }));
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
