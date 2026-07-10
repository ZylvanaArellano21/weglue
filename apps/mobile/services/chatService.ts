import { supabase } from '../lib/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ChatParticipant {
  user_id: string;
  username: string;
  avatar_url: string | null;
  full_name: string | null;
  joined_at: string;
  role: string;
}

export interface ChatPreview {
  id: string;
  type: 'direct' | 'group' | 'club_group' | 'officer_chat';
  /** Live display title: the other participant's current display name for
   * DMs, "Club name · Members/Officers" from the clubs table for club chats.
   * Never a stored snapshot, so renames and profile edits show immediately. */
  name: string | null;
  /** Live avatar: other participant's current profile picture for DMs, the
   * club's current profile picture (never the banner) for club chats. */
  avatar_url: string | null;
  club_id: string | null;
  /** The other participant of a direct chat (stable user id). */
  other_user_id: string | null;
  last_message: string | null;
  last_message_at: string | null;
  last_sender_username: string | null;
  unread_count: number;
  channel_names: string[];
  /** Default channel of THIS conversation — lets taps open the thread
   * directly with a single navigation (no intermediate redirect screen). */
  default_channel_id: string | null;
}

export interface ChatDetails {
  id: string;
  type: 'direct' | 'group' | 'club_group' | 'officer_chat';
  /** Live display title (see ChatPreview.name). */
  name: string | null;
  /** Live avatar (see ChatPreview.avatar_url). */
  avatar_url: string | null;
  club_id: string | null;
  participants: ChatParticipant[];
}

// ─── Live conversation identity ──────────────────────────────────────────────
// Conversation identity is the immutable conversation/club/user IDs; what we
// DISPLAY is always resolved from the current clubs/profiles rows. The
// conversations.name column is only a fallback (a DB trigger keeps it synced
// on club rename, but rendering never depends on it).

const DELETED_ACCOUNT_LABEL = 'Deleted account';

function clubConversationTitle(
  clubName: string | null | undefined,
  type: string,
  storedName: string | null,
): string | null {
  if (!clubName) return storedName;
  return `${clubName} · ${type === 'officer_chat' ? 'Officers' : 'Members'}`;
}

/** Display name for a person: full name when they entered one, otherwise
 * their username. Usernames are never the *preferred* chat title. */
function personDisplayName(p: { full_name?: string | null; username?: string | null } | null | undefined): string | null {
  if (!p) return null;
  const full = p.full_name?.trim();
  if (full) return full;
  const username = p.username?.trim();
  return username || null;
}

interface ResolvedIdentity {
  name: string | null;
  avatar_url: string | null;
  other_user_id: string | null;
}

function resolveConversationIdentity(
  type: string,
  storedName: string | null,
  storedAvatar: string | null,
  club: { name?: string | null; avatar_url?: string | null } | null,
  participants: { user_id: string; profiles?: { username?: string | null; full_name?: string | null; avatar_url?: string | null } | null }[],
  currentUserId: string,
): ResolvedIdentity {
  if (type === 'direct') {
    const other = participants.find((p) => p.user_id !== currentUserId) ?? null;
    if (!other) {
      // The other account no longer exists (participants cascade on account
      // deletion) — a valid conversation with an explicit label, never
      // "Unknown Chat".
      return { name: DELETED_ACCOUNT_LABEL, avatar_url: null, other_user_id: null };
    }
    const name = personDisplayName(other.profiles);
    if (!name) {
      // Malformed/incomplete profile: log for repair, show a safe fallback.
      console.warn('[chatService] direct chat participant has no resolvable name', other.user_id);
    }
    return {
      name: name ?? DELETED_ACCOUNT_LABEL,
      avatar_url: other.profiles?.avatar_url ?? null,
      other_user_id: other.user_id,
    };
  }

  if (type === 'club_group' || type === 'officer_chat') {
    return {
      name: clubConversationTitle(club?.name, type, storedName),
      // Club profile picture — never the banner.
      avatar_url: club?.avatar_url ?? null,
      other_user_id: null,
    };
  }

  return { name: storedName, avatar_url: storedAvatar, other_user_id: null };
}

export interface DirectMessageThread {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string | null;
  attachment_url: string | null;
  message_type: string;
  shared_event_id: string | null;
  shared_post_id: string | null;
  created_at: string;
  sender: {
    id: string;
    username: string;
    avatar_url: string | null;
  };
  poll_id?: string | null;
}

export interface DirectMessagesPage {
  messages: DirectMessageThread[];
  next_cursor: string | null;
}

function formatLastMessagePreview(lastMsg: { content: string | null; message_type: string } | null): string | null {
  if (!lastMsg) return null;
  if (lastMsg.message_type === 'shared_event') return '📅 Shared an event';
  if (lastMsg.message_type === 'shared_post') return '🖼️ Shared a post';
  if (lastMsg.message_type === 'poll') return '📊 Started a poll';
  if (lastMsg.message_type === 'image') return lastMsg.content ?? '📷 Photo';
  return lastMsg.content;
}

// ─── Chat List ────────────────────────────────────────────────────────────────

// Cap how many recent messages are fetched per conversation. Previously this
// query pulled EVERY message of EVERY conversation (with a profile join each)
// just to derive the last message + unread count, so the chat list got slower
// with every message ever sent. 30 is enough for the preview and an accurate
// unread badge up to 30.
const CHAT_PREVIEW_MESSAGES = 30;

export async function getMyChats(userId: string): Promise<ChatPreview[]> {
  const { data, error } = await supabase
    .from('conversation_participants')
    .select(
      `conversation_id, last_read_at, joined_at,
       conversations!inner(
         id, type, name, avatar_url, club_id,
         clubs(id, name, avatar_url),
         conversation_participants(user_id, profiles!user_id(username, full_name, avatar_url)),
         conversation_channels(id, name, is_default, display_order),
         messages(id, content, message_type, created_at, profiles!sender_id(username))
       )`,
    )
    .eq('user_id', userId)
    .order('created_at', { referencedTable: 'conversations.messages', ascending: false })
    .limit(CHAT_PREVIEW_MESSAGES, { referencedTable: 'conversations.messages' })
    .order('joined_at', { ascending: false });

  if (error) throw error;

  const rows = (data ?? []) as any[];

  return rows.map((row) => {
    const conv = row.conversations;
    const msgs: any[] = conv.messages ?? [];
    const identity = resolveConversationIdentity(
      conv.type,
      conv.name,
      conv.avatar_url,
      conv.clubs ?? null,
      conv.conversation_participants ?? [],
      userId,
    );

    msgs.sort(
      (a: any, b: any) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
    const lastMsg = msgs[0] ?? null;

    const lastReadAt: string | null = row.last_read_at ?? row.joined_at ?? null;
    const unreadCount = lastReadAt
      ? msgs.filter((m: any) => new Date(m.created_at) > new Date(lastReadAt)).length
      : msgs.length;

    const channels: any[] = [...(conv.conversation_channels ?? [])].sort(
      (a: any, b: any) => (a.display_order ?? 0) - (b.display_order ?? 0),
    );
    const defaultChannel = channels.find((c: any) => c.is_default) ?? channels[0] ?? null;

    return {
      id: conv.id,
      type: conv.type,
      name: identity.name,
      avatar_url: identity.avatar_url,
      club_id: conv.club_id,
      other_user_id: identity.other_user_id,
      last_message: formatLastMessagePreview(lastMsg),
      last_message_at: lastMsg?.created_at ?? null,
      last_sender_username: lastMsg?.profiles?.username ?? null,
      unread_count: unreadCount,
      channel_names: channels.map((c: any) => c.name),
      default_channel_id: defaultChannel?.id ?? null,
    } as ChatPreview;
  });
}

// ─── Chat Details ─────────────────────────────────────────────────────────────

export async function getChatDetails(
  conversationId: string,
  currentUserId: string,
): Promise<ChatDetails | null> {
  const [{ data: conv }, { data: participants }] = await Promise.all([
    supabase
      .from('conversations')
      .select('id, type, name, avatar_url, club_id, clubs(id, name, avatar_url)')
      .eq('id', conversationId)
      .single(),
    supabase
      .from('conversation_participants')
      .select('user_id, joined_at, profiles!user_id(username, avatar_url, full_name)')
      .eq('conversation_id', conversationId),
  ]);

  if (!conv) return null;

  const identity = resolveConversationIdentity(
    (conv as any).type,
    (conv as any).name,
    (conv as any).avatar_url,
    (conv as any).clubs ?? null,
    ((participants ?? []) as any[]),
    currentUserId,
  );

  const rolesMap = new Map<string, string>();
  if ((conv as any).club_id) {
    const [{ data: members }, { data: officers }] = await Promise.all([
      supabase
        .from('club_members')
        .select('user_id, role')
        .eq('club_id', (conv as any).club_id),
      supabase
        .from('club_officers')
        .select('user_id, role_title')
        .eq('club_id', (conv as any).club_id),
    ]);
    for (const m of (members ?? []) as any[]) {
      rolesMap.set(m.user_id, m.role === 'officer' ? 'Officer' : 'Member');
    }
    // club_officers.role_title overrides generic "Officer" with specific title (President, VP, etc.)
    for (const o of (officers ?? []) as any[]) {
      rolesMap.set(o.user_id, o.role_title);
    }
  }

  const parts: ChatParticipant[] = ((participants ?? []) as any[]).map((p) => ({
    user_id: p.user_id,
    username: p.profiles?.username ?? '',
    avatar_url: p.profiles?.avatar_url ?? null,
    full_name: p.profiles?.full_name ?? null,
    joined_at: p.joined_at,
    role: rolesMap.get(p.user_id) ?? 'Member',
  }));

  return {
    id: (conv as any).id,
    type: (conv as any).type,
    name: identity.name,
    avatar_url: identity.avatar_url,
    club_id: (conv as any).club_id,
    participants: parts,
  };
}

// ─── Direct Messages ──────────────────────────────────────────────────────────

export async function getOrCreateDirectChat(otherUserId: string): Promise<string> {
  const { data, error } = await supabase.rpc('get_or_create_direct_chat', {
    other_user_id: otherUserId,
  });
  if (error) throw error;
  return data as string;
}

export async function getDirectMessages(
  conversationId: string,
  cursor?: string,
): Promise<DirectMessagesPage> {
  const PAGE_SIZE = 30;

  let query = supabase
    .from('messages')
    .select(
      'id, conversation_id, sender_id, content, attachment_url, message_type, shared_event_id, shared_post_id, created_at, profiles!sender_id(id, username, avatar_url)',
    )
    .eq('conversation_id', conversationId)
    .is('channel_id', null)
    .order('created_at', { ascending: false })
    .limit(PAGE_SIZE);

  if (cursor) {
    query = query.lt('created_at', cursor);
  }

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data ?? []) as any[];
  const messages: DirectMessageThread[] = rows.map((m) => ({
    id: m.id,
    conversation_id: m.conversation_id,
    sender_id: m.sender_id,
    content: m.content,
    attachment_url: m.attachment_url,
    message_type: m.message_type,
    shared_event_id: m.shared_event_id ?? null,
    shared_post_id: m.shared_post_id ?? null,
    created_at: m.created_at,
    sender: {
      id: m.profiles.id,
      username: m.profiles.username,
      avatar_url: m.profiles.avatar_url,
    },
  }));

  const next_cursor =
    rows.length === PAGE_SIZE ? rows[rows.length - 1].created_at : null;

  return { messages, next_cursor };
}

export async function sendDirectMessage(
  conversationId: string,
  senderId: string,
  content: string,
  attachmentUrl?: string,
  attachmentType?: 'image' | 'file',
): Promise<void> {
  const { error } = await supabase.from('messages').insert({
    conversation_id: conversationId,
    channel_id: null,
    sender_id: senderId,
    content: content || null,
    attachment_url: attachmentUrl ?? null,
    message_type: attachmentType ?? 'text',
  });
  if (error) throw error;
}

// ─── Share Messages ───────────────────────────────────────────────────────────
// Sends a rich event/post preview card into a DM. Renders via
// EventShareCard/PostShareCard (components/chat/) through MessageBubble's
// cardSlot, the same extension point used for poll messages.

export async function sendEventShareMessage(
  conversationId: string,
  senderId: string,
  eventId: string,
): Promise<void> {
  const { error } = await supabase.from('messages').insert({
    conversation_id: conversationId,
    channel_id: null,
    sender_id: senderId,
    message_type: 'shared_event',
    shared_event_id: eventId,
  });
  if (error) throw error;
}

export async function sendPostShareMessage(
  conversationId: string,
  senderId: string,
  postId: string,
): Promise<void> {
  const { error } = await supabase.from('messages').insert({
    conversation_id: conversationId,
    channel_id: null,
    sender_id: senderId,
    message_type: 'shared_post',
    shared_post_id: postId,
  });
  if (error) throw error;
}

// ─── Mark Read ────────────────────────────────────────────────────────────────

export async function markConversationRead(conversationId: string): Promise<void> {
  await supabase.rpc('mark_conversation_read', {
    p_conversation_id: conversationId,
  });
}

// ─── Non-member preview ───────────────────────────────────────────────────────

export async function getNonMemberPreview(conversationId: string): Promise<DirectMessageThread[]> {
  const { data, error } = await supabase
    .from('messages')
    .select(
      'id, conversation_id, sender_id, content, attachment_url, message_type, shared_event_id, shared_post_id, created_at, profiles!sender_id(id, username, avatar_url)',
    )
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(15);

  if (error) throw error;

  return ((data ?? []) as any[]).map((m) => ({
    id: m.id,
    conversation_id: m.conversation_id,
    sender_id: m.sender_id,
    content: m.content,
    attachment_url: m.attachment_url,
    message_type: m.message_type,
    shared_event_id: m.shared_event_id ?? null,
    shared_post_id: m.shared_post_id ?? null,
    created_at: m.created_at,
    sender: {
      id: m.profiles?.id ?? '',
      username: m.profiles?.username ?? '',
      avatar_url: m.profiles?.avatar_url ?? null,
    },
  }));
}

// ─── Search ───────────────────────────────────────────────────────────────────

export interface PeopleResult {
  user_id: string;
  username: string;
  full_name: string | null;
  avatar_url: string | null;
}

export interface ChatResult {
  id: string;
  name: string | null;
  type: string;
  club_id: string | null;
  avatar_url: string | null;
}

export interface SearchResults {
  people: PeopleResult[];
  chats: ChatResult[];
}

export async function searchChats(
  userId: string,
  query: string,
): Promise<SearchResults> {
  const q = query.trim();
  if (!q) return { people: [], chats: [] };

  const [{ data: people }, { data: chats }] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, username, full_name, avatar_url')
      .or(`username.ilike.%${q}%,full_name.ilike.%${q}%`)
      .neq('id', userId)
      .limit(20),

    supabase
      .from('conversation_participants')
      .select('conversations!inner(id, name, type, club_id, avatar_url, clubs(id, name, avatar_url))')
      .eq('user_id', userId)
      .in('conversations.type', ['club_group', 'officer_chat', 'group'])
      // conversations.name is kept in sync on club rename by a DB trigger,
      // so matching against it finds the CURRENT club name.
      .ilike('conversations.name', `%${q}%`)
      .limit(20),
  ]);

  const peopleResults: PeopleResult[] = ((people ?? []) as any[]).map((p) => ({
    user_id: p.id,
    username: p.username,
    full_name: p.full_name,
    avatar_url: p.avatar_url,
  }));

  const chatResults: ChatResult[] = ((chats ?? []) as any[]).map((row) => {
    const c = row.conversations;
    return {
      id: c.id,
      name: clubConversationTitle(c.clubs?.name, c.type, c.name),
      type: c.type,
      club_id: c.club_id,
      // Club profile picture — never the banner, never a stale snapshot.
      avatar_url: c.clubs?.avatar_url ?? c.avatar_url,
    };
  });

  return { people: peopleResults, chats: chatResults };
}

/** Returns up to 20 suggested people from clubs the user shares with others. */
export async function getSuggestedPeople(userId: string): Promise<PeopleResult[]> {
  const { data: memberships } = await supabase
    .from('club_members')
    .select('club_id')
    .eq('user_id', userId);

  if (!memberships || memberships.length === 0) {
    const { data } = await supabase
      .from('profiles')
      .select('id, username, full_name, avatar_url')
      .neq('id', userId)
      .limit(10);
    return ((data ?? []) as any[]).map((p) => ({
      user_id: p.id,
      username: p.username,
      full_name: p.full_name,
      avatar_url: p.avatar_url,
    }));
  }

  const clubIds = (memberships as any[]).map((m) => m.club_id);

  const { data } = await supabase
    .from('club_members')
    .select('user_id, profiles!user_id(id, username, full_name, avatar_url)')
    .in('club_id', clubIds)
    .neq('user_id', userId)
    .limit(40);

  const seen = new Set<string>();
  const result: PeopleResult[] = [];
  for (const row of (data ?? []) as any[]) {
    if (!seen.has(row.user_id)) {
      seen.add(row.user_id);
      result.push({
        user_id: row.user_id,
        username: row.profiles?.username ?? '',
        full_name: row.profiles?.full_name ?? null,
        avatar_url: row.profiles?.avatar_url ?? null,
      });
    }
  }
  return result.slice(0, 20);
}

// ─── Membership check ─────────────────────────────────────────────────────────

export async function isConversationMember(
  conversationId: string,
  userId: string,
): Promise<boolean> {
  const { count } = await supabase
    .from('conversation_participants')
    .select('user_id', { count: 'exact', head: true })
    .eq('conversation_id', conversationId)
    .eq('user_id', userId);
  return (count ?? 0) > 0;
}

export async function getClubGroupConversationId(clubId: string): Promise<string | null> {
  const { data } = await supabase
    .from('conversations')
    .select('id')
    .eq('club_id', clubId)
    .eq('type', 'club_group')
    .single();
  return data?.id ?? null;
}

export async function getClubOfficerConversationId(clubId: string): Promise<string | null> {
  const { data } = await supabase
    .from('conversations')
    .select('id')
    .eq('club_id', clubId)
    .eq('type', 'officer_chat')
    .single();
  return data?.id ?? null;
}

export interface ClubChatTarget {
  conversationId: string;
  channelId: string | null;
  name: string | null;
  avatarUrl: string | null;
}

// Resolves the exact conversation AND its default channel in one query so
// tapping Chat / Admin Chat on a club profile lands directly in the correct
// thread — one push, no intermediate screen, no wrong-chat flash. Channels
// are read from THIS conversation only (channels of the sibling member/
// officer conversation can never leak in).
export async function getClubChatTarget(
  clubId: string,
  type: 'club_group' | 'officer_chat',
): Promise<ClubChatTarget | null> {
  const { data } = await supabase
    .from('conversations')
    .select('id, name, avatar_url, clubs(id, name, avatar_url), conversation_channels(id, is_default, display_order)')
    .eq('club_id', clubId)
    .eq('type', type)
    .maybeSingle();

  if (!data) return null;

  const channels = [...(((data as any).conversation_channels ?? []) as any[])].sort(
    (a, b) => (a.display_order ?? 0) - (b.display_order ?? 0),
  );
  const defaultChannel = channels.find((c) => c.is_default) ?? channels[0] ?? null;

  return {
    conversationId: (data as any).id,
    channelId: defaultChannel?.id ?? null,
    // Live club identity for the header (club profile picture, never banner).
    name: clubConversationTitle((data as any).clubs?.name, type, (data as any).name),
    avatarUrl: (data as any).clubs?.avatar_url ?? null,
  };
}
