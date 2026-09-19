import { supabase } from '../lib/supabase';
import { resolveDisplayName, MEMBER_FALLBACK } from '../lib/displayName';
import { CHAT_ATTACHMENTS_BUCKET, clientUuid } from '../lib/chatAttachments';
import { applyThreadVisibility, loadThreadVisibility } from '@weglue/shared';
import type { MessageAttachment, MessageReactionSummary } from './messagingService';

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
  /** Sender of the newest visible message (null when it's a deletion
   * placeholder or has no sender). Drives the "You: " vs "Name: " preview
   * prefix and must never be shown as raw text. */
  last_sender_id: string | null;
  /** Resolved display name of the newest message's sender (null for own
   * messages or deletion placeholders). */
  last_sender_name: string | null;
  unread_count: number;
  channel_names: string[];
  /** Default channel of THIS conversation — lets taps open the thread
   * directly with a single navigation (no intermediate redirect screen). */
  default_channel_id: string | null;
  /** Viewer-specific: muted / archived (Bug 7). Archived chats move to the
   * Archived section and stay there until manually unarchived (a new message
   * must NOT unarchive). */
  muted: boolean;
  archived: boolean;
  /**
   * Backend-owned banner-delivery state (migration 105). When
   * `banner_broadcast_active` is true the server delivers this conversation's
   * foreground `new_message` banner on the conversation-scoped topic
   * `sync:message-inbox-conv:<id>:<banner_epoch>` instead of the per-user
   * topic — the client must hold that subscription (useConversationBannerChannels).
   * Read-only on the client; never set from the app.
   */
  banner_broadcast_active: boolean;
  banner_epoch: number | null;
}

export interface ChatDetails {
  id: string;
  type: 'direct' | 'group' | 'club_group' | 'officer_chat';
  /** Live display title (see ChatPreview.name). */
  name: string | null;
  /** Custom-group stored name (null → title is auto-derived). */
  stored_name: string | null;
  /** Live avatar (see ChatPreview.avatar_url). */
  avatar_url: string | null;
  club_id: string | null;
  /** Custom-group administrator (creator). */
  created_by: string | null;
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

/** Display name for a person: full name when they entered one, otherwise a
 * real username. Placeholder `user_<hex>` usernames resolve to null so callers
 * never render the internal-looking id as someone's name. */
function personDisplayName(p: { full_name?: string | null; username?: string | null } | null | undefined): string | null {
  return resolveDisplayName(p);
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
    return {
      // The account exists (participant row present) but hasn't set a name and
      // still has the placeholder username — show "We Glue member", never the
      // internal id and never "Deleted account".
      name: name ?? MEMBER_FALLBACK,
      avatar_url: other.profiles?.avatar_url ?? null,
      other_user_id: other.user_id,
    };
  }

  if (type === 'club_group' || type === 'officer_chat') {
    return {
      name: clubConversationTitle(club?.name, type, storedName),
      // Bug 5 — the chat's OWN picture is authoritative.
      //
      // This read `club?.avatar_url` alone, so a Members or Officers chat
      // always rendered the live Club Profile image and `storedAvatar` was
      // ignored entirely. That coupled the two permanently: an officer setting
      // a chat picture saw nothing change, and editing the Club Profile
      // silently restyled every existing chat. The club image is now only the
      // fallback, for a chat created before its picture was seeded (079).
      // Club profile picture — never the banner.
      avatar_url: storedAvatar ?? club?.avatar_url ?? null,
      other_user_id: null,
    };
  }

  if (type === 'group') {
    // Custom groups: explicit name wins; otherwise derive from participant
    // display names ("Ana, Marcus, Liam" / "Ana, Marcus and 4 others") and
    // keep deriving as membership changes.
    if (storedName?.trim()) {
      return { name: storedName.trim(), avatar_url: storedAvatar, other_user_id: null };
    }
    return {
      name: autoGroupTitle(participants, currentUserId),
      avatar_url: storedAvatar,
      other_user_id: null,
    };
  }

  return { name: storedName, avatar_url: storedAvatar, other_user_id: null };
}

/** Fallback title for unnamed custom groups, derived from display names. */
export function autoGroupTitle(
  participants: { user_id: string; profiles?: { username?: string | null; full_name?: string | null } | null }[],
  currentUserId: string,
): string {
  const names = participants
    .filter((p) => p.user_id !== currentUserId)
    .map((p) => personDisplayName(p.profiles))
    .filter((n): n is string => !!n);
  if (names.length === 0) return 'Group chat';
  if (names.length <= 3) return names.join(', ');
  return `${names[0]}, ${names[1]} and ${names.length - 2} others`;
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
  attachments: MessageAttachment[];
  reactions: MessageReactionSummary[];
  sender: {
    id: string;
    username: string;
    avatar_url: string | null;
  };
  poll_id?: string | null;
}

function directAttachments(m: any): MessageAttachment[] {
  const rows = Array.isArray(m.message_attachments) && m.message_attachments.length
    ? m.message_attachments
    : m.attachment_url
      ? [{ id: `legacy:${m.id}`, storage_path: m.attachment_url, kind: m.message_type === 'video' ? 'video' : m.message_type === 'file' ? 'file' : 'image', position: 0, mime: m.attachment_mime ?? null, width: null, height: null, byte_size: m.attachment_size ?? null, file_name: m.attachment_name ?? null }]
      : [];
  return rows
    .map((a: any) => ({ id: a.id, storage_path: a.storage_path, kind: a.kind, position: Number(a.position), mime: a.mime ?? null, width: a.width ?? null, height: a.height ?? null, byte_size: a.byte_size ?? null, file_name: a.file_name ?? null }))
    .sort((a: MessageAttachment, b: MessageAttachment) => a.position - b.position);
}

function directReactions(m: any, viewerId: string): MessageReactionSummary[] {
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

export interface DirectMessagesPage {
  messages: DirectMessageThread[];
  next_cursor: string | null;
}

/** Every message the user deleted-for-me, so those are excluded from the
 * Message-tab preview and unread count. Bounded by the viewer's own hides
 * (small), so this stays one lightweight query regardless of inbox size. */
async function getHiddenMessageIdsForUser(userId: string): Promise<Set<string>> {
  const { data } = await supabase
    .from('message_hides')
    .select('message_id')
    .eq('user_id', userId);
  return new Set(((data ?? []) as any[]).map((r) => r.message_id));
}

function formatLastMessagePreview(lastMsg: { content: string | null; message_type: string } | null): string | null {
  if (!lastMsg) return null;
  if (lastMsg.message_type === 'shared_event') return '📅 Shared an event';
  if (lastMsg.message_type === 'shared_post') return '🖼️ Shared a post';
  if (lastMsg.message_type === 'poll') return '📊 Started a poll';
  if (lastMsg.message_type === 'image') return lastMsg.content ?? '📷 Photo';
  if (lastMsg.message_type === 'video') return lastMsg.content ?? '🎬 Video';
  if (lastMsg.message_type === 'file') return lastMsg.content ?? '📎 File';
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
      `conversation_id, last_read_at, joined_at, hidden_at, cleared_before, muted_at, archived_at,
       conversations!inner(
         id, type, name, avatar_url, club_id, created_by, deleted_at,
         banner_broadcast_active, banner_epoch,
         clubs(id, name, avatar_url),
         conversation_participants(user_id, profiles!user_id(username, full_name, avatar_url)),
         conversation_channels(id, name, is_default, display_order),
         messages(id, sender_id, content, message_type, created_at, deleted_at, deleted_by, profiles!sender_id(username, full_name))
       )`,
    )
    .eq('user_id', userId)
    .order('created_at', { referencedTable: 'conversations.messages', ascending: false })
    .limit(CHAT_PREVIEW_MESSAGES, { referencedTable: 'conversations.messages' })
    .order('joined_at', { ascending: false });

  if (error) throw error;

  const rows = ((data ?? []) as any[]).filter(
    // Hidden-for-me and deleted-for-everyone conversations stay out of the
    // Message tab. hidden_at clears automatically when a new message arrives.
    (row) => !row.hidden_at && !row.conversations?.deleted_at,
  );

  // Delete-for-me messages must also disappear from the Message-tab preview
  // (not just inside the thread), so load the viewer's hides once.
  const hiddenIds = await getHiddenMessageIdsForUser(userId);

  return rows.flatMap((row) => {
    const conv = row.conversations;
    const clearedBefore = row.cleared_before ? new Date(row.cleared_before) : null;
    // Candidates = everything visible to this viewer (excludes cleared history
    // and delete-for-me), but KEEPS delete-for-everyone rows so the newest one
    // can render its "… deleted a message" placeholder instead of silently
    // reverting to an older message.
    const candidates: any[] = (conv.messages ?? []).filter(
      (m: any) =>
        !hiddenIds.has(m.id) && (!clearedBefore || new Date(m.created_at) > clearedBefore),
    );
    // Draft/emptied DMs never occupy the Message tab: a direct thread exists
    // for the viewer only once it has at least one message it can show.
    if (conv.type === 'direct' && candidates.length === 0) return [];
    const identity = resolveConversationIdentity(
      conv.type,
      conv.name,
      conv.avatar_url,
      conv.clubs ?? null,
      conv.conversation_participants ?? [],
      userId,
    );

    candidates.sort(
      (a: any, b: any) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
    const lastMsg = candidates[0] ?? null;
    const lastIsDeleted = !!lastMsg?.deleted_at;

    // Unread never counts the viewer's OWN messages or globally-deleted rows —
    // sending your own message must not light up your own unread badge.
    const liveIncoming = candidates.filter((m: any) => !m.deleted_at && m.sender_id !== userId);
    const lastReadAt: string | null = row.last_read_at ?? row.joined_at ?? null;
    const unreadCount = lastReadAt
      ? liveIncoming.filter((m: any) => new Date(m.created_at) > new Date(lastReadAt)).length
      : liveIncoming.length;

    const lastPreview = lastIsDeleted
      ? lastMsg.deleted_by === userId
        ? 'You deleted a message'
        : 'A message was deleted'
      : formatLastMessagePreview(lastMsg);

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
      last_message: lastPreview,
      last_message_at: lastMsg?.created_at ?? null,
      // No sender attribution for deletion placeholders or the viewer's own
      // last message (rendered as "You: …" by the caller).
      last_sender_id: lastIsDeleted ? null : lastMsg?.sender_id ?? null,
      last_sender_name:
        lastIsDeleted || !lastMsg || lastMsg.sender_id === userId
          ? null
          : personDisplayName(lastMsg.profiles),
      unread_count: unreadCount,
      channel_names: channels.map((c: any) => c.name),
      default_channel_id: defaultChannel?.id ?? null,
      muted: !!row.muted_at,
      archived: !!row.archived_at,
      banner_broadcast_active: !!conv.banner_broadcast_active,
      banner_epoch: conv.banner_epoch ?? null,
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
      .select('id, type, name, avatar_url, club_id, created_by, deleted_at, clubs(id, name, avatar_url)')
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
  const participantIds = ((participants ?? []) as any[]).map((p) => p.user_id);
  if ((conv as any).club_id && participantIds.length > 0) {
    const [{ data: members }, { data: officers }] = await Promise.all([
      supabase
        .from('club_members')
        .select('user_id, role')
        .eq('club_id', (conv as any).club_id)
        .in('user_id', participantIds),
      supabase
        .from('club_officers')
        .select('user_id, role_title')
        .eq('club_id', (conv as any).club_id)
        .in('user_id', participantIds),
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
    stored_name: (conv as any).name ?? null,
    avatar_url: identity.avatar_url,
    club_id: (conv as any).club_id,
    created_by: (conv as any).created_by ?? null,
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
      'id, conversation_id, sender_id, content, attachment_url, attachment_name, attachment_size, attachment_mime, message_type, shared_event_id, shared_post_id, created_at, profiles!sender_id(id, username, avatar_url), message_attachments(id, storage_path, kind, position, mime, width, height, byte_size, file_name), message_reactions(id, user_id, emoji, created_at, profiles!user_id(id, username, full_name, avatar_url))',
    )
    .eq('conversation_id', conversationId)
    .is('channel_id', null)
    .order('created_at', { ascending: false })
    .limit(PAGE_SIZE);

  if (cursor) {
    query = query.lt('created_at', cursor);
  }

  const [{ data, error }, auth] = await Promise.all([query, supabase.auth.getUser()]);
  if (error) throw error;

  const rows = (data ?? []) as any[];
  const viewerId = auth.data.user?.id ?? '';
  const visibility = await loadThreadVisibility(supabase, conversationId, viewerId);
  const messages: DirectMessageThread[] = applyThreadVisibility(rows, visibility).map((m) => ({
    id: m.id,
    conversation_id: m.conversation_id,
    sender_id: m.sender_id,
    content: m.content,
    attachment_url: m.attachment_url,
    attachments: directAttachments(m),
    reactions: directReactions(m, viewerId),
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

// Re-export the canonical reaction API for legacy DM callers; channel callers
// can use the same functions because authorization is derived from message
// participation, never from posting permission.
export { setMessageReaction, removeMessageReaction, toggleMessageReaction, getMessageReactors } from './messagingService';

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
      'id, conversation_id, sender_id, content, attachment_url, attachment_name, attachment_size, attachment_mime, message_type, shared_event_id, shared_post_id, created_at, profiles!sender_id(id, username, avatar_url), message_attachments(id, storage_path, kind, position, mime, width, height, byte_size, file_name), message_reactions(id, user_id, emoji, created_at, profiles!user_id(id, username, full_name, avatar_url))',
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
    attachments: directAttachments(m),
    reactions: [],
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

  const [{ data: people, error: peopleError }, { data: chats }] = await Promise.all([
    supabase.rpc('search_message_people', { p_query: q, p_limit: 20 }),

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

  if (peopleError) throw peopleError;

  const peopleResults: PeopleResult[] = ((people ?? []) as any[]).map((p) => ({
    user_id: p.user_id,
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
      // Bug 5 — the chat's own picture first, the club's only as a fallback.
      avatar_url: c.avatar_url ?? c.clubs?.avatar_url ?? null,
    };
  });

  return { people: peopleResults, chats: chatResults };
}

/** Product floor for every Suggested section (empty Single, New message, New
 * group chat). The server returns fewer only when fewer accounts are eligible.
 * Web uses the same constant (apps/web/lib/messages/service.ts). */
export const MESSAGE_SUGGESTION_LIMIT = 10;

/** Bounded, cross-campus suggestions from the shared secure RPC. The database
 * excludes blocked, restricted, and deleted accounts before any profile data
 * reaches the device. */
export async function getSuggestedPeople(_userId: string): Promise<PeopleResult[]> {
  const { data, error } = await supabase.rpc('get_message_suggestions', {
    p_limit: MESSAGE_SUGGESTION_LIMIT,
  });
  if (error) throw error;
  return ((data ?? []) as any[]).map((p) => ({
    user_id: p.user_id,
    username: p.username,
    full_name: p.full_name ?? null,
    avatar_url: p.avatar_url ?? null,
  }));
}

// ─── Internal sharing (people + groups + club chats) ────────────────────────
// One destination model for the Share sheet: individual people (each resolving
// to their DM) plus every multi-person conversation the user belongs to
// (custom groups, club Members chats, club Officers chats), each a DISTINCT,
// clearly-labelled destination ("Clay Club · Members" vs "Clay Club · Officers").

/** My group/club/officer conversations, newest-active first, for the Share
 * sheet's Suggested section (multi-person destinations only — people come from
 * getSuggestedPeople / searchChats). */
export async function getMyGroupChats(userId: string): Promise<ChatResult[]> {
  const { data } = await supabase
    .from('conversation_participants')
    .select('conversations!inner(id, name, type, club_id, avatar_url, deleted_at, clubs(id, name, avatar_url))')
    .eq('user_id', userId)
    .in('conversations.type', ['group', 'club_group', 'officer_chat'])
    .limit(40);

  return ((data ?? []) as any[])
    .map((row) => row.conversations)
    .filter((c) => c && !c.deleted_at)
    .map((c) => ({
      id: c.id,
      name: clubConversationTitle(c.clubs?.name, c.type, c.name),
      type: c.type,
      club_id: c.club_id,
      // Bug 5 — the chat's own picture first, the club's only as a fallback.
      avatar_url: c.avatar_url ?? c.clubs?.avatar_url ?? null,
    }));
}

/** Default channel of a club chat (share messages must land in a real channel
 * thread, not channel_id=null which no channel view renders). Null for DMs and
 * custom groups, which have no channels. */
async function getDefaultChannelId(conversationId: string): Promise<string | null> {
  const { data } = await supabase
    .from('conversation_channels')
    .select('id, is_default, display_order')
    .eq('conversation_id', conversationId)
    .order('display_order', { ascending: true });
  const channels = (data ?? []) as any[];
  if (channels.length === 0) return null;
  return (channels.find((c) => c.is_default) ?? channels[0]).id;
}

export type ShareContent =
  | { type: 'event'; eventId: string }
  | { type: 'post'; postId: string }
  | { type: 'media'; sourcePath: string; kind: 'image' | 'video'; name?: string | null; mime?: string | null };

/** A single share destination: an existing conversation, or a person (resolved
 * to their DM at send time). */
export interface ShareTarget {
  conversationId?: string;
  userId?: string;
}

/**
 * Delivers shared content to one conversation as a REAL message (never a text
 * URL). For media, the private object is server-side copied into the
 * destination conversation's storage folder so recipient RLS grants access —
 * no signed URL is ever exposed, and unauthorized users can't read it.
 */
async function shareToConversation(
  senderId: string,
  conversationId: string,
  content: ShareContent,
): Promise<void> {
  const channelId = await getDefaultChannelId(conversationId);

  if (content.type === 'event') {
    const { error } = await supabase.from('messages').insert({
      conversation_id: conversationId,
      channel_id: channelId,
      sender_id: senderId,
      message_type: 'shared_event',
      shared_event_id: content.eventId,
    });
    if (error) throw error;
    return;
  }
  if (content.type === 'post') {
    const { error } = await supabase.from('messages').insert({
      conversation_id: conversationId,
      channel_id: channelId,
      sender_id: senderId,
      message_type: 'shared_post',
      shared_post_id: content.postId,
    });
    if (error) throw error;
    return;
  }

  // Media: copy the private object into the destination folder (server-side,
  // no download) so the new message references media the recipients can read.
  const ext = content.sourcePath.includes('.') ? content.sourcePath.split('.').pop() : content.kind === 'video' ? 'mp4' : 'jpg';
  const destPath = `${conversationId}/${clientUuid()}.${ext}`;
  const { error: copyErr } = await supabase.storage
    .from(CHAT_ATTACHMENTS_BUCKET)
    .copy(content.sourcePath, destPath);
  if (copyErr) throw copyErr;

  const { error } = await supabase.from('messages').insert({
    conversation_id: conversationId,
    channel_id: channelId,
    sender_id: senderId,
    message_type: content.kind,
    attachment_url: destPath,
    attachment_name: content.name ?? null,
    attachment_mime: content.mime ?? null,
  });
  if (error) throw error;
}

export interface ShareResult {
  sent: number;
  failed: number;
}

/**
 * Fan-out share to many destinations at once. Dedupes destinations (never two
 * sends to the same conversation), resolves people to their DM, and reports
 * partial failures so the UI can be truthful. Idempotency across taps is the
 * caller's responsibility (it disables Send while pending).
 */
export async function shareContentToTargets(
  senderId: string,
  targets: ShareTarget[],
  content: ShareContent,
): Promise<ShareResult> {
  // Resolve people → DM conversation ids, then dedupe.
  const conversationIds = new Set<string>();
  for (const t of targets) {
    try {
      const convId = t.conversationId ?? (t.userId ? await getOrCreateDirectChat(t.userId) : null);
      if (convId) conversationIds.add(convId);
    } catch {
      // A resolution failure counts as a failed destination below.
    }
  }

  let sent = 0;
  let failed = 0;
  for (const convId of conversationIds) {
    try {
      await shareToConversation(senderId, convId, content);
      sent += 1;
    } catch {
      failed += 1;
    }
  }
  // Destinations that never resolved to a conversation id are failures too.
  failed += Math.max(0, targets.length - conversationIds.size - failed);
  return { sent, failed };
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
    // Bug 5 — the chat's own picture first, the club's only as a fallback.
    // The NAME above stays live club identity; only the image is a copy.
    avatarUrl: (data as any).avatar_url ?? (data as any).clubs?.avatar_url ?? null,
  };
}
