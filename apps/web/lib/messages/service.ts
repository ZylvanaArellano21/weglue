"use client";

import { applyThreadVisibility, loadThreadVisibility } from "@weglue/shared";
import { getSupabaseBrowser } from "../supabase-browser";

/**
 * The signed-in user's id, straight from the auth session.
 *
 * Every write that RLS checks against `auth.uid()` must carry it explicitly.
 * `messages.sender_id` is nullable at the column level (migration 016 dropped
 * NOT NULL so an account deletion can orphan a row rather than cascade it), and
 * it has no DEFAULT — so an insert that omits it stores NULL, and the INSERT
 * policy's `sender_id = auth.uid()` evaluates to NULL, which is not TRUE. The
 * row is rejected. That is a silent, total send failure, not a permission
 * problem the user can act on.
 */
async function requireUserId(): Promise<string> {
  const { data, error } = await getSupabaseBrowser().auth.getUser();
  if (error || !data.user) throw new Error("You’re signed out. Sign in again to send messages.");
  return data.user.id;
}

export type ConversationType = "direct" | "group" | "club_group" | "officer_chat";
export type MessageType = "text" | "image" | "video" | "file" | "poll" | "shared_event" | "shared_post";
export type PostingPermission = "everyone" | "officers" | "certain";

export interface Person {
  user_id: string;
  username: string;
  full_name: string | null;
  avatar_url: string | null;
}

export interface ConversationPreview {
  id: string;
  type: ConversationType;
  name: string;
  avatar_url: string | null;
  club_id: string | null;
  club_handle?: string | null;
  other_user_id: string | null;
  last_message: string | null;
  last_message_at: string | null;
  last_sender_id: string | null;
  last_sender_name: string | null;
  unread_count: number;
  muted: boolean;
  archived: boolean;
  /** Number of recent messages visible to the viewer; used only for ranking. */
  message_count: number;
}

export interface ConversationDetails {
  id: string;
  type: ConversationType;
  name: string;
  avatar_url: string | null;
  club_id: string | null;
  created_by: string | null;
  participants: Array<Person & { joined_at: string; role: string }>;
}

export interface Channel {
  id: string;
  conversation_id: string;
  name: string;
  kind: "main" | "channel";
  avatar_url: string | null;
  post_permission: PostingPermission;
  display_order: number;
}

export interface ChannelPreview extends Channel {
  last_preview: string | null;
  last_sender: string | null;
  last_at: string | null;
  unread_count: number;
}

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
  message_type: MessageType;
  shared_event_id: string | null;
  shared_post_id: string | null;
  poll_id: string | null;
  client_tag: string | null;
  created_at: string;
  sender: { id: string; username: string; full_name: string | null; avatar_url: string | null };
}

export interface ThreadPage {
  messages: ThreadMessage[];
  next_cursor: string | null;
}

export interface MessageSearchResult {
  message_id: string;
  conversation_id: string;
  channel_id: string | null;
  content: string | null;
  message_type: MessageType;
  created_at: string;
  sender_id: string | null;
  username: string | null;
  full_name: string | null;
}

const PAGE_SIZE = 40;
const CHAT_ATTACHMENT_BUCKET = "chat-attachments";

function displayName(profile: { username?: string | null; full_name?: string | null } | null | undefined): string {
  const full = profile?.full_name?.trim();
  if (full) return full;
  const username = profile?.username?.trim();
  return username && !/^user_[a-f0-9]+$/i.test(username) ? username : "We Glue member";
}

function previewForMessage(message: { content: string | null; message_type: string } | null): string | null {
  if (!message) return null;
  if (message.message_type === "shared_event") return "📅 Shared an event";
  if (message.message_type === "shared_post") return "🖼️ Shared a post";
  if (message.message_type === "poll") return "📊 Started a poll";
  if (message.message_type === "image") return message.content ?? "📷 Photo";
  if (message.message_type === "video") return message.content ?? "🎬 Video";
  if (message.message_type === "file") return message.content ?? "📎 File";
  return message.content;
}

export interface SharedIdentity {
  id: string;
  username: string;
  full_name: string | null;
  avatar_url: string | null;
}

/**
 * Minimal structural identity for the people in ONE conversation the viewer
 * already participates in (074). Used only to fill in what the profiles policy
 * removes: a blocked person is hidden from `profiles` in both directions, so
 * `profiles!sender_id(...)` embeds as null and their existing messages would
 * otherwise render with no name and no avatar.
 *
 * Not a profile bypass — the RPC returns id/username/full_name/avatar_url for
 * this conversation's participants and active senders only, refuses
 * non-participants outright, and discloses nothing about who blocked whom.
 */
export async function conversationSharedIdentities(
  conversationId: string
): Promise<Map<string, SharedIdentity>> {
  const { data, error } = await getSupabaseBrowser().rpc("conversation_shared_identities", {
    p_conversation_id: conversationId,
  });
  if (error) throw error;
  return new Map(
    ((data ?? []) as any[]).map((row) => [
      row.id as string,
      {
        id: row.id as string,
        username: (row.username ?? "") as string,
        full_name: row.full_name ?? null,
        avatar_url: row.avatar_url ?? null,
      },
    ])
  );
}

/**
 * Senders in this conversation whose ATTACHMENT payload the viewer may not
 * read, because of a block in either direction (074). Symmetric, so it never
 * reveals the direction. Presentation only: the storage policy refuses the
 * bytes independently of anything the client believes.
 */
export async function conversationRestrictedSenders(conversationId: string): Promise<string[]> {
  const { data, error } = await getSupabaseBrowser().rpc("conversation_restricted_senders", {
    p_conversation_id: conversationId,
  });
  if (error) throw error;
  return ((data ?? []) as string[]) ?? [];
}

function messageFromRow(row: any, identities?: Map<string, SharedIdentity>): ThreadMessage {
  const poll = Array.isArray(row.polls) ? row.polls[0] : row.polls;
  const shared = row.sender_id ? identities?.get(row.sender_id) : undefined;
  return {
    id: row.id,
    conversation_id: row.conversation_id,
    channel_id: row.channel_id ?? null,
    sender_id: row.sender_id ?? null,
    content: row.content ?? null,
    attachment_url: row.attachment_url ?? null,
    attachment_name: row.attachment_name ?? null,
    attachment_size: row.attachment_size ?? null,
    attachment_mime: row.attachment_mime ?? null,
    message_type: row.message_type as MessageType,
    shared_event_id: row.shared_event_id ?? null,
    shared_post_id: row.shared_post_id ?? null,
    poll_id: poll?.id ?? null,
    client_tag: row.client_tag ?? null,
    created_at: row.created_at,
    sender: {
      id: row.profiles?.id ?? row.sender_id ?? "",
      username: row.profiles?.username ?? shared?.username ?? "",
      full_name: row.profiles?.full_name ?? shared?.full_name ?? null,
      avatar_url: row.profiles?.avatar_url ?? shared?.avatar_url ?? null,
    },
  };
}

function threadFilter<T>(query: T & { eq: Function; is: Function }, channelId: string | null): T {
  return channelId ? query.eq("channel_id", channelId) : query.is("channel_id", null);
}

export async function getMyConversations(userId: string, limit = 30): Promise<ConversationPreview[]> {
  const supabase = getSupabaseBrowser();
  const { data, error } = await supabase
    .from("conversation_participants")
    .select(
      `conversation_id, last_read_at, joined_at, hidden_at, cleared_before, muted_at, archived_at,
       conversations!inner(
         id, type, name, avatar_url, club_id, created_by, deleted_at,
         clubs(id, name, handle, avatar_url),
         conversation_participants(user_id, profiles!user_id(username, full_name, avatar_url)),
         messages(id, sender_id, content, message_type, created_at, profiles!sender_id(username, full_name))
       )`
    )
    .eq("user_id", userId)
    .order("created_at", { referencedTable: "conversations.messages", ascending: false })
    .limit(30, { referencedTable: "conversations.messages" })
    .order("joined_at", { ascending: false })
    .limit(limit);
  if (error) throw error;

  return ((data ?? []) as any[])
    .filter((row) => !row.hidden_at && !row.conversations?.deleted_at)
    .flatMap((row) => {
      const conversation = row.conversations;
      const messages = (conversation.messages ?? []).filter((message: any) => {
        return !row.cleared_before || new Date(message.created_at) > new Date(row.cleared_before);
      });
      if (conversation.type === "direct" && messages.length === 0) return [];
      messages.sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      const last = messages[0] ?? null;
      const participants = conversation.conversation_participants ?? [];
      const other = conversation.type === "direct" ? participants.find((participant: any) => participant.user_id !== userId) : null;
      const club = conversation.clubs;
      const name =
        conversation.type === "direct"
          ? other
            ? displayName(other.profiles)
            : "Deleted account"
          : conversation.type === "club_group" || conversation.type === "officer_chat"
            ? `${club?.name ?? conversation.name ?? "Club"} · ${conversation.type === "officer_chat" ? "Officers" : "Members"}`
            : conversation.name?.trim() || participants.filter((p: any) => p.user_id !== userId).slice(0, 3).map((p: any) => displayName(p.profiles)).join(", ") || "Group chat";
      const incoming = messages.filter((message: any) => message.sender_id !== userId);
      const lastRead = row.last_read_at ?? row.joined_at;
      return [{
        id: conversation.id,
        type: conversation.type as ConversationType,
        name,
        avatar_url: conversation.type === "direct" ? other?.profiles?.avatar_url ?? null : club?.avatar_url ?? conversation.avatar_url ?? null,
        club_id: conversation.club_id ?? null,
        club_handle: club?.handle ?? null,
        other_user_id: other?.user_id ?? null,
        last_message: previewForMessage(last),
        last_message_at: last?.created_at ?? null,
        last_sender_id: last?.sender_id ?? null,
        last_sender_name: last?.sender_id === userId ? null : displayName(last?.profiles),
        unread_count: incoming.filter((message: any) => !lastRead || new Date(message.created_at) > new Date(lastRead)).length,
        muted: !!row.muted_at,
        archived: !!row.archived_at,
        message_count: messages.length,
      } satisfies ConversationPreview];
    })
    .sort((a, b) => {
      const at = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
      const bt = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
      return bt - at || b.message_count - a.message_count || a.name.localeCompare(b.name);
    })
    .slice(0, limit);
}

export async function getConversationDetails(conversationId: string, currentUserId: string): Promise<ConversationDetails | null> {
  const supabase = getSupabaseBrowser();
  // A shared conversation is a legitimate shared context: a blocked person stays
  // a participant and their name must remain readable in the roster and on their
  // existing messages. The profiles embed returns null for them (058 hides the
  // row both ways), so 074's narrow, participant-gated identity RPC fills only
  // that gap. The normal profile stays unreadable.
  const [{ data: conversation, error }, { data: participantRows }, identities] = await Promise.all([
    supabase
      .from("conversations")
      .select("id, type, name, avatar_url, club_id, created_by, clubs(id, name, avatar_url)")
      .eq("id", conversationId)
      .maybeSingle(),
    supabase
      .from("conversation_participants")
      .select("user_id, joined_at, profiles!user_id(username, full_name, avatar_url)")
      .eq("conversation_id", conversationId),
    conversationSharedIdentities(conversationId),
  ]);
  if (error) throw error;
  if (!conversation) return null;
  const participants = ((participantRows ?? []) as any[]).map((participant) => {
    if (participant.profiles) return participant;
    const shared = identities.get(participant.user_id);
    return shared
      ? {
          ...participant,
          profiles: {
            username: shared.username,
            full_name: shared.full_name,
            avatar_url: shared.avatar_url,
          },
        }
      : participant;
  });
  const other = participants.find((participant) => participant.user_id !== currentUserId);
  const raw = conversation as any;
  const name = raw.type === "direct"
    ? other ? displayName(other.profiles) : "Deleted account"
    : raw.type === "club_group" || raw.type === "officer_chat"
      ? `${raw.clubs?.name ?? raw.name ?? "Club"} · ${raw.type === "officer_chat" ? "Officers" : "Members"}`
      : raw.name?.trim() || "Group chat";
  const roleRows = raw.club_id
    ? await supabase.from("club_members").select("user_id, role").eq("club_id", raw.club_id)
    : { data: [] as any[] };
  const roles = new Map<string, string>((roleRows.data ?? []).map((row: any): [string, string] => [row.user_id, row.role === "officer" ? "Officer" : "Member"]));
  return {
    id: raw.id,
    type: raw.type,
    name,
    avatar_url: raw.type === "direct" ? other?.profiles?.avatar_url ?? null : raw.clubs?.avatar_url ?? raw.avatar_url ?? null,
    club_id: raw.club_id ?? null,
    created_by: raw.created_by ?? null,
    participants: participants.map((participant) => ({
      user_id: participant.user_id,
      username: participant.profiles?.username ?? "",
      full_name: participant.profiles?.full_name ?? null,
      avatar_url: participant.profiles?.avatar_url ?? null,
      joined_at: participant.joined_at,
      role: roles.get(participant.user_id) ?? "Member",
    })),
  };
}

export async function getChannels(conversationId: string): Promise<Channel[]> {
  const { data, error } = await getSupabaseBrowser()
    .from("conversation_channels")
    .select("id, conversation_id, name, kind, avatar_url, post_permission, display_order")
    .eq("conversation_id", conversationId)
    .order("display_order", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as any[]).map((row) => ({ ...row, post_permission: row.post_permission as PostingPermission }));
}

export async function getConversationHub(conversationId: string, userId: string): Promise<ChannelPreview[]> {
  const supabase = getSupabaseBrowser();
  const channels = await getChannels(conversationId);
  if (!channels.length) return [];
  const { data: reads } = await supabase
    .from("channel_reads")
    .select("channel_id, last_read_at")
    .eq("user_id", userId)
    .in("channel_id", channels.map((channel) => channel.id));
  const readAt = new Map((reads ?? []).map((row: any) => [row.channel_id, row.last_read_at]));
  return Promise.all(channels.map(async (channel) => {
    const [{ data: latest, error: latestError }, { count, error: countError }] = await Promise.all([
      supabase.from("messages").select("content, message_type, created_at, profiles!sender_id(username, full_name)").eq("channel_id", channel.id).order("created_at", { ascending: false }).limit(1),
      (() => {
        let query = supabase.from("messages").select("id", { count: "exact", head: true }).eq("channel_id", channel.id).neq("sender_id", userId);
        const last = readAt.get(channel.id);
        if (last) query = query.gt("created_at", last);
        return query;
      })(),
    ]);
    if (latestError) throw latestError;
    if (countError) throw countError;
    const last = (latest ?? [])[0] as any;
    return {
      ...channel,
      last_preview: previewForMessage(last ?? null),
      last_sender: last ? displayName(last.profiles) : null,
      last_at: last?.created_at ?? null,
      unread_count: count ?? 0,
    };
  }));
}

/**
 * One page of a thread, with the SAME visibility rules mobile applies.
 *
 * Unsent messages are already excluded by RLS (migration 067). Delete-for-me
 * and the conversation-delete watermark are not, and are applied here through
 * the shared contract so the two platforms cannot diverge again.
 */
export async function getThread(conversationId: string, channelId: string | null, userId: string, cursor?: string): Promise<ThreadPage> {
  const supabase = getSupabaseBrowser();
  let query = threadFilter(
    supabase
      .from("messages")
      .select("id, conversation_id, channel_id, sender_id, content, attachment_url, attachment_name, attachment_size, attachment_mime, message_type, shared_event_id, shared_post_id, client_tag, created_at, polls(id), profiles!sender_id(id, username, full_name, avatar_url)")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(PAGE_SIZE),
    channelId
  );
  if (cursor) query = query.lt("created_at", cursor);
  const [{ data, error }, visibility, identities] = await Promise.all([
    query,
    loadThreadVisibility(supabase, conversationId, userId),
    conversationSharedIdentities(conversationId),
  ]);
  if (error) throw error;
  const raw = (data ?? []) as any[];
  const rows = applyThreadVisibility(raw, visibility);
  return {
    messages: rows.map((row) => messageFromRow(row, identities)),
    // Cursor is derived from the RAW page: a page whose rows were all hidden
    // must still advance, or the history would appear to end there.
    next_cursor: raw.length === PAGE_SIZE ? raw[raw.length - 1].created_at : null,
  };
}

/** Product floor for every Suggested section (empty Single, New message, New
 * group chat). The server returns fewer only when fewer accounts are eligible. */
export const MESSAGE_SUGGESTION_LIMIT = 10;

export async function getMessageSuggestions(): Promise<Person[]> {
  const { data, error } = await getSupabaseBrowser().rpc("get_message_suggestions", {
    p_limit: MESSAGE_SUGGESTION_LIMIT,
  });
  if (error) throw error;
  return ((data ?? []) as any[]).map((row) => ({ user_id: row.user_id, username: row.username, full_name: row.full_name ?? null, avatar_url: row.avatar_url ?? null }));
}

export async function searchMessagePeople(query: string): Promise<Person[]> {
  const value = query.trim();
  if (value.length < 3) return [];
  const { data, error } = await getSupabaseBrowser().rpc("search_message_people", { p_query: value, p_limit: 20 });
  if (error) throw error;
  return ((data ?? []) as any[]).map((row) => ({ user_id: row.user_id, username: row.username, full_name: row.full_name ?? null, avatar_url: row.avatar_url ?? null }));
}

export async function searchMessageContent(query: string, conversationId: string | null): Promise<MessageSearchResult[]> {
  const value = query.trim();
  if (value.length < 3) return [];
  const { data, error } = await getSupabaseBrowser().rpc("search_message_content", {
    p_query: value,
    p_conversation_id: conversationId,
    p_limit: 30,
  });
  if (error) throw error;
  return ((data ?? []) as any[]).map((row) => ({
    message_id: row.message_id,
    conversation_id: row.conversation_id,
    channel_id: row.channel_id ?? null,
    content: row.content ?? null,
    message_type: row.message_type as MessageType,
    created_at: row.created_at,
    sender_id: row.sender_id ?? null,
    username: row.username ?? null,
    full_name: row.full_name ?? null,
  }));
}

export async function getMessagePerson(userId: string): Promise<Person | null> {
  const { data, error } = await getSupabaseBrowser()
    .from("profiles")
    .select("id, username, full_name, avatar_url")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const person = data as any;
  return { user_id: person.id, username: person.username, full_name: person.full_name ?? null, avatar_url: person.avatar_url ?? null };
}

export async function getOrCreateDirectConversation(userId: string): Promise<string> {
  const { data, error } = await getSupabaseBrowser().rpc("get_or_create_direct_chat", { other_user_id: userId });
  if (error) throw error;
  return data as string;
}

/** Restores an official chat only after the database verifies the viewer's
 * current club role. This is the web equivalent of mobile's club-profile
 * hand-off; the browser never writes membership rows to open a chat. */
export async function reopenClubConversation(clubId: string, type: "club_group" | "officer_chat"): Promise<string> {
  const { data, error } = await getSupabaseBrowser().rpc("reopen_club_chat", { p_club_id: clubId, p_type: type });
  if (error) throw error;
  return data as string;
}

/** The Main channel is a stable, explicit destination for an official club
 * chat. It is never chosen by recency or an arbitrary first-row fallback. */
export async function getMainConversationChannel(conversationId: string): Promise<string | null> {
  const { data, error } = await getSupabaseBrowser()
    .from("conversation_channels")
    .select("id")
    .eq("conversation_id", conversationId)
    .eq("kind", "main")
    .maybeSingle();
  if (error) throw error;
  return (data as any)?.id ?? null;
}

export async function createGroupConversation(participantIds: string[], name: string | null, firstMessage: string, clientTag: string): Promise<string> {
  const { data, error } = await getSupabaseBrowser().rpc("create_group_chat", {
    p_name: name,
    p_participant_ids: participantIds,
    p_first_message: firstMessage,
    p_client_tag: clientTag,
  });
  if (error) throw error;
  return data as string;
}

export function clientTag(): string {
  return crypto.randomUUID();
}

export async function sendMessage(input: {
  conversationId: string;
  channelId: string | null;
  content?: string | null;
  messageType?: "text" | "image" | "video" | "file";
  attachment?: { path: string; name: string | null; size: number; mime: string } | null;
  tag?: string;
}): Promise<void> {
  const senderId = await requireUserId();
  const tag = input.tag ?? clientTag();
  const { error } = await getSupabaseBrowser().from("messages").insert({
    conversation_id: input.conversationId,
    channel_id: input.channelId,
    sender_id: senderId,
    content: input.content?.trim() || null,
    message_type: input.messageType ?? "text",
    attachment_url: input.attachment?.path ?? null,
    attachment_name: input.attachment?.name ?? null,
    attachment_size: input.attachment?.size ?? null,
    attachment_mime: input.attachment?.mime ?? null,
    client_tag: tag,
  });
  // Same retry contract as mobile: a lost response may have stored the row, and
  // the unique (sender_id, client_tag) index turns the retry into a no-op rather
  // than a duplicate message.
  if (error && (error as { code?: string }).code === "23505") return;
  if (error) throw error;
}

/** Sends the same canonical shared_event reference used by the mobile share
 * sheet.  No event title or internal data is copied into the message. */
export async function shareEventToConversation(input: {
  conversationId: string;
  channelId: string | null;
  eventId: string;
  tag?: string;
}): Promise<void> {
  const senderId = await requireUserId();
  const { error } = await getSupabaseBrowser().from("messages").insert({
    conversation_id: input.conversationId,
    channel_id: input.channelId,
    sender_id: senderId,
    message_type: "shared_event",
    shared_event_id: input.eventId,
    client_tag: input.tag ?? clientTag(),
  });
  if (error && (error as { code?: string }).code === "23505") return;
  if (error) throw error;
}

export type ShareableContent =
  | { type: "event"; id: string }
  | { type: "post"; id: string };

/** Delivers the same structured share references used by mobile. */
export async function shareContentToConversation(input: {
  conversationId: string;
  senderId: string;
  content: ShareableContent;
}): Promise<void> {
  const channelId = await getMainConversationChannel(input.conversationId);
  const payload = input.content.type === "event"
    ? { shared_event_id: input.content.id, message_type: "shared_event" as const }
    : { shared_post_id: input.content.id, message_type: "shared_post" as const };
  const { error } = await getSupabaseBrowser().from("messages").insert({
    conversation_id: input.conversationId,
    channel_id: channelId,
    sender_id: input.senderId,
    ...payload,
    client_tag: clientTag(),
  });
  if (error) throw error;
}

export async function uploadAttachment(conversationId: string, file: File): Promise<{ path: string; name: string; size: number; mime: string; type: "image" | "video" | "file" }> {
  if (file.size > 25 * 1024 * 1024) throw new Error("This file is larger than 25 MB.");
  const type = file.type.startsWith("image/") ? "image" : file.type.startsWith("video/") ? "video" : "file";
  const extension = file.name.includes(".") ? file.name.split(".").pop()!.toLowerCase().slice(0, 8) : "bin";
  const path = `${conversationId}/${clientTag()}.${extension}`;
  const { error } = await getSupabaseBrowser().storage.from(CHAT_ATTACHMENT_BUCKET).upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
  if (error) throw error;
  return { path, name: file.name, size: file.size, mime: file.type || "application/octet-stream", type };
}

/**
 * Attachment delivery. AUTHORIZATION IS CHECKED WHEN THE FILE IS FETCHED.
 *
 * This used to call `createSignedUrl`. A Supabase signed URL is a
 * self-contained token: Storage validates the signature and the expiry and
 * serves the object WITHOUT re-evaluating the bucket's RLS policy. That was
 * demonstrated, not assumed — a link minted while the viewer was authorized
 * still returned HTTP 200 with the bytes after the sender blocked them.
 *
 * `download()` issues GET /storage/v1/object/authenticated/... carrying the
 * viewer's own access token, so the `chat-attachments` SELECT policy — and
 * therefore 074's blocking check — runs on EVERY request. A blocked viewer is
 * refused immediately, with no window and nothing to replay.
 *
 * The returned value is a same-origin blob: URL. It is not a credential and
 * cannot be handed to anyone else: it only resolves inside this browsing
 * context, and it dies with the tab. Callers must revoke it (see
 * `releaseAttachmentUrl`) so the blob is not retained after the message
 * unmounts or access changes.
 *
 * What this does NOT do, and does not claim to do: recall a file the viewer
 * already downloaded, screenshotted or re-shared before the block. Nothing
 * server-side can.
 */
export async function attachmentObjectUrl(path: string | null): Promise<string | null> {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  const { data, error } = await getSupabaseBrowser().storage.from(CHAT_ATTACHMENT_BUCKET).download(path);
  if (error) throw error;
  if (!data) return null;
  return URL.createObjectURL(data);
}

/** Frees a blob: URL created by `attachmentObjectUrl`. Safe to call with null. */
export function releaseAttachmentUrl(url: string | null | undefined): void {
  if (url && url.startsWith("blob:")) URL.revokeObjectURL(url);
}

export async function markConversationRead(conversationId: string): Promise<void> {
  const { error } = await getSupabaseBrowser().rpc("mark_conversation_read", { p_conversation_id: conversationId });
  if (error) throw error;
}

export async function markChannelRead(channelId: string): Promise<void> {
  const { error } = await getSupabaseBrowser().rpc("mark_channel_read", { p_channel_id: channelId });
  if (error) throw error;
}

export async function canPostInChannel(channelId: string): Promise<boolean> {
  const { data, error } = await getSupabaseBrowser().rpc("can_post_in_channel", { p_channel_id: channelId });
  if (error) throw error;
  return data === true;
}

export async function setConversationMuted(conversationId: string, muted: boolean): Promise<void> {
  const { error } = await getSupabaseBrowser().rpc("set_conversation_muted", { p_conversation_id: conversationId, p_muted: muted });
  if (error) throw error;
}

/** Archive / unarchive for this viewer only — the same per-user RPC mobile
 *  calls from the group info screen's Archive action. */
export async function setConversationArchived(conversationId: string, archived: boolean): Promise<void> {
  const { error } = await getSupabaseBrowser().rpc("set_conversation_archived", { p_conversation_id: conversationId, p_archived: archived });
  if (error) throw error;
}

/**
 * Direct-chat "Delete" — delete-for-me on a whole conversation.
 *
 * Byte-for-byte the mobile contract (`hideConversationForMe`): it removes the
 * conversation from THIS user's inbox and sets the `cleared_before` watermark
 * so their copy of the history stays hidden, while the other participant keeps
 * theirs. A new message from either side restores it. It is NOT a delete for
 * everyone, and it must never be presented as one.
 */
export async function deleteDirectConversationForMe(conversationId: string, userId: string): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await getSupabaseBrowser()
    .from("conversation_participants")
    .update({ hidden_at: now, cleared_before: now })
    .eq("conversation_id", conversationId)
    .eq("user_id", userId);
  if (error) throw error;
}

export async function setChannelMuted(channelId: string, muted: boolean): Promise<void> {
  const { error } = await getSupabaseBrowser().rpc("set_channel_muted", { p_channel_id: channelId, p_muted: muted });
  if (error) throw error;
}

export async function getChannelMuted(channelId: string, userId: string): Promise<boolean> {
  const { data, error } = await getSupabaseBrowser().from("channel_mutes").select("channel_id").eq("channel_id", channelId).eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return !!data;
}

export async function getConversationMuted(conversationId: string, userId: string): Promise<boolean> {
  return (await getConversationFlags(conversationId, userId)).muted;
}

/** This viewer's mute + archive flags, matching mobile's `getConversationFlags`. */
export async function getConversationFlags(conversationId: string, userId: string): Promise<{ muted: boolean; archived: boolean }> {
  const { data, error } = await getSupabaseBrowser()
    .from("conversation_participants")
    .select("muted_at, archived_at")
    .eq("conversation_id", conversationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  const row = data as { muted_at?: string | null; archived_at?: string | null } | null;
  return { muted: !!row?.muted_at, archived: !!row?.archived_at };
}

export async function createChannel(conversationId: string, name: string): Promise<string> {
  const { data, error } = await getSupabaseBrowser().rpc("create_conversation_channel", { p_conversation_id: conversationId, p_name: name, p_avatar_url: null });
  if (error) throw error;
  return data as string;
}

export async function renameChannel(channelId: string, name: string): Promise<void> {
  const { error } = await getSupabaseBrowser().rpc("rename_conversation_channel", { p_channel_id: channelId, p_name: name });
  if (error) throw error;
}

export async function deleteChannel(channelId: string): Promise<void> {
  const { error } = await getSupabaseBrowser().rpc("delete_conversation_channel", { p_channel_id: channelId });
  if (error) throw error;
}

/** The people currently allowed to post in a "certain people" channel. The
 *  permissions sheet must seed itself with these — opening it and saving without
 *  them would silently revoke everyone's posting access. */
export async function getChannelPosters(channelId: string): Promise<string[]> {
  const { data, error } = await getSupabaseBrowser().from("channel_posters").select("user_id").eq("channel_id", channelId);
  if (error) throw error;
  return ((data ?? []) as Array<{ user_id: string }>).map((row) => row.user_id);
}

export async function setChannelPostPermission(channelId: string, permission: PostingPermission, userIds: string[] = []): Promise<void> {
  const { error } = await getSupabaseBrowser().rpc("set_channel_post_permission", { p_channel_id: channelId, p_permission: permission, p_user_ids: permission === "certain" ? userIds : null });
  if (error) throw error;
}

export async function unsendMessage(messageId: string): Promise<void> {
  const { error } = await getSupabaseBrowser().functions.invoke("delete-message", {
    body: { messageId, idempotencyKey: crypto.randomUUID() },
  });
  if (error) throw error;
}

export async function hideMessage(messageId: string, userId: string): Promise<void> {
  const { error } = await getSupabaseBrowser().from("message_hides").upsert({ message_id: messageId, user_id: userId }, { onConflict: "message_id,user_id", ignoreDuplicates: true });
  if (error) throw error;
}

export async function reportMessage(messageId: string, reason: string, details?: string): Promise<void> {
  const { error } = await getSupabaseBrowser().rpc("report_message", { p_message_id: messageId, p_reason: reason, p_details: details ?? null });
  if (error) throw error;
}

export interface CreatePollInput {
  conversationId: string;
  channelId: string | null;
  question: string;
  options: string[];
  allowMultiple: boolean;
  /** ISO instant. Omitted / null = start immediately (mobile's rule). */
  startAt?: string | null;
  /** ISO instant. Omitted / null = no end time (mobile's rule). */
  endAt?: string | null;
}

/**
 * Creates a poll through the same `create_poll` RPC mobile uses — the RPC owns
 * the posting-permission check (migration 041 routes it through
 * can_post_in_channel), so poll permission automatically follows the chat's
 * current posting permission with no separate web rule.
 */
export async function createPoll(input: CreatePollInput): Promise<void> {
  const { error } = await getSupabaseBrowser().rpc("create_poll", {
    p_conversation_id: input.conversationId,
    p_channel_id: input.channelId,
    p_question: input.question,
    p_options: input.options,
    p_allow_multiple: input.allowMultiple,
    p_start_at: input.startAt ?? null,
    p_end_at: input.endAt ?? null,
    p_client_tag: clientTag(),
  });
  if (error) throw error;
}

export interface Poll {
  id: string;
  question: string;
  allow_multiple: boolean;
  start_at: string | null;
  end_at: string | null;
  options: Array<{ id: string; option_text: string; votes: number; selected: boolean }>;
}

export async function getPoll(pollId: string, userId: string): Promise<Poll | null> {
  const supabase = getSupabaseBrowser();
  const { data, error } = await supabase.from("polls").select("id, question, allow_multiple, start_at, end_at, poll_options(id, option_text, display_order, poll_votes(user_id))").eq("id", pollId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const raw = data as any;
  return {
    id: raw.id,
    question: raw.question,
    allow_multiple: raw.allow_multiple,
    start_at: raw.start_at,
    end_at: raw.end_at,
    options: (raw.poll_options ?? []).sort((a: any, b: any) => a.display_order - b.display_order).map((option: any) => ({
      id: option.id,
      option_text: option.option_text,
      votes: option.poll_votes?.length ?? 0,
      selected: (option.poll_votes ?? []).some((vote: any) => vote.user_id === userId),
    })),
  };
}

export async function votePoll(pollId: string, optionId: string): Promise<void> {
  const { error } = await getSupabaseBrowser().rpc("cast_poll_vote", { p_poll_id: pollId, p_option_id: optionId });
  if (error) throw error;
}

export interface SharedEvent {
  event_id: string;
  title: string;
  emoji: string | null;
  cover_image_url: string | null;
  event_date: string;
  start_time: string | null;
  location: string | null;
}

export async function getSharedEvents(conversationId: string, channelId: string | null, userId: string): Promise<SharedEvent[]> {
  const supabase = getSupabaseBrowser();
  const query = threadFilter(
    supabase.from("messages").select("id, created_at, shared_event_id, events!shared_event_id(id, title, emoji, cover_image_url, event_date, start_time, location)").eq("conversation_id", conversationId).eq("message_type", "shared_event").not("shared_event_id", "is", null).order("created_at", { ascending: false }).limit(100),
    channelId
  );
  const [{ data, error }, visibility] = await Promise.all([
    query,
    loadThreadVisibility(supabase, conversationId, userId),
  ]);
  if (error) throw error;
  const seen = new Set<string>();
  return applyThreadVisibility((data ?? []) as any[], visibility).flatMap((row) => {
    const event = row.events;
    if (!event || seen.has(event.id)) return [];
    seen.add(event.id);
    return [{ event_id: event.id, title: event.title, emoji: event.emoji ?? null, cover_image_url: event.cover_image_url ?? null, event_date: event.event_date, start_time: event.start_time ?? null, location: event.location ?? null }];
  });
}

/** Photos, videos, files and polls obey exactly the same deletion rules as the
 *  thread itself: an unsent item is gone by RLS, and a delete-for-me item must
 *  disappear from this panel too — otherwise a "deleted" photo stays one tab
 *  away from the person who deleted it. */
export async function getSharedMessages(conversationId: string, channelId: string | null, type: "image" | "video" | "file" | "poll", userId: string): Promise<ThreadMessage[]> {
  const supabase = getSupabaseBrowser();
  const query = threadFilter(
    supabase.from("messages").select("id, conversation_id, channel_id, sender_id, content, attachment_url, attachment_name, attachment_size, attachment_mime, message_type, shared_event_id, shared_post_id, client_tag, created_at, polls(id), profiles!sender_id(id, username, full_name, avatar_url)").eq("conversation_id", conversationId).eq("message_type", type).order("created_at", { ascending: false }).limit(100),
    channelId
  );
  const [{ data, error }, visibility, identities] = await Promise.all([
    query,
    loadThreadVisibility(supabase, conversationId, userId),
    conversationSharedIdentities(conversationId),
  ]);
  if (error) throw error;
  return applyThreadVisibility((data ?? []) as any[], visibility).map((row) => messageFromRow(row, identities));
}

/**
 * Shared-content availability, resolved by the same RLS the rest of the app
 * uses: a post or event whose author has blocked the viewer (or which was
 * deleted, or whose audience no longer includes the viewer) simply returns no
 * row. Mirrors mobile's PostShareCard/EventShareCard, which fetch the target
 * and fall back to an unavailable card when it resolves to nothing.
 *
 * Only the id is selected, so an inaccessible target never puts a caption,
 * image URL, location or any other payload on the wire.
 */
export async function sharedPostIsAvailable(postId: string): Promise<boolean> {
  const { data } = await getSupabaseBrowser()
    .from("posts")
    .select("id")
    .eq("id", postId)
    .maybeSingle();
  return !!data;
}

export async function sharedEventIsAvailable(eventId: string): Promise<boolean> {
  const { data } = await getSupabaseBrowser()
    .from("events")
    .select("id")
    .eq("id", eventId)
    .maybeSingle();
  return !!data;
}
