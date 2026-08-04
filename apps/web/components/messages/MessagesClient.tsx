"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AppHeader } from "../home/AppHeader";
import { PageOverlays } from "../shared/PageOverlays";
import { Avatar } from "../shared/Avatar";
import { ToastProvider, useToast } from "../shared/Toast";
import { useUnreadSummary } from "../../lib/hooks/useUnreadSummary";
import { messagesHref, isMessageUuid, type MessagesDestination } from "../../lib/messages/routes";
import { useMyClubs } from "../../lib/hooks/useClubTab";
import { useMyClubsRealtime } from "../../lib/hooks/useClubRealtime";
import {
  canPostInChannel,
  clientTag,
  createChannel,
  deleteChannel,
  createGroupConversation,
  createPoll,
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
  setConversationMuted,
  signedAttachmentUrl,
  unsendMessage,
  uploadAttachment,
  votePoll,
  type ChannelPreview,
  type ConversationPreview,
  type MessageSearchResult,
  type Person,
  type PostingPermission,
  type ThreadMessage,
} from "../../lib/messages/service";
import {
  messageKeys,
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

export function MessagesClient({ userId }: { userId: string }): JSX.Element {
  useUnreadSummary(userId);
  useMyClubsRealtime(userId);
  return (
    <ToastProvider>
      <div className="min-h-screen bg-cream">
        <AppHeader userId={userId} />
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
    center = <ChannelHub conversationId={conversationId} userId={userId} participants={details.participants} isOfficer={details.participants.some((p) => p.user_id === userId && p.role === "Officer")} onOpenChannel={(channel) => destination({ filter: "groups", conversationId, channelId: channel.id })} onBack={clearSelection} onCreateChannel={async (name) => {
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
    center = <NewMessagePicker onSelect={openPerson} onClose={() => setComposerMode("none")} />;
  } else if (composerMode === "new-group") {
    center = <NewGroupPicker onClose={() => setComposerMode("none")} onContinue={(ids, name) => {
      setComposerMode("none");
      destination({ filter: "groups", draftGroupIds: ids, draftGroupName: name });
    }} />;
  } else if (isDraft) {
    center = <DraftThread userId={userId} draftPerson={draftPerson} groupName={draftGroupName} groupIds={draftGroupIds} onMaterialized={(id) => destination({ filter, conversationId: id }, true)} onError={(message) => show(message, "error")} />;
  } else if (conversationId && details) {
    center = <ConversationThread userId={userId} conversationId={conversationId} channelId={channelId} details={details} channelName={selectedChannel ? channelLabel(selectedChannel) : null} canPost={channelId ? undefined : true} onOpenHub={details.type === "club_group" || details.type === "officer_chat" ? () => destination({ filter: "groups", conversationId, hub: true }) : undefined} onOpenInfo={() => destination({ filter, conversationId, channelId, info: true, infoTab })} onOpenProfile={(id) => router.push(`/u/${id}`)} onInvalidate={() => invalidateConversation(conversationId)} onError={(message) => show(message, "error")} />;
  } else {
    center = <MessagesLanding noClubs={!clubsLoading && !hasClubs} onJoinClub={() => router.push("/clubs")} />;
  }

  return (
    <main className="mx-auto max-w-[1400px] px-0 py-0 sm:px-4 sm:py-6">
      <div className="overflow-hidden border-y bg-cream shadow-[0_2px_8px_rgba(0,0,0,0.16)] sm:rounded-sm sm:border" style={{ borderColor: "rgba(0,0,0,0.17)", minHeight: "calc(100vh - 88px)" }}>
        <div className={infoOpen && conversationId ? "grid min-h-[calc(100vh-88px)] grid-cols-1 lg:grid-cols-[292px_minmax(0,1fr)_360px]" : "grid min-h-[calc(100vh-88px)] grid-cols-1 md:grid-cols-[292px_minmax(0,1fr)]"}>
          <MessagesSidebar filter={filter} loading={conversationsLoading} conversations={filter === "single" ? directConversations : groupConversations} suggestionsEnabled={filter === "single" && directConversations.length === 0 && !composerMode && !conversationId && !isDraft} activeConversationId={conversationId} onFilter={setFilter} onOpen={openConversation} onNew={() => setComposerMode(filter === "single" ? "new-message" : "new-group")} onOpenPerson={openPerson} onOpenMessage={openSearchResult} />
          <section className="relative min-w-0 bg-[#fffdf4]">{center}</section>
          {infoOpen && conversationId && details && (
            <InfoPanel userId={userId} conversationId={conversationId} channelId={channelId} details={details} infoTab={infoTab} onClose={() => destination({ filter, conversationId, channelId })} onTab={(tab) => destination({ filter, conversationId, channelId, info: true, infoTab: tab })} onOpenEvent={(eventId) => destination({ filter, conversationId, channelId, info: true, infoTab, eventId })} onOpenMessage={openSearchResult} onError={(message) => show(message, "error")} />
          )}
        </div>
      </div>
      <PageOverlays userId={userId} />
    </main>
  );
}

function MessagesSidebar({ filter, loading, conversations, suggestionsEnabled, activeConversationId, onFilter, onOpen, onNew, onOpenPerson, onOpenMessage }: { filter: Filter; loading: boolean; conversations: ConversationPreview[]; suggestionsEnabled: boolean; activeConversationId: string | null; onFilter: (filter: Filter) => void; onOpen: (conversation: ConversationPreview) => void; onNew: () => void; onOpenPerson: (person: Person) => void; onOpenMessage: (result: MessageSearchResult) => void }): JSX.Element {
  const [query, setQuery] = useState("");
  const { data: people = [], isLoading: peopleLoading } = useMessagePeopleSearch(query);
  const { data: contentResults = [], isLoading: contentLoading } = useMessageContentSearch(query, null);
  const { data: suggestions = [] } = useMessageSuggestions(suggestionsEnabled);
  const term = query.trim().toLowerCase();
  const filtered = term ? conversations.filter((conversation) => `${conversation.name} ${conversation.last_message ?? ""}`.toLowerCase().includes(term)) : conversations;
  const active = filtered.filter((conversation) => !conversation.archived).sort(compareConversation);
  const archived = filtered.filter((conversation) => conversation.archived).sort(compareConversation);
  return (
    <aside className="flex min-h-0 flex-col border-b bg-cream md:border-b-0 md:border-r" style={{ borderColor: "rgba(0,0,0,0.17)" }}>
      <div className="px-5 pb-3 pt-5">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-950 font-zain">Chats</h1>
          <button type="button" onClick={onNew} aria-label={filter === "single" ? "Start a new direct message" : "Create a group chat"} className="rounded-full p-1 text-2xl text-gray-950 transition hover:bg-black/5 focus:outline-none focus:ring-2 focus:ring-teal">+</button>
        </div>
        <label className="relative mt-3 block">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-800">⌕</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} type="search" placeholder="Search" className="h-10 w-full rounded-full border bg-white pl-9 pr-9 text-sm outline-none focus:ring-2 focus:ring-teal" style={{ borderColor: "rgba(0,0,0,0.2)", boxShadow: "0 2px 3px rgba(0,0,0,0.16)" }} />
          {query && <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full px-1 text-gray-500 hover:bg-gray-100">×</button>}
        </label>
        <div className="mt-3 flex gap-3" role="tablist" aria-label="Conversation type">
          <FilterButton label="Single" active={filter === "single"} onClick={() => onFilter("single")} />
          <FilterButton label="Groups" active={filter === "groups"} onClick={() => onFilter("groups")} />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-5">
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
            {suggestions.length ? suggestions.map((person) => <PersonRow key={person.user_id} person={person} onClick={() => onOpenPerson(person)} />) : <p className="px-2 text-sm leading-6 text-gray-500">Search above to find people, or browse clubs to meet members.</p>}
          </div>
        )}
        {!loading && !term && active.length === 0 && !suggestionsEnabled && <p className="px-2 py-6 text-sm text-gray-500">No conversations yet.</p>}
        {archived.length > 0 && <details className="mt-3 border-t pt-3"><summary className="cursor-pointer px-2 text-sm font-semibold text-gray-500">Archived ({archived.length})</summary>{archived.map((conversation) => <ConversationRow key={conversation.id} conversation={conversation} active={activeConversationId === conversation.id} onClick={() => onOpen(conversation)} />)}</details>}
      </div>
    </aside>
  );
}

function FilterButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }): JSX.Element {
  return <button type="button" role="tab" aria-selected={active} onClick={onClick} className="rounded-full px-5 py-1 text-sm font-medium shadow-sm transition focus:outline-none focus:ring-2 focus:ring-teal" style={active ? { background: "#0FA6A6", color: "#fff" } : { background: "#fff", color: "#0FA6A6" }}>{label}</button>;
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

function NewMessagePicker({ onSelect, onClose }: { onSelect: (person: Person) => void; onClose: () => void }): JSX.Element {
  const [query, setQuery] = useState("");
  const { data: people = [], isLoading } = useMessagePeopleSearch(query);
  const { data: suggestions = [] } = useMessageSuggestions(query.trim().length < 3);
  const peopleToShow = query.trim().length >= 3 ? people : suggestions;
  return <div className="mx-auto max-w-xl px-6 py-7"><div className="flex items-center justify-between"><h2 className="text-xl font-bold text-gray-900">New message</h2><button type="button" onClick={onClose} className="rounded-full px-2 py-1 text-sm text-gray-500 hover:bg-black/5">Cancel</button></div><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search people (3+ characters)" className="mt-4 h-11 w-full rounded-full border bg-white px-4 text-sm outline-none focus:ring-2 focus:ring-teal" /><p className="mt-5 text-sm font-bold text-gray-600">Suggested</p><div className="mt-2">{isLoading ? <p className="py-4 text-sm text-gray-500">Searching…</p> : peopleToShow.map((person) => <PersonRow key={person.user_id} person={person} onClick={() => onSelect(person)} />)}</div></div>;
}

function NewGroupPicker({ onClose, onContinue }: { onClose: () => void; onContinue: (ids: string[], name: string | null) => void }): JSX.Element {
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Person[]>([]);
  const { data: people = [] } = useMessagePeopleSearch(query);
  const { data: suggestions = [] } = useMessageSuggestions(query.trim().length < 3);
  const peopleToShow = query.trim().length >= 3 ? people : suggestions;
  const selectedIds = new Set(selected.map((person) => person.user_id));
  const toggle = (person: Person) => setSelected((current) => current.some((item) => item.user_id === person.user_id) ? current.filter((item) => item.user_id !== person.user_id) : [...current, person]);
  return <div className="mx-auto max-w-xl px-6 py-7"><div className="flex items-center justify-between"><h2 className="text-xl font-bold text-gray-900">New group chat</h2><button type="button" onClick={onClose} className="rounded-full px-2 py-1 text-sm text-gray-500 hover:bg-black/5">Cancel</button></div><input value={name} onChange={(event) => setName(event.target.value)} maxLength={60} placeholder="Group name (optional)" className="mt-4 h-11 w-full rounded-xl border bg-white px-4 text-sm outline-none focus:ring-2 focus:ring-teal" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search people (3+ characters)" className="mt-3 h-11 w-full rounded-full border bg-white px-4 text-sm outline-none focus:ring-2 focus:ring-teal" />{selected.length > 0 && <p className="mt-3 text-xs text-gray-500">{selected.map((person) => person.full_name || person.username).join(", ")}</p>}<div className="mt-4">{peopleToShow.map((person) => <PersonRow key={person.user_id} person={person} selected={selectedIds.has(person.user_id)} onClick={() => toggle(person)} />)}</div><button type="button" disabled={!selected.length} onClick={() => onContinue(selected.map((person) => person.user_id), name.trim() || null)} className="mt-5 rounded-full bg-teal px-6 py-2.5 text-sm font-semibold text-white disabled:opacity-40">Continue</button></div>;
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

function ChannelHub({ conversationId, userId, participants, isOfficer, onOpenChannel, onBack, onCreateChannel, onRenameChannel, onDeleteChannel, onSetPermission }: { conversationId: string; userId: string; participants: Array<Person & { joined_at: string; role: string }>; isOfficer: boolean; onOpenChannel: (channel: ChannelPreview) => void; onBack: () => void; onCreateChannel: (name: string) => Promise<void>; onRenameChannel: (channelId: string, name: string) => Promise<void>; onDeleteChannel: (channelId: string) => Promise<void>; onSetPermission: (channelId: string, permission: PostingPermission, userIds: string[]) => Promise<void> }): JSX.Element {
  const { data: channels = [], isLoading } = useMessageHub(conversationId, userId);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [configuring, setConfiguring] = useState<ChannelPreview | null>(null);
  const [allowed, setAllowed] = useState<string[]>([]);
  const toggleAllowed = (id: string) => setAllowed((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  return <div className="mx-auto max-w-2xl px-5 py-6"><div className="flex items-center gap-3"><button type="button" onClick={onBack} aria-label="Back to messages" className="rounded-full p-2 text-lg hover:bg-black/5">‹</button><div><h2 className="text-xl font-bold text-gray-900">Channels</h2><p className="text-sm text-gray-500">Choose a chat</p></div></div>{isOfficer && <div className="mt-5">{adding ? <form onSubmit={(event) => { event.preventDefault(); if (!name.trim()) return; void onCreateChannel(name.trim()).finally(() => { setAdding(false); setName(""); }); }} className="flex gap-2"><input autoFocus value={name} onChange={(event) => setName(event.target.value)} maxLength={60} placeholder="Channel name" className="min-w-0 flex-1 rounded-full border bg-white px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-teal" /><button className="rounded-full bg-teal px-4 text-sm font-semibold text-white">Create</button></form> : <button type="button" onClick={() => setAdding(true)} className="rounded-full border border-teal px-4 py-2 text-sm font-semibold text-teal hover:bg-teal/5">+ Add Channel</button>}</div>}{isLoading ? <SidebarSkeleton /> : <div className="mt-5 space-y-2">{channels.map((channel) => <div key={channel.id} className="rounded-xl border bg-white p-3 shadow-sm"><button type="button" onClick={() => onOpenChannel(channel)} className="flex w-full items-center gap-3 text-left transition hover:bg-teal/[0.025] focus:outline-none focus:ring-2 focus:ring-teal"><span className="flex h-10 w-10 items-center justify-center rounded-full bg-teal/10 text-lg text-teal">#</span><span className="min-w-0 flex-1"><span className="flex"><span className="truncate font-semibold text-gray-900">{channelLabel(channel)}</span><span className="ml-auto text-xs text-gray-400">{shortTime(channel.last_at)}</span></span><span className="mt-1 flex"><span className="truncate text-xs text-gray-500">{channel.last_sender ? `${channel.last_sender}: ` : ""}{channel.last_preview ?? "No messages yet"}</span>{channel.unread_count > 0 && <span className="ml-auto rounded-full bg-teal px-1.5 text-[10px] font-bold text-white">{channel.unread_count}</span>}</span></span></button>{isOfficer && <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3 text-xs" style={{ borderColor: "rgba(0,0,0,0.08)" }}><label className="font-semibold text-gray-600">Posting <select value={channel.post_permission} onChange={(event) => { const permission = event.target.value as PostingPermission; if (permission === "certain") { setConfiguring(channel); setAllowed([]); } else void onSetPermission(channel.id, permission, []); }} className="ml-1 rounded border bg-white px-1 py-1"><option value="everyone">Everyone</option><option value="officers">Officers</option><option value="certain">Certain people</option></select></label>{channel.kind === "channel" && <><button type="button" onClick={() => { const next = window.prompt("New channel name", channel.name); if (next?.trim()) void onRenameChannel(channel.id, next.trim()); }} className="rounded border px-2 py-1 font-semibold text-teal hover:bg-teal/5">Rename</button><button type="button" onClick={() => { if (window.confirm(`Delete #${channel.name}? This also removes its messages.`)) void onDeleteChannel(channel.id); }} className="rounded border border-red-200 px-2 py-1 font-semibold text-red-600 hover:bg-red-50">Delete</button></>}</div>}</div>)}</div>}{configuring && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"><div role="dialog" aria-modal="true" aria-label="Choose who can post" className="w-full max-w-md rounded-2xl bg-cream p-5 shadow-2xl"><h3 className="text-lg font-bold">Who can post in {channelLabel(configuring)}?</h3><div className="mt-4 max-h-64 space-y-2 overflow-y-auto">{participants.map((person) => <label key={person.user_id} className="flex items-center gap-3 rounded-lg bg-white px-3 py-2 text-sm"><input type="checkbox" checked={allowed.includes(person.user_id)} onChange={() => toggleAllowed(person.user_id)} /><span>{person.full_name?.trim() || person.username}</span></label>)}</div><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setConfiguring(null)} className="rounded-full px-4 py-2 text-sm font-semibold text-gray-600">Cancel</button><button type="button" onClick={() => void onSetPermission(configuring.id, "certain", allowed).finally(() => setConfiguring(null))} className="rounded-full bg-teal px-4 py-2 text-sm font-semibold text-white">Save</button></div></div></div>}</div>;
}

function ConversationThread({ userId, conversationId, channelId, details, channelName, canPost: fallbackCanPost, onOpenHub, onOpenInfo, onOpenProfile, onInvalidate, onError }: { userId: string; conversationId: string; channelId: string | null; details: NonNullable<ReturnType<typeof useMessageDetails>["data"]>; channelName: string | null; canPost?: boolean; onOpenHub?: () => void; onOpenInfo: () => void; onOpenProfile: (id: string) => void; onInvalidate: () => void; onError: (message: string) => void }): JSX.Element {
  const { data: page, isLoading } = useMessageThread(conversationId, channelId);
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
  return <ThreadShell title={channelName ?? details.name} subtitle={channelName ? details.name : null} onOpenHub={onOpenHub} onOpenInfo={onOpenInfo}><div ref={listRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-5">{isLoading ? <p className="m-auto text-sm text-gray-500">Loading messages…</p> : messages.length ? messages.map((message, index) => <MessageBubble key={message.id} message={message} isOwn={message.sender_id === userId} showSender={index === 0 || messages[index - 1]?.sender_id !== message.sender_id} userId={userId} onOpenProfile={onOpenProfile} onChanged={onInvalidate} onError={onError} />) : <EmptyThread label="No messages yet" />}</div><Composer disabled={!actualCanPost} disabledReason={channelId && permitted === false ? "Only permitted members can post in this chat." : undefined} allowPolls={details.type !== "direct"} onSend={send} onPoll={async (question, options, allowMultiple) => { try { await createPoll({ conversationId, channelId, question, options, allowMultiple }); onInvalidate(); } catch (error) { onError(error instanceof Error ? error.message : "Couldn’t create the poll."); } }} /></ThreadShell>;
}

function ThreadShell({ title, subtitle, onOpenHub, onOpenInfo, children }: { title: string; subtitle: string | null; onOpenHub?: () => void; onOpenInfo?: () => void; children: React.ReactNode }): JSX.Element {
  return <div className="flex min-h-[calc(100vh-88px)] flex-col"><header className="flex min-h-[76px] items-center justify-center border-b px-5 text-center" style={{ borderColor: "rgba(0,0,0,0.16)" }}><div className="flex min-w-0 items-center gap-2">{onOpenHub && <button type="button" onClick={onOpenHub} aria-label="Open channel navigator" className="rounded-full p-2 text-lg hover:bg-black/5">☰</button>}<button type="button" onClick={onOpenInfo} className="min-w-0 rounded-lg px-2 py-1 transition hover:bg-black/[0.03] focus:outline-none focus:ring-2 focus:ring-teal" aria-label={`${title} information`}><span className="block truncate text-xl font-bold text-gray-950">{title}{onOpenInfo && <span className="ml-2 text-teal">›</span>}</span>{subtitle && <span className="block truncate text-sm font-semibold text-gray-500">{subtitle}</span>}</button></div></header>{children}</div>;
}

function EmptyThread({ label }: { label: string }): JSX.Element { return <p className="m-auto text-sm text-gray-400">{label}</p>; }

function Composer({ disabled = false, disabledReason, allowPolls = false, onSend, onPoll }: { disabled?: boolean; disabledReason?: string; allowPolls?: boolean; onSend: (text: string, file?: File) => Promise<void>; onPoll?: (question: string, options: string[], allowMultiple: boolean) => Promise<void> }): JSX.Element {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [pollOpen, setPollOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const submit = async (file?: File) => { if (sending || (!text.trim() && !file)) return; setSending(true); try { await onSend(text, file); setText(""); if (fileRef.current) fileRef.current.value = ""; } finally { setSending(false); } };
  if (disabled) return <div className="border-t px-5 py-4 text-center text-sm text-gray-500" style={{ borderColor: "rgba(0,0,0,0.16)" }}>{disabledReason ?? "You can’t post in this conversation."}</div>;
  return <><form onSubmit={(event) => { event.preventDefault(); void submit(); }} className="flex items-end gap-2 border-t bg-[#fffdf4] px-5 py-3 shadow-[0_-2px_6px_rgba(0,0,0,0.12)]" style={{ borderColor: "rgba(0,0,0,0.16)" }}><textarea value={text} onChange={(event) => setText(event.target.value)} maxLength={2000} rows={1} placeholder="Message…" className="min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-sm italic outline-none placeholder:text-gray-700 focus:ring-2 focus:ring-teal" /><input ref={fileRef} type="file" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void submit(file); }} /><button type="button" onClick={() => fileRef.current?.click()} aria-label="Attach a file" className="rounded-full p-2 text-lg hover:bg-black/5">⌇</button>{allowPolls && <button type="button" onClick={() => setPollOpen(true)} aria-label="Create a poll" className="rounded-full p-2 text-lg hover:bg-black/5">☷</button>}<button disabled={sending || !text.trim()} aria-label="Send message" className="rounded-full bg-teal px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">{sending ? "…" : "Send"}</button></form>{pollOpen && onPoll && <PollComposer onClose={() => setPollOpen(false)} onSubmit={async (question, options, multiple) => { await onPoll(question, options, multiple); setPollOpen(false); }} />}</>;
}

function MessageBubble({ message, isOwn, showSender, userId, onOpenProfile, onChanged, onError }: { message: ThreadMessage; isOwn: boolean; showSender: boolean; userId: string; onOpenProfile: (id: string) => void; onChanged: () => void; onError: (message: string) => void }): JSX.Element {
  const [menu, setMenu] = useState(false);
  const [attachment, setAttachment] = useState<string | null>(null);
  useEffect(() => { let alive = true; if (message.attachment_url) void signedAttachmentUrl(message.attachment_url).then((url) => { if (alive) setAttachment(url); }).catch(() => {}); return () => { alive = false; }; }, [message.attachment_url]);
  const mutate = async (action: () => Promise<void>) => { try { await action(); onChanged(); } catch { onError("Couldn’t update the message."); } finally { setMenu(false); } };
  return <div className={`mb-3 flex gap-2 ${isOwn ? "justify-end" : "justify-start"}`}>{!isOwn && <button type="button" onClick={() => onOpenProfile(message.sender_id!)} aria-label={`Open ${message.sender.username}'s profile`} className="self-end"><Avatar uri={message.sender.avatar_url} size={28} name={message.sender.full_name ?? message.sender.username} /></button>}<div className={`group relative max-w-[78%] rounded-2xl px-3 py-2 shadow-[0_2px_4px_rgba(0,0,0,0.15)] ${isOwn ? "bg-teal text-white" : "bg-white text-teal"}`}>{showSender && !isOwn && <button type="button" onClick={() => onOpenProfile(message.sender_id!)} className="mb-0.5 block text-left text-xs font-bold">{message.sender.full_name || `@${message.sender.username}`}</button>}{message.message_type === "poll" && message.poll_id ? <PollCard pollId={message.poll_id} userId={userId} onChanged={onChanged} onError={onError} /> : message.message_type === "shared_event" ? <EventMessage eventId={message.shared_event_id} /> : message.message_type === "shared_post" ? <PostMessage postId={message.shared_post_id} /> : <>{message.content && <p className="whitespace-pre-wrap break-words text-sm">{message.content}</p>}{attachment && (message.message_type === "image" ? <a href={attachment} target="_blank" rel="noreferrer"><img src={attachment} alt={message.attachment_name ?? "Shared image"} className="mt-2 max-h-64 rounded-lg object-cover" /></a> : message.message_type === "video" ? <video controls src={attachment} className="mt-2 max-h-64 rounded-lg" /> : <a href={attachment} target="_blank" rel="noreferrer" className="mt-2 block rounded-lg bg-black/10 px-3 py-2 text-sm underline">📎 {message.attachment_name ?? "Download file"}</a>)}</>}<div className={`mt-1 flex items-center gap-2 text-[10px] ${isOwn ? "text-white/75" : "text-gray-400"}`}><time>{shortTime(message.created_at)}</time><button type="button" aria-label="Message actions" onClick={() => setMenu((open) => !open)} className="rounded px-1 opacity-70 hover:bg-black/10">•••</button></div>{menu && <div role="menu" className="absolute bottom-1 right-1 z-20 w-40 rounded-lg border bg-white p-1 text-left text-sm text-gray-800 shadow-lg"><button type="button" role="menuitem" onClick={() => { if (message.content) void navigator.clipboard?.writeText(message.content); setMenu(false); }} className="block w-full rounded px-3 py-2 text-left hover:bg-gray-50">Copy</button><button type="button" role="menuitem" onClick={() => mutate(() => hideMessage(message.id, userId))} className="block w-full rounded px-3 py-2 text-left hover:bg-gray-50">Delete for me</button>{isOwn && <button type="button" role="menuitem" onClick={() => mutate(() => unsendMessage(message.id))} className="block w-full rounded px-3 py-2 text-left text-red-600 hover:bg-red-50">Unsend for everyone</button>}{!isOwn && <button type="button" role="menuitem" onClick={() => { const reason = window.prompt(`Report reason: ${REPORT_REASONS.join(", ")}`); if (reason && REPORT_REASONS.includes(reason)) void mutate(() => reportMessage(message.id, reason)); }} className="block w-full rounded px-3 py-2 text-left text-red-600 hover:bg-red-50">Report</button>}</div>}</div></div>;
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

function PollComposer({ onClose, onSubmit }: { onClose: () => void; onSubmit: (question: string, options: string[], multiple: boolean) => Promise<void> }): JSX.Element {
  const [question, setQuestion] = useState(""); const [options, setOptions] = useState(["", ""]); const [multiple, setMultiple] = useState(false); const [sending, setSending] = useState(false);
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Create poll"><form onSubmit={(event) => { event.preventDefault(); const clean = options.map((option) => option.trim()).filter(Boolean); if (!question.trim() || clean.length < 2) return; setSending(true); void onSubmit(question.trim(), clean, multiple).finally(() => setSending(false)); }} className="w-full max-w-md rounded-2xl bg-cream p-5 shadow-2xl"><div className="flex items-center justify-between"><h3 className="text-lg font-bold">Create poll</h3><button type="button" onClick={onClose} aria-label="Close poll composer" className="rounded-full p-1 hover:bg-black/5">×</button></div><input autoFocus value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={300} placeholder="Question" className="mt-4 h-10 w-full rounded-lg border bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-teal" />{options.map((option, index) => <input key={index} value={option} onChange={(event) => setOptions((items) => items.map((item, position) => position === index ? event.target.value : item))} maxLength={120} placeholder={`Option ${index + 1}`} className="mt-2 h-10 w-full rounded-lg border bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-teal" />)}{options.length < 6 && <button type="button" onClick={() => setOptions((items) => [...items, ""])} className="mt-2 text-sm font-semibold text-teal">+ Add option</button>}<label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={multiple} onChange={(event) => setMultiple(event.target.checked)} />Allow multiple choices</label><button disabled={sending} className="mt-5 rounded-full bg-teal px-5 py-2 text-sm font-semibold text-white disabled:opacity-50">{sending ? "Creating…" : "Create poll"}</button></form></div>;
}

function InfoPanel({ userId, conversationId, channelId, details, infoTab, onClose, onTab, onOpenEvent, onOpenMessage, onError }: { userId: string; conversationId: string; channelId: string | null; details: NonNullable<ReturnType<typeof useMessageDetails>["data"]>; infoTab: InfoTab; onClose: () => void; onTab: (tab: InfoTab) => void; onOpenEvent: (id: string) => void; onOpenMessage: (result: MessageSearchResult) => void; onError: (message: string) => void }): JSX.Element {
  const { data: muted = false } = useMessageMute(conversationId, channelId, userId);
  const { data: media = [] } = useMessageShared(conversationId, channelId, "image");
  const { data: videos = [] } = useMessageShared(conversationId, channelId, "video");
  const { data: files = [] } = useMessageShared(conversationId, channelId, "file");
  const { data: polls = [] } = useMessageShared(conversationId, channelId, "poll");
  const { data: events = [] } = useMessageEvents(conversationId, channelId);
  const [query, setQuery] = useState("");
  const { data: matches = [], isLoading: searchLoading } = useMessageContentSearch(query, conversationId);
  const isChannel = !!channelId;
  const toggleMute = async () => {
    try {
      if (channelId) await setChannelMuted(channelId, !muted);
      else await setConversationMuted(conversationId, !muted);
    } catch {
      onError("Couldn’t update mute settings.");
    }
  };
  return <aside className="relative flex min-h-0 flex-col border-l bg-[#fffdf4] shadow-xl lg:shadow-none" style={{ borderColor: "rgba(0,0,0,0.17)" }}>
    <div className="flex items-center justify-between p-4"><button type="button" onClick={onClose} aria-label="Close information panel" className="rounded-full p-2 text-xl hover:bg-black/5">‹</button><button type="button" aria-label="More chat options" className="rounded-full p-2 hover:bg-black/5">•••</button></div>
    <div className="px-5 pb-4 text-center"><div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-teal text-3xl font-bold text-white">{isChannel ? "#" : details.name.slice(0, 1).toUpperCase()}</div><h2 className="mt-3 text-2xl font-bold text-gray-950">{isChannel ? "Channel" : details.name}</h2><p className="text-sm text-gray-500">{details.type === "club_group" ? "Members chat" : details.type === "officer_chat" ? "Officer chat" : `${details.participants.length} participants`}</p><div className="mt-4 flex justify-center gap-8"><label className="flex flex-col items-center gap-1 text-xs font-semibold"><span className="rounded-full p-2 text-lg">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search" className="w-24 border-b bg-transparent text-center text-xs outline-none focus:border-teal" /></label><button type="button" onClick={() => void toggleMute()} className="flex flex-col items-center gap-1 text-xs font-semibold"><span className="rounded-full p-2 text-lg">{muted ? "♩" : "♩̸"}</span>{muted ? "Unmute" : "Mute"}</button></div></div>
    <div role="tablist" className="grid grid-cols-4 border-y" style={{ borderColor: "rgba(0,0,0,0.1)" }}><InfoTabButton label="Polls" icon="☑" active={infoTab === "polls"} onClick={() => onTab("polls")} /><InfoTabButton label="Media" icon="▧" active={infoTab === "media"} onClick={() => onTab("media")} /><InfoTabButton label="Events" icon="▦" active={infoTab === "events"} onClick={() => onTab("events")} /><InfoTabButton label="Files" icon="⌇" active={infoTab === "files"} onClick={() => onTab("files")} /></div>
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      {query.trim().length >= 3 ? <div className="space-y-2">{searchLoading ? <p className="py-4 text-sm text-gray-500">Searching this conversation…</p> : matches.length ? matches.map((result) => <MessageSearchRow key={result.message_id} result={result} onClick={() => onOpenMessage(result)} />) : <EmptyPanel label="No messages match that search" />}</div> : <>{infoTab === "polls" && <SharedPolls messages={polls} userId={userId} onError={onError} />}{infoTab === "media" && <SharedMedia messages={[...media, ...videos]} />}{infoTab === "events" && <div className="space-y-2">{events.length ? events.map((event) => <button key={event.event_id} type="button" onClick={() => onOpenEvent(event.event_id)} className="flex w-full gap-3 rounded-xl border bg-white p-2 text-left hover:bg-teal/[0.03]">{event.cover_image_url && <img src={event.cover_image_url} alt="" className="h-14 w-14 rounded-lg object-cover" />}<span className="min-w-0"><span className="block truncate text-sm font-bold">{event.emoji ? `${event.emoji} ` : ""}{event.title}</span><span className="block text-xs text-gray-500">{event.event_date}{event.start_time ? ` · ${event.start_time}` : ""}</span></span></button>) : <EmptyPanel label="No shared events yet" />}</div>}{infoTab === "files" && <SharedFiles messages={files} />}</>}
    </div>
  </aside>;
}

function InfoTabButton({ label, icon, active, onClick }: { label: string; icon: string; active: boolean; onClick: () => void }): JSX.Element { return <button type="button" role="tab" aria-selected={active} onClick={onClick} className="relative flex flex-col items-center gap-1 py-3 text-xs font-semibold text-gray-700 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-teal"><span className="text-lg">{icon}</span><span className="sr-only">{label}</span>{active && <span className="absolute bottom-0 h-0.5 w-8 rounded bg-teal" />}</button>; }
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
