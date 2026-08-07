"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AppHeader } from "../home/AppHeader";
import { PageOverlays } from "../shared/PageOverlays";
import { Avatar } from "../shared/Avatar";
import { CountBadge } from "../shared/CountBadge";
import {
  ArchiveIcon, BellOffIcon, CalendarIcon, ChatBubblesIcon, CheckboxIcon, CloseCircleIcon, CloseIcon,
  EllipsisIcon, ExitIcon, FlagIcon, ImageIcon, ListIcon, LockIcon, MegaphoneIcon, PaperclipIcon,
  PeopleIcon, PersonAddIcon, PlusIcon, SearchIcon, ShareIcon, TagIcon, TrashIcon,
} from "../shared/icons";
import { REPORT_RECEIVED_MESSAGE, useReport } from "../../lib/hooks/useReport";
import { ToastProvider, useToast } from "../shared/Toast";
import { messageBadgeCounts, useUnreadSummary, useUnreadSummaryValue } from "../../lib/hooks/useUnreadSummary";
import { messagesHref, isMessageUuid, type MessagesDestination } from "../../lib/messages/routes";
import { useMyClubs } from "../../lib/hooks/useClubTab";
import {
  canPostInChannel,
  clientTag,
  createChannel,
  deleteChannel,
  createGroupConversation,
  createPoll,
  deleteDirectConversationForMe,
  getChannelPosters,
  getOrCreateDirectConversation,
  getPoll,
  hideMessage,
  markChannelRead,
  markConversationRead,
  reportMessage,
  renameChannel,
  sendMessage,
  setChannelMuted,
  setChannelPostPermission,
  setConversationArchived,
  setConversationMuted,
  signedAttachmentUrl,
  unsendMessage,
  uploadAttachment,
  votePoll,
  type Channel,
  type ChannelPreview,
  type ConversationPreview,
  type MessageSearchResult,
  type Person,
  type PostingPermission,
  type ThreadMessage,
} from "../../lib/messages/service";
import {
  messageKeys,
  useConversationFlags,
  useMessageChannels,
  useMessageContentSearch,
  useMessageConversations,
  useMessageDetails,
  useMessageEvents,
  useMessageHub,
  useMessageMute,
  useMessagePeopleSearch,
  useMessagePermission,
  useMessagePerson,
  useMessageShared,
  useMessageSuggestions,
  useMessageThread,
  useMessagesRealtime,
} from "../../lib/messages/hooks";

type Filter = "single" | "groups";
type InfoTab = "polls" | "media" | "events" | "files";

const REPORT_REASONS = ["Spam", "Harassment or bullying", "Hate speech", "Inappropriate content", "Impersonation", "Other"];

/**
 * Dismisses a transient surface (menu, popover, modal) on an outside pointer
 * press or Escape.
 *
 * `pointerdown` rather than `click`: a click fires only after the button is
 * released, so a press that starts outside and drags in would keep the menu
 * open. Capture phase so a child that stops propagation cannot trap the menu
 * open either. Both listeners are attached only while the surface is mounted.
 */
function useEscapeAndOutside(ref: React.RefObject<HTMLElement>, onDismiss: () => void): void {
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onDismiss();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.stopPropagation(); onDismiss(); }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [onDismiss, ref]);
}

export function MessagesClient({ userId }: { userId: string }): JSX.Element {
  useUnreadSummary(userId);
  // From `md` up the Message tab is a FIXED-height application shell: the
  // document itself never scrolls, and the only scrollable region is the
  // conversation list inside the Chats column (plus each thread's own message
  // list). Below `md` the columns stack, so normal document flow is kept.
  return (
    <ToastProvider>
      <div className="flex min-h-screen flex-col bg-cream md:h-[100dvh] md:min-h-0 md:overflow-hidden">
        <div className="shrink-0">
          <AppHeader userId={userId} />
        </div>
        <MessagesBody userId={userId} />
      </div>
    </ToastProvider>
  );
}

function MessagesBody({ userId }: { userId: string }): JSX.Element {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const show = useToast();
  const filter: Filter = params.get("filter") === "groups" ? "groups" : "single";
  const conversationId = isMessageUuid(params.get("conversation")) ? params.get("conversation") : null;
  const channelId = isMessageUuid(params.get("channel")) ? params.get("channel") : null;
  const draftUserId = isMessageUuid(params.get("draft")) ? params.get("draft") : null;
  const draftGroupIds = useMemo(
    () => (params.get("draftGroup") ?? "").split(",").filter(isMessageUuid),
    [params]
  );
  const draftGroupName = params.get("groupName")?.trim().slice(0, 60) || null;
  const hubOpen = params.get("hub") === "1";
  const infoOpen = params.get("info") === "1";
  const infoTab = (["polls", "media", "events", "files"] as string[]).includes(params.get("infoTab") ?? "")
    ? (params.get("infoTab") as InfoTab)
    : "polls";
  const [composerMode, setComposerMode] = useState<"none" | "new-message" | "new-group">("none");

  const { data: conversations = [], isLoading: conversationsLoading } = useMessageConversations(userId);
  const { data: myClubs, isLoading: clubsLoading } = useMyClubs(userId);
  const { data: details, isLoading: detailsLoading } = useMessageDetails(conversationId, userId);
  const { data: channels = [] } = useMessageChannels(conversationId);
  const { data: draftPerson } = useMessagePerson(draftUserId);
  useMessagesRealtime(conversationId, userId);

  const directConversations = useMemo(() => conversations.filter((conversation) => conversation.type === "direct"), [conversations]);
  const groupConversations = useMemo(() => conversations.filter((conversation) => conversation.type !== "direct"), [conversations]);
  const hasClubs = (myClubs?.officer_clubs.length ?? 0) + (myClubs?.member_clubs.length ?? 0) > 0;
  const isDraftGroup = !conversationId && draftGroupIds.length > 0;
  const isDraft = !conversationId && (!!draftUserId || isDraftGroup);
  const selectedChannel = channelId ? channels.find((channel) => channel.id === channelId) ?? null : null;
  // Officer status comes from the club roster (`club_members.role`), which is
  // what `getConversationDetails` resolves and what mobile's officer store uses.
  // It is NOT inferred from chat participation: being in an officers chat and
  // being a current officer are separate facts.
  const viewerIsOfficer = !!details?.participants.some((participant) => participant.user_id === userId && participant.role === "Officer");
  const hasValidDestination = isDraft || (!conversationId ? true : !!details && (!channelId || !!selectedChannel));

  const destination = useCallback(
    (next: MessagesDestination, replace = false) => {
      const href = messagesHref(next);
      if (replace) router.replace(href, { scroll: false });
      else router.push(href, { scroll: false });
    },
    [router]
  );

  // The general nav always stays blank; a contextual person entry resolves to
  // an existing DM when one is already present, without ever creating a row.
  useEffect(() => {
    if (!draftUserId || conversationsLoading) return;
    const existing = directConversations.find((conversation) => conversation.other_user_id === draftUserId);
    if (existing) destination({ filter: "single", conversationId: existing.id }, true);
  }, [conversationsLoading, destination, directConversations, draftUserId]);

  // A direct link can refer to a channel that no longer exists or has become
  // inaccessible. RLS produces an empty query, which becomes a safe state.
  useEffect(() => {
    if (conversationId && channelId && channels.length && !selectedChannel) {
      destination({ filter: "groups", conversationId, hub: true }, true);
    }
  }, [channelId, channels.length, conversationId, destination, selectedChannel]);

  const openPerson = useCallback((person: Person) => {
    const existing = directConversations.find((conversation) => conversation.other_user_id === person.user_id);
    destination(existing ? { filter: "single", conversationId: existing.id } : { filter: "single", draftUserId: person.user_id });
    setComposerMode("none");
  }, [destination, directConversations]);

  const openConversation = useCallback((conversation: ConversationPreview) => {
    if (conversation.type === "club_group" || conversation.type === "officer_chat") {
      destination({ filter: "groups", conversationId: conversation.id, hub: true });
      return;
    }
    destination({ filter: conversation.type === "direct" ? "single" : "groups", conversationId: conversation.id });
  }, [destination]);

  const openSearchResult = useCallback((result: MessageSearchResult) => {
    const conversation = conversations.find((item) => item.id === result.conversation_id);
    destination({
      filter: conversation?.type === "direct" ? "single" : "groups",
      conversationId: result.conversation_id,
      channelId: result.channel_id,
      messageId: result.message_id,
    });
  }, [conversations, destination]);

  const clearSelection = useCallback(() => destination({ filter }), [destination, filter]);
  const setFilter = useCallback((next: Filter) => {
    setComposerMode("none");
    destination({ filter: next });
  }, [destination]);

  const invalidateConversation = useCallback((id: string) => {
    void queryClient.invalidateQueries({ queryKey: ["messages", "thread", id] });
    void queryClient.invalidateQueries({ queryKey: ["messages", "shared", id] });
    void queryClient.invalidateQueries({ queryKey: messageKeys.conversations(userId) });
    void queryClient.invalidateQueries({ queryKey: ["unreadSummary", userId] });
  }, [queryClient, userId]);

  let center: JSX.Element;
  if (!hasValidDestination || (conversationId && !detailsLoading && !details)) {
    center = <Unavailable onBack={clearSelection} />;
  } else if (hubOpen && conversationId && details) {
    const refreshHub = async () => {
      await queryClient.invalidateQueries({ queryKey: messageKeys.hub(conversationId, userId) });
      await queryClient.invalidateQueries({ queryKey: messageKeys.channels(conversationId) });
    };
    center = <ChannelHub conversationId={conversationId} conversationName={details.name} userId={userId} participants={details.participants} isOfficer={viewerIsOfficer} isOfficersChat={details.type === "officer_chat"} onOpenChannel={(channel) => destination({ filter: "groups", conversationId, channelId: channel.id })} onBack={clearSelection} onCreateChannel={async (name) => {
      try {
        const channel = await createChannel(conversationId, name);
        show("Channel created");
        await refreshHub();
        destination({ filter: "groups", conversationId, channelId: channel });
      } catch {
        show("Couldn’t create the channel.", "error");
      }
    }} onRenameChannel={async (channelId, name) => {
      try { await renameChannel(channelId, name); await refreshHub(); show("Channel renamed"); } catch { show("Couldn’t rename the channel.", "error"); }
    }} onDeleteChannel={async (channelId) => {
      try { await deleteChannel(channelId); await refreshHub(); show("Channel deleted"); } catch { show("Couldn’t delete the channel.", "error"); }
    }} onSetPermission={async (channelId, permission, userIds) => {
      try { await setChannelPostPermission(channelId, permission, userIds); await refreshHub(); show("Posting permissions updated"); } catch { show("Couldn’t update posting permissions.", "error"); }
    }} />;
  } else if (composerMode === "new-message") {
    center = <NewMessagePicker onSelect={openPerson} onGroupChat={() => setComposerMode("new-group")} onClose={() => setComposerMode("none")} />;
  } else if (composerMode === "new-group") {
    center = <NewGroupPicker onBack={() => setComposerMode("new-message")} onContinue={(ids, name) => {
      setComposerMode("none");
      destination({ filter: "groups", draftGroupIds: ids, draftGroupName: name });
    }} />;
  } else if (isDraft) {
    center = <DraftThread userId={userId} draftPerson={draftPerson} groupName={draftGroupName} groupIds={draftGroupIds} onMaterialized={(id) => destination({ filter, conversationId: id }, true)} onError={(message) => show(message, "error")} />;
  } else if (conversationId && details) {
    // Back from a channel thread returns to that club's channel chooser (mobile's
    // group chat → channels → chat → details path), not to an empty Messages
    // pane, so the previous context is preserved on desktop too.
    const isOfficial = details.type === "club_group" || details.type === "officer_chat";
    center = <ConversationThread userId={userId} conversationId={conversationId} channelId={channelId} details={details} channelName={selectedChannel ? channelLabel(selectedChannel) : null} canPost={channelId ? undefined : true} onOpenHub={isOfficial ? () => destination({ filter: "groups", conversationId, hub: true }) : undefined} onBack={isOfficial ? () => destination({ filter: "groups", conversationId, hub: true }) : clearSelection} onOpenInfo={() => destination({ filter, conversationId, channelId, info: true, infoTab })} onOpenProfile={(id) => router.push(`/u/${id}`)} onInvalidate={() => invalidateConversation(conversationId)} onError={(message) => show(message, "error")} />;
  } else {
    center = <MessagesLanding noClubs={!clubsLoading && !hasClubs} onJoinClub={() => router.push("/clubs")} />;
  }

  return (
    <main className="mx-auto w-full max-w-[1400px] px-0 py-0 sm:px-4 sm:py-6 md:flex md:min-h-0 md:flex-1 md:flex-col">
      {/* The shell owns the viewport height and clips: nothing inside it may
          grow the document. `min-h-0` on every descendant in this chain is what
          lets the list below actually reach `overflow-y-auto` instead of
          stretching its parent. */}
      <div className="min-h-[calc(100vh-88px)] overflow-hidden border-y bg-cream shadow-[0_2px_8px_rgba(0,0,0,0.16)] sm:rounded-sm sm:border md:min-h-0 md:flex-1" style={{ borderColor: "rgba(0,0,0,0.17)" }}>
        <div className={infoOpen && conversationId ? "grid grid-cols-1 md:h-full md:grid-rows-[minmax(0,1fr)] lg:grid-cols-[292px_minmax(0,1fr)_360px]" : "grid grid-cols-1 md:h-full md:grid-cols-[292px_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)]"}>
          {/* suggestionsEnabled: `composerMode` is a STRING union whose idle value
              is "none" — truthy — so the previous `!composerMode` test was
              permanently false and the empty-Single Suggested section could never
              render. It must compare against "none". */}
          <MessagesSidebar userId={userId} filter={filter} loading={conversationsLoading} conversations={filter === "single" ? directConversations : groupConversations} suggestionsEnabled={filter === "single" && directConversations.length === 0 && composerMode === "none" && !conversationId && !isDraft} activeConversationId={conversationId} onFilter={setFilter} onOpen={openConversation} onNew={() => setComposerMode("new-message")} onOpenPerson={openPerson} onOpenMessage={openSearchResult} />
          <section className="relative flex min-w-0 flex-col bg-[#fffdf4] md:min-h-0 md:overflow-y-auto">{center}</section>
          {infoOpen && conversationId && details && (
            <InfoPanel userId={userId} conversationId={conversationId} channelId={channelId} channel={selectedChannel} details={details} isOfficer={viewerIsOfficer} infoTab={infoTab} onClose={() => destination({ filter, conversationId, channelId })} onTab={(tab) => destination({ filter, conversationId, channelId, info: true, infoTab: tab })} onOpenEvent={(eventId) => destination({ filter, conversationId, channelId, info: true, infoTab, eventId })} onOpenMessage={openSearchResult} onOpenProfile={(id) => router.push(`/u/${id}`)} onChanged={() => invalidateConversation(conversationId)} onError={(message) => show(message, "error")} />
          )}
        </div>
      </div>
      <PageOverlays userId={userId} />
    </main>
  );
}

function MessagesSidebar({ userId, filter, loading, conversations, suggestionsEnabled, activeConversationId, onFilter, onOpen, onNew, onOpenPerson, onOpenMessage }: { userId: string; filter: Filter; loading: boolean; conversations: ConversationPreview[]; suggestionsEnabled: boolean; activeConversationId: string | null; onFilter: (filter: Filter) => void; onOpen: (conversation: ConversationPreview) => void; onNew: () => void; onOpenPerson: (person: Person) => void; onOpenMessage: (result: MessageSearchResult) => void }): JSX.Element {
  const [query, setQuery] = useState("");
  const { data: people = [], isLoading: peopleLoading } = useMessagePeopleSearch(query);
  const { data: contentResults = [], isLoading: contentLoading } = useMessageContentSearch(query, null);
  const { data: suggestions = [], isLoading: suggestionsLoading, isError: suggestionsFailed } = useMessageSuggestions(suggestionsEnabled);
  const { data: summary } = useUnreadSummaryValue(userId);
  const { single: singleUnread, groups: groupsUnread } = messageBadgeCounts(summary);
  const term = query.trim().toLowerCase();
  const filtered = term ? conversations.filter((conversation) => `${conversation.name} ${conversation.last_message ?? ""}`.toLowerCase().includes(term)) : conversations;
  const active = filtered.filter((conversation) => !conversation.archived).sort(compareConversation);
  const archived = filtered.filter((conversation) => conversation.archived).sort(compareConversation);
  return (
    <aside className="flex min-h-0 flex-col border-b bg-cream md:overflow-hidden md:border-b-0 md:border-r" style={{ borderColor: "rgba(0,0,0,0.17)" }}>
      {/* Fixed header: heading, plus, search and the Single/Groups controls
          never scroll away — only the list below them moves. */}
      <div className="shrink-0 px-5 pb-3 pt-5">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-950 font-zain">Chats</h1>
          {/* Always New message now (group chat is reached from inside it), so
              the label must not depend on the active filter. */}
          <button type="button" onClick={onNew} aria-label="New message" className="rounded-full p-1 text-2xl text-gray-950 transition hover:bg-black/5 focus:outline-none focus:ring-2 focus:ring-teal">+</button>
        </div>
        {/* The real magnifying glass from the shared icon set (same one the
            header search uses) — not the ⌕ text glyph, which rendered at the
            font's own size and sat off the optical centre. */}
        <label className="relative mt-3 block">
          <span className="pointer-events-none absolute left-3.5 top-1/2 flex -translate-y-1/2 items-center text-gray-500">
            <SearchIcon size={17} />
          </span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} type="search" placeholder="Search" aria-label="Search conversations and people" className="h-10 w-full rounded-full border bg-white pl-11 pr-9 text-sm outline-none placeholder:text-gray-500 focus:ring-2 focus:ring-teal" style={{ borderColor: "rgba(0,0,0,0.2)", boxShadow: "0 2px 3px rgba(0,0,0,0.16)" }} />
          {query && <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full px-1 text-gray-500 hover:bg-gray-100">×</button>}
        </label>
        <div className="mt-3 flex gap-3" role="tablist" aria-label="Conversation type">
          <FilterButton label="Single" active={filter === "single"} badge={singleUnread} badgeLabel="unread direct messages" onClick={() => onFilter("single")} />
          <FilterButton label="Groups" active={filter === "groups"} badge={groupsUnread} badgeLabel="unread group messages" onClick={() => onFilter("groups")} />
        </div>
      </div>
      {/* THE one scrollable region of the Chats column. `min-h-0` is required:
          without it this flex child refuses to shrink below its content and the
          overflow escapes to the document instead. */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-5">
        {term.length >= 3 && (
          <div className="pb-2">
            <p className="px-2 pb-1 pt-1 text-xs font-bold uppercase tracking-wide text-gray-500">People</p>
            {peopleLoading ? <p className="px-2 py-3 text-sm text-gray-500">Searching…</p> : people.map((person) => <PersonRow key={person.user_id} person={person} onClick={() => onOpenPerson(person)} />)}
          </div>
        )}
        {term.length >= 3 && (
          <div className="pb-2">
            <p className="px-2 pb-1 pt-1 text-xs font-bold uppercase tracking-wide text-gray-500">Messages</p>
            {contentLoading ? <p className="px-2 py-3 text-sm text-gray-500">Searching messages…</p> : contentResults.map((result) => <MessageSearchRow key={result.message_id} result={result} onClick={() => onOpenMessage(result)} />)}
          </div>
        )}
        {loading ? <SidebarSkeleton /> : active.map((conversation) => <ConversationRow key={conversation.id} conversation={conversation} active={activeConversationId === conversation.id} onClick={() => onOpen(conversation)} />)}
        {!loading && !term && suggestionsEnabled && (
          <div className="mt-3">
            <p className="px-2 pb-2 text-base font-bold text-gray-900 font-zain">Suggested</p>
            <SuggestedPeople people={suggestions} loading={suggestionsLoading} failed={suggestionsFailed} onSelect={onOpenPerson} />
          </div>
        )}
        {!loading && !term && active.length === 0 && !suggestionsEnabled && <p className="px-2 py-6 text-sm text-gray-500">No conversations yet.</p>}
        {archived.length > 0 && <details className="mt-3 border-t pt-3"><summary className="cursor-pointer px-2 text-sm font-semibold text-gray-500">Archived ({archived.length})</summary>{archived.map((conversation) => <ConversationRow key={conversation.id} conversation={conversation} active={activeConversationId === conversation.id} onClick={() => onOpen(conversation)} />)}</details>}
      </div>
    </aside>
  );
}

// The category control carries the compact red CountBadge already used by the
// header and mobile — no pill, banner, or label. CountBadge itself renders
// nothing at 0, which is exactly the "hide when zero" rule.
function FilterButton({ label, active, badge = 0, badgeLabel, onClick }: { label: string; active: boolean; badge?: number; badgeLabel?: string; onClick: () => void }): JSX.Element {
  return (
    <span className="relative inline-flex">
      <button type="button" role="tab" aria-selected={active} onClick={onClick} className="rounded-full px-5 py-1 text-sm font-medium shadow-sm transition focus:outline-none focus:ring-2 focus:ring-teal" style={active ? { background: "#0FA6A6", color: "#fff" } : { background: "#fff", color: "#0FA6A6" }}>{label}</button>
      <CountBadge count={badge} label={badgeLabel} style={{ position: "absolute", top: -7, right: -7, pointerEvents: "none" }} />
    </span>
  );
}

/** Suggested rows shared by the Chats column, New message and New group chat,
 * so all three render the same avatar/name/username row and the same states.
 * A failed lookup must never masquerade as "nobody to suggest". */
function SuggestedPeople({ people, loading, failed, selectedIds, onSelect }: { people: Person[]; loading: boolean; failed: boolean; selectedIds?: Set<string>; onSelect: (person: Person) => void }): JSX.Element {
  if (loading) return <p className="px-2 py-3 text-sm text-gray-500">Loading suggestions…</p>;
  if (failed) return <p className="px-2 text-sm leading-6 text-red-600">Couldn’t load suggestions. Check your connection and try again.</p>;
  if (!people.length) return <p className="px-2 text-sm leading-6 text-gray-500">Search above to find people, or browse clubs to meet members.</p>;
  return <>{people.map((person) => <PersonRow key={person.user_id} person={person} selected={selectedIds?.has(person.user_id)} onClick={() => onSelect(person)} />)}</>;
}

function ConversationRow({ conversation, active, onClick }: { conversation: ConversationPreview; active: boolean; onClick: () => void }): JSX.Element {
  const preview = conversation.last_message ? `${conversation.last_sender_id ? conversation.last_sender_id === "self" ? "You: " : conversation.last_sender_name ? `${conversation.last_sender_name}: ` : "" : ""}${conversation.last_message}` : "No messages yet";
  return (
    <button type="button" onClick={onClick} className="mb-2 flex w-full items-center gap-2.5 rounded-xl border bg-white p-2.5 text-left shadow-[0_2px_5px_rgba(0,0,0,0.16)] transition hover:-translate-y-px hover:bg-teal/[0.025] focus:outline-none focus:ring-2 focus:ring-teal" style={{ borderColor: active ? "#0FA6A6" : "rgba(0,0,0,0.08)" }}>
      <Avatar uri={conversation.avatar_url} size={42} name={conversation.name} />
      <span className="min-w-0 flex-1"><span className="flex items-center gap-2"><span className="truncate text-sm font-bold text-gray-900">{conversation.name}</span>{conversation.muted && <span aria-label="Muted" className="text-xs text-gray-400">⌁</span>}<time className="ml-auto shrink-0 text-[11px] text-gray-400">{shortTime(conversation.last_message_at)}</time></span><span className="mt-0.5 flex items-center gap-2"><span className="truncate text-xs text-gray-500">{preview}</span>{conversation.unread_count > 0 && <span aria-label={`${conversation.unread_count} unread messages`} className="ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-teal px-1.5 py-0.5 text-[10px] font-bold text-white">{conversation.unread_count > 99 ? "99+" : conversation.unread_count}</span>}</span></span>
    </button>
  );
}

function PersonRow({ person, onClick, selected = false }: { person: Person; onClick: () => void; selected?: boolean }): JSX.Element {
  return <button type="button" onClick={onClick} className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-black/[0.035] focus:outline-none focus:ring-2 focus:ring-teal"><Avatar uri={person.avatar_url} size={38} name={person.full_name ?? person.username} /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-gray-900">{person.full_name?.trim() || person.username}</span><span className="block truncate text-xs text-gray-500">@{person.username}</span></span>{selected && <span className="text-teal">✓</span>}</button>;
}

function MessageSearchRow({ result, onClick }: { result: MessageSearchResult; onClick: () => void }): JSX.Element {
  const text = result.content?.trim() || previewForSearch(result.message_type);
  return <button type="button" onClick={onClick} className="block w-full rounded-lg px-2 py-2 text-left transition hover:bg-black/[0.035] focus:outline-none focus:ring-2 focus:ring-teal"><span className="block truncate text-sm font-semibold text-gray-900">{result.full_name?.trim() || result.username || "We Glue member"}</span><span className="block truncate text-xs text-gray-500">{text}</span></button>;
}

function SidebarSkeleton(): JSX.Element { return <div className="space-y-2 px-1">{[1, 2, 3].map((item) => <div key={item} className="h-16 animate-pulse rounded-xl bg-black/5" />)}</div>; }

function MessagesLanding({ noClubs, onJoinClub }: { noClubs: boolean; onJoinClub: () => void }): JSX.Element {
  return <div className="flex min-h-[480px] items-start justify-center px-6 pt-40">{noClubs ? <button type="button" onClick={onJoinClub} className="w-full max-w-sm rounded-full bg-teal px-8 py-4 text-lg font-semibold text-white shadow-[0_3px_5px_rgba(0,0,0,0.22)] transition hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-teal focus:ring-offset-2">Join a Club</button> : <div className="text-center"><p className="text-2xl font-bold text-gray-900 font-zain">Messages</p><p className="mt-2 text-sm text-gray-500">Select a conversation or start a new one.</p></div>}</div>;
}

function Unavailable({ onBack }: { onBack: () => void }): JSX.Element { return <div className="flex min-h-[480px] flex-col items-center justify-center px-6 text-center"><p className="text-xl font-bold text-gray-900">This conversation isn’t available</p><p className="mt-2 text-sm text-gray-500">It may have been removed, or you may no longer have access.</p><button type="button" onClick={onBack} className="mt-5 rounded-full bg-teal px-5 py-2 text-sm font-semibold text-white">Back to Messages</button></div>; }

// New message / New group chat both render INSIDE the right-hand content area
// (the Chats column stays visible throughout) and mirror the mobile flow:
// plus → New message → "Group chat" row → New group chat → back.
function ComposerSearchField({ value, onChange, autoFocus = false }: { value: string; onChange: (value: string) => void; autoFocus?: boolean }): JSX.Element {
  return (
    <label className="relative mt-4 block">
      <span className="pointer-events-none absolute left-4 top-1/2 flex -translate-y-1/2 items-center text-gray-500"><SearchIcon size={17} /></span>
      <input autoFocus={autoFocus} value={value} onChange={(event) => onChange(event.target.value)} type="search" placeholder="Search" aria-label="Search people" className="h-11 w-full rounded-full border bg-white pl-12 pr-4 text-sm outline-none placeholder:text-gray-500 focus:ring-2 focus:ring-teal" style={{ borderColor: "rgba(0,0,0,0.2)" }} />
    </label>
  );
}

function NewMessagePicker({ onSelect, onGroupChat, onClose }: { onSelect: (person: Person) => void; onGroupChat: () => void; onClose: () => void }): JSX.Element {
  const [query, setQuery] = useState("");
  const searching = query.trim().length >= 3;
  const { data: people = [], isLoading: searchLoading } = useMessagePeopleSearch(query);
  const { data: suggestions = [], isLoading: suggestionsLoading, isError: suggestionsFailed } = useMessageSuggestions(!searching);
  return (
    <div className="mx-auto w-full max-w-xl px-6 py-7">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900">New message</h2>
        <button type="button" onClick={onClose} className="rounded-full px-2 py-1 text-sm text-gray-500 hover:bg-black/5">Cancel</button>
      </div>
      <ComposerSearchField autoFocus value={query} onChange={setQuery} />
      {!searching && (
        <button type="button" onClick={onGroupChat} className="mt-4 flex w-full items-center gap-3.5 rounded-xl px-2 py-3 text-left transition hover:bg-black/[0.035] focus:outline-none focus:ring-2 focus:ring-teal">
          <span className="flex h-10 w-10 items-center justify-center rounded-full text-teal" style={{ background: "rgba(15,166,166,0.1)", color: "#0FA6A6" }}><PeopleIcon size={20} /></span>
          <span className="flex-1 text-[15px] font-semibold text-gray-900">Group chat</span>
          <span aria-hidden className="text-gray-400">›</span>
        </button>
      )}
      <p className="mt-5 text-sm font-bold text-gray-600">{searching ? "Results" : "Suggested"}</p>
      <div className="mt-2">
        {searching
          ? searchLoading ? <p className="py-4 text-sm text-gray-500">Searching…</p> : people.length ? people.map((person) => <PersonRow key={person.user_id} person={person} onClick={() => onSelect(person)} />) : <p className="px-2 py-3 text-sm text-gray-500">No people found.</p>
          : <SuggestedPeople people={suggestions} loading={suggestionsLoading} failed={suggestionsFailed} onSelect={onSelect} />}
      </div>
    </div>
  );
}

function NewGroupPicker({ onBack, onContinue }: { onBack: () => void; onContinue: (ids: string[], name: string | null) => void }): JSX.Element {
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Person[]>([]);
  const searching = query.trim().length >= 3;
  const { data: people = [], isLoading: searchLoading } = useMessagePeopleSearch(query);
  const { data: suggestions = [], isLoading: suggestionsLoading, isError: suggestionsFailed } = useMessageSuggestions(!searching);
  const selectedIds = new Set(selected.map((person) => person.user_id));
  const toggle = (person: Person) => setSelected((current) => current.some((item) => item.user_id === person.user_id) ? current.filter((item) => item.user_id !== person.user_id) : [...current, person]);
  return (
    <div className="mx-auto w-full max-w-xl px-6 py-7">
      <div className="flex items-center justify-between gap-3">
        <button type="button" onClick={onBack} aria-label="Back to new message" className="rounded-full px-2 py-1 text-lg text-gray-500 hover:bg-black/5">‹</button>
        <h2 className="flex-1 text-center text-xl font-bold text-gray-900">New group chat</h2>
        {/* Same minimum as mobile: at least one other person before Next. */}
        <button type="button" disabled={!selected.length} onClick={() => onContinue(selected.map((person) => person.user_id), name.trim() || null)} className="rounded-full px-2 py-1 text-sm font-semibold text-teal transition hover:bg-black/5 disabled:text-gray-400 disabled:hover:bg-transparent">Next</button>
      </div>
      <input value={name} onChange={(event) => setName(event.target.value)} maxLength={60} placeholder="Group name (optional)" aria-label="Group name (optional)" className="mt-4 h-11 w-full rounded-xl border bg-white px-4 text-sm outline-none placeholder:text-gray-500 focus:ring-2 focus:ring-teal" style={{ borderColor: "rgba(0,0,0,0.2)" }} />
      <ComposerSearchField value={query} onChange={setQuery} />
      {selected.length > 0 && <p className="mt-3 text-xs text-gray-500">{selected.map((person) => person.full_name?.trim() || person.username).join(", ")}</p>}
      <p className="mt-5 text-sm font-bold text-gray-600">{searching ? "Results" : "Suggested"}</p>
      <div className="mt-2">
        {searching
          ? searchLoading ? <p className="py-4 text-sm text-gray-500">Searching…</p> : people.length ? people.map((person) => <PersonRow key={person.user_id} person={person} selected={selectedIds.has(person.user_id)} onClick={() => toggle(person)} />) : <p className="px-2 py-3 text-sm text-gray-500">No people found.</p>
          : <SuggestedPeople people={suggestions} loading={suggestionsLoading} failed={suggestionsFailed} selectedIds={selectedIds} onSelect={toggle} />}
      </div>
    </div>
  );
}

function DraftThread({ userId, draftPerson, groupName, groupIds, onMaterialized, onError }: { userId: string; draftPerson: Person | null | undefined; groupName: string | null; groupIds: string[]; onMaterialized: (id: string) => void; onError: (message: string) => void }): JSX.Element {
  const label = draftPerson ? `To: @${draftPerson.username}` : groupIds.length ? groupName || "New group" : "New message";
  const send = async (text: string, file?: File) => {
    try {
      const tag = clientTag();
      let conversationId: string;
      let firstMessageStored = false;
      if (draftPerson) conversationId = await getOrCreateDirectConversation(draftPerson.user_id);
      else if (groupIds.length && text.trim() && !file) {
        conversationId = await createGroupConversation(groupIds, groupName, text, tag);
        firstMessageStored = true;
      } else if (groupIds.length) conversationId = await createGroupConversation(groupIds, groupName, "", clientTag());
      else throw new Error("Choose a recipient first.");
      if (file) {
        const attachment = await uploadAttachment(conversationId, file);
        await sendMessage({ conversationId, channelId: null, content: text, messageType: attachment.type, attachment, tag });
      } else if (!firstMessageStored) {
        await sendMessage({ conversationId, channelId: null, content: text, tag });
      }
      onMaterialized(conversationId);
    } catch (error) { onError(error instanceof Error ? error.message : "Couldn’t send the message."); }
  };
  return <ThreadShell title={label} subtitle={draftPerson ? draftPerson.full_name : null}><EmptyThread label="Start the conversation" /><Composer onSend={send} /></ThreadShell>;
}

function ChannelHub({ conversationId, conversationName, userId, participants, isOfficer, isOfficersChat, onOpenChannel, onBack, onCreateChannel, onRenameChannel, onDeleteChannel, onSetPermission }: { conversationId: string; conversationName: string; userId: string; participants: Array<Person & { joined_at: string; role: string }>; isOfficer: boolean; isOfficersChat: boolean; onOpenChannel: (channel: ChannelPreview) => void; onBack: () => void; onCreateChannel: (name: string) => Promise<void>; onRenameChannel: (channelId: string, name: string) => Promise<void>; onDeleteChannel: (channelId: string) => Promise<void>; onSetPermission: (channelId: string, permission: PostingPermission, userIds: string[]) => Promise<void> }): JSX.Element {
  const { data: channels = [], isLoading } = useMessageHub(conversationId, userId);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [configuring, setConfiguring] = useState<ChannelPreview | null>(null);
  return <div className="mx-auto max-w-2xl px-5 py-6">
    <div className="flex items-center gap-3">
      <button type="button" onClick={onBack} aria-label="Back to messages" className="rounded-full p-2 text-lg text-gray-950 hover:bg-black/5">‹</button>
      <div className="min-w-0"><h2 className="truncate text-xl font-bold text-gray-900">{conversationName}</h2><p className="text-sm text-gray-500">Choose a chat</p></div>
      {/* Add Channel is officer-only. A member never sees this control, exactly
          as on mobile, where the CHANNELS header carries no action for them. */}
      {isOfficer && !adding && <button type="button" onClick={() => setAdding(true)} className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border border-teal px-4 py-2 text-sm font-semibold text-teal hover:bg-teal/5"><PlusIcon size={15} />Add Channel</button>}
    </div>

    {isOfficer && adding && <form onSubmit={(event) => { event.preventDefault(); if (!name.trim()) return; void onCreateChannel(name.trim()).finally(() => { setAdding(false); setName(""); }); }} className="mt-4 flex gap-2">
      <input autoFocus value={name} onChange={(event) => setName(event.target.value)} maxLength={60} placeholder="New channel" aria-label="New channel name" className="min-w-0 flex-1 rounded-full border bg-white px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-teal" />
      <button className="rounded-full bg-teal px-4 text-sm font-semibold text-white">Create</button>
      <button type="button" onClick={() => { setAdding(false); setName(""); }} className="rounded-full px-3 text-sm font-semibold text-gray-600">Cancel</button>
    </form>}

    {isLoading ? <SidebarSkeleton /> : <div className="mt-5 space-y-2">{channels.map((channel) => <div key={channel.id} className="rounded-xl border bg-white p-3 shadow-sm">
      <button type="button" onClick={() => onOpenChannel(channel)} className="flex w-full items-center gap-3 rounded-lg text-left transition hover:bg-teal/[0.025] focus:outline-none focus:ring-2 focus:ring-teal">
        {/* Mobile marks Main chat with the chat-bubbles glyph and every custom
            channel with the price-tag glyph — never a bare "#" for both. */}
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-teal/10 text-teal">{channel.kind === "main" ? <ChatBubblesIcon size={20} filled /> : <TagIcon size={20} filled />}</span>
        <span className="min-w-0 flex-1"><span className="flex"><span className="truncate font-semibold text-gray-900">{channelLabel(channel)}</span><span className="ml-auto shrink-0 text-xs text-gray-400">{shortTime(channel.last_at)}</span></span><span className="mt-1 flex"><span className="truncate text-xs text-gray-500">{channel.last_sender ? `${channel.last_sender}: ` : ""}{channel.last_preview ?? (channel.kind === "main" ? "No messages yet" : `No messages in #${channel.name} yet`)}</span>{channel.unread_count > 0 && <span className="ml-auto shrink-0 rounded-full bg-teal px-1.5 text-[10px] font-bold text-white">{channel.unread_count}</span>}</span></span>
      </button>
      {/* Officer-only channel management. Rename and Delete are restricted to
          `kind === "channel"`: Main chat is a permanent, structural thread and
          must never pick up a custom channel's destructive actions. */}
      {isOfficer && <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3 text-xs" style={{ borderColor: "rgba(0,0,0,0.08)" }}>
        <label className="font-semibold text-gray-600">Posting <select value={channel.post_permission} aria-label={`Who can post in ${channelLabel(channel)}`} onChange={(event) => { const permission = event.target.value as PostingPermission; if (permission === "certain") { setConfiguring(channel); } else void onSetPermission(channel.id, permission, []); }} className="ml-1 rounded border bg-white px-1 py-1"><option value="everyone">{isOfficersChat ? "All officers" : "Everyone"}</option><option value="officers">Only officers</option><option value="certain">Certain people</option></select></label>
        {channel.kind === "channel" && <>
          <button type="button" onClick={() => { const next = window.prompt("New channel name", channel.name); if (next?.trim()) void onRenameChannel(channel.id, next.trim()); }} className="rounded border px-2 py-1 font-semibold text-teal hover:bg-teal/5">Rename</button>
          <button type="button" onClick={() => { if (window.confirm(`Delete #${channel.name}? This also removes its messages.`)) void onDeleteChannel(channel.id); }} className="rounded border border-red-200 px-2 py-1 font-semibold text-red-600 hover:bg-red-50">Delete</button>
        </>}
      </div>}
    </div>)}</div>}

    {configuring && <PermissionsSheet channel={configuring} participants={participants} isOfficersChat={isOfficersChat} onClose={() => setConfiguring(null)} onSave={(permission, userIds) => onSetPermission(configuring.id, permission, userIds)} />}
  </div>;
}

function ConversationThread({ userId, conversationId, channelId, details, channelName, canPost: fallbackCanPost, onOpenHub, onBack, onOpenInfo, onOpenProfile, onInvalidate, onError }: { userId: string; conversationId: string; channelId: string | null; details: NonNullable<ReturnType<typeof useMessageDetails>["data"]>; channelName: string | null; canPost?: boolean; onOpenHub?: () => void; onBack?: () => void; onOpenInfo: () => void; onOpenProfile: (id: string) => void; onInvalidate: () => void; onError: (message: string) => void }): JSX.Element {
  const { data: page, isLoading } = useMessageThread(conversationId, channelId, userId);
  const { data: permitted } = useMessagePermission(channelId);
  const queryClient = useQueryClient();
  const messages = useMemo(() => [...(page?.messages ?? [])].reverse(), [page?.messages]);
  const actualCanPost = channelId ? permitted === true : fallbackCanPost !== false;
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!conversationId) return;
    if (channelId) void markChannelRead(channelId); else void markConversationRead(conversationId);
    void queryClient.invalidateQueries({ queryKey: ["unreadSummary", userId] });
  }, [channelId, conversationId, queryClient, userId]);
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [messages.length]);
  const send = async (text: string, file?: File) => {
    try {
      if (file) {
        const attachment = await uploadAttachment(conversationId, file);
        await sendMessage({ conversationId, channelId, content: text, messageType: attachment.type, attachment });
      } else await sendMessage({ conversationId, channelId, content: text });
      onInvalidate();
    } catch (error) { onError(error instanceof Error ? error.message : "Couldn’t send the message."); }
  };
  const emptyLabel = channelName && channelName.startsWith("#") ? `No messages in ${channelName} yet` : "No messages yet";
  return <ThreadShell title={channelName ?? details.name} subtitle={channelName ? details.name : null} onOpenHub={onOpenHub} onBack={onBack} onOpenInfo={onOpenInfo}><div ref={listRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-5 py-5">{isLoading ? <p className="m-auto text-sm text-gray-500">Loading messages…</p> : messages.length ? messages.map((message, index) => <MessageBubble key={message.id} message={message} isOwn={message.sender_id === userId} showSender={index === 0 || messages[index - 1]?.sender_id !== message.sender_id} userId={userId} onOpenProfile={onOpenProfile} onChanged={onInvalidate} onError={onError} />) : <EmptyThread label={emptyLabel} />}</div><Composer disabled={!actualCanPost} disabledReason={channelId && permitted === false ? "Only club officers can post in this chat." : undefined} allowPolls={details.type !== "direct"} onSend={send} onPoll={async (poll) => { try { await createPoll({ conversationId, channelId, question: poll.question, options: poll.options, allowMultiple: poll.allowMultiple, startAt: poll.startAt, endAt: poll.endAt }); onInvalidate(); } catch (error) { onError(error instanceof Error ? error.message : "Couldn’t create the poll."); } }} /></ThreadShell>;
}

function ThreadShell({ title, subtitle, onOpenHub, onBack, onOpenInfo, children }: { title: string; subtitle: string | null; onOpenHub?: () => void; onBack?: () => void; onOpenInfo?: () => void; children: React.ReactNode }): JSX.Element {
  // `md:h-full` (not a viewport min-height) keeps the thread exactly as tall as
  // its column, so the message list scrolls internally and the page does not.
  return <div className="flex min-h-[calc(100vh-88px)] flex-col md:h-full md:min-h-0"><header className="relative flex min-h-[76px] shrink-0 items-center justify-center border-b px-5 text-center" style={{ borderColor: "rgba(0,0,0,0.16)" }}>{onBack && <button type="button" onClick={onBack} aria-label="Back" className="absolute left-3 rounded-full p-2 text-lg text-gray-950 hover:bg-black/5">‹</button>}<div className="flex min-w-0 items-center gap-2">{onOpenHub && <button type="button" onClick={onOpenHub} aria-label="Open channel navigator" className="rounded-full p-2 text-lg text-gray-950 hover:bg-black/5">☰</button>}<button type="button" onClick={onOpenInfo} className="min-w-0 rounded-lg px-2 py-1 transition hover:bg-black/[0.03] focus:outline-none focus:ring-2 focus:ring-teal" aria-label={`${title} information`}><span className="block truncate text-xl font-bold text-gray-950">{title}{onOpenInfo && <span className="ml-2 text-teal">›</span>}</span>{subtitle && <span className="block truncate text-sm font-semibold text-gray-500">{subtitle}</span>}</button></div></header>{children}</div>;
}

function EmptyThread({ label }: { label: string }): JSX.Element { return <p className="m-auto text-sm text-gray-400">{label}</p>; }

function Composer({ disabled = false, disabledReason, allowPolls = false, onSend, onPoll }: { disabled?: boolean; disabledReason?: string; allowPolls?: boolean; onSend: (text: string, file?: File) => Promise<void>; onPoll?: (poll: PollDraft) => Promise<void> }): JSX.Element {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [pollOpen, setPollOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const submit = async (file?: File) => { if (sending || (!text.trim() && !file)) return; setSending(true); try { await onSend(text, file); setText(""); if (fileRef.current) fileRef.current.value = ""; } finally { setSending(false); } };
  // Mobile shows the same megaphone + sentence in place of the input when the
  // viewer may not post, instead of letting them type into a send that fails.
  if (disabled) return <div className="flex items-center justify-center gap-2 border-t px-5 py-4 text-center text-sm text-gray-500" style={{ borderColor: "rgba(0,0,0,0.16)" }}><MegaphoneIcon size={16} /><span>{disabledReason ?? "You can’t post in this chat."}</span></div>;
  return <><form onSubmit={(event) => { event.preventDefault(); void submit(); }} className="flex items-end gap-2 border-t bg-[#fffdf4] px-5 py-3 shadow-[0_-2px_6px_rgba(0,0,0,0.12)]" style={{ borderColor: "rgba(0,0,0,0.16)" }}>
    {/* The composer uses the normal app face. It was previously `italic`, which
        rendered every draft — and the placeholder — in a slanted face that read
        as cursive and matched nothing else in the product. */}
    <textarea value={text} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submit(); } }} maxLength={2000} rows={1} placeholder="Message…" aria-label="Message" className="min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-sm not-italic outline-none placeholder:text-gray-500 focus:ring-2 focus:ring-teal" />
    <input ref={fileRef} type="file" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void submit(file); }} />
    <button type="button" onClick={() => fileRef.current?.click()} aria-label="Attach a file" className="rounded-full p-2 text-gray-950 hover:bg-black/5"><PaperclipIcon size={20} /></button>
    {allowPolls && <button type="button" onClick={() => setPollOpen(true)} aria-label="Create a poll" className="rounded-full p-2 text-gray-950 hover:bg-black/5"><ListIcon size={20} /></button>}
    <button disabled={sending || !text.trim()} aria-label="Send message" className="rounded-full bg-teal px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">{sending ? "…" : "Send"}</button>
  </form>{pollOpen && onPoll && <PollComposer onClose={() => setPollOpen(false)} onSubmit={async (poll) => { await onPoll(poll); setPollOpen(false); }} />}</>;
}

function MessageBubble({ message, isOwn, showSender, userId, onOpenProfile, onChanged, onError }: { message: ThreadMessage; isOwn: boolean; showSender: boolean; userId: string; onOpenProfile: (id: string) => void; onChanged: () => void; onError: (message: string) => void }): JSX.Element {
  const [menu, setMenu] = useState(false);
  const [attachment, setAttachment] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const closeMenu = useCallback(() => setMenu(false), []);
  useEscapeAndOutside(menuRef, closeMenu);
  useEffect(() => { let alive = true; if (message.attachment_url) void signedAttachmentUrl(message.attachment_url).then((url) => { if (alive) setAttachment(url); }).catch(() => {}); return () => { alive = false; }; }, [message.attachment_url]);
  const mutate = async (action: () => Promise<void>) => { setMenu(false); try { await action(); onChanged(); } catch { onError("Couldn’t update the message."); } };
  return <div className={`mb-3 flex gap-2 ${isOwn ? "justify-end" : "justify-start"}`}>{!isOwn && <button type="button" onClick={() => onOpenProfile(message.sender_id!)} aria-label={`Open ${message.sender.username}'s profile`} className="self-end"><Avatar uri={message.sender.avatar_url} size={28} name={message.sender.full_name ?? message.sender.username} /></button>}<div className={`group relative max-w-[78%] rounded-2xl px-3 py-2 shadow-[0_2px_4px_rgba(0,0,0,0.15)] ${isOwn ? "bg-teal text-white" : "bg-white text-teal"}`}>{showSender && !isOwn && <button type="button" onClick={() => onOpenProfile(message.sender_id!)} className="mb-0.5 block text-left text-xs font-bold">{message.sender.full_name || `@${message.sender.username}`}</button>}{message.message_type === "poll" && message.poll_id ? <PollCard pollId={message.poll_id} userId={userId} onChanged={onChanged} onError={onError} /> : message.message_type === "shared_event" ? <EventMessage eventId={message.shared_event_id} /> : message.message_type === "shared_post" ? <PostMessage postId={message.shared_post_id} /> : <>{message.content && <p className="whitespace-pre-wrap break-words text-sm">{message.content}</p>}{attachment && (message.message_type === "image" ? <a href={attachment} target="_blank" rel="noreferrer"><img src={attachment} alt={message.attachment_name ?? "Shared image"} className="mt-2 max-h-64 rounded-lg object-cover" /></a> : message.message_type === "video" ? <video controls src={attachment} className="mt-2 max-h-64 rounded-lg" /> : <a href={attachment} target="_blank" rel="noreferrer" className="mt-2 block rounded-lg bg-black/10 px-3 py-2 text-sm underline">📎 {message.attachment_name ?? "Download file"}</a>)}</>}<div className={`mt-1 flex items-center gap-2 text-[10px] ${isOwn ? "text-white/75" : "text-gray-400"}`}><time>{shortTime(message.created_at)}</time><button type="button" aria-label="Message actions" onClick={() => setMenu((open) => !open)} className="rounded px-1 opacity-70 hover:bg-black/10">•••</button></div>{menu && <div ref={menuRef} role="menu" className="absolute bottom-1 right-1 z-20 w-40 rounded-lg border bg-white p-1 text-left text-sm text-gray-800 shadow-lg"><button type="button" role="menuitem" onClick={() => { if (message.content) void navigator.clipboard?.writeText(message.content); setMenu(false); }} className="block w-full rounded px-3 py-2 text-left hover:bg-gray-50">Copy</button><button type="button" role="menuitem" onClick={() => mutate(() => hideMessage(message.id, userId))} className="block w-full rounded px-3 py-2 text-left hover:bg-gray-50">Delete for me</button>{isOwn && <button type="button" role="menuitem" onClick={() => mutate(() => unsendMessage(message.id))} className="block w-full rounded px-3 py-2 text-left text-red-600 hover:bg-red-50">Unsend for everyone</button>}{!isOwn && <button type="button" role="menuitem" onClick={() => { const reason = window.prompt(`Report reason: ${REPORT_REASONS.join(", ")}`); if (reason && REPORT_REASONS.includes(reason)) void mutate(() => reportMessage(message.id, reason)); }} className="block w-full rounded px-3 py-2 text-left text-red-600 hover:bg-red-50">Report</button>}</div>}</div></div>;
}

function PollCard({ pollId, userId, onChanged, onError }: { pollId: string; userId: string; onChanged: () => void; onError: (message: string) => void }): JSX.Element {
  const { data: poll } = useQuery({ queryKey: ["messages", "poll", pollId, userId], queryFn: () => getPoll(pollId, userId), staleTime: 0 });
  const queryClient = useQueryClient();
  if (!poll) return <p className="text-sm">Loading poll…</p>;
  const closed = !!poll.end_at && new Date(poll.end_at) < new Date();
  return <div className="min-w-[200px] text-sm"><p className="font-bold">{poll.question}</p><div className="mt-2 space-y-1">{poll.options.map((option) => <button key={option.id} disabled={closed} onClick={async () => { try { await votePoll(pollId, option.id); await queryClient.invalidateQueries({ queryKey: ["messages", "poll", pollId] }); onChanged(); } catch { onError("Couldn’t record that vote."); } }} className={`flex w-full items-center justify-between rounded-lg border px-2 py-1.5 text-left disabled:opacity-60 ${option.selected ? "border-teal bg-teal/10" : "border-black/10 bg-white/70"}`}><span>{option.selected ? "✓ " : ""}{option.option_text}</span><span className="text-xs text-gray-500">{option.votes}</span></button>)}</div>{closed && <p className="mt-2 text-xs text-gray-500">Poll closed</p>}</div>;
}

function EventMessage({ eventId }: { eventId: string | null }): JSX.Element {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  if (!eventId) return <p className="text-sm">Shared an event</p>;
  return <button type="button" onClick={() => { const next = new URLSearchParams(params.toString()); next.set("event", eventId); router.push(`${pathname}?${next.toString()}`, { scroll: false }); }} className="rounded-lg bg-black/10 px-3 py-2 text-left text-sm font-semibold underline">📅 View shared event</button>;
}

function PostMessage({ postId }: { postId: string | null }): JSX.Element {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  if (!postId) return <p className="text-sm">Shared a post</p>;
  return <button type="button" onClick={() => { const next = new URLSearchParams(params.toString()); next.set("post", postId); router.push(`${pathname}?${next.toString()}`, { scroll: false }); }} className="rounded-lg bg-black/10 px-3 py-2 text-left text-sm font-semibold underline">🖼️ View shared post</button>;
}

export interface PollDraft { question: string; options: string[]; allowMultiple: boolean; startAt: string | null; endAt: string | null }

/** Mobile's cap. There is no database constraint on option count, so this stays
 *  the single source of truth and must match `PollComposer.tsx`. */
const POLL_MAX_OPTIONS = 8;
const POLL_MIN_OPTIONS = 2;

/** Combines a native `date` value and a native `time` value into an ISO instant
 *  in the viewer's own timezone. A date with no time means midnight local, which
 *  is what a person picking only a day means. A time with no date is not a
 *  usable instant and is reported rather than silently guessed. */
function combineDateTime(date: string, time: string): { iso: string | null; error: string | null } {
  if (!date && !time) return { iso: null, error: null };
  if (!date && time) return { iso: null, error: "Choose a date to go with that time." };
  const parsed = new Date(`${date}T${time || "00:00"}`);
  if (Number.isNaN(parsed.getTime())) return { iso: null, error: "That date and time isn’t valid." };
  return { iso: parsed.toISOString(), error: null };
}

/**
 * Desktop poll composer with the same functional structure as mobile's
 * full-screen `PollComposer`: question, options, add option, allow multiple
 * answers, and a Duration block with Start/End date + time.
 *
 * It is deliberately a centred, scrollable desktop modal rather than a copy of
 * the mobile full-screen sheet, and it reuses the same `create_poll` RPC — so
 * poll permission follows the chat's posting permission, and a poll made here
 * is the same row a poll made on a phone is.
 */
function PollComposer({ onClose, onSubmit }: { onClose: () => void; onSubmit: (poll: PollDraft) => Promise<void> }): JSX.Element {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [allowMultiple, setAllowMultiple] = useState(false);
  const [startDate, setStartDate] = useState(""); const [startTime, setStartTime] = useState("");
  const [endDate, setEndDate] = useState(""); const [endTime, setEndTime] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEscapeAndOutside(dialogRef, onClose);

  const filled = options.map((option) => option.trim()).filter(Boolean);
  const canSend = question.trim().length > 0 && filled.length >= POLL_MIN_OPTIONS && !sending;

  const submit = () => {
    // Same validation order and wording as mobile, so a poll rejected on one
    // platform is rejected on the other for the same stated reason.
    if (!question.trim()) return setError("Add a question.");
    if (filled.length < POLL_MIN_OPTIONS) return setError(`Add at least ${POLL_MIN_OPTIONS} options.`);
    const start = combineDateTime(startDate, startTime);
    if (start.error) return setError(start.error);
    const end = combineDateTime(endDate, endTime);
    if (end.error) return setError(end.error);
    // 60s grace so "now" is not rejected as past.
    if (start.iso && new Date(start.iso).getTime() < Date.now() - 60_000) return setError("Start can’t be in the past.");
    if (end.iso && !start.iso && new Date(end.iso).getTime() <= Date.now()) return setError("End must be in the future.");
    if (start.iso && end.iso && new Date(end.iso) <= new Date(start.iso)) return setError("End must be after start.");
    setError(null);
    setSending(true);
    void onSubmit({ question: question.trim(), options: filled, allowMultiple, startAt: start.iso, endAt: end.iso })
      .catch(() => setError("Could not send the poll. Try again."))
      .finally(() => setSending(false));
  };

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Create poll" className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-cream shadow-2xl">
      <div className="flex shrink-0 items-center justify-between border-b px-5 py-3" style={{ borderColor: "rgba(0,0,0,0.12)" }}>
        <button type="button" onClick={onClose} aria-label="Close poll composer" className="rounded-full p-1.5 text-gray-950 hover:bg-black/5"><CloseIcon size={20} /></button>
        <h3 className="text-lg font-bold text-gray-950">Poll</h3>
        <button type="button" onClick={submit} disabled={!canSend} className="rounded-full bg-teal px-4 py-1.5 text-sm font-semibold text-white shadow-sm disabled:opacity-45">{sending ? "…" : "Send"}</button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {error && <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <label className="block text-[15px] font-semibold text-gray-950" htmlFor="poll-question">Ask a question</label>
        <input id="poll-question" autoFocus value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={200} placeholder="What do you want to ask?" className="mt-2 h-12 w-full rounded-3xl bg-white px-4 text-[15px] shadow-sm outline-none focus:ring-2 focus:ring-teal" />

        <p className="mt-4 text-[15px] font-semibold text-gray-950">Poll options</p>
        {options.map((option, index) => <div key={index} className="mt-2 flex items-center gap-2">
          <input value={option} onChange={(event) => setOptions((items) => items.map((item, position) => position === index ? event.target.value : item))} maxLength={100} placeholder={`Option ${index + 1}`} aria-label={`Poll option ${index + 1}`} className="h-11 min-w-0 flex-1 rounded-3xl bg-white px-4 text-[15px] shadow-sm outline-none focus:ring-2 focus:ring-teal" />
          {options.length > POLL_MIN_OPTIONS && <button type="button" onClick={() => setOptions((items) => items.filter((_, position) => position !== index))} aria-label={`Remove option ${index + 1}`} className="rounded-full p-1 text-gray-400 hover:bg-black/5"><CloseCircleIcon size={20} /></button>}
        </div>)}
        {options.length < POLL_MAX_OPTIONS && <button type="button" onClick={() => setOptions((items) => [...items, ""])} className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-teal"><PlusIcon size={16} />Add option</button>}

        <div className="mt-5 flex items-center justify-between">
          <label htmlFor="poll-multiple" className="text-[15px] font-semibold text-gray-950">Allow multiple answers</label>
          <input id="poll-multiple" type="checkbox" checked={allowMultiple} onChange={(event) => setAllowMultiple(event.target.checked)} className="h-5 w-9 shrink-0 cursor-pointer accent-teal" />
        </div>

        <p className="mt-5 text-[15px] font-semibold text-gray-950">Duration</p>
        <PollDurationRow label="Start" date={startDate} time={startTime} onDate={setStartDate} onTime={setStartTime} />
        <PollDurationRow label="End" date={endDate} time={endTime} onDate={setEndDate} onTime={setEndTime} />
        <p className="mt-2 text-xs italic text-gray-500">Leave empty to start the poll now with no end time.</p>
      </div>
    </div>
  </div>;
}

function PollDurationRow({ label, date, time, onDate, onTime }: { label: string; date: string; time: string; onDate: (value: string) => void; onTime: (value: string) => void }): JSX.Element {
  return <div className="mt-3 flex flex-wrap items-center gap-3">
    <span className="w-12 shrink-0 text-[15px] font-semibold text-gray-950">{label}</span>
    <input type="date" value={date} onChange={(event) => onDate(event.target.value)} aria-label={`${label} date`} className="h-10 rounded-2xl bg-white px-3 text-sm shadow-sm outline-none focus:ring-2 focus:ring-teal" />
    <input type="time" value={time} onChange={(event) => onTime(event.target.value)} aria-label={`${label} time`} className="h-10 rounded-2xl bg-white px-3 text-sm shadow-sm outline-none focus:ring-2 focus:ring-teal" />
    {(date || time) && <button type="button" onClick={() => { onDate(""); onTime(""); }} aria-label={`Clear ${label.toLowerCase()}`} className="rounded-full p-1 text-gray-400 hover:bg-black/5"><CloseCircleIcon size={18} /></button>}
  </div>;
}

/**
 * Chat details, in the desktop right-hand panel.
 *
 * The ACTIONS and PERMISSIONS here are a direct transcription of mobile's
 * `app/chat/[chatId]/info.tsx`, which is the functional source of truth:
 *
 *   parent info (the club conversation itself, no channel selected)
 *     · officer + members chat → Add Person, Share
 *     · everyone               → Mute, Archive
 *     · People list + count
 *   thread info (Main chat or a channel)
 *     · everyone               → Search, Mute
 *     · officer                → Permissions
 *     · no People list
 *   direct / custom group
 *     · Search, then Delete (direct) or Leave (group)
 *
 * The panel keeps its desktop shape — it is NOT the mobile full-screen page.
 */
function InfoPanel({ userId, conversationId, channelId, channel, details, isOfficer, infoTab, onClose, onTab, onOpenEvent, onOpenMessage, onOpenProfile, onChanged, onError }: { userId: string; conversationId: string; channelId: string | null; channel: Channel | null; details: NonNullable<ReturnType<typeof useMessageDetails>["data"]>; isOfficer: boolean; infoTab: InfoTab; onClose: () => void; onTab: (tab: InfoTab) => void; onOpenEvent: (id: string) => void; onOpenMessage: (result: MessageSearchResult) => void; onOpenProfile: (id: string) => void; onChanged: () => void; onError: (message: string) => void }): JSX.Element {
  const queryClient = useQueryClient();
  const { data: muted = false } = useMessageMute(conversationId, channelId, userId);
  const { data: convFlags } = useConversationFlags(conversationId, userId);
  const { data: media = [] } = useMessageShared(conversationId, channelId, "image", userId);
  const { data: videos = [] } = useMessageShared(conversationId, channelId, "video", userId);
  const { data: files = [] } = useMessageShared(conversationId, channelId, "file", userId);
  const { data: polls = [] } = useMessageShared(conversationId, channelId, "poll", userId);
  const { data: events = [] } = useMessageEvents(conversationId, channelId, userId);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [permOpen, setPermOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [overflow, setOverflow] = useState(false);
  const overflowRef = useRef<HTMLDivElement>(null);
  const report = useReport();
  const { data: matches = [], isLoading: searchLoading } = useMessageContentSearch(query, conversationId);
  useEscapeAndOutside(overflowRef, useCallback(() => setOverflow(false), []));

  const isDirect = details.type === "direct";
  const isCustomGroup = details.type === "group";
  const isMembersChat = details.type === "club_group";
  const isOfficersChat = details.type === "officer_chat";
  const isOfficialChat = isMembersChat || isOfficersChat;
  const isParentInfo = isOfficialChat && !channelId;
  const isThreadInfo = isOfficialChat && !!channelId;

  // Mobile shows the channel's own name with the club conversation beneath it.
  // The panel previously showed the literal words "Channel" / "Members chat",
  // which told the viewer nothing about which chat they were looking at.
  const title = channel ? channelLabel(channel) : details.name;
  const subtitle = channel
    ? details.name
    : isMembersChat || isOfficersChat ? null
    : `${details.participants.length} participants`;
  const initials = channel ? (channel.kind === "main" ? "MA" : `#${channel.name.slice(0, 1).toUpperCase()}`) : details.name.slice(0, 1).toUpperCase();

  const toggleMute = async () => {
    try {
      if (channelId) await setChannelMuted(channelId, !muted);
      else await setConversationMuted(conversationId, !muted);
      onChanged();
      await queryClient.invalidateQueries({ queryKey: ["messages", "muted"] });
      await queryClient.invalidateQueries({ queryKey: ["messages", "convFlags", conversationId, userId] });
    } catch { onError("Couldn’t update mute settings."); }
  };
  const toggleArchive = async () => {
    try {
      await setConversationArchived(conversationId, !convFlags?.archived);
      onChanged();
      await queryClient.invalidateQueries({ queryKey: ["messages", "convFlags", conversationId, userId] });
    } catch { onError("Couldn’t update archive settings."); }
  };
  const deleteDirect = async () => {
    setConfirmDelete(false);
    try { await deleteDirectConversationForMe(conversationId, userId); onChanged(); onClose(); }
    catch { onError("Could not delete the conversation. Please try again."); }
  };

  const tabs: InfoTab[] = isDirect ? ["media", "events", "files"] : ["polls", "media", "events", "files"];
  // A direct chat has no Polls tab on mobile; if a stale URL still asks for it,
  // fall back rather than rendering an empty, unreachable tab.
  const activeTab: InfoTab = tabs.includes(infoTab) ? infoTab : "media";

  return <aside className="relative flex min-h-0 flex-col border-l bg-[#fffdf4] shadow-xl lg:overflow-hidden lg:shadow-none" style={{ borderColor: "rgba(0,0,0,0.17)" }}>
    <div className="flex shrink-0 items-center justify-between p-4">
      <button type="button" onClick={onClose} aria-label="Close information panel" className="rounded-full p-2 text-xl text-gray-950 hover:bg-black/5">‹</button>
      <div className="relative">
        <button type="button" onClick={() => setOverflow((open) => !open)} aria-label="More chat options" aria-expanded={overflow} className="rounded-full p-2 text-gray-950 hover:bg-black/5"><EllipsisIcon size={20} /></button>
        {overflow && <div ref={overflowRef} role="menu" className="absolute right-0 z-30 mt-1 w-44 rounded-xl border bg-white p-1 text-sm shadow-lg">
          {/* Mobile's chat overflow offers exactly one entry to a non-admin:
              Report, and only on an OFFICIAL chat, where it reports the club.
              Anything more here would be inventing an action mobile lacks. */}
          {isOfficialChat && details.club_id
            ? <button type="button" role="menuitem" onClick={() => { setOverflow(false); const reason = window.prompt(`Report reason: ${REPORT_REASONS.join(", ")}`); if (reason && REPORT_REASONS.includes(reason)) { report.mutate({ entityType: "club", entityId: details.club_id!, entityName: details.name, clubId: details.club_id, reason }, { onSuccess: () => onError(REPORT_RECEIVED_MESSAGE), onError: () => onError("Couldn’t send that report.") }); } }} className="flex w-full items-center gap-2 rounded px-3 py-2 text-left hover:bg-gray-50"><FlagIcon size={16} />Report</button>
            : <p className="px-3 py-2 text-gray-400">No actions available</p>}
        </div>}
      </div>
    </div>

    <div className="shrink-0 px-5 pb-4 text-center">
      <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-teal text-2xl font-bold text-white">{initials}</div>
      <h2 className="mt-3 truncate text-2xl font-bold text-gray-950">{title}</h2>
      {subtitle && <p className="truncate text-sm text-gray-500">{subtitle}</p>}

      <div className="mt-4 flex flex-wrap justify-center gap-6">
        {isParentInfo && isMembersChat && isOfficer && <InfoAction icon={<PersonAddIcon size={22} />} label="Add Person" onClick={() => setShareOpen(true)} />}
        {isParentInfo && isMembersChat && isOfficer && <InfoAction icon={<ShareIcon size={22} />} label="Share" onClick={() => setShareOpen(true)} />}
        {isParentInfo && <>
          <InfoAction icon={<BellOffIcon size={22} filled={!!convFlags?.muted} />} label={convFlags?.muted ? "Unmute" : "Mute"} onClick={() => void toggleMute()} />
          <InfoAction icon={<ArchiveIcon size={22} filled={!!convFlags?.archived} />} label={convFlags?.archived ? "Unarchive" : "Archive"} onClick={() => void toggleArchive()} />
        </>}
        {isThreadInfo && <>
          <InfoAction icon={<SearchIcon size={22} />} label="Search" onClick={() => setSearchOpen((open) => !open)} />
          <InfoAction icon={<BellOffIcon size={22} filled={muted} />} label={muted ? "Unmute" : "Mute"} onClick={() => void toggleMute()} />
          {isOfficer && <InfoAction icon={<LockIcon size={22} />} label="Permissions" onClick={() => setPermOpen(true)} />}
        </>}
        {!isOfficialChat && <>
          <InfoAction icon={<SearchIcon size={22} />} label="Search" onClick={() => setSearchOpen((open) => !open)} />
          <InfoAction icon={isDirect ? <TrashIcon size={22} /> : <ExitIcon size={22} />} label={isDirect ? "Delete" : "Leave"} onClick={() => setConfirmDelete(true)} />
        </>}
      </div>

      {searchOpen && <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search this chat" aria-label="Search this chat" className="mt-4 h-10 w-full rounded-full border bg-white px-4 text-sm outline-none focus:ring-2 focus:ring-teal" style={{ borderColor: "rgba(0,0,0,0.2)" }} />}
    </div>

    <div role="tablist" aria-label="Chat content" className={`grid shrink-0 border-y grid-cols-${tabs.length}`} style={{ borderColor: "rgba(0,0,0,0.1)", gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
      {tabs.map((tab) => <InfoTabButton key={tab} tab={tab} active={activeTab === tab} onClick={() => onTab(tab)} />)}
    </div>

    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      {query.trim().length >= 3 ? <div className="space-y-2">{searchLoading ? <p className="py-4 text-sm text-gray-500">Searching this conversation…</p> : matches.length ? matches.map((result) => <MessageSearchRow key={result.message_id} result={result} onClick={() => onOpenMessage(result)} />) : <EmptyPanel label="No messages match that search" />}</div> : <>
        {activeTab === "polls" && <SharedPolls messages={polls} userId={userId} onError={onError} />}
        {activeTab === "media" && <SharedMedia messages={[...media, ...videos]} />}
        {activeTab === "events" && <div className="space-y-2">{events.length ? events.map((event) => <button key={event.event_id} type="button" onClick={() => onOpenEvent(event.event_id)} className="flex w-full gap-3 rounded-xl border bg-white p-2 text-left hover:bg-teal/[0.03]">{event.cover_image_url && <img src={event.cover_image_url} alt="" className="h-14 w-14 rounded-lg object-cover" />}<span className="min-w-0"><span className="block truncate text-sm font-bold">{event.emoji ? `${event.emoji} ` : ""}{event.title}</span><span className="block text-xs text-gray-500">{event.event_date}{event.start_time ? ` · ${event.start_time}` : ""}</span></span></button>) : <EmptyPanel label="No shared events yet" />}</div>}
        {activeTab === "files" && <SharedFiles messages={files} />}

        {/* People + count, exactly where mobile puts it: the conversation-level
            info and custom groups, never a channel thread. */}
        {(isParentInfo || (isCustomGroup && !isDirect)) && <div className="mt-6 border-t pt-4" style={{ borderColor: "rgba(0,0,0,0.1)" }}>
          <div className="flex items-baseline justify-between"><p className="text-base font-bold text-gray-950">{isOfficersChat ? "Officers" : "People"}</p><span className="text-sm text-gray-500">{details.participants.length}</span></div>
          <div className="mt-2 space-y-1">{details.participants.slice(0, 4).map((person) => <button key={person.user_id} type="button" onClick={() => onOpenProfile(person.user_id)} className="flex w-full items-center gap-3 rounded-lg px-1 py-1.5 text-left hover:bg-black/[0.035]"><Avatar uri={person.avatar_url} size={36} name={person.full_name ?? person.username} /><span className="min-w-0 flex-1"><span className="block text-xs text-gray-500">{person.role}</span><span className="block truncate text-sm font-semibold text-gray-900">{person.full_name?.trim() || person.username}</span></span></button>)}</div>
          {details.participants.length > 4 && <p className="mt-2 px-1 text-sm font-semibold text-teal">See all {details.participants.length} people</p>}
        </div>}
      </>}
    </div>

    {permOpen && channel && <PermissionsSheet channel={channel} participants={details.participants} isOfficersChat={isOfficersChat} onClose={() => setPermOpen(false)} onSave={async (permission, userIds) => {
      try {
        await setChannelPostPermission(channel.id, permission, userIds);
        onChanged();
        // The composer is gated by `can_post_in_channel`; invalidate it so a
        // permission change takes effect immediately rather than after a reload.
        await queryClient.invalidateQueries({ queryKey: ["messages", "canPost"] });
        await queryClient.invalidateQueries({ queryKey: messageKeys.channels(conversationId) });
      } catch { onError("Couldn’t update posting permissions."); }
    }} />}
    {shareOpen && <ShareInvitePanel conversationName={details.name} onClose={() => setShareOpen(false)} />}
    {confirmDelete && <ConfirmSheet
      title={isDirect ? "Delete conversation?" : "Leave group?"}
      message={isDirect ? `This removes the conversation from your messages only. ${details.name} keeps their copy. If either of you messages again, the conversation comes back.` : `You'll leave ${details.name}. This has no effect on any club.`}
      confirmLabel={isDirect ? "Delete" : "Leave group"}
      onConfirm={() => { if (isDirect) void deleteDirect(); else { setConfirmDelete(false); onError("Leaving a group chat is available on mobile."); } }}
      onCancel={() => setConfirmDelete(false)} />}
  </aside>;
}

function InfoAction({ icon, label, onClick }: { icon: JSX.Element; label: string; onClick: () => void }): JSX.Element {
  return <button type="button" onClick={onClick} className="flex w-16 flex-col items-center gap-1 text-[11px] font-semibold text-gray-950 focus:outline-none focus:ring-2 focus:ring-teal"><span className="rounded-full p-1">{icon}</span><span className="truncate">{label}</span></button>;
}

/** Same four glyphs mobile uses, in mobile's order: checkbox-outline,
 *  images-outline, calendar-outline, attach-outline. */
function InfoTabButton({ tab, active, onClick }: { tab: InfoTab; active: boolean; onClick: () => void }): JSX.Element {
  const label = tab === "polls" ? "Polls" : tab === "media" ? "Media" : tab === "events" ? "Events" : "Files";
  const icon = tab === "polls" ? <CheckboxIcon size={22} /> : tab === "media" ? <ImageIcon size={22} /> : tab === "events" ? <CalendarIcon size={22} /> : <PaperclipIcon size={22} />;
  return <button type="button" role="tab" aria-selected={active} aria-label={label} onClick={onClick} className={`relative flex flex-col items-center gap-1 py-3 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-teal ${active ? "text-teal" : "text-gray-950"}`}>{icon}{active && <span className="absolute bottom-0 h-0.5 w-8 rounded bg-teal" />}</button>;
}

/**
 * "Who can post" — the exact three options mobile offers, with mobile's own
 * context-dependent wording (an officers-only conversation says "All officers"
 * where a members conversation says "Everyone"). This does not invent a
 * permission model; it drives the same `set_channel_post_permission` RPC.
 */
function PermissionsSheet({ channel, participants, isOfficersChat, onClose, onSave }: { channel: Channel; participants: Array<Person & { role: string }>; isOfficersChat: boolean; onClose: () => void; onSave: (permission: PostingPermission, userIds: string[]) => Promise<void> }): JSX.Element {
  const [permission, setPermission] = useState<PostingPermission>(channel.post_permission);
  const [allowed, setAllowed] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEscapeAndOutside(ref, onClose);
  // Seed from the channel's CURRENT allow-list, exactly as mobile does. Without
  // this, opening Permissions on a "certain people" channel and pressing Save
  // would submit an empty list and revoke everyone's access.
  useEffect(() => {
    let alive = true;
    if (channel.post_permission !== "certain") { setAllowed([]); return; }
    void getChannelPosters(channel.id).then((ids) => { if (alive) setAllowed(ids); }).catch(() => {});
    return () => { alive = false; };
  }, [channel.id, channel.post_permission]);
  const everyoneLabel = isOfficersChat ? "All officers" : "Everyone";
  const options: Array<[PostingPermission, string, string]> = [
    ["everyone", everyoneLabel, "Every member of this conversation can post."],
    ["officers", "Only officers", "Members can read; only officers can post."],
    ["certain", "Certain people", "Only the people you select can post."],
  ];
  const save = async () => {
    setSaving(true);
    try { await onSave(permission, allowed); onClose(); }
    finally { setSaving(false); }
  };
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
    <div ref={ref} role="dialog" aria-modal="true" aria-label="Who can post" className="w-full max-w-md rounded-2xl bg-cream p-5 shadow-2xl">
      <h3 className="text-lg font-bold text-gray-950">Who can post</h3>
      <div className="mt-4 space-y-3">{options.map(([value, label, hint]) => <label key={value} className="flex cursor-pointer items-start gap-3"><input type="radio" name="who-can-post" checked={permission === value} onChange={() => setPermission(value)} className="mt-1 accent-teal" /><span><span className="block text-[15px] font-bold text-gray-950">{label}</span><span className="block text-sm text-gray-500">{hint}</span></span></label>)}</div>
      {permission === "certain" && <div className="mt-4 max-h-48 space-y-1 overflow-y-auto rounded-xl bg-white/60 p-2">{participants.map((person) => <label key={person.user_id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm"><input type="checkbox" checked={allowed.includes(person.user_id)} onChange={() => setAllowed((current) => current.includes(person.user_id) ? current.filter((id) => id !== person.user_id) : [...current, person.user_id])} className="accent-teal" /><span>{person.full_name?.trim() || person.username}</span></label>)}</div>}
      <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded-full px-4 py-2 text-sm font-semibold text-gray-600">Cancel</button><button type="button" disabled={saving} onClick={() => void save()} className="rounded-full bg-teal px-5 py-2 text-sm font-semibold text-white disabled:opacity-50">Save</button></div>
    </div>
  </div>;
}

/** Mobile's Share sheet offers Copy link / Show QR / Share… / Reset link. The
 *  web panel offers the two that a browser can honestly perform; it does not
 *  fake a QR code or a link reset it has no endpoint for. */
function ShareInvitePanel({ conversationName, onClose }: { conversationName: string; onClose: () => void }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  useEscapeAndOutside(ref, onClose);
  const url = typeof window === "undefined" ? "" : window.location.href;
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
    <div ref={ref} role="dialog" aria-modal="true" aria-label={`Invite to ${conversationName}`} className="w-full max-w-md rounded-2xl bg-cream p-5 shadow-2xl">
      <h3 className="text-lg font-bold text-gray-950">Invite to {conversationName}</h3>
      <p className="mt-1 text-sm text-gray-500">Anyone from your university with this link can join.</p>
      <button type="button" onClick={() => { void navigator.clipboard?.writeText(url).then(() => setCopied(true)); }} className="mt-4 flex w-full items-center gap-3 rounded-xl bg-white px-3 py-3 text-left text-[15px] font-semibold text-gray-950 hover:bg-teal/[0.04]"><ShareIcon size={20} />{copied ? "Link copied" : "Copy link"}</button>
      <p className="mt-3 text-xs text-gray-500">Adding people directly and QR invites are available in the We Glue app.</p>
      <div className="mt-4 flex justify-end"><button type="button" onClick={onClose} className="rounded-full px-4 py-2 text-sm font-semibold text-gray-600">Close</button></div>
    </div>
  </div>;
}

function ConfirmSheet({ title, message, confirmLabel, onConfirm, onCancel }: { title: string; message: string; confirmLabel: string; onConfirm: () => void; onCancel: () => void }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  useEscapeAndOutside(ref, onCancel);
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
    <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className="w-full max-w-sm rounded-2xl bg-cream p-5 shadow-2xl">
      <h3 className="text-lg font-bold text-gray-950">{title}</h3>
      <p className="mt-2 text-sm text-gray-600">{message}</p>
      <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={onCancel} className="rounded-full px-4 py-2 text-sm font-semibold text-gray-600">Cancel</button><button type="button" onClick={onConfirm} className="rounded-full bg-red-600 px-5 py-2 text-sm font-semibold text-white">{confirmLabel}</button></div>
    </div>
  </div>;
}
function EmptyPanel({ label }: { label: string }): JSX.Element { return <p className="py-10 text-center text-sm text-gray-400">{label}</p>; }
function SharedPolls({ messages, userId, onError }: { messages: ThreadMessage[]; userId: string; onError: (message: string) => void }): JSX.Element { return messages.length ? <div className="space-y-3">{messages.map((message) => message.poll_id && <div key={message.id} className="rounded-xl border bg-white p-3"><PollCard pollId={message.poll_id} userId={userId} onChanged={() => {}} onError={onError} /></div>)}</div> : <EmptyPanel label="No polls yet" />; }
function SharedMedia({ messages }: { messages: ThreadMessage[] }): JSX.Element { return messages.length ? <div className="grid grid-cols-3 gap-2">{messages.map((message) => <SignedMedia key={message.id} message={message} />)}</div> : <EmptyPanel label="No photos or videos yet" />; }
function SignedMedia({ message }: { message: ThreadMessage }): JSX.Element { const [url, setUrl] = useState<string | null>(null); useEffect(() => { if (message.attachment_url) void signedAttachmentUrl(message.attachment_url).then(setUrl).catch(() => {}); }, [message.attachment_url]); return url ? <a href={url} target="_blank" rel="noreferrer" className="aspect-square overflow-hidden rounded-lg bg-black/5">{message.message_type === "video" ? <video src={url} className="h-full w-full object-cover" /> : <img src={url} alt={message.attachment_name ?? "Shared media"} className="h-full w-full object-cover" />}</a> : <div className="aspect-square animate-pulse rounded-lg bg-black/5" />; }
function SharedFiles({ messages }: { messages: ThreadMessage[] }): JSX.Element { return messages.length ? <div className="space-y-2">{messages.map((message) => <SignedFile key={message.id} message={message} />)}</div> : <EmptyPanel label="No files yet" />; }
function SignedFile({ message }: { message: ThreadMessage }): JSX.Element { const [url, setUrl] = useState<string | null>(null); useEffect(() => { if (message.attachment_url) void signedAttachmentUrl(message.attachment_url).then(setUrl).catch(() => {}); }, [message.attachment_url]); return <a href={url ?? undefined} target="_blank" rel="noreferrer" className="block rounded-lg border bg-white px-3 py-2 text-sm font-medium text-teal underline">📎 {message.attachment_name ?? "Download file"}</a>; }

function compareConversation(a: ConversationPreview, b: ConversationPreview): number { return new Date(b.last_message_at ?? 0).getTime() - new Date(a.last_message_at ?? 0).getTime(); }
function previewForSearch(type: string): string { if (type === "poll") return "Poll"; if (type === "shared_event") return "Shared an event"; if (type === "shared_post") return "Shared a post"; if (type === "image") return "Photo"; if (type === "video") return "Video"; if (type === "file") return "File"; return "Message"; }
function shortTime(value: string | null): string { if (!value) return ""; const date = new Date(value); const now = new Date(); if (date.toDateString() === now.toDateString()) return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); if ((now.getTime() - date.getTime()) < 6 * 24 * 60 * 60 * 1000) return date.toLocaleDateString([], { weekday: "short" }); return date.toLocaleDateString([], { month: "short", day: "numeric" }); }
function channelLabel(channel: { kind: "main" | "channel"; name: string }): string { return channel.kind === "main" ? "Main chat" : `#${channel.name}`; }
