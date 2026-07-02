import { supabase } from '../lib/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Channel {
  id: string;
  conversation_id: string;
  name: string;
  is_restricted: boolean;
  is_default: boolean;
  created_at: string;
  created_by: string | null;
}

export interface Attachment {
  url: string;
  type: 'image' | 'file';
}

export interface MessageSender {
  id: string;
  username: string;
  avatar_url: string | null;
}

export interface MessageWithSender {
  id: string;
  conversation_id: string;
  channel_id: string | null;
  sender_id: string;
  content: string | null;
  attachment_url: string | null;
  message_type: string;
  created_at: string;
  poll_id: string | null;
  sender: MessageSender;
}

export interface MessagesPage {
  messages: MessageWithSender[];
  next_cursor: string | null;
}

export interface CreateChannelInput {
  name: string;
  is_restricted: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns the club_group conversation id for a club (null if none). */
export async function getClubConversationId(clubId: string): Promise<string | null> {
  const { data } = await supabase
    .from('conversations')
    .select('id')
    .eq('club_id', clubId)
    .eq('type', 'club_group')
    .single();
  return data?.id ?? null;
}

// ─── Channels ─────────────────────────────────────────────────────────────────

export async function getClubChannels(clubId: string): Promise<Channel[]> {
  const { data, error } = await supabase
    .from('conversation_channels')
    .select(
      'id, conversation_id, name, is_restricted, is_default, created_at, created_by, conversations!inner(club_id)',
    )
    .eq('conversations.club_id', clubId)
    .order('display_order', { ascending: true });

  if (error) throw error;

  return ((data ?? []) as any[]).map((row) => ({
    id: row.id,
    conversation_id: row.conversation_id,
    name: row.name,
    is_restricted: row.is_restricted,
    is_default: row.is_default,
    created_at: row.created_at,
    created_by: row.created_by,
  }));
}

export async function createChannel(
  clubId: string,
  createdBy: string,
  input: CreateChannelInput,
): Promise<Channel> {
  const conversationId = await getClubConversationId(clubId);
  if (!conversationId) throw new Error('Club group chat not found.');

  const { data, error } = await supabase
    .from('conversation_channels')
    .insert({
      conversation_id: conversationId,
      created_by: createdBy,
      name: input.name.trim().toLowerCase().replace(/\s+/g, '-'),
      is_restricted: input.is_restricted,
      is_default: false,
    })
    .select('id, conversation_id, name, is_restricted, is_default, created_at, created_by')
    .single();

  if (error) throw error;
  return data as Channel;
}

export async function deleteChannel(channelId: string, clubId: string): Promise<void> {
  const conversationId = await getClubConversationId(clubId);
  if (!conversationId) throw new Error('Club group chat not found.');

  const { count } = await supabase
    .from('conversation_channels')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversationId);

  if ((count ?? 0) <= 1) {
    throw new Error('Cannot delete the last channel in a club.');
  }

  const { error } = await supabase
    .from('conversation_channels')
    .delete()
    .eq('id', channelId);

  if (error) throw error;
}

export async function updateChannel(
  channelId: string,
  updates: Partial<CreateChannelInput>,
): Promise<void> {
  const payload: Record<string, unknown> = {};
  if (updates.name !== undefined) {
    payload.name = updates.name.trim().toLowerCase().replace(/\s+/g, '-');
  }
  if (updates.is_restricted !== undefined) {
    payload.is_restricted = updates.is_restricted;
  }

  const { error } = await supabase
    .from('conversation_channels')
    .update(payload)
    .eq('id', channelId);

  if (error) throw error;
}

// ─── Messages ─────────────────────────────────────────────────────────────────

export async function getChannelMessages(
  channelId: string,
  cursor?: string,
): Promise<MessagesPage> {
  const PAGE_SIZE = 30;

  let query = supabase
    .from('messages')
    .select(
      'id, conversation_id, channel_id, sender_id, content, attachment_url, message_type, created_at, polls(id), profiles!sender_id(id, username, avatar_url)',
    )
    .eq('channel_id', channelId)
    .order('created_at', { ascending: false })
    .limit(PAGE_SIZE);

  if (cursor) {
    query = query.lt('created_at', cursor);
  }

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data ?? []) as any[];

  const messages: MessageWithSender[] = rows.map((m) => ({
    id: m.id,
    conversation_id: m.conversation_id,
    channel_id: m.channel_id,
    sender_id: m.sender_id,
    content: m.content,
    attachment_url: m.attachment_url,
    message_type: m.message_type,
    created_at: m.created_at,
    poll_id: Array.isArray(m.polls) ? (m.polls[0]?.id ?? null) : null,
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

export async function sendMessage(
  conversationId: string,
  channelId: string,
  senderId: string,
  content: string,
  attachment?: Attachment,
): Promise<void> {
  const messageType = attachment
    ? attachment.type === 'image'
      ? 'image'
      : 'file'
    : 'text';

  const { error } = await supabase.from('messages').insert({
    conversation_id: conversationId,
    channel_id: channelId,
    sender_id: senderId,
    content: content || null,
    attachment_url: attachment?.url ?? null,
    message_type: messageType,
  });

  if (error) throw error;
}

export async function deleteMessage(messageId: string): Promise<void> {
  const { error } = await supabase
    .from('messages')
    .delete()
    .eq('id', messageId);

  if (error) throw error;
}
