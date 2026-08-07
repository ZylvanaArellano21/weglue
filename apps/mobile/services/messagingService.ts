import { supabase } from '../lib/supabase';
import { clientUuid } from '../lib/chatAttachments';
import { applyThreadVisibility, isMessageVisible, loadThreadVisibility } from '@weglue/shared';

// ─── Unified messaging service (all four conversation types) ────────────────
// direct · group (custom) · club_group · officer_chat
//
// INVARIANT: nothing in this file may touch club_members / club_officers
// directly. Chat participation and club membership are separate; the only
// club-affecting calls are the explicit officer-moderation RPCs at the
// bottom, which are server-authorized.

export interface ThreadMessage {
  id: string;
  conversation_id: string;
  channel_id: string | null;
  sender_id: string | null;
  content: string | null;
  attachment_url: string | null;
  attachment_name: string | null;
  attachment_size: number | null;
  attachment_mime: string | null;
  message_type: string;
  shared_event_id: string | null;
  shared_post_id: string | null;
  poll_id: string | null;
  client_tag: string | null;
  created_at: string;
  sender: {
    id: string;
    username: string;
    full_name: string | null;
    avatar_url: string | null;
  };
}

export interface ThreadPage {
  messages: ThreadMessage[];
  next_cursor: string | null;
}

const MESSAGE_SELECT =
  'id, conversation_id, channel_id, sender_id, content, attachment_url, attachment_name, attachment_size, attachment_mime, message_type, shared_event_id, shared_post_id, client_tag, created_at, polls(id), profiles!sender_id(id, username, full_name, avatar_url)';

function mapMessage(m: any): ThreadMessage {
  return {
    id: m.id,
    conversation_id: m.conversation_id,
    channel_id: m.channel_id ?? null,
    sender_id: m.sender_id,
    content: m.content,
    attachment_url: m.attachment_url,
    attachment_name: m.attachment_name ?? null,
    attachment_size: m.attachment_size ?? null,
    attachment_mime: m.attachment_mime ?? null,
    message_type: m.message_type,
    shared_event_id: m.shared_event_id ?? null,
    shared_post_id: m.shared_post_id ?? null,
    poll_id: Array.isArray(m.polls) ? (m.polls[0]?.id ?? null) : (m.polls?.id ?? null),
    client_tag: m.client_tag ?? null,
    created_at: m.created_at,
    sender: {
      id: m.profiles?.id ?? m.sender_id ?? '',
      username: m.profiles?.username ?? '',
      full_name: m.profiles?.full_name ?? null,
      avatar_url: m.profiles?.avatar_url ?? null,
    },
  };
}

// Delete-for-me and the conversation-delete watermark are now resolved by the
// canonical `@weglue/shared` thread-visibility contract, which the web app uses
// too. They previously lived only here, which is exactly why the browser showed
// messages this user had already deleted on their phone.

/**
 * Messages of one thread (conversation, or one channel of a club chat),
 * newest first, excluding unsent messages, delete-for-me hides and history
 * cleared by a conversation delete.
 */
export async function getThreadMessages(
  conversationId: string,
  channelId: string | null,
  userId: string,
  cursor?: string,
): Promise<ThreadPage> {
  const PAGE_SIZE = 40;

  let query = supabase
    .from('messages')
    .select(MESSAGE_SELECT)
    .eq('conversation_id', conversationId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(PAGE_SIZE);

  query = channelId ? query.eq('channel_id', channelId) : query.is('channel_id', null);
  if (cursor) query = query.lt('created_at', cursor);

  const [{ data, error }, visibility] = await Promise.all([
    query,
    loadThreadVisibility(supabase, conversationId, userId),
  ]);
  if (error) throw error;

  const raw = (data ?? []) as any[];
  const rows = applyThreadVisibility(raw, visibility);

  return {
    messages: rows.map(mapMessage),
    // Cursor comes from the RAW page, never the filtered one: a page whose rows
    // were all hidden must still advance, or history would truncate there.
    next_cursor: raw.length === PAGE_SIZE ? raw[raw.length - 1].created_at : null,
  };
}

// ─── Sending ─────────────────────────────────────────────────────────────────

export interface SendMessageInput {
  conversationId: string;
  channelId?: string | null;
  content?: string | null;
  messageType?: 'text' | 'image' | 'video' | 'file';
  attachmentPath?: string | null;
  attachmentName?: string | null;
  attachmentSize?: number | null;
  attachmentMime?: string | null;
  /** Stable per-logical-message tag; retries with the same tag never duplicate. */
  clientTag: string;
}

export async function sendMessage(input: SendMessageInput): Promise<ThreadMessage> {
  const { data: auth } = await supabase.auth.getUser();
  const senderId = auth.user?.id;
  if (!senderId) throw new Error('Not signed in');

  const { data, error } = await supabase
    .from('messages')
    .insert({
      conversation_id: input.conversationId,
      channel_id: input.channelId ?? null,
      sender_id: senderId,
      content: input.content?.trim() || null,
      message_type: input.messageType ?? 'text',
      attachment_url: input.attachmentPath ?? null,
      attachment_name: input.attachmentName ?? null,
      attachment_size: input.attachmentSize ?? null,
      attachment_mime: input.attachmentMime ?? null,
      client_tag: input.clientTag,
    })
    .select(MESSAGE_SELECT)
    .single();

  if (error) {
    // Retry after a lost response: the row may already exist under this tag.
    if ((error as any).code === '23505') {
      const { data: existing } = await supabase
        .from('messages')
        .select(MESSAGE_SELECT)
        .eq('sender_id', senderId)
        .eq('client_tag', input.clientTag)
        .single();
      if (existing) return mapMessage(existing);
    }
    throw error;
  }
  return mapMessage(data);
}

export function newClientTag(): string {
  return clientUuid();
}

// ─── Message actions ─────────────────────────────────────────────────────────

/** Unsend for everyone (server-authorized: sender / official-chat officer / group admin). */
export async function unsendMessage(messageId: string): Promise<void> {
  const { error } = await supabase.functions.invoke('delete-message', {
    body: { messageId, idempotencyKey: clientUuid() },
  });
  if (error) throw error;
}

/** Delete for me only. */
export async function hideMessageForMe(messageId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('message_hides')
    .upsert({ message_id: messageId, user_id: userId }, { onConflict: 'message_id,user_id', ignoreDuplicates: true });
  if (error) throw error;
}

export interface ReportMessageResult {
  /** The report row and any pre-deletion private evidence capture exist on the
   * server — the durable, primary action. */
  saved: true;
  /** The courtesy notification email to SUPPORT_EMAIL was accepted. A false
   * here never means the report was lost: the row is the source of truth and
   * records email_error for retry. */
  emailed: boolean;
}

export async function reportMessage(
  messageId: string,
  reason: string,
  details?: string,
): Promise<ReportMessageResult> {
  // 1) Durable insert + private pre-deletion evidence capture. It is server
  //    authorized, never stores a signed URL, and is unavailable if deletion
  //    won the race. Must succeed — a throw here surfaces as retry in the UI.
  const { data: reportId, error } = await supabase.rpc('report_message', {
    p_message_id: messageId,
    p_reason: reason,
    p_details: details ?? null,
  });
  if (error) throw error;

  // 2) Notify SUPPORT_EMAIL. Idempotent per report (email_sent_at); a delivery
  //    failure is recorded server-side and never fails the stored report.
  try {
    const { data, error: fnError } = await supabase.functions.invoke('send-report-email', {
      body: { reportId },
    });
    if (fnError) throw fnError;
    return { saved: true, emailed: (data as { sent?: boolean } | null)?.sent === true };
  } catch {
    // Keep report/evidence-related transport errors out of browser logs.
    console.warn('[reportMessage] report email delivery deferred (report stored)');
    return { saved: true, emailed: false };
  }
}

// ─── Conversation inbox state ────────────────────────────────────────────────

/**
 * Delete a conversation from MY inbox only. Keeps the pair/participant row so
 * the same thread restores (instead of duplicating) on the next message;
 * cleared_before hides today's history from me permanently.
 */
export async function hideConversationForMe(conversationId: string, userId: string): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('conversation_participants')
    .update({ hidden_at: now, cleared_before: now })
    .eq('conversation_id', conversationId)
    .eq('user_id', userId);
  if (error) throw error;
}

/** Officer-only: hide an official chat from my inbox WITHOUT clearing history. */
export async function hideOfficialChatForMe(conversationId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('conversation_participants')
    .update({ hidden_at: new Date().toISOString() })
    .eq('conversation_id', conversationId)
    .eq('user_id', userId);
  if (error) throw error;
}

/**
 * Leave a chat = remove ONLY my participant row. Never touches club
 * membership, officer roles, RSVPs or any club data.
 */
export async function leaveChatOnly(conversationId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('conversation_participants')
    .delete()
    .eq('conversation_id', conversationId)
    .eq('user_id', userId);
  if (error) throw error;
}

// ─── Parent-conversation mute + archive (per user; Bug 7) ───────────────────

export async function setConversationMuted(conversationId: string, muted: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_conversation_muted', {
    p_conversation_id: conversationId,
    p_muted: muted,
  });
  if (error) throw error;
}

export async function setConversationArchived(conversationId: string, archived: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_conversation_archived', {
    p_conversation_id: conversationId,
    p_archived: archived,
  });
  if (error) throw error;
}

/** Current user's mute/archive flags for a conversation. */
export async function getMyConversationFlags(
  conversationId: string,
  userId: string,
): Promise<{ muted: boolean; archived: boolean }> {
  const { data } = await supabase
    .from('conversation_participants')
    .select('muted_at, archived_at')
    .eq('conversation_id', conversationId)
    .eq('user_id', userId)
    .maybeSingle();
  return { muted: !!(data as any)?.muted_at, archived: !!(data as any)?.archived_at };
}

/** Reopen an official club chat from the club profile (validates club role server-side). */
export async function reopenClubChat(clubId: string, type: 'club_group' | 'officer_chat'): Promise<string> {
  const { data, error } = await supabase.rpc('reopen_club_chat', { p_club_id: clubId, p_type: type });
  if (error) throw error;
  return data as string;
}

/** Officer "Delete for everyone" on an official chat (clears history + inboxes; club untouched). */
export async function clearOfficialChat(conversationId: string): Promise<void> {
  const { error } = await supabase.rpc('clear_official_chat', { p_conversation_id: conversationId });
  if (error) throw error;
}

// ─── Custom groups ───────────────────────────────────────────────────────────

export async function createGroupChat(opts: {
  name?: string | null;
  participantIds: string[];
  firstMessage?: string | null;
  clientTag?: string;
}): Promise<string> {
  const { data, error } = await supabase.rpc('create_group_chat', {
    p_name: opts.name ?? null,
    p_participant_ids: opts.participantIds,
    p_first_message: opts.firstMessage ?? null,
    p_client_tag: opts.clientTag ?? null,
  });
  if (error) throw error;
  return data as string;
}

export async function addGroupParticipants(conversationId: string, userIds: string[]): Promise<void> {
  const { error } = await supabase.rpc('add_group_participants', {
    p_conversation_id: conversationId,
    p_user_ids: userIds,
  });
  if (error) throw error;
}

export async function removeGroupParticipant(conversationId: string, userId: string): Promise<void> {
  const { error } = await supabase.rpc('remove_group_participant', {
    p_conversation_id: conversationId,
    p_user_id: userId,
  });
  if (error) throw error;
}

export type LeaveGroupResult = 'left' | 'transfer_required' | 'not_member';

export async function leaveGroupChat(conversationId: string, transferTo?: string): Promise<LeaveGroupResult> {
  const { data, error } = await supabase.rpc('leave_group_chat', {
    p_conversation_id: conversationId,
    p_transfer_to: transferTo ?? null,
  });
  if (error) throw error;
  return data as LeaveGroupResult;
}

export async function deleteGroupForEveryone(conversationId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_group_conversation', { p_conversation_id: conversationId });
  if (error) throw error;
}

export async function updateGroupMeta(
  conversationId: string,
  updates: { name?: string | null; avatar_url?: string | null },
): Promise<void> {
  const { error } = await supabase
    .from('conversations')
    .update(updates)
    .eq('id', conversationId)
    .eq('type', 'group');
  if (error) throw error;
}

// ─── Invitations (non-expiring, opaque tokens) ───────────────────────────────

export const INVITE_BASE_URL = 'https://weglue.app/invite';

export async function getInviteToken(conversationId: string): Promise<string> {
  const { data, error } = await supabase.rpc('get_or_create_chat_invitation', {
    p_conversation_id: conversationId,
  });
  if (error) throw error;
  return data as string;
}

export async function rotateInviteToken(conversationId: string): Promise<string> {
  const { data, error } = await supabase.rpc('rotate_chat_invitation', {
    p_conversation_id: conversationId,
  });
  if (error) throw error;
  return data as string;
}

export interface InvitePreview {
  valid: boolean;
  type?: 'club_group' | 'group';
  club_name?: string | null;
  club_avatar?: string | null;
  group_name?: string | null;
  creator_name?: string | null;
  university?: string | null;
}

export async function previewInvite(token: string): Promise<InvitePreview> {
  const { data, error } = await supabase.rpc('preview_chat_invitation', { p_token: token });
  if (error) throw error;
  return data as InvitePreview;
}

export interface InviteJoinResult {
  conversation_id: string;
  type: 'club_group' | 'group';
  club_id: string | null;
  default_channel_id: string | null;
}

export async function joinInvite(token: string): Promise<InviteJoinResult> {
  const { data, error } = await supabase.rpc('join_chat_invitation', { p_token: token });
  if (error) throw error;
  return data as InviteJoinResult;
}

// ─── Chat Information history (derived from canonical messages) ─────────────

export async function getConversationMedia(
  conversationId: string,
  userId: string,
  channelId?: string | null,
): Promise<ThreadMessage[]> {
  let q = supabase
    .from('messages')
    .select(MESSAGE_SELECT)
    .eq('conversation_id', conversationId)
    .is('deleted_at', null)
    .in('message_type', ['image', 'video']);
  if (channelId) q = q.eq('channel_id', channelId);
  const [{ data, error }, visibility] = await Promise.all([
    q.order('created_at', { ascending: false }).limit(200),
    loadThreadVisibility(supabase, conversationId, userId),
  ]);
  if (error) throw error;
  return applyThreadVisibility((data ?? []) as any[], visibility).map(mapMessage);
}

export async function getConversationFiles(
  conversationId: string,
  userId: string,
  channelId?: string | null,
): Promise<ThreadMessage[]> {
  let q = supabase
    .from('messages')
    .select(MESSAGE_SELECT)
    .eq('conversation_id', conversationId)
    .is('deleted_at', null)
    .eq('message_type', 'file');
  if (channelId) q = q.eq('channel_id', channelId);
  const [{ data, error }, visibility] = await Promise.all([
    q.order('created_at', { ascending: false }).limit(200),
    loadThreadVisibility(supabase, conversationId, userId),
  ]);
  if (error) throw error;
  return applyThreadVisibility((data ?? []) as any[], visibility).map(mapMessage);
}

export interface SharedCalendarEvent {
  event_id: string;
  message_id: string;
  shared_at: string;
  title: string;
  emoji: string | null;
  cover_image_url: string | null;
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  club_name: string | null;
}

/**
 * Genuine We Glue events explicitly shared in this conversation. Derived from
 * shared_event messages; deduped per event; disappears when every sharing
 * message is unsent/removed. No text parsing, ever.
 */
export async function getConversationSharedEvents(
  conversationId: string,
  userId: string,
  channelId?: string | null,
): Promise<SharedCalendarEvent[]> {
  let evq = supabase
    .from('messages')
    .select(
      'id, created_at, shared_event_id, events!shared_event_id(id, title, emoji, cover_image_url, event_date, start_time, end_time, location, clubs(name))',
    )
    .eq('conversation_id', conversationId)
    .is('deleted_at', null)
    .eq('message_type', 'shared_event')
    .not('shared_event_id', 'is', null);
  if (channelId) evq = evq.eq('channel_id', channelId);
  const [{ data, error }, visibility] = await Promise.all([
    evq.order('created_at', { ascending: false }).limit(200),
    loadThreadVisibility(supabase, conversationId, userId),
  ]);
  if (error) throw error;

  const seen = new Set<string>();
  const out: SharedCalendarEvent[] = [];
  for (const m of applyThreadVisibility((data ?? []) as any[], visibility)) {
    const ev = m.events;
    if (!ev || seen.has(ev.id)) continue;
    seen.add(ev.id);
    out.push({
      event_id: ev.id,
      message_id: m.id,
      shared_at: m.created_at,
      title: ev.title,
      emoji: ev.emoji,
      cover_image_url: ev.cover_image_url,
      event_date: ev.event_date,
      start_time: ev.start_time,
      end_time: ev.end_time,
      location: ev.location,
      club_name: ev.clubs?.name ?? null,
    });
  }
  return out.sort((a, b) => (a.event_date < b.event_date ? 1 : -1));
}

// ─── Polls (atomic create + history for any conversation type) ──────────────

export interface CreatePollParams {
  conversationId: string;
  channelId?: string | null;
  question: string;
  options: string[];
  allowMultiple: boolean;
  startAt?: string | null;
  endAt?: string | null;
  clientTag?: string;
}

export async function createPollAtomic(params: CreatePollParams): Promise<{ message_id: string; poll_id: string }> {
  const { data, error } = await supabase.rpc('create_poll', {
    p_conversation_id: params.conversationId,
    p_channel_id: params.channelId ?? null,
    p_question: params.question,
    p_options: params.options,
    p_allow_multiple: params.allowMultiple,
    p_start_at: params.startAt ?? null,
    p_end_at: params.endAt ?? null,
    p_client_tag: params.clientTag ?? null,
  });
  if (error) throw error;
  return data as { message_id: string; poll_id: string };
}

/** Poll history for ANY conversation (date-ordered, excludes unsent). */
export async function getConversationPollIds(
  conversationId: string,
  channelId?: string | null,
): Promise<Array<{ poll_id: string; message_id: string; channel_id: string | null; created_at: string }>> {
  let q = supabase
    .from('polls')
    .select('id, message_id, created_at, messages!inner(conversation_id, channel_id, deleted_at)')
    .eq('messages.conversation_id', conversationId)
    .is('messages.deleted_at', null);
  if (channelId) q = q.eq('messages.channel_id', channelId);
  const { data, error } = await q
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return ((data ?? []) as any[]).map((r) => ({
    poll_id: r.id,
    message_id: r.message_id,
    channel_id: r.messages?.channel_id ?? null,
    created_at: r.created_at,
  }));
}

// ─── In-conversation search (server-side, full accessible history) ──────────

export interface ConversationSearchHit {
  message: ThreadMessage;
  matchField: 'content' | 'file_name' | 'poll_question' | 'shared_event' | 'shared_post';
  matchText: string;
}

export async function searchConversation(
  conversationId: string,
  userId: string,
  rawQuery: string,
): Promise<ConversationSearchHit[]> {
  const q = rawQuery.trim();
  if (!q) return [];
  const like = `%${q.replace(/[%_]/g, (ch) => `\\${ch}`)}%`;

  const [content, files, polls, events, posts, visibility] = await Promise.all([
    supabase
      .from('messages')
      .select(MESSAGE_SELECT)
      .eq('conversation_id', conversationId)
      .is('deleted_at', null)
      .ilike('content', like)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('messages')
      .select(MESSAGE_SELECT)
      .eq('conversation_id', conversationId)
      .is('deleted_at', null)
      .ilike('attachment_name', like)
      .order('created_at', { ascending: false })
      .limit(25),
    supabase
      .from('polls')
      .select(`question, messages!inner(${MESSAGE_SELECT})`)
      .eq('messages.conversation_id', conversationId)
      .is('messages.deleted_at', null)
      .ilike('question', like)
      .limit(25),
    supabase
      .from('messages')
      .select(`${MESSAGE_SELECT}, events!shared_event_id!inner(title)`)
      .eq('conversation_id', conversationId)
      .is('deleted_at', null)
      .ilike('events.title', like)
      .limit(25),
    supabase
      .from('messages')
      .select(`${MESSAGE_SELECT}, posts!shared_post_id!inner(caption)`)
      .eq('conversation_id', conversationId)
      .is('deleted_at', null)
      .ilike('posts.caption', like)
      .limit(25),
    loadThreadVisibility(supabase, conversationId, userId),
  ]);

  const hits = new Map<string, ConversationSearchHit>();
  const visible = (rows: any[]) => applyThreadVisibility(rows, visibility);

  for (const m of visible((content.data ?? []) as any[])) {
    hits.set(m.id, { message: mapMessage(m), matchField: 'content', matchText: m.content ?? '' });
  }
  for (const m of visible((files.data ?? []) as any[])) {
    if (!hits.has(m.id))
      hits.set(m.id, { message: mapMessage(m), matchField: 'file_name', matchText: m.attachment_name ?? '' });
  }
  for (const r of (polls.data ?? []) as any[]) {
    const m = r.messages;
    if (m && isMessageVisible(m, visibility) && !hits.has(m.id))
      hits.set(m.id, { message: mapMessage(m), matchField: 'poll_question', matchText: r.question ?? '' });
  }
  for (const m of visible((events.data ?? []) as any[])) {
    if (!hits.has(m.id))
      hits.set(m.id, { message: mapMessage(m), matchField: 'shared_event', matchText: m.events?.title ?? '' });
  }
  for (const m of visible((posts.data ?? []) as any[])) {
    if (!hits.has(m.id))
      hits.set(m.id, { message: mapMessage(m), matchField: 'shared_post', matchText: m.posts?.caption ?? '' });
  }

  return Array.from(hits.values()).sort(
    (a, b) => new Date(b.message.created_at).getTime() - new Date(a.message.created_at).getTime(),
  );
}

// ─── Officer moderation (canonical club-role RPCs) ───────────────────────────

export async function addClubMemberByOfficer(clubId: string, userId: string): Promise<void> {
  const { error } = await supabase.rpc('add_club_member_by_officer', {
    p_club_id: clubId,
    p_user_id: userId,
  });
  if (error) throw error;
}

export async function removeClubMemberByOfficer(clubId: string, userId: string): Promise<void> {
  const { error } = await supabase.rpc('remove_club_member_by_officer', {
    p_club_id: clubId,
    p_user_id: userId,
  });
  if (error) throw error;
}

export async function addClubOfficerCanonical(clubId: string, userId: string, roleTitle = 'Officer'): Promise<void> {
  const { error } = await supabase.rpc('add_club_officer', {
    p_club_id: clubId,
    p_user_id: userId,
    p_role_title: roleTitle,
  });
  if (error) throw error;
}

export async function demoteClubOfficer(clubId: string, userId: string): Promise<void> {
  const { error } = await supabase.rpc('remove_club_officer', {
    p_club_id: clubId,
    p_user_id: userId,
  });
  if (error) throw error;
}

/** Same-university people eligible for adding to a club chat. */
export async function getEligibleUniversityPeople(
  viewerUserId: string,
  query: string,
  excludeClubId?: string | null,
): Promise<Array<{ user_id: string; username: string; full_name: string | null; avatar_url: string | null }>> {
  const { data: me } = await supabase
    .from('profiles')
    .select('university')
    .eq('id', viewerUserId)
    .single();
  const univ = (me as any)?.university;
  if (!univ) return [];

  // Add Person must only show same-university users who are NOT already members
  // of this club (Bug 4).
  let excludeIds: string[] = [viewerUserId];
  if (excludeClubId) {
    const { data: members } = await supabase
      .from('club_members')
      .select('user_id')
      .eq('club_id', excludeClubId);
    excludeIds = excludeIds.concat(((members ?? []) as any[]).map((m) => m.user_id));
  }

  let q = supabase
    .from('profiles')
    .select('id, username, full_name, avatar_url')
    .eq('university', univ)
    .not('id', 'in', `(${excludeIds.join(',')})`)
    .limit(30);
  const term = query.trim();
  if (term) q = q.or(`username.ilike.%${term}%,full_name.ilike.%${term}%`);

  const { data, error } = await q;
  if (error) throw error;
  return ((data ?? []) as any[]).map((p) => ({
    user_id: p.id,
    username: p.username,
    full_name: p.full_name,
    avatar_url: p.avatar_url,
  }));
}
