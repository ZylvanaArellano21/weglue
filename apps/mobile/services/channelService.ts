import { supabase } from '../lib/supabase';
import { clientUuid } from '../lib/chatAttachments';
import { applyThreadVisibility, loadThreadVisibility } from '@weglue/shared';
import type { MessageAttachment, MessageReactionSummary } from './messagingService';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Channel {
  id: string;
  conversation_id: string;
  name: string;
  is_restricted: boolean;
  is_default: boolean;
  created_at: string;
  created_by: string | null;
  kind: 'main' | 'channel';
  avatar_url: string | null;
  post_permission: 'everyone' | 'officers' | 'certain';
  display_order: number;
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
  attachments: MessageAttachment[];
  reactions: MessageReactionSummary[];
  sender: MessageSender;
}

export interface ChannelAttachmentInput {
  path: string;
  kind: 'image' | 'video' | 'file';
  mime: string | null;
  width?: number;
  height?: number;
  bytes?: number;
  fileName?: string | null;
}

function channelAttachments(m: any): MessageAttachment[] {
  const rows = Array.isArray(m.message_attachments) && m.message_attachments.length
    ? m.message_attachments
    : m.attachment_url
      ? [{ id: `legacy:${m.id}`, storage_path: m.attachment_url, kind: m.message_type === 'video' ? 'video' : m.message_type === 'file' ? 'file' : 'image', position: 0, mime: m.attachment_mime ?? null, width: null, height: null, byte_size: m.attachment_size ?? null, file_name: m.attachment_name ?? null }]
      : [];
  return rows.map((a: any) => ({ id: a.id, storage_path: a.storage_path, kind: a.kind, position: Number(a.position), mime: a.mime ?? null, width: a.width ?? null, height: a.height ?? null, byte_size: a.byte_size ?? null, file_name: a.file_name ?? null })).sort((a: MessageAttachment, b: MessageAttachment) => a.position - b.position);
}

function channelReactions(m: any, viewerId: string): MessageReactionSummary[] {
  const groups = new Map<string, MessageReactionSummary & { firstCreatedAt: string }>();
  for (const row of (Array.isArray(m.message_reactions) ? m.message_reactions : [])) {
    const current = groups.get(row.emoji) ?? { emoji: row.emoji, count: 0, reactedByMe: false, userIds: [], firstCreatedAt: row.created_at ?? '' };
    current.count += 1;
    current.reactedByMe ||= row.user_id === viewerId;
    if (current.userIds.length < 50) (current.userIds as string[]).push(row.user_id);
    if (row.created_at && (!current.firstCreatedAt || row.created_at < current.firstCreatedAt)) current.firstCreatedAt = row.created_at;
    groups.set(row.emoji, current);
  }
  return Array.from(groups.values()).sort((a, b) => b.count - a.count || a.firstCreatedAt.localeCompare(b.firstCreatedAt)).map(({ firstCreatedAt: _firstCreatedAt, ...reaction }) => reaction);
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
      'id, conversation_id, name, is_restricted, is_default, created_at, created_by, kind, avatar_url, post_permission, display_order, conversations!inner(club_id)',
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
    kind: row.kind,
    avatar_url: row.avatar_url,
    post_permission: row.post_permission,
    display_order: row.display_order,
  }));
}

/** Create a channel through the officer-authorized RPC (server enforces officer
 * role + Main-chat protection). Returns the new channel id. */
export async function createChannel(
  conversationId: string,
  name: string,
  avatarUrl?: string | null,
): Promise<string> {
  const { data, error } = await supabase.rpc('create_conversation_channel', {
    p_conversation_id: conversationId,
    p_name: name,
    p_avatar_url: avatarUrl ?? null,
  });
  if (error) throw error;
  return data as string;
}

/** Rename a hashtag channel (officer-only; Main chat cannot be renamed). */
export async function renameChannel(channelId: string, name: string): Promise<void> {
  const { error } = await supabase.rpc('rename_conversation_channel', {
    p_channel_id: channelId,
    p_name: name,
  });
  if (error) throw error;
}

/** Delete a hashtag channel (officer-only; Main chat cannot be deleted). */
export async function deleteChannel(channelId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_conversation_channel', {
    p_channel_id: channelId,
  });
  if (error) throw error;
}

export async function setChannelAvatar(channelId: string, avatarUrl: string | null): Promise<void> {
  const { error } = await supabase.rpc('set_channel_avatar', {
    p_channel_id: channelId,
    p_avatar_url: avatarUrl,
  });
  if (error) throw error;
}

export type PostPermission = 'everyone' | 'officers' | 'certain';

export async function setChannelPostPermission(
  channelId: string,
  permission: PostPermission,
  userIds?: string[],
): Promise<void> {
  const { error } = await supabase.rpc('set_channel_post_permission', {
    p_channel_id: channelId,
    p_permission: permission,
    p_user_ids: permission === 'certain' ? (userIds ?? []) : null,
  });
  if (error) throw error;
}

// ─── Conversation hub (Main chat + hashtag channels with previews/unread) ────

export interface HubThread {
  id: string;
  name: string;
  kind: 'main' | 'channel';
  avatar_url: string | null;
  post_permission: PostPermission;
  display_order: number;
  last_preview: string | null;
  last_sender: string | null;
  last_at: string | null;
  unread_count: number;
}

/**
 * Everything the conversation hub renders for one parent conversation. Channels
 * are scoped by conversation_id so Members and Officers threads never mix, even
 * with identical hashtag names (Bug 15). Per-thread last message + unread come
 * from channel_reads (Bug 1/9).
 */
export async function getConversationHub(
  conversationId: string,
  userId: string,
): Promise<HubThread[]> {
  const { data: chRows, error: chErr } = await supabase
    .from('conversation_channels')
    .select('id, name, kind, avatar_url, post_permission, display_order')
    .eq('conversation_id', conversationId)
    // TODO(perf): verify index supports (conversation_id, display_order)
    .order('display_order', { ascending: true });
  if (chErr) throw chErr;
  const channels = (chRows ?? []) as any[];
  if (channels.length === 0) return [];

  const { data: readRows } = await supabase
    .from('channel_reads')
    .select('channel_id, last_read_at')
    .eq('user_id', userId)
    .in('channel_id', channels.map((c) => c.id));
  const reads = new Map<string, string>(
    (readRows ?? []).map((r: any) => [r.channel_id, r.last_read_at]),
  );

  // TODO(perf): verify index supports (channel_id, created_at)
  // Bound the hub payload; a very busy channel can crowd out older rows from
  // another channel, but the thread view remains the source of truth.
  const { data: messageRows, error: messageErr } = await supabase
    .from('messages')
    .select(
      'channel_id, sender_id, content, message_type, created_at, profiles!sender_id(username, full_name)',
    )
    .in('channel_id', channels.map((c) => c.id))
    .is('deleted_at', null)
    .limit(channels.length * 50)
    .order('created_at', { ascending: false });
  if (messageErr) throw messageErr;

  const latestByChannel = new Map<string, any>();
  const unreadByChannel = new Map<string, number>();
  for (const row of (messageRows ?? []) as any[]) {
    if (!latestByChannel.has(row.channel_id)) latestByChannel.set(row.channel_id, row);
    const readAt = reads.get(row.channel_id);
    if (row.sender_id !== userId && (!readAt || row.created_at > readAt)) {
      unreadByChannel.set(row.channel_id, (unreadByChannel.get(row.channel_id) ?? 0) + 1);
    }
  }

  const threads = channels.map((c): HubThread => {
    const last = latestByChannel.get(c.id) as any | undefined;
    return {
      id: c.id,
      name: c.name,
      kind: c.kind,
      avatar_url: c.avatar_url,
      post_permission: c.post_permission,
      display_order: c.display_order,
      last_preview: last ? previewForMessage(last) : null,
      last_sender: last
        ? (last.profiles?.full_name?.trim() || last.profiles?.username || null)
        : null,
      last_at: last?.created_at ?? null,
      unread_count: unreadByChannel.get(c.id) ?? 0,
    };
  });

  return threads;
}

function previewForMessage(m: any): string {
  switch (m.message_type) {
    case 'image':
      return 'Photo';
    case 'video':
      return 'Video';
    case 'file':
      return 'File';
    case 'poll':
      return 'Poll';
    case 'shared_event':
      return 'Shared an event';
    case 'shared_post':
      return 'Shared a post';
    default:
      return (m.content ?? '').replace(/\s+/g, ' ').trim() || 'Message';
  }
}

export async function markChannelRead(channelId: string): Promise<void> {
  await supabase.rpc('mark_channel_read', { p_channel_id: channelId });
}

export interface ChannelMeta {
  id: string;
  name: string;
  kind: 'main' | 'channel';
  post_permission: PostPermission;
  conversation_id: string;
  avatar_url: string | null;
}

export async function getChannelMeta(channelId: string): Promise<ChannelMeta | null> {
  const { data } = await supabase
    .from('conversation_channels')
    .select('id, name, kind, post_permission, conversation_id, avatar_url')
    .eq('id', channelId)
    .single();
  return (data as ChannelMeta) ?? null;
}

/** Authoritative posting check — mirrors the server-side RLS gate exactly. */
export async function canPostInChannel(channelId: string): Promise<boolean> {
  const { data } = await supabase.rpc('can_post_in_channel', { p_channel_id: channelId });
  return data === true;
}

/** Certain-people allow-list for a channel (officer permission editor). */
export async function getChannelPosters(channelId: string): Promise<string[]> {
  const { data } = await supabase
    .from('channel_posters')
    .select('user_id')
    .eq('channel_id', channelId);
  return ((data ?? []) as any[]).map((r) => r.user_id);
}

export async function setChannelMuted(channelId: string, muted: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_channel_muted', {
    p_channel_id: channelId,
    p_muted: muted,
  });
  if (error) throw error;
}

export async function getChannelMuted(channelId: string, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from('channel_mutes')
    .select('channel_id')
    .eq('channel_id', channelId)
    .eq('user_id', userId)
    .maybeSingle();
  return !!data;
}

/** Every channel the viewer has muted (RLS already scopes to auth.uid()). */
export async function getMutedChannelIds(userId: string): Promise<string[]> {
  const { data } = await supabase
    .from('channel_mutes')
    .select('channel_id')
    .eq('user_id', userId);
  return ((data ?? []) as any[]).map((r) => r.channel_id);
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
      'id, conversation_id, channel_id, sender_id, content, attachment_url, attachment_name, attachment_size, attachment_mime, message_type, created_at, polls(id), profiles!sender_id(id, username, avatar_url), message_attachments(id, storage_path, kind, position, mime, width, height, byte_size, file_name), message_reactions(id, user_id, emoji, created_at, profiles!user_id(id, username, full_name, avatar_url))',
    )
    .eq('channel_id', channelId)
    .order('created_at', { ascending: false })
    .limit(PAGE_SIZE);

  if (cursor) {
    query = query.lt('created_at', cursor);
  }

  const [{ data, error }, auth] = await Promise.all([query, supabase.auth.getUser()]);
  if (error) throw error;

  const rows = (data ?? []) as any[];
  const viewerId = auth.data.user?.id ?? '';
  const visibility = rows.length > 0 ? await loadThreadVisibility(supabase, rows[0].conversation_id, viewerId) : { hiddenIds: new Set<string>(), clearedBefore: null };

  const messages: MessageWithSender[] = applyThreadVisibility(rows, visibility).map((m) => ({
    id: m.id,
    conversation_id: m.conversation_id,
    channel_id: m.channel_id,
    sender_id: m.sender_id,
    content: m.content,
    attachment_url: m.attachment_url,
    attachments: channelAttachments(m),
    reactions: channelReactions(m, viewerId),
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
  attachments?: ChannelAttachmentInput[],
): Promise<void> {
  if (attachments) {
    if (attachments.length < 1 || attachments.length > 5) throw new Error('You can send between 1 and 5 attachments.');
    const kind = attachments[0].kind;
    if (attachments.some((item) => item.kind !== kind)) throw new Error('Grouped attachments must have one kind.');
    if (attachments.length > 1 && kind !== 'image') throw new Error('Only images can be grouped.');
    const { error } = await supabase.rpc('send_message_with_attachments', {
      p_conversation_id: conversationId,
      p_channel_id: channelId,
      p_content: content || null,
      p_message_type: kind,
      p_client_tag: clientUuid(),
      p_attachments: attachments,
    });
    if (error) throw error;
    return;
  }
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

export { setMessageReaction, removeMessageReaction, toggleMessageReaction, getMessageReactors } from './messagingService';

export async function deleteMessage(messageId: string): Promise<void> {
  const { error } = await supabase.functions.invoke('delete-message', {
    body: { messageId, idempotencyKey: clientUuid() },
  });

  if (error) throw error;
}
