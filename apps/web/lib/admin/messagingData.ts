// ============================================================================
// Admin Dashboard — Day-4 messaging + notifications read access  (SERVER-ONLY)
// ============================================================================
// Same contract as data.ts / data2.ts / contentData.ts: requireSecureAdmin()
// FIRST, then read through the service-role client; CANONICAL tables only;
// counts computed live; NO full message bodies by default; deleted/redacted rows
// NEVER expose retained original content or attachments.
//
// CANONICAL SOURCES OF TRUTH (from supabase/migrations/*.sql — never types.ts):
//   • conversations            — id, type IN ('direct','group','club_group',
//                                'officer_chat'), club_id, name, avatar_url,
//                                created_by (040), deleted_at (040), created_at
//   • conversation_participants — (conversation_id, user_id) UNIQUE, joined_at,
//                                hidden_at/cleared_before (040),
//                                muted_at/archived_at (041). NO participant "role"
//                                column — a participant's authority is DERIVED
//                                (group creator = admin; club role via
//                                club_members.role = 'officer').
//   • conversation_channels     — id, conversation_id, name, display_order,
//                                is_default, is_restricted, created_by,
//                                created_at (025), kind IN ('main','channel')
//                                (041), avatar_url (041), post_permission IN
//                                ('everyone','officers','certain') (041).
//   • messages                  — id, conversation_id, channel_id, sender_id,
//                                content, message_type IN ('text','image','video',
//                                'poll','file','shared_event','shared_post'),
//                                attachment_url/name/size/mime (010/040),
//                                deleted_at/deleted_by (040), client_tag (040),
//                                created_at, updated_at.
//   • message_attachments       — ordered position 0..4 attachment metadata;
//                                attachment_* remains the position-0 legacy
//                                projection.
//   • message_reactions         — one participant reaction per message/user;
//                                read-only in this dashboard and never a
//                                moderation target of its own.
//   • polls / poll_options / poll_votes — canonical poll model.
//   • notifications             — id, user_id, type (FK notification_types),
//                                actor_id, entity_id, entity_type IN
//                                ('event','club','message'), read, message (033),
//                                route/read_at/seen_at/group_* (046), created_at.
//   • reports                   — message reports carry message_id,
//                                conversation_id, conversation_type, message_type,
//                                message_sender_id. Legacy content_snapshot /
//                                attachment_snapshot are scrubbed by Day 10F;
//                                private retained evidence is never surfaced here.
//   • club_members.role='officer' — the ONLY canonical officer authority.
//
// PRIVACY INVARIANTS (Day-4):
//   • Message list rows carry METADATA only. A short active-message preview is
//     shown only for currently-visible (deleted_at IS NULL) text messages.
//   • A message with deleted_at set is reported as deleted/redacted and its
//     content/attachment fields are forced to null — private retained evidence
//     is never read back here.
//   • Full private message bodies are NEVER returned by this module. The
//     recent-MFA gated reveal lives in messagingActions.ts.
// ============================================================================

if (typeof window !== "undefined") {
  throw new Error("lib/admin/messagingData.ts is server-only and must not be imported in the browser.");
}

import { createAdminClient } from "../supabase/admin";
import { requireSecureAdmin } from "./secureAdmin";
import { emailMap, universityNameMap, PAGE_SIZE } from "./data";
import type { Paginated } from "./data";

type Admin = ReturnType<typeof createAdminClient>;

function fmtIds(ids: string[]): string {
  return `(${ids.join(",")})`;
}

function textPreview(text: string | null, len = 120): string | null {
  if (!text) return null;
  const t = text.trim();
  if (!t) return null;
  return t.length > len ? `${t.slice(0, len)}…` : t;
}

// ── Conversation-type presentation ───────────────────────────────────────────

export type ConversationType = "direct" | "group" | "club_group" | "officer_chat";

export const CONVERSATION_TYPE_LABEL: Record<string, string> = {
  direct: "Direct message",
  group: "Custom group",
  club_group: "Club chat",
  officer_chat: "Official club chat",
};

/** Human-readable label with a graceful fallback for any unknown type. */
export function conversationTypeLabel(type: string): string {
  return CONVERSATION_TYPE_LABEL[type] ?? type;
}

// ── Small shared lookup maps ─────────────────────────────────────────────────

async function profileMap(admin: Admin, ids: (string | null)[]): Promise<Map<string, any>> {
  const map = new Map<string, any>();
  const unique = Array.from(new Set(ids.filter(Boolean))) as string[];
  if (unique.length === 0) return map;
  const { data } = await admin
    .from("profiles")
    .select("id, full_name, username, avatar_url, university_id")
    .in("id", unique);
  for (const p of (data ?? []) as any[]) map.set(p.id, p);
  return map;
}

async function clubMap(admin: Admin, ids: (string | null)[]): Promise<Map<string, any>> {
  const map = new Map<string, any>();
  const unique = Array.from(new Set(ids.filter(Boolean))) as string[];
  if (unique.length === 0) return map;
  const { data } = await admin
    .from("clubs")
    .select("id, name, handle, avatar_url, university_id")
    .in("id", unique);
  for (const c of (data ?? []) as any[]) map.set(c.id, c);
  return map;
}

/** Batched counts of child rows keyed by a parent-id column. */
async function childCounts(admin: Admin, table: string, parentCol: string, parentIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (parentIds.length === 0) return map;
  const { data } = await admin.from(table).select(parentCol).in(parentCol, parentIds);
  for (const r of (data ?? []) as any[]) {
    const key = r[parentCol];
    if (key) map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
}

/** Active (non-deleted) message counts per conversation. */
async function activeMessageCounts(admin: Admin, conversationIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (conversationIds.length === 0) return map;
  const { data } = await admin
    .from("messages")
    .select("conversation_id")
    .is("deleted_at", null)
    .in("conversation_id", conversationIds);
  for (const r of (data ?? []) as any[]) {
    if (r.conversation_id) map.set(r.conversation_id, (map.get(r.conversation_id) ?? 0) + 1);
  }
  return map;
}

/** Report counts per conversation (entity_type='message' grouped by conversation_id). */
async function conversationReportCounts(admin: Admin, conversationIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (conversationIds.length === 0) return map;
  const { data } = await admin
    .from("reports")
    .select("conversation_id")
    .eq("entity_type", "message")
    .in("conversation_id", conversationIds);
  for (const r of (data ?? []) as any[]) {
    if (r.conversation_id) map.set(r.conversation_id, (map.get(r.conversation_id) ?? 0) + 1);
  }
  return map;
}

async function allReportedConversationIds(admin: Admin): Promise<string[]> {
  const { data } = await admin
    .from("reports")
    .select("conversation_id")
    .eq("entity_type", "message")
    .not("conversation_id", "is", null)
    .limit(5000);
  return Array.from(new Set((data ?? []).map((r: any) => r.conversation_id).filter(Boolean)));
}

/** Bounded email→user-id resolver (mirrors the pattern in data.ts/contentData.ts). */
async function findUserIdsByEmail(admin: Admin, query: string, cap = 2000): Promise<string[]> {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const perPage = 200;
  const ids: string[] = [];
  let page = 1;
  let scanned = 0;
  while (scanned < cap) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error || !data?.users?.length) break;
    for (const u of data.users) if (u.email && u.email.toLowerCase().includes(needle)) ids.push(u.id);
    scanned += data.users.length;
    if (data.users.length < perPage) break;
    page += 1;
  }
  return ids;
}

/** Latest message time per conversation (last-activity column). */
async function lastActivityMap(admin: Admin, conversationIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (conversationIds.length === 0) return map;
  const { data } = await admin
    .from("messages")
    .select("conversation_id, created_at")
    .in("conversation_id", conversationIds)
    .order("created_at", { ascending: false })
    .limit(5000);
  for (const r of (data ?? []) as any[]) {
    if (r.conversation_id && !map.has(r.conversation_id)) map.set(r.conversation_id, r.created_at);
  }
  return map;
}

/** Conversation display title (uses stored name, else derives for DMs/groups). */
function conversationTitle(
  conv: { type: string; name: string | null; club_id: string | null },
  clubName: string | null,
  participantNames: string[]
): string {
  if (conv.name && conv.name.trim()) return conv.name.trim();
  if (conv.type === "direct") {
    return participantNames.length ? participantNames.join(" ↔ ") : "Direct message";
  }
  if (conv.type === "group") return "Untitled group";
  if (clubName) return clubName;
  return conversationTypeLabel(conv.type);
}

// ── Conversations list ───────────────────────────────────────────────────────

export interface AdminConversationRow {
  id: string;
  title: string;
  type: string;
  type_label: string;
  club_id: string | null;
  club_name: string | null;
  club_handle: string | null;
  creator_id: string | null;
  creator_username: string | null;
  participant_count: number;
  channel_count: number;
  message_count: number;
  report_count: number;
  last_activity: string | null;
  archived: boolean;
  created_at: string;
}

export interface ListConversationsParams {
  search?: string;
  type?: "all" | ConversationType;
  clubId?: string;
  state?: "all" | "active" | "archived";
  reports?: "all" | "reported";
  dateFrom?: string;
  dateTo?: string;
  sort?: "created_at";
  dir?: "asc" | "desc";
  page?: number;
}

export async function listConversations(params: ListConversationsParams = {}): Promise<Paginated<AdminConversationRow>> {
  await requireSecureAdmin();
  const admin = createAdminClient();

  const page = Math.max(1, params.page ?? 1);
  const dir = params.dir ?? "desc";
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  const search = params.search?.trim();

  let q = admin
    .from("conversations")
    .select("id, type, club_id, name, created_by, deleted_at, created_at", { count: "exact" });

  if (params.type && params.type !== "all") q = q.eq("type", params.type);
  if (params.clubId) q = q.eq("club_id", params.clubId);
  // "archived" here = soft-deleted-for-everyone (conversations.deleted_at).
  if (params.state === "active") q = q.is("deleted_at", null);
  if (params.state === "archived") q = q.not("deleted_at", "is", null);
  if (params.dateFrom) q = q.gte("created_at", params.dateFrom);
  if (params.dateTo) q = q.lte("created_at", params.dateTo);

  if (params.reports === "reported") {
    const ids = await allReportedConversationIds(admin);
    if (ids.length === 0) return { rows: [], total: 0, page, pageSize: PAGE_SIZE };
    q = q.in("id", ids);
  }

  if (search) {
    const like = `%${search}%`;
    const isEmail = search.includes("@");
    // Match by conversation name, club name/handle, or participant identity.
    const [{ data: clubs }, participantIds] = await Promise.all([
      admin.from("clubs").select("id").or(`name.ilike.${like},handle.ilike.${like}`).limit(500),
      (async () => {
        const userIds = isEmail
          ? await findUserIdsByEmail(admin, search)
          : ((await admin.from("profiles").select("id").or(`full_name.ilike.${like},username.ilike.${like}`).limit(500)).data ?? []).map(
              (p: any) => p.id
            );
        if (userIds.length === 0) return [] as string[];
        const { data } = await admin.from("conversation_participants").select("conversation_id").in("user_id", userIds).limit(5000);
        return Array.from(new Set((data ?? []).map((r: any) => r.conversation_id)));
      })(),
    ]);
    const clubIds = (clubs ?? []).map((c: any) => c.id);
    const parts: string[] = [];
    if (!isEmail) parts.push(`name.ilike.${like}`);
    if (clubIds.length) parts.push(`club_id.in.${fmtIds(clubIds)}`);
    if (participantIds.length) parts.push(`id.in.${fmtIds(participantIds)}`);
    if (parts.length === 0) return { rows: [], total: 0, page, pageSize: PAGE_SIZE };
    q = q.or(parts.join(","));
  }

  q = q.order("created_at", { ascending: dir === "asc" }).range(from, to);
  const { data, count, error } = await q;
  if (error) throw error;

  const convs = (data ?? []) as any[];
  const ids = convs.map((c) => c.id);
  const clubIds = convs.map((c) => c.club_id).filter(Boolean) as string[];
  const creatorIds = convs.map((c) => c.created_by).filter(Boolean) as string[];

  const [clubs, creators, participants, channels, messages, reports, activity, dmNames] = await Promise.all([
    clubMap(admin, clubIds),
    profileMap(admin, creatorIds),
    childCounts(admin, "conversation_participants", "conversation_id", ids),
    childCounts(admin, "conversation_channels", "conversation_id", ids),
    activeMessageCounts(admin, ids),
    conversationReportCounts(admin, ids),
    lastActivityMap(admin, ids),
    directParticipantNames(admin, convs.filter((c) => c.type === "direct" && !c.name).map((c) => c.id)),
  ]);

  const rows: AdminConversationRow[] = convs.map((c) => {
    const club = c.club_id ? clubs.get(c.club_id) : null;
    const creator = c.created_by ? creators.get(c.created_by) : null;
    return {
      id: c.id,
      title: conversationTitle(c, club?.name ?? null, dmNames.get(c.id) ?? []),
      type: c.type,
      type_label: conversationTypeLabel(c.type),
      club_id: c.club_id ?? null,
      club_name: club?.name ?? null,
      club_handle: club?.handle ?? null,
      creator_id: c.created_by ?? null,
      creator_username: creator?.username ?? null,
      participant_count: participants.get(c.id) ?? 0,
      channel_count: channels.get(c.id) ?? 0,
      message_count: messages.get(c.id) ?? 0,
      report_count: reports.get(c.id) ?? 0,
      last_activity: activity.get(c.id) ?? null,
      archived: !!c.deleted_at,
      created_at: c.created_at,
    };
  });

  return { rows, total: count ?? rows.length, page, pageSize: PAGE_SIZE };
}

/** Two participant usernames for each DM (to derive a "A ↔ B" title). */
async function directParticipantNames(admin: Admin, dmIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (dmIds.length === 0) return map;
  const { data } = await admin
    .from("conversation_participants")
    .select("conversation_id, user_id, profiles!inner(username)")
    .in("conversation_id", dmIds);
  for (const r of (data ?? []) as any[]) {
    const list = map.get(r.conversation_id) ?? [];
    if (r.profiles?.username) list.push(`@${r.profiles.username}`);
    map.set(r.conversation_id, list);
  }
  return map;
}

// ── Conversation detail ──────────────────────────────────────────────────────

export interface ConversationParticipant {
  user_id: string;
  full_name: string;
  username: string;
  email: string | null;
  avatar_url: string | null;
  role: string;
  joined_at: string;
  hidden: boolean;
  archived: boolean;
  muted: boolean;
  is_club_member: boolean | null;
  is_club_officer: boolean | null;
  eligibility: "ok" | "not_club_member" | "not_officer" | null;
}

export interface ConversationChannelSummary {
  id: string;
  name: string;
  kind: string;
  post_permission: string;
  is_restricted: boolean;
  message_count: number;
  report_count: number;
  created_at: string | null;
}

export interface ConversationMessageMeta {
  id: string;
  channel_id: string | null;
  channel_name: string | null;
  sender_id: string;
  sender_username: string;
  message_type: string;
  has_attachment: boolean;
  is_poll: boolean;
  preview: string | null;
  deleted: boolean;
  report_count: number;
  created_at: string;
}

export interface ConversationReportSummary {
  id: string;
  status: string;
  reason: string | null;
  message_id: string | null;
  reporter_username: string | null;
  created_at: string;
}

export interface ConversationDetail {
  id: string;
  title: string;
  type: string;
  type_label: string;
  club_id: string | null;
  club_name: string | null;
  club_handle: string | null;
  university: string | null;
  creator_id: string | null;
  creator_name: string | null;
  creator_username: string | null;
  archived: boolean;
  created_at: string;
  last_activity: string | null;
  participantCount: number;
  channelCount: number;
  messageCount: number;
  reportCount: number;
  openReportCount: number;
  participants: ConversationParticipant[];
  channels: ConversationChannelSummary[];
  recentMessages: ConversationMessageMeta[];
  reports: ConversationReportSummary[];
}

export async function getConversationDetail(id: string): Promise<ConversationDetail | null> {
  await requireSecureAdmin();
  const admin = createAdminClient();

  const { data: conv } = await admin
    .from("conversations")
    .select("id, type, club_id, name, created_by, deleted_at, created_at")
    .eq("id", id)
    .maybeSingle();
  if (!conv) return null;
  const c = conv as any;

  const [participantsRes, channelsRaw, messagesRaw, reportsRes, club, creatorMap, activity] = await Promise.all([
    admin
      .from("conversation_participants")
      .select("user_id, joined_at, hidden_at, archived_at, muted_at, profiles!inner(full_name, username, avatar_url)")
      .eq("conversation_id", id)
      .order("joined_at", { ascending: true })
      .limit(1000),
    admin
      .from("conversation_channels")
      .select("id, name, kind, post_permission, is_restricted, created_at, display_order")
      .eq("conversation_id", id)
      .order("display_order", { ascending: true })
      .limit(200),
    admin
      .from("messages")
      .select("id, channel_id, sender_id, message_type, content, attachment_url, deleted_at, created_at, profiles!inner(username)")
      .eq("conversation_id", id)
      .order("created_at", { ascending: false })
      .limit(30),
    admin
      .from("reports")
      .select("id, status, reason, message_id, reporter_username, created_at")
      .eq("entity_type", "message")
      .eq("conversation_id", id)
      .order("created_at", { ascending: false })
      .limit(200),
    c.club_id ? clubMap(admin, [c.club_id]) : Promise.resolve(new Map<string, any>()),
    c.created_by ? profileMap(admin, [c.created_by]) : Promise.resolve(new Map<string, any>()),
    lastActivityMap(admin, [id]),
  ]);

  const participantsRows = (participantsRes.data ?? []) as any[];
  const userIds = participantsRows.map((p) => p.user_id);
  const emails = await emailMap(userIds);

  // Club membership/officer eligibility (only meaningful for club conversations).
  let clubRoleByUser = new Map<string, string>();
  if (c.club_id) {
    const { data: cm } = await admin.from("club_members").select("user_id, role").eq("club_id", c.club_id).in("user_id", userIds.length ? userIds : ["_"]);
    for (const m of (cm ?? []) as any[]) clubRoleByUser.set(m.user_id, m.role);
  }

  const channelIds = (channelsRaw.data ?? []).map((ch: any) => ch.id);
  const [channelMsgCounts, channelReportCounts, channelNameById] = await Promise.all([
    activeChannelMessageCounts(admin, channelIds),
    channelReportCountsMap(admin, channelIds),
    (async () => {
      const m = new Map<string, string>();
      for (const ch of (channelsRaw.data ?? []) as any[]) m.set(ch.id, ch.name);
      return m;
    })(),
  ]);

  // Per-recent-message report counts.
  const msgIds = (messagesRaw.data ?? []).map((m: any) => m.id);
  const msgReportCounts = await messageReportCountsMap(admin, msgIds);

  const clubRow = c.club_id ? club.get(c.club_id) : null;
  const creator = c.created_by ? creatorMap.get(c.created_by) : null;
  const uniId = clubRow?.university_id ?? null;
  const uniName = uniId ? (await universityNameMap(admin, [uniId])).get(uniId) ?? null : null;

  const participants: ConversationParticipant[] = participantsRows.map((p) => {
    const role = participantRole(c, p.user_id, clubRoleByUser.get(p.user_id) ?? null);
    let isMember: boolean | null = null;
    let isOfficer: boolean | null = null;
    let eligibility: ConversationParticipant["eligibility"] = null;
    if (c.club_id) {
      const cr = clubRoleByUser.get(p.user_id) ?? null;
      isMember = cr !== null;
      isOfficer = cr === "officer";
      if (c.type === "club_group") eligibility = isMember ? "ok" : "not_club_member";
      else if (c.type === "officer_chat") eligibility = isOfficer ? "ok" : "not_officer";
    }
    return {
      user_id: p.user_id,
      full_name: p.profiles?.full_name ?? "",
      username: p.profiles?.username ?? "",
      email: emails.get(p.user_id) ?? null,
      avatar_url: p.profiles?.avatar_url ?? null,
      role,
      joined_at: p.joined_at,
      hidden: !!p.hidden_at,
      archived: !!p.archived_at,
      muted: !!p.muted_at,
      is_club_member: isMember,
      is_club_officer: isOfficer,
      eligibility,
    };
  });

  const channels: ConversationChannelSummary[] = ((channelsRaw.data ?? []) as any[]).map((ch) => ({
    id: ch.id,
    name: ch.name,
    kind: ch.kind ?? "channel",
    post_permission: ch.post_permission ?? "everyone",
    is_restricted: !!ch.is_restricted,
    message_count: channelMsgCounts.get(ch.id) ?? 0,
    report_count: channelReportCounts.get(ch.id) ?? 0,
    created_at: ch.created_at ?? null,
  }));

  const recentMessages: ConversationMessageMeta[] = ((messagesRaw.data ?? []) as any[]).map((m) => shapeMessageMeta(m, channelNameById.get(m.channel_id ?? "") ?? null, msgReportCounts.get(m.id) ?? 0));

  const reports = ((reportsRes.data ?? []) as any[]).map((r) => ({
    id: r.id,
    status: r.status,
    reason: r.reason ?? null,
    message_id: r.message_id ?? null,
    reporter_username: r.reporter_username ?? null,
    created_at: r.created_at,
  }));

  const messageCount = (await activeMessageCounts(admin, [id])).get(id) ?? 0;
  const dmNames = c.type === "direct" && !c.name ? (await directParticipantNames(admin, [id])).get(id) ?? [] : [];

  return {
    id: c.id,
    title: conversationTitle(c, clubRow?.name ?? null, dmNames),
    type: c.type,
    type_label: conversationTypeLabel(c.type),
    club_id: c.club_id ?? null,
    club_name: clubRow?.name ?? null,
    club_handle: clubRow?.handle ?? null,
    university: uniName,
    creator_id: c.created_by ?? null,
    creator_name: creator?.full_name ?? null,
    creator_username: creator?.username ?? null,
    archived: !!c.deleted_at,
    created_at: c.created_at,
    last_activity: activity.get(id) ?? null,
    participantCount: participants.length,
    channelCount: channels.length,
    messageCount,
    reportCount: reports.length,
    openReportCount: reports.filter((r) => r.status === "pending" || r.status === "reviewing").length,
    participants,
    channels,
    recentMessages,
    reports,
  };
}

/** Derive a participant's authority label (no participant.role column exists). */
function participantRole(conv: { type: string; created_by: string | null }, userId: string, clubRole: string | null): string {
  if (conv.type === "group") return conv.created_by === userId ? "Group admin" : "Member";
  if (conv.type === "club_group") return clubRole === "officer" ? "Officer" : clubRole === "member" ? "Member" : "Participant";
  if (conv.type === "officer_chat") return "Officer";
  if (conv.type === "direct") return "Participant";
  return "Participant";
}

/** Force a metadata-only, privacy-safe shape for one message row. */
function shapeMessageMeta(m: any, channelName: string | null, reportCount: number): ConversationMessageMeta {
  const deleted = !!m.deleted_at;
  return {
    id: m.id,
    channel_id: m.channel_id ?? null,
    channel_name: channelName,
    sender_id: m.sender_id,
    sender_username: m.profiles?.username ?? "",
    message_type: m.message_type,
    // Deleted rows: never reveal that retained content/attachments existed.
    has_attachment: deleted ? false : !!m.attachment_url,
    is_poll: m.message_type === "poll",
    // Only currently-visible plain-text messages get a short preview.
    preview: deleted ? null : m.message_type === "text" ? textPreview(m.content, 100) : null,
    deleted,
    report_count: reportCount,
    created_at: m.created_at,
  };
}

async function activeChannelMessageCounts(admin: Admin, channelIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (channelIds.length === 0) return map;
  const { data } = await admin.from("messages").select("channel_id").is("deleted_at", null).in("channel_id", channelIds);
  for (const r of (data ?? []) as any[]) if (r.channel_id) map.set(r.channel_id, (map.get(r.channel_id) ?? 0) + 1);
  return map;
}

async function channelReportCountsMap(admin: Admin, channelIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (channelIds.length === 0) return map;
  // Reports carry message_id; resolve which reported messages belong to each channel.
  const { data: reported } = await admin.from("reports").select("message_id").eq("entity_type", "message").not("message_id", "is", null).limit(5000);
  const reportedIds = Array.from(new Set((reported ?? []).map((r: any) => r.message_id)));
  if (reportedIds.length === 0) return map;
  const { data: msgs } = await admin.from("messages").select("channel_id").in("id", reportedIds).in("channel_id", channelIds);
  for (const r of (msgs ?? []) as any[]) if (r.channel_id) map.set(r.channel_id, (map.get(r.channel_id) ?? 0) + 1);
  return map;
}

async function messageReportCountsMap(admin: Admin, messageIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (messageIds.length === 0) return map;
  const { data } = await admin.from("reports").select("message_id").eq("entity_type", "message").in("message_id", messageIds);
  for (const r of (data ?? []) as any[]) if (r.message_id) map.set(r.message_id, (map.get(r.message_id) ?? 0) + 1);
  return map;
}

// ── Channels list ────────────────────────────────────────────────────────────

export interface AdminChannelRow {
  id: string;
  name: string;
  kind: string;
  conversation_id: string;
  conversation_title: string;
  conversation_type: string;
  conversation_type_label: string;
  club_id: string | null;
  club_name: string | null;
  post_permission: string;
  is_restricted: boolean;
  message_count: number;
  report_count: number;
  archived: boolean;
  created_at: string | null;
}

export interface ListChannelsParams {
  search?: string;
  conversationId?: string;
  clubId?: string;
  kind?: "all" | "main" | "channel";
  permission?: "all" | "everyone" | "officers" | "certain";
  state?: "all" | "active" | "archived";
  sort?: "created_at" | "display_order";
  dir?: "asc" | "desc";
  page?: number;
}

export async function listChannels(params: ListChannelsParams = {}): Promise<Paginated<AdminChannelRow>> {
  await requireSecureAdmin();
  const admin = createAdminClient();

  const page = Math.max(1, params.page ?? 1);
  const dir = params.dir ?? "desc";
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  const search = params.search?.trim();
  const sort = params.sort ?? "created_at";

  let q = admin
    .from("conversation_channels")
    .select("id, conversation_id, name, kind, post_permission, is_restricted, created_at, display_order", { count: "exact" });

  if (params.conversationId) q = q.eq("conversation_id", params.conversationId);
  if (params.kind && params.kind !== "all") q = q.eq("kind", params.kind);
  if (params.permission && params.permission !== "all") q = q.eq("post_permission", params.permission);

  // Club / conversation-name search resolves to a conversation-id set.
  if (params.clubId || search) {
    let convQ = admin.from("conversations").select("id, name, club_id");
    if (params.clubId) convQ = convQ.eq("club_id", params.clubId);
    const { data: convs } = await convQ.limit(5000);
    let convRows = (convs ?? []) as any[];

    if (search) {
      const like = `%${search}%`;
      const { data: clubs } = await admin.from("clubs").select("id").or(`name.ilike.${like},handle.ilike.${like}`).limit(500);
      const clubIds = new Set((clubs ?? []).map((c: any) => c.id));
      const s = search.toLowerCase();
      // Channel-name match happens on the base query via .or below; here we also
      // include conversations matched by name or club.
      const matchedConvIds = convRows
        .filter((cv) => (cv.name && cv.name.toLowerCase().includes(s)) || (cv.club_id && clubIds.has(cv.club_id)))
        .map((cv) => cv.id);
      const parts: string[] = [`name.ilike.${like}`];
      if (matchedConvIds.length) parts.push(`conversation_id.in.${fmtIds(matchedConvIds)}`);
      q = q.or(parts.join(","));
    } else if (params.clubId) {
      const convIds = convRows.map((cv) => cv.id);
      if (convIds.length === 0) return { rows: [], total: 0, page, pageSize: PAGE_SIZE };
      q = q.in("conversation_id", convIds);
    }
  }

  q = q.order(sort, { ascending: dir === "asc" }).range(from, to);
  const { data, count, error } = await q;
  if (error) throw error;

  const channels = (data ?? []) as any[];
  const ids = channels.map((ch) => ch.id);
  const convIds = Array.from(new Set(channels.map((ch) => ch.conversation_id)));

  const [convMap, msgCounts, reportCounts] = await Promise.all([
    conversationLiteMap(admin, convIds),
    activeChannelMessageCounts(admin, ids),
    channelReportCountsMap(admin, ids),
  ]);
  const clubIds = Array.from(new Set([...convMap.values()].map((cv) => cv.club_id).filter(Boolean))) as string[];
  const clubs = await clubMap(admin, clubIds);

  const rows: AdminChannelRow[] = channels
    .map((ch) => {
      const cv = convMap.get(ch.conversation_id);
      if (!cv) return null;
      const club = cv.club_id ? clubs.get(cv.club_id) : null;
      const archived = !!cv.deleted_at;
      return {
        id: ch.id,
        name: ch.name,
        kind: ch.kind ?? "channel",
        conversation_id: ch.conversation_id,
        conversation_title: conversationTitle(cv, club?.name ?? null, []),
        conversation_type: cv.type,
        conversation_type_label: conversationTypeLabel(cv.type),
        club_id: cv.club_id ?? null,
        club_name: club?.name ?? null,
        post_permission: ch.post_permission ?? "everyone",
        is_restricted: !!ch.is_restricted,
        message_count: msgCounts.get(ch.id) ?? 0,
        report_count: reportCounts.get(ch.id) ?? 0,
        archived,
        created_at: ch.created_at ?? null,
      } as AdminChannelRow;
    })
    .filter(Boolean) as AdminChannelRow[];

  // Active/archived state filter (derived from parent conversation.deleted_at).
  const filtered =
    params.state === "active" ? rows.filter((r) => !r.archived) : params.state === "archived" ? rows.filter((r) => r.archived) : rows;

  return { rows: filtered, total: count ?? filtered.length, page, pageSize: PAGE_SIZE };
}

async function conversationLiteMap(admin: Admin, ids: string[]): Promise<Map<string, any>> {
  const map = new Map<string, any>();
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (unique.length === 0) return map;
  const { data } = await admin.from("conversations").select("id, type, name, club_id, deleted_at, created_by").in("id", unique);
  for (const c of (data ?? []) as any[]) map.set(c.id, c);
  return map;
}

// ── Channel detail ───────────────────────────────────────────────────────────

export interface ChannelDetail {
  id: string;
  name: string;
  kind: string;
  conversation_id: string;
  conversation_title: string;
  conversation_type: string;
  conversation_type_label: string;
  club_id: string | null;
  club_name: string | null;
  club_handle: string | null;
  university: string | null;
  creator_id: string | null;
  creator_username: string | null;
  post_permission: string;
  is_restricted: boolean;
  allowed_posters: { user_id: string; full_name: string; username: string; avatar_url: string | null }[];
  archived: boolean;
  created_at: string | null;
  messageCount: number;
  reportCount: number;
  isEmpty: boolean;
  isMain: boolean;
  recentMessages: ConversationMessageMeta[];
}

export async function getChannelDetail(id: string): Promise<ChannelDetail | null> {
  await requireSecureAdmin();
  const admin = createAdminClient();

  const { data: ch } = await admin
    .from("conversation_channels")
    .select("id, conversation_id, name, kind, post_permission, is_restricted, created_by, created_at")
    .eq("id", id)
    .maybeSingle();
  if (!ch) return null;
  const channel = ch as any;

  const [convMap, postersRes, messagesRaw, creatorMap] = await Promise.all([
    conversationLiteMap(admin, [channel.conversation_id]),
    admin.from("channel_posters").select("user_id, profiles!inner(full_name, username, avatar_url)").eq("channel_id", id).limit(200),
    admin
      .from("messages")
      .select("id, channel_id, sender_id, message_type, content, attachment_url, deleted_at, created_at, profiles!inner(username)")
      .eq("channel_id", id)
      .order("created_at", { ascending: false })
      .limit(30),
    channel.created_by ? profileMap(admin, [channel.created_by]) : Promise.resolve(new Map<string, any>()),
  ]);

  const cv = convMap.get(channel.conversation_id);
  if (!cv) return null;
  const club = cv.club_id ? (await clubMap(admin, [cv.club_id])).get(cv.club_id) : null;
  const uniId = club?.university_id ?? null;
  const uniName = uniId ? (await universityNameMap(admin, [uniId])).get(uniId) ?? null : null;

  const msgIds = (messagesRaw.data ?? []).map((m: any) => m.id);
  const [msgCount, reportCount, msgReportCounts] = await Promise.all([
    activeChannelMessageCounts(admin, [id]),
    channelReportCountsMap(admin, [id]),
    messageReportCountsMap(admin, msgIds),
  ]);
  const totalChannelMessages = (await allChannelMessageCount(admin, id));

  const creator = channel.created_by ? creatorMap.get(channel.created_by) : null;

  const recentMessages: ConversationMessageMeta[] = ((messagesRaw.data ?? []) as any[]).map((m) =>
    shapeMessageMeta(m, channel.name, msgReportCounts.get(m.id) ?? 0)
  );

  return {
    id: channel.id,
    name: channel.name,
    kind: channel.kind ?? "channel",
    conversation_id: channel.conversation_id,
    conversation_title: conversationTitle(cv, club?.name ?? null, []),
    conversation_type: cv.type,
    conversation_type_label: conversationTypeLabel(cv.type),
    club_id: cv.club_id ?? null,
    club_name: club?.name ?? null,
    club_handle: club?.handle ?? null,
    university: uniName,
    creator_id: channel.created_by ?? null,
    creator_username: creator?.username ?? null,
    post_permission: channel.post_permission ?? "everyone",
    is_restricted: !!channel.is_restricted,
    allowed_posters: ((postersRes.data ?? []) as any[]).map((p) => ({
      user_id: p.user_id,
      full_name: p.profiles?.full_name ?? "",
      username: p.profiles?.username ?? "",
      avatar_url: p.profiles?.avatar_url ?? null,
    })),
    archived: !!cv.deleted_at,
    created_at: channel.created_at ?? null,
    messageCount: msgCount.get(id) ?? 0,
    reportCount: reportCount.get(id) ?? 0,
    isEmpty: totalChannelMessages === 0,
    isMain: (channel.kind ?? "channel") === "main",
    recentMessages,
  };
}

/** Count ALL messages (including soft-deleted) — used to decide "empty" for the
 * delete-empty lifecycle: a channel with any message row is never removable. */
async function allChannelMessageCount(admin: Admin, channelId: string): Promise<number> {
  const { count } = await admin.from("messages").select("id", { count: "exact", head: true }).eq("channel_id", channelId);
  return count ?? 0;
}

// ── Messages list (metadata-only) ────────────────────────────────────────────

export interface AdminMessageRow {
  id: string;
  sender_id: string;
  sender_username: string;
  conversation_id: string;
  conversation_title: string;
  conversation_type: string;
  conversation_type_label: string;
  channel_id: string | null;
  channel_name: string | null;
  message_type: string;
  has_attachment: boolean;
  is_poll: boolean;
  is_system: boolean;
  preview: string | null;
  report_count: number;
  deleted: boolean;
  edited: boolean;
  created_at: string;
}

export interface ListMessagesParams {
  search?: string;
  conversationId?: string;
  channelId?: string;
  type?: "all" | "text" | "image" | "video" | "poll" | "file" | "shared_event" | "shared_post";
  attachment?: "all" | "with" | "without";
  poll?: "all" | "poll";
  reports?: "all" | "reported";
  state?: "all" | "active" | "deleted";
  dateFrom?: string;
  dateTo?: string;
  sort?: "created_at";
  dir?: "asc" | "desc";
  page?: number;
}

const SHARED_TYPES = new Set(["shared_event", "shared_post"]);

export async function listMessages(params: ListMessagesParams = {}): Promise<Paginated<AdminMessageRow>> {
  await requireSecureAdmin();
  const admin = createAdminClient();

  const page = Math.max(1, params.page ?? 1);
  const dir = params.dir ?? "desc";
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  const search = params.search?.trim();

  let q = admin
    .from("messages")
    .select("id, conversation_id, channel_id, sender_id, message_type, content, attachment_url, deleted_at, created_at, updated_at", {
      count: "exact",
    });

  if (params.conversationId) q = q.eq("conversation_id", params.conversationId);
  if (params.channelId) q = q.eq("channel_id", params.channelId);
  if (params.type && params.type !== "all") q = q.eq("message_type", params.type);
  if (params.attachment === "with") q = q.not("attachment_url", "is", null);
  if (params.attachment === "without") q = q.is("attachment_url", null);
  if (params.poll === "poll") q = q.eq("message_type", "poll");
  if (params.state === "active") q = q.is("deleted_at", null);
  if (params.state === "deleted") q = q.not("deleted_at", "is", null);
  if (params.dateFrom) q = q.gte("created_at", params.dateFrom);
  if (params.dateTo) q = q.lte("created_at", params.dateTo);

  if (params.reports === "reported") {
    const { data: reported } = await admin
      .from("reports")
      .select("message_id")
      .eq("entity_type", "message")
      .not("message_id", "is", null)
      .limit(5000);
    const ids = Array.from(new Set((reported ?? []).map((r: any) => r.message_id)));
    if (ids.length === 0) return { rows: [], total: 0, page, pageSize: PAGE_SIZE };
    q = q.in("id", ids);
  }

  // Search is metadata-only here: sender identity or conversation/channel name.
  // (Message-CONTENT search lives behind the recent-MFA path in messagingActions.)
  if (search) {
    const like = `%${search}%`;
    const isEmail = search.includes("@");
    const senderIds = isEmail
      ? await findUserIdsByEmail(admin, search)
      : ((await admin.from("profiles").select("id").or(`full_name.ilike.${like},username.ilike.${like}`).limit(500)).data ?? []).map(
          (p: any) => p.id
        );
    // Conversations matched by name.
    const { data: convByName } = isEmail
      ? { data: [] as any[] }
      : await admin.from("conversations").select("id").ilike("name", like).limit(500);
    const convIds = (convByName ?? []).map((c: any) => c.id);
    const parts: string[] = [];
    if (senderIds.length) parts.push(`sender_id.in.${fmtIds(senderIds)}`);
    if (convIds.length) parts.push(`conversation_id.in.${fmtIds(convIds)}`);
    if (parts.length === 0) return { rows: [], total: 0, page, pageSize: PAGE_SIZE };
    q = q.or(parts.join(","));
  }

  q = q.order("created_at", { ascending: dir === "asc" }).range(from, to);
  const { data, count, error } = await q;
  if (error) throw error;

  const msgs = (data ?? []) as any[];
  const ids = msgs.map((m) => m.id);
  const senderIds = msgs.map((m) => m.sender_id);
  const convIds = Array.from(new Set(msgs.map((m) => m.conversation_id)));
  const channelIds = Array.from(new Set(msgs.map((m) => m.channel_id).filter(Boolean))) as string[];

  const [senders, convMap, channelNames, reportCounts] = await Promise.all([
    profileMap(admin, senderIds),
    conversationLiteMap(admin, convIds),
    channelNameMap(admin, channelIds),
    messageReportCountsMap(admin, ids),
  ]);
  const clubIds = Array.from(new Set([...convMap.values()].map((c) => c.club_id).filter(Boolean))) as string[];
  const clubs = await clubMap(admin, clubIds);

  const rows: AdminMessageRow[] = msgs.map((m) => {
    const cv = convMap.get(m.conversation_id);
    const club = cv?.club_id ? clubs.get(cv.club_id) : null;
    const deleted = !!m.deleted_at;
    const edited = !deleted && !!m.updated_at && !!m.created_at && new Date(m.updated_at).getTime() - new Date(m.created_at).getTime() > 1000;
    return {
      id: m.id,
      sender_id: m.sender_id,
      sender_username: senders.get(m.sender_id)?.username ?? "",
      conversation_id: m.conversation_id,
      conversation_title: cv ? conversationTitle(cv, club?.name ?? null, []) : "",
      conversation_type: cv?.type ?? "",
      conversation_type_label: cv ? conversationTypeLabel(cv.type) : "",
      channel_id: m.channel_id ?? null,
      channel_name: m.channel_id ? channelNames.get(m.channel_id) ?? null : null,
      message_type: m.message_type,
      has_attachment: deleted ? false : !!m.attachment_url,
      is_poll: m.message_type === "poll",
      is_system: SHARED_TYPES.has(m.message_type),
      preview: deleted ? null : m.message_type === "text" ? textPreview(m.content, 100) : null,
      report_count: reportCounts.get(m.id) ?? 0,
      deleted,
      edited,
      created_at: m.created_at,
    };
  });

  return { rows, total: count ?? rows.length, page, pageSize: PAGE_SIZE };
}

async function channelNameMap(admin: Admin, ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (unique.length === 0) return map;
  const { data } = await admin.from("conversation_channels").select("id, name").in("id", unique);
  for (const c of (data ?? []) as any[]) map.set(c.id, c.name);
  return map;
}

// ── Message detail (metadata + poll + attachment metadata; NO full body) ──────

export interface MessageAttachmentMeta {
  present: boolean;
  position: number;
  kind: "image" | "video" | "file";
  name: string | null;
  size: number | null;
  mime: string | null;
  width: number | null;
  height: number | null;
  /** Storage bucket path segment is intentionally NOT exposed. */
  active: boolean;
}

export interface MessageReactor {
  display_name: string;
  username: string | null;
  avatar_url: string | null;
}

export interface MessageReactionSummary {
  emoji: string;
  count: number;
  reactors: MessageReactor[];
}

export interface MessagePollDetail {
  question: string | null;
  allow_multiple: boolean;
  start_at: string | null;
  end_at: string | null;
  totalVotes: number;
  options: { id: string; text: string; votes: number }[];
}

export interface MessageReportDetail {
  id: string;
  status: string;
  reason: string | null;
  details: string | null;
  reporter_username: string | null;
  created_at: string;
}

export interface MessageDetail {
  id: string;
  sender_id: string;
  sender_name: string;
  sender_username: string;
  sender_avatar: string | null;
  conversation_id: string;
  conversation_title: string;
  conversation_type: string;
  conversation_type_label: string;
  club_id: string | null;
  club_name: string | null;
  channel_id: string | null;
  channel_name: string | null;
  message_type: string;
  deleted: boolean;
  deleted_at: string | null;
  edited: boolean;
  created_at: string;
  updated_at: string | null;
  /** A short preview of the CURRENTLY-VISIBLE text body only (never for deleted
   * rows). The full private body is only obtainable via the recent-MFA reveal. */
  preview: string | null;
  /** Position-0 compatibility alias; new callers should use attachments. */
  attachment: MessageAttachmentMeta | null;
  attachments: MessageAttachmentMeta[];
  reactions: MessageReactionSummary[];
  poll: MessagePollDetail | null;
  reportCount: number;
  reports: MessageReportDetail[];
}

export async function getMessageDetail(id: string): Promise<MessageDetail | null> {
  await requireSecureAdmin();
  const admin = createAdminClient();

  const { data: msg } = await admin
    .from("messages")
    .select(
      "id, conversation_id, channel_id, sender_id, content, message_type, attachment_url, attachment_name, attachment_size, attachment_mime, deleted_at, created_at, updated_at"
    )
    .eq("id", id)
    .maybeSingle();
  if (!msg) return null;
  const m = msg as any;
  const deleted = !!m.deleted_at;

  const [senderMap, convMap, channelName, pollRes, reportsRes] = await Promise.all([
    profileMap(admin, [m.sender_id]),
    conversationLiteMap(admin, [m.conversation_id]),
    m.channel_id ? channelNameMap(admin, [m.channel_id]) : Promise.resolve(new Map<string, string>()),
    m.message_type === "poll" && !deleted ? loadPoll(admin, id) : Promise.resolve(null),
    admin
      .from("reports")
      .select("id, status, reason, details, reporter_username, created_at")
      .eq("entity_type", "message")
      .eq("message_id", id)
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  const [attachments, reactions] = await Promise.all([
    loadMessageAttachments(admin, id, m, deleted),
    loadMessageReactions(admin, id, deleted),
  ]);

  const sender = senderMap.get(m.sender_id);
  const cv = convMap.get(m.conversation_id);
  const club = cv?.club_id ? (await clubMap(admin, [cv.club_id])).get(cv.club_id) : null;
  const edited = !deleted && !!m.updated_at && !!m.created_at && new Date(m.updated_at).getTime() - new Date(m.created_at).getTime() > 1000;

  // Attachment metadata — never for deleted rows (retained-evidence protection).
  const attachment = attachments[0] ?? null;

  return {
    id: m.id,
    sender_id: m.sender_id,
    sender_name: sender?.full_name ?? "",
    sender_username: sender?.username ?? "",
    sender_avatar: sender?.avatar_url ?? null,
    conversation_id: m.conversation_id,
    conversation_title: cv ? conversationTitle(cv, club?.name ?? null, []) : "",
    conversation_type: cv?.type ?? "",
    conversation_type_label: cv ? conversationTypeLabel(cv.type) : "",
    club_id: cv?.club_id ?? null,
    club_name: club?.name ?? null,
    channel_id: m.channel_id ?? null,
    channel_name: m.channel_id ? channelName.get(m.channel_id) ?? null : null,
    message_type: m.message_type,
    deleted,
    deleted_at: m.deleted_at ?? null,
    edited,
    created_at: m.created_at,
    updated_at: m.updated_at ?? null,
    preview: deleted ? null : m.message_type === "text" ? textPreview(m.content, 160) : null,
    attachment,
    attachments,
    reactions,
    poll: pollRes,
    reportCount: (reportsRes.data ?? []).length,
    reports: ((reportsRes.data ?? []) as any[]).map((r) => ({
      id: r.id,
      status: r.status,
      reason: r.reason ?? null,
      details: r.details ?? null,
      reporter_username: r.reporter_username ?? null,
      created_at: r.created_at,
    })),
  };
}

function legacyAttachmentKind(messageType: string): MessageAttachmentMeta["kind"] {
  if (messageType === "image") return "image";
  if (messageType === "video") return "video";
  return "file";
}

/** Load normalized attachment metadata while keeping storage paths private. */
async function loadMessageAttachments(
  admin: Admin,
  messageId: string,
  message: any,
  deleted: boolean
): Promise<MessageAttachmentMeta[]> {
  if (deleted) return [];
  const { data, error } = await admin
    .from("message_attachments")
    .select("position, kind, mime, width, height, byte_size, file_name")
    .eq("message_id", messageId)
    .order("position", { ascending: true });
  if (error) throw error;

  const normalized = ((data ?? []) as any[]).map((attachment) => ({
    present: true,
    position: attachment.position,
    kind: attachment.kind as MessageAttachmentMeta["kind"],
    name: attachment.file_name ?? null,
    size: attachment.byte_size ?? null,
    mime: attachment.mime ?? null,
    width: attachment.width ?? null,
    height: attachment.height ?? null,
    active: true,
  }));
  if (normalized.length > 0) return normalized;

  // Position-0 compatibility fallback protects admin visibility for a row
  // created by an older client before its normalized child was backfilled.
  return message.attachment_url
    ? [{
        present: true,
        position: 0,
        kind: legacyAttachmentKind(message.message_type),
        name: message.attachment_name ?? null,
        size: message.attachment_size ?? null,
        mime: message.attachment_mime ?? null,
        width: null,
        height: null,
        active: true,
      }]
    : [];
}

/** Group participant-visible reaction metadata for the admin read-only view. */
async function loadMessageReactions(admin: Admin, messageId: string, deleted: boolean): Promise<MessageReactionSummary[]> {
  if (deleted) return [];
  const { data, error } = await admin
    .from("message_reactions")
    .select("user_id, emoji, created_at")
    .eq("message_id", messageId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  const rows = (data ?? []) as any[];
  if (rows.length === 0) return [];

  const reactors = await profileMap(admin, rows.map((row) => row.user_id));
  const grouped = new Map<string, MessageReactionSummary & { firstCreatedAt: string }>();
  for (const row of rows) {
    if (!row.emoji) continue;
    const existing = grouped.get(row.emoji);
    const profile = reactors.get(row.user_id);
    const reactor: MessageReactor = {
      display_name: profile?.full_name || profile?.username || "Unavailable account",
      username: profile?.username ?? null,
      avatar_url: profile?.avatar_url ?? null,
    };
    if (existing) {
      existing.count += 1;
      existing.reactors.push(reactor);
    } else {
      grouped.set(row.emoji, { emoji: row.emoji, count: 1, reactors: [reactor], firstCreatedAt: row.created_at });
    }
  }
  return Array.from(grouped.values())
    .sort((a, b) => b.count - a.count || a.firstCreatedAt.localeCompare(b.firstCreatedAt))
    .map((summary) => ({
      emoji: summary.emoji,
      count: summary.count,
      reactors: summary.reactors,
    }));
}

async function loadPoll(admin: Admin, messageId: string): Promise<MessagePollDetail | null> {
  const { data: poll } = await admin
    .from("polls")
    .select("id, question, allow_multiple, start_at, end_at")
    .eq("message_id", messageId)
    .maybeSingle();
  if (!poll) return null;
  const p = poll as any;
  const [{ data: options }, { data: votes }] = await Promise.all([
    admin.from("poll_options").select("id, option_text, display_order").eq("poll_id", p.id).order("display_order", { ascending: true }),
    admin.from("poll_votes").select("option_id").eq("poll_id", p.id),
  ]);
  const voteCounts = new Map<string, number>();
  for (const v of (votes ?? []) as any[]) voteCounts.set(v.option_id, (voteCounts.get(v.option_id) ?? 0) + 1);
  return {
    question: p.question ?? null,
    allow_multiple: !!p.allow_multiple,
    start_at: p.start_at ?? null,
    end_at: p.end_at ?? null,
    totalVotes: (votes ?? []).length,
    options: ((options ?? []) as any[]).map((o) => ({ id: o.id, text: o.option_text, votes: voteCounts.get(o.id) ?? 0 })),
  };
}

// ── Notifications list ───────────────────────────────────────────────────────

export interface AdminNotificationRow {
  id: string;
  recipient_id: string;
  recipient_name: string;
  recipient_username: string;
  recipient_email: string | null;
  type: string;
  category: string | null;
  title: string | null;
  actor_id: string | null;
  actor_username: string | null;
  entity_type: string | null;
  entity_id: string | null;
  read: boolean;
  group_count: number;
  route_screen: string | null;
  created_at: string;
}

export interface ListNotificationsParams {
  search?: string;
  type?: string;
  read?: "all" | "read" | "unread";
  entityType?: "all" | "event" | "club" | "message";
  dateFrom?: string;
  dateTo?: string;
  sort?: "created_at";
  dir?: "asc" | "desc";
  page?: number;
}

export async function listNotifications(params: ListNotificationsParams = {}): Promise<Paginated<AdminNotificationRow>> {
  await requireSecureAdmin();
  const admin = createAdminClient();

  const page = Math.max(1, params.page ?? 1);
  const dir = params.dir ?? "desc";
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  const search = params.search?.trim();

  let q = admin
    .from("notifications")
    .select("id, user_id, type, actor_id, entity_id, entity_type, read, message, group_count, route, created_at", { count: "exact" });

  if (params.type && params.type !== "all") q = q.eq("type", params.type);
  if (params.read === "read") q = q.eq("read", true);
  if (params.read === "unread") q = q.eq("read", false);
  if (params.entityType && params.entityType !== "all") q = q.eq("entity_type", params.entityType);
  if (params.dateFrom) q = q.gte("created_at", params.dateFrom);
  if (params.dateTo) q = q.lte("created_at", params.dateTo);

  if (search) {
    const like = `%${search}%`;
    const isEmail = search.includes("@");
    const recipientIds = isEmail
      ? await findUserIdsByEmail(admin, search)
      : ((await admin.from("profiles").select("id").or(`full_name.ilike.${like},username.ilike.${like}`).limit(500)).data ?? []).map(
          (p: any) => p.id
        );
    const parts: string[] = [];
    if (recipientIds.length) parts.push(`user_id.in.${fmtIds(recipientIds)}`);
    // Also allow matching by type token (e.g. "officer").
    if (!isEmail) parts.push(`type.ilike.${like}`);
    if (parts.length === 0) return { rows: [], total: 0, page, pageSize: PAGE_SIZE };
    q = q.or(parts.join(","));
  }

  q = q.order("created_at", { ascending: dir === "asc" }).range(from, to);
  const { data, count, error } = await q;
  if (error) throw error;

  const notifs = (data ?? []) as any[];
  const recipientIds = notifs.map((n) => n.user_id);
  const actorIds = notifs.map((n) => n.actor_id).filter(Boolean) as string[];

  const [recipients, actors, emails, categories] = await Promise.all([
    profileMap(admin, recipientIds),
    profileMap(admin, actorIds),
    emailMap(recipientIds),
    notificationCategoryMap(admin, Array.from(new Set(notifs.map((n) => n.type)))),
  ]);

  const rows: AdminNotificationRow[] = notifs.map((n) => ({
    id: n.id,
    recipient_id: n.user_id,
    recipient_name: recipients.get(n.user_id)?.full_name ?? "",
    recipient_username: recipients.get(n.user_id)?.username ?? "",
    recipient_email: emails.get(n.user_id) ?? null,
    type: n.type,
    category: categories.get(n.type) ?? null,
    title: n.message ?? null,
    actor_id: n.actor_id ?? null,
    actor_username: n.actor_id ? actors.get(n.actor_id)?.username ?? null : null,
    entity_type: n.entity_type ?? null,
    entity_id: n.entity_id ?? null,
    read: !!n.read,
    group_count: n.group_count ?? 1,
    route_screen: n.route?.screen ?? null,
    created_at: n.created_at,
  }));

  return { rows, total: count ?? rows.length, page, pageSize: PAGE_SIZE };
}

async function notificationCategoryMap(admin: Admin, types: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (types.length === 0) return map;
  const { data } = await admin.from("notification_types").select("type, category").in("type", types);
  for (const t of (data ?? []) as any[]) map.set(t.type, t.category);
  return map;
}

/** Distinct notification types (registry) for the filter dropdown. */
export async function listNotificationTypes(): Promise<{ type: string; category: string }[]> {
  await requireSecureAdmin();
  const admin = createAdminClient();
  const { data } = await admin.from("notification_types").select("type, category").order("category", { ascending: true }).order("type", { ascending: true });
  return (data ?? []) as { type: string; category: string }[];
}

// ── Notification detail ──────────────────────────────────────────────────────

export interface NotificationDetail {
  id: string;
  recipient_id: string;
  recipient_name: string;
  recipient_username: string;
  recipient_email: string | null;
  recipient_avatar: string | null;
  type: string;
  category: string | null;
  description: string | null;
  title: string | null;
  actor_id: string | null;
  actor_name: string | null;
  actor_username: string | null;
  actor_avatar: string | null;
  entity_type: string | null;
  entity_id: string | null;
  read: boolean;
  read_at: string | null;
  seen_at: string | null;
  group_count: number;
  route: Record<string, unknown> | null;
  /** A safe, allowlisted admin deep-link derived from route (never a raw path). */
  admin_link: string | null;
  delivery: { queued: number; sent: number; failed: number; pending: number } | null;
  created_at: string;
}

export async function getNotificationDetail(id: string): Promise<NotificationDetail | null> {
  await requireSecureAdmin();
  const admin = createAdminClient();

  const { data: n } = await admin
    .from("notifications")
    .select("id, user_id, type, actor_id, entity_id, entity_type, read, read_at, seen_at, message, group_count, route, created_at")
    .eq("id", id)
    .maybeSingle();
  if (!n) return null;
  const notif = n as any;

  const [recipientMap, actorMap, emails, typeRes, deliveryRows] = await Promise.all([
    profileMap(admin, [notif.user_id]),
    notif.actor_id ? profileMap(admin, [notif.actor_id]) : Promise.resolve(new Map<string, any>()),
    emailMap([notif.user_id]),
    admin.from("notification_types").select("category, description").eq("type", notif.type).maybeSingle(),
    admin.from("push_queue").select("status").eq("notification_id", id).limit(200),
  ]);

  const recipient = recipientMap.get(notif.user_id);
  const actor = notif.actor_id ? actorMap.get(notif.actor_id) : null;

  // Delivery status counts (metadata only — device tokens are NEVER read here).
  let delivery: NotificationDetail["delivery"] = null;
  const dRows = (deliveryRows.data ?? []) as any[];
  if (dRows.length) {
    delivery = { queued: dRows.length, sent: 0, failed: 0, pending: 0 };
    for (const r of dRows) {
      if (r.status === "sent") delivery.sent += 1;
      else if (r.status === "failed") delivery.failed += 1;
      else if (r.status === "pending" || r.status === "processing") delivery.pending += 1;
    }
  }

  return {
    id: notif.id,
    recipient_id: notif.user_id,
    recipient_name: recipient?.full_name ?? "",
    recipient_username: recipient?.username ?? "",
    recipient_email: emails.get(notif.user_id) ?? null,
    recipient_avatar: recipient?.avatar_url ?? null,
    type: notif.type,
    category: (typeRes.data as any)?.category ?? null,
    description: (typeRes.data as any)?.description ?? null,
    title: notif.message ?? null,
    actor_id: notif.actor_id ?? null,
    actor_name: actor?.full_name ?? null,
    actor_username: actor?.username ?? null,
    actor_avatar: actor?.avatar_url ?? null,
    entity_type: notif.entity_type ?? null,
    entity_id: notif.entity_id ?? null,
    read: !!notif.read,
    read_at: notif.read_at ?? null,
    seen_at: notif.seen_at ?? null,
    group_count: notif.group_count ?? 1,
    route: notif.route ?? null,
    admin_link: adminLinkForNotification(notif),
    delivery,
    created_at: notif.created_at,
  };
}

/**
 * Map a notification to a SAFE in-dashboard deep link using the canonical
 * entity_type/entity_id (never a raw client route string). Returns null when
 * there is no safe admin destination.
 */
export function adminLinkForNotification(n: { entity_type: string | null; entity_id: string | null; actor_id: string | null }): string | null {
  if (n.entity_id) {
    if (n.entity_type === "event") return `/admin/events/${n.entity_id}`;
    if (n.entity_type === "club") return `/admin/clubs/${n.entity_id}`;
    if (n.entity_type === "message") return `/admin/conversations/${n.entity_id}`;
  }
  if (n.actor_id) return `/admin/users/${n.actor_id}`;
  return null;
}
