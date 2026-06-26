import { supabase } from '../lib/supabase';

export interface Channel {
  id: string;
  club_id: string;
  name: string;
  is_restricted: boolean;
  created_at: string;
}

export interface Attachment {
  url: string;
  type: 'image' | 'video' | 'document' | 'pdf';
}

export interface MessageSender {
  id: string;
  username: string;
  avatar_url: string | null;
}

export interface MessageWithSender {
  id: string;
  channel_id: string;
  club_id: string;
  sender_id: string;
  content: string | null;
  attachment_url: string | null;
  attachment_type: string | null;
  poll_id: string | null;
  created_at: string;
  sender: MessageSender;
}

export interface MessagesPage {
  messages: MessageWithSender[];
  next_cursor: string | null;
}

export async function getClubChannels(clubId: string): Promise<Channel[]> {
  const { data } = await supabase
    .from('club_channels')
    .select('id, club_id, name, is_restricted, created_at')
    .eq('club_id', clubId)
    .order('created_at', { ascending: true });

  return (data ?? []) as Channel[];
}

export async function getChannelMessages(
  channelId: string,
  cursor?: string,
): Promise<MessagesPage> {
  const PAGE_SIZE = 30;

  let query = supabase
    .from('channel_messages')
    .select(
      'id, channel_id, club_id, sender_id, content, attachment_url, attachment_type, poll_id, created_at, profiles!sender_id(id, username, avatar_url)',
    )
    .eq('channel_id', channelId)
    .order('created_at', { ascending: false })
    .limit(PAGE_SIZE);

  if (cursor) {
    query = query.lt('created_at', cursor);
  }

  const { data } = await query;

  const rows = (data ?? []) as any[];

  const messages: MessageWithSender[] = rows.map((m) => ({
    id: m.id,
    channel_id: m.channel_id,
    club_id: m.club_id,
    sender_id: m.sender_id,
    content: m.content,
    attachment_url: m.attachment_url,
    attachment_type: m.attachment_type,
    poll_id: m.poll_id,
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

export async function sendMessage(
  channelId: string,
  clubId: string,
  senderId: string,
  content: string,
  attachment?: Attachment,
): Promise<void> {
  const { error } = await supabase.from('channel_messages').insert({
    channel_id: channelId,
    club_id: clubId,
    sender_id: senderId,
    content: content || null,
    attachment_url: attachment?.url ?? null,
    attachment_type: attachment?.type ?? null,
  });

  if (error) throw error;
}

export async function deleteMessage(messageId: string): Promise<void> {
  const { error } = await supabase
    .from('channel_messages')
    .delete()
    .eq('id', messageId);

  if (error) throw error;
}

export interface CreateChannelInput {
  name: string;
  is_restricted: boolean;
}

export async function createChannel(
  clubId: string,
  createdBy: string,
  input: CreateChannelInput,
): Promise<Channel> {
  const { data, error } = await supabase
    .from('club_channels')
    .insert({
      club_id: clubId,
      created_by: createdBy,
      name: input.name.trim().toLowerCase().replace(/\s+/g, '-'),
      is_restricted: input.is_restricted,
    })
    .select('id, club_id, name, is_restricted, created_at')
    .single();

  if (error) throw error;
  return data as Channel;
}

export async function deleteChannel(channelId: string, clubId: string): Promise<void> {
  const { count } = await supabase
    .from('club_channels')
    .select('id', { count: 'exact', head: true })
    .eq('club_id', clubId);

  if ((count ?? 0) <= 1) {
    throw new Error('Cannot delete the last channel in a club.');
  }

  const { error } = await supabase
    .from('club_channels')
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
    .from('club_channels')
    .update(payload)
    .eq('id', channelId);

  if (error) throw error;
}
