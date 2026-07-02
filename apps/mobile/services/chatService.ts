import { supabase } from '../lib/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ChatParticipant {
  user_id: string;
  username: string;
  avatar_url: string | null;
  full_name: string | null;
  joined_at: string;
}

export interface ChatPreview {
  id: string;
  type: 'direct' | 'group' | 'club_group' | 'officer_chat';
  name: string | null;
  avatar_url: string | null;
  club_id: string | null;
  last_message: string | null;
  last_message_at: string | null;
  last_sender_username: string | null;
  unread_count: number;
}

export interface ChatDetails {
  id: string;
  type: 'direct' | 'group' | 'club_group' | 'officer_chat';
  name: string | null;
  avatar_url: string | null;
  club_id: string | null;
  participants: ChatParticipant[];
}

export interface DirectMessageThread {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string | null;
  attachment_url: string | null;
  message_type: string;
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

// ─── Chat List ────────────────────────────────────────────────────────────────

/** Returns all conversations the current user is part of, with last-message preview. */
export async function getMyChats(userId: string): Promise<ChatPreview[]> {
  const { data, error } = await supabase
    .from('conversation_participants')
    .select(
      `conversation_id,
       conversations!inner(
         id, type, name, avatar_url, club_id,
         messages(id, content, message_type, created_at, profiles!sender_id(username))
       )`,
    )
    .eq('user_id', userId)
    .order('joined_at', { ascending: false });

  if (error) throw error;

  const rows = (data ?? []) as any[];

  return rows.map((row) => {
    const conv = row.conversations;
    const msgs: any[] = conv.messages ?? [];

    // Sort messages to get the most recent
    msgs.sort(
      (a: any, b: any) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
    const lastMsg = msgs[0] ?? null;

    return {
      id: conv.id,
      type: conv.type,
      name: conv.name,
      avatar_url: conv.avatar_url,
      club_id: conv.club_id,
      last_message: lastMsg?.content ?? null,
      last_message_at: lastMsg?.created_at ?? null,
      last_sender_username: lastMsg?.profiles?.username ?? null,
      unread_count: 0,
    } as ChatPreview;
  });
}

// ─── Chat Details ─────────────────────────────────────────────────────────────

export async function getChatDetails(conversationId: string): Promise<ChatDetails | null> {
  const [{ data: conv }, { data: participants }] = await Promise.all([
    supabase
      .from('conversations')
      .select('id, type, name, avatar_url, club_id')
      .eq('id', conversationId)
      .single(),
    supabase
      .from('conversation_participants')
      .select('user_id, joined_at, profiles!user_id(username, avatar_url, full_name)')
      .eq('conversation_id', conversationId),
  ]);

  if (!conv) return null;

  const parts: ChatParticipant[] = ((participants ?? []) as any[]).map((p) => ({
    user_id: p.user_id,
    username: p.profiles?.username ?? '',
    avatar_url: p.profiles?.avatar_url ?? null,
    full_name: p.profiles?.full_name ?? null,
    joined_at: p.joined_at,
  }));

  return {
    ...(conv as any),
    participants: parts,
  };
}

// ─── Direct Messages ──────────────────────────────────────────────────────────

/** Creates or finds a DM conversation with another user. Returns the conversation id. */
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
      'id, conversation_id, sender_id, content, attachment_url, message_type, created_at, profiles!sender_id(id, username, avatar_url)',
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

// ─── Non-member preview ───────────────────────────────────────────────────────

/**
 * Returns the 15 most recent messages in a club_group conversation
 * for a user who is NOT a member. RLS enforces the limit server-side.
 */
export async function getNonMemberPreview(conversationId: string): Promise<DirectMessageThread[]> {
  const { data, error } = await supabase
    .from('messages')
    .select(
      'id, conversation_id, sender_id, content, attachment_url, message_type, created_at, profiles!sender_id(id, username, avatar_url)',
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

/**
 * Top-level Message tab search.
 * Returns two separate labeled sections: People and Chats.
 */
export async function searchChats(
  userId: string,
  query: string,
): Promise<SearchResults> {
  const q = query.trim();
  if (!q) return { people: [], chats: [] };

  const [{ data: people }, { data: chats }] = await Promise.all([
    // People: search profiles the user has a DM with or that are in the same club
    supabase
      .from('profiles')
      .select('id, username, full_name, avatar_url')
      .or(`username.ilike.%${q}%,full_name.ilike.%${q}%`)
      .neq('id', userId)
      .limit(20),

    // Chats: search group chats the user is a participant of
    supabase
      .from('conversation_participants')
      .select('conversations!inner(id, name, type, club_id, avatar_url)')
      .eq('user_id', userId)
      .in('conversations.type', ['club_group', 'officer_chat', 'group'])
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
      name: c.name,
      type: c.type,
      club_id: c.club_id,
      avatar_url: c.avatar_url,
    };
  });

  return { people: peopleResults, chats: chatResults };
}

// ─── Membership check ─────────────────────────────────────────────────────────

/** Returns true if the given user is a participant in the conversation. */
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

/** Returns the club_group conversation id for a club (read-only, no membership needed). */
export async function getClubGroupConversationId(clubId: string): Promise<string | null> {
  const { data } = await supabase
    .from('conversations')
    .select('id')
    .eq('club_id', clubId)
    .eq('type', 'club_group')
    .single();
  return data?.id ?? null;
}
