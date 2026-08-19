"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AppHeader } from "../home/AppHeader";
import { PageOverlays } from "../shared/PageOverlays";
import { Avatar } from "../shared/Avatar";
import { ClickableUserIdentity } from "../shared/ClickableIdentity";
import { CountBadge } from "../shared/CountBadge";
import {
  ArchiveIcon, BellOffIcon, BlockIcon, CalendarIcon, CameraIcon, ChatBubbleOutlineIcon, ChatBubblesIcon,
  CheckboxIcon, CloseCircleIcon, CloseIcon, EllipsisIcon, ExitIcon, FlagIcon, ImageIcon, ListIcon,
  LockIcon, MegaphoneIcon, PaperclipIcon, PencilIcon, PeopleIcon, PersonAddIcon, PersonRemoveIcon,
  PlusIcon, QrCodeIcon, RefreshIcon, SearchIcon, ShareIcon, TagIcon, TrashIcon,
} from "../shared/icons";
import qrcodegen from "qrcode-generator";
import type { ReportEntityType } from "../../lib/hooks/useReport";
import { ReportModal } from "../shared/ReportModal";
import { ToastProvider, useToast } from "../shared/Toast";
import { messageBadgeCounts, useUnreadSummaryValue } from "../../lib/hooks/useUnreadSummary";
import { messagesHref, isMessageUuid, type MessagesDestination } from "../../lib/messages/routes";
import { useMyClubs } from "../../lib/hooks/useClubTab";
import { ATTACHMENT_UNAVAILABLE_TEXT, blockConfirmMessage, blockUser } from "../../lib/blocking";
import {
  addGroupParticipants,
  canPostInChannel,
  clientTag,
  createChannel,
  deleteGroupConversation,
  leaveGroupChat,
  removeGroupParticipant,
  updateGroupMeta,
  uploadGroupAvatar,
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
  attachmentObjectUrl,
  permissionSelectValue,
  postingPermissionOptions,
  releaseAttachmentUrl,
  uploadAttachment,
  votePoll,
  type Channel,
  type ChannelPreview,
  type ConversationPreview,
  type MessageSearchResult,
  type Person,
  type PostingPermission,
  type ThreadMessage, sharedPostIsAvailable, sharedEventIsAvailable, conversationRestrictedSenders,
  getInviteToken, rotateInviteToken, INVITE_BASE_URL } from "../../lib/messages/service";
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
  useUnsendMessage,
} from "../../lib/messages/hooks";
import {
  ChatFileCard,
  ChatImage,
  ChatVideo,
  EventShareCard,
  PersonIdentity,
  PostShareCard,
  useAttachmentUrl,
  useSearchHighlight,
} from "./RichMessage";

type Filter = "single" | "groups";
type InfoTab = "polls" | "media" | "events" | "files";

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
  // The unread-summary and my-clubs realtime subscriptions are owned once for
  // the whole session by Providers (useSessionRealtimeHub), not remounted here.
  // From `md` up the Message tab is a FIXED-height application shell: the
  // document itself never scrolls, and the only scrollable region is the
  // conversation list inside the Chats column (plus each thread's own message
  // list). Below `md` the columns stack, so normal document flow is kept.
  return (
    <ToastProvider>
      <div className="flex min-h-screen flex-col bg-cream pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0 md:h-[100dvh] md:min-h-0 md:overflow-hidden">
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
  const targetMessageId = isMessageUuid(params.get("message")) ? params.get("message") : null;
  const [searchNonce, setSearchNonce] = useState(0);

  const { data: conversations = [], isLoading: conversationsLoading } = useMessageConversations(userId);
  const { data: myClubs, isLoading: clubsLoading } = useMyClubs(userId);
  const { data: details, isLoading: detailsLoading } = useMessageDetails(conversationId, userId);
  const { data: channels = [], isLoading: channelsLoading } = useMessageChannels(conversationId);
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
  // A conversation is "unavailable" ONLY once resolution has actually finished
  // and produced nothing. While `details` is still loading it is simply unknown,
  // and the channel list is equally unknown until `channelsLoading` settles —
  // treating either as invalid is what rendered "This conversation isn't
  // available" over a conversation the viewer is a participant of.
  const resolving = !!conversationId && (detailsLoading || (!!channelId && channelsLoading));
  const hasValidDestination =
    isDraft || !conversationId || resolving || (!!details && (!channelId || !!selectedChannel));

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

  // Bug 2. Two separate defects lived here:
  //   1. `messageId` was written into the URL but nothing ever read it, so the
  //      thread never scrolled to or marked the selected message.
  //   2. `info` was dropped, which CLOSED the details panel the search field
  //      lives in — the "loses the search context" half of the report.
  // `keepInfo` preserves the panel and its active tab, so results can be
  // selected one after another without reopening Search.
  const openSearchResult = useCallback((result: MessageSearchResult, keepInfo = false) => {
    const conversation = conversations.find((item) => item.id === result.conversation_id);
    destination({
      filter: conversation?.type === "direct" ? "single" : "groups",
      conversationId: result.conversation_id,
      channelId: result.channel_id,
      messageId: result.message_id,
      ...(keepInfo ? { info: true, infoTab } : {}),
    });
    // Selecting the SAME result again must re-trigger the scroll and highlight;
    // the URL alone would not change, so a nonce drives the effect.
    setSearchNonce((value) => value + 1);
  }, [conversations, destination, infoTab]);

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
  } else if (resolving) {
    // The shell renders immediately so a legitimate load never shows a
    // not-found, a blank pane, or the "Select a conversation" landing state.
    center = <ThreadSkeleton />;
  } else if (hubOpen && conversationId && details) {
    const refreshHub = async () => {
      await queryClient.invalidateQueries({ queryKey: messageKeys.hub(conversationId, userId) });
      await queryClient.invalidateQueries({ queryKey: messageKeys.channels(conversationId) });
    };
    center = <ChannelHub conversationId={conversationId} conversationName={details.name} conversationAvatarUrl={details.avatar_url} userId={userId} participants={details.participants} isOfficer={viewerIsOfficer} isOfficersChat={details.type === "officer_chat"} onOpenChannel={(channel) => destination({ filter: "groups", conversationId, channelId: channel.id })} onOpenInfo={() => destination({ filter: "groups", conversationId, hub: true, info: true, infoTab })} onBack={clearSelection} onCreateChannel={async (name) => {
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
    center = <DraftThread userId={userId} draftPerson={draftPerson} groupName={draftGroupName} groupIds={draftGroupIds} onMaterialized={(id) => destination({ filter, conversationId: id }, true)} onError={(message) => show(message, "error")} onClearSelection={clearSelection} />;
  } else if (conversationId && details) {
    // Back from a channel thread returns to that club's channel chooser (mobile's
    // group chat → channels → chat → details path), not to an empty Messages
    // pane, so the previous context is preserved on desktop too.
    const isOfficial = details.type === "club_group" || details.type === "officer_chat";
    center = <ConversationThread userId={userId} conversationId={conversationId} channelId={channelId} details={details} channelName={selectedChannel ? channelLabel(selectedChannel) : null} canPost={channelId ? undefined : true} targetMessageId={targetMessageId} searchNonce={searchNonce} onOpenHub={isOfficial ? () => destination({ filter: "groups", conversationId, hub: true }) : undefined} onBack={isOfficial ? () => destination({ filter: "groups", conversationId, hub: true }) : clearSelection} onOpenInfo={() => destination({ filter, conversationId, channelId, info: true, infoTab })} onOpenProfile={(id) => router.push(`/u/${id}`)} onOpenEvent={(id) => destination({ filter, conversationId, channelId, info: infoOpen, infoTab, eventId: id })} onOpenPost={(id) => destination({ filter, conversationId, channelId, info: infoOpen, infoTab, postId: id })} onInvalidate={() => invalidateConversation(conversationId)} onError={(message) => show(message, "error")} />;
  } else {
    center = <MessagesLanding noClubs={!clubsLoading && !hasClubs} onJoinClub={() => router.push("/clubs")} />;
  }

  // Phone has no split view — like native, it pushes a full-screen detail
  // (thread/composer/hub/error) over the list and pops back to it, never
  // stacking both in one column. `showingDetail` is true for every branch
  // above that renders something other than the bare landing state.
  const showingDetail = !!conversationId || composerMode !== "none" || isDraft;
  const phoneShowInfo = infoOpen && !!conversationId && !!details;

  return (
    <main className="mx-auto w-full max-w-[1400px] px-0 py-0 sm:px-4 sm:py-6 md:flex md:min-h-0 md:flex-1 md:flex-col">
      {/* The shell owns the viewport height and clips: nothing inside it may
          grow the document. `min-h-0` on every descendant in this chain is what
          lets the list below actually reach `overflow-y-auto` instead of
          stretching its parent. */}
      <div className="min-h-[100vh] overflow-hidden border-y bg-cream shadow-[0_2px_8px_rgba(0,0,0,0.16)] sm:rounded-sm sm:border md:min-h-0 md:flex-1" style={{ borderColor: "rgba(0,0,0,0.17)" }}>
        <div className={infoOpen && conversationId ? "grid grid-cols-1 md:h-full md:grid-rows-[minmax(0,1fr)] lg:grid-cols-[292px_minmax(0,1fr)_360px]" : "grid grid-cols-1 md:h-full md:grid-cols-[292px_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)]"}>
          {/* suggestionsEnabled: `composerMode` is a STRING union whose idle value
              is "none" — truthy — so the previous `!composerMode` test was
              permanently false and the empty-Single Suggested section could never
              render. It must compare against "none". */}
          <div className={showingDetail ? "hidden md:contents" : "contents"}>
            <MessagesSidebar userId={userId} filter={filter} loading={conversationsLoading} conversations={filter === "single" ? directConversations : groupConversations} suggestionsEnabled={filter === "single" && directConversations.length === 0 && composerMode === "none" && !conversationId && !isDraft} activeConversationId={conversationId} onFilter={setFilter} onOpen={openConversation} onNew={() => setComposerMode("new-message")} onOpenPerson={openPerson} onOpenMessage={openSearchResult} onBrowseClubs={() => router.push("/clubs")} onNewGroupChat={() => setComposerMode("new-group")} />
          </div>
          <div className={!showingDetail || phoneShowInfo ? "hidden md:contents" : "contents"}>
            <section className="relative flex min-w-0 flex-col bg-[#fffdf4] md:min-h-0 md:overflow-y-auto">{center}</section>
          </div>
          {/* `hub` is carried through every destination below (Bug 2). Club
              Chat Information is opened FROM the channel list, so closing it,
              switching its tab or opening a shared event from it must all
              return to that channel list rather than dropping the person into
              an empty Messages pane. */}
          {infoOpen && conversationId && details && (
            <InfoPanel userId={userId} conversationId={conversationId} channelId={channelId} channel={selectedChannel} details={details} isOfficer={viewerIsOfficer} infoTab={infoTab} onClose={() => destination({ filter, conversationId, channelId, hub: hubOpen })} onTab={(tab) => destination({ filter, conversationId, channelId, hub: hubOpen, info: true, infoTab: tab })} onOpenEvent={(eventId) => destination({ filter, conversationId, channelId, hub: hubOpen, info: true, infoTab, eventId })} onOpenMessage={(result) => openSearchResult(result, true)} onOpenProfile={(id) => router.push(`/u/${id}`)} onChanged={() => invalidateConversation(conversationId)} onError={(message) => show(message, "error")} />
          )}
        </div>
      </div>
      <PageOverlays userId={userId} />
    </main>
  );
}

function MessagesSidebar({ userId, filter, loading, conversations, suggestionsEnabled, activeConversationId, onFilter, onOpen, onNew, onOpenPerson, onOpenMessage, onBrowseClubs, onNewGroupChat }: { userId: string; filter: Filter; loading: boolean; conversations: ConversationPreview[]; suggestionsEnabled: boolean; activeConversationId: string | null; onFilter: (filter: Filter) => void; onOpen: (conversation: ConversationPreview) => void; onNew: () => void; onOpenPerson: (person: Person) => void; onOpenMessage: (result: MessageSearchResult) => void; onBrowseClubs: () => void; onNewGroupChat: () => void }): JSX.Element {
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
          <FilterButton label="Group" active={filter === "groups"} badge={groupsUnread} badgeLabel="unread group messages" onClick={() => onFilter("groups")} />
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
        {!loading && !term && active.length === 0 && !suggestionsEnabled && (
          filter === "groups"
            ? <GroupEmptyState onBrowseClubs={onBrowseClubs} onNewGroupChat={onNewGroupChat} />
            : <p className="px-2 py-6 text-sm text-gray-500">No conversations yet.</p>
        )}
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

// Matches apps/mobile/components/chat/GroupEmptyState.tsx exactly (copy, order,
// icon-circle/primary-button/link structure) — the Groups filter's empty state
// on both platforms, not a desktop-only "Join a Club" fallback.
function GroupEmptyState({ onBrowseClubs, onNewGroupChat }: { onBrowseClubs: () => void; onNewGroupChat: () => void }): JSX.Element {
  return (
    <div className="flex flex-col items-center px-8 pb-12 pt-10 text-center">
      <span className="mb-5 flex h-[72px] w-[72px] items-center justify-center rounded-full text-teal opacity-90" style={{ background: "rgba(15,166,166,0.1)" }}>
        <PeopleIcon size={40} filled />
      </span>
      <p className="mb-2 text-lg font-semibold text-gray-900">No group chats yet</p>
      <p className="mb-7 text-sm leading-5 text-gray-500">Join a club to unlock group conversations, or start your own group chat with friends.</p>
      <button type="button" onClick={onBrowseClubs} className="w-full max-w-[280px] rounded-full bg-teal py-4 text-[15px] font-semibold text-white shadow-[0_3px_5px_rgba(0,0,0,0.22)] transition hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-teal focus:ring-offset-2">Browse Clubs</button>
      <button type="button" onClick={onNewGroupChat} className="mt-4 py-2 text-[13px] font-semibold text-teal">or start a new group chat</button>
    </div>
  );
}

function MessagesLanding({ noClubs, onJoinClub }: { noClubs: boolean; onJoinClub: () => void }): JSX.Element {
  return <div className="flex min-h-[480px] items-start justify-center px-6 pt-40">{noClubs ? <button type="button" onClick={onJoinClub} className="w-full max-w-sm rounded-full bg-teal px-8 py-4 text-lg font-semibold text-white shadow-[0_3px_5px_rgba(0,0,0,0.22)] transition hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-teal focus:ring-offset-2">Join a Club</button> : <div className="text-center"><p className="text-2xl font-bold text-gray-900 font-zain">Messages</p><p className="mt-2 text-sm text-gray-500">Select a conversation or start a new one.</p></div>}</div>;
}

/** The conversation shell, shown while a valid destination is still resolving.
 *  It occupies the thread's real layout (header bar, message area, composer
 *  strip) so the pane never collapses, flashes the landing state, or claims the
 *  conversation is missing before resolution has finished. */
function ThreadSkeleton(): JSX.Element {
  return (
    <div className="flex min-h-[100vh] flex-col md:h-full md:min-h-0" aria-busy="true" aria-live="polite">
      <header className="flex min-h-[76px] shrink-0 items-center justify-center border-b px-5" style={{ borderColor: "rgba(0,0,0,0.16)" }}>
        <div className="h-6 w-40 animate-pulse rounded-full bg-black/5" />
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-hidden px-5 py-5">
        <div className="h-10 w-1/2 animate-pulse rounded-2xl bg-black/5" />
        <div className="ml-auto h-10 w-2/5 animate-pulse rounded-2xl bg-black/5" />
        <div className="h-10 w-1/3 animate-pulse rounded-2xl bg-black/5" />
      </div>
      <div className="shrink-0 border-t px-5 py-3" style={{ borderColor: "rgba(0,0,0,0.16)" }}>
        <div className="h-10 w-full animate-pulse rounded-full bg-black/5" />
      </div>
      <span className="sr-only">Loading conversation…</span>
    </div>
  );
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

function DraftThread({ userId, draftPerson, groupName, groupIds, onMaterialized, onError, onClearSelection }: { userId: string; draftPerson: Person | null | undefined; groupName: string | null; groupIds: string[]; onMaterialized: (id: string) => void; onError: (message: string) => void; onClearSelection: () => void }): JSX.Element {
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
  return <ThreadShell title={label} subtitle={draftPerson ? draftPerson.full_name : null} onBack={onClearSelection}><EmptyThread label="Start the conversation" /><Composer onSend={send} /></ThreadShell>;
}

function ChannelHub({ conversationId, conversationName, conversationAvatarUrl, userId, participants, isOfficer, isOfficersChat, onOpenChannel, onOpenInfo, onBack, onCreateChannel, onRenameChannel, onDeleteChannel, onSetPermission }: { conversationId: string; conversationName: string; conversationAvatarUrl: string | null; userId: string; participants: Array<Person & { joined_at: string; role: string }>; isOfficer: boolean; isOfficersChat: boolean; onOpenChannel: (channel: ChannelPreview) => void; onOpenInfo: () => void; onBack: () => void; onCreateChannel: (name: string) => Promise<void>; onRenameChannel: (channelId: string, name: string) => Promise<void>; onDeleteChannel: (channelId: string) => Promise<void>; onSetPermission: (channelId: string, permission: PostingPermission, userIds: string[]) => Promise<void> }): JSX.Element {
  const { data: channels = [], isLoading } = useMessageHub(conversationId, userId);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [configuring, setConfiguring] = useState<ChannelPreview | null>(null);
  return <div className="mx-auto max-w-2xl px-5 py-6">
    <div className="flex items-center gap-3">
      <button type="button" onClick={onBack} aria-label="Back to messages" className="rounded-full p-2 text-lg text-gray-950 hover:bg-black/5">‹</button>
      {/* Bug 2 — the club picture and name at the top of the channel list are
          the entry point to Club Chat Information, matching mobile:
            channel list → club picture/name → Club Chat Information
                         → club picture/name → the real Club Profile
          The web had no way in at all: this header was plain text. */}
      <button
        type="button"
        onClick={onOpenInfo}
        className="flex min-w-0 items-center gap-3 rounded-xl px-2 py-1 text-left transition hover:bg-black/[0.03] focus:outline-none focus:ring-2 focus:ring-teal"
        aria-label={`${conversationName} information`}
      >
        <Avatar uri={conversationAvatarUrl} size={40} name={conversationName} />
        <span className="min-w-0"><span className="block truncate text-xl font-bold text-gray-900">{conversationName}<span className="ml-2 text-teal">›</span></span><span className="block text-sm text-gray-500">Choose a chat</span></span>
      </button>
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
        {/* Bug 7 — an Officers conversation offers only "Everyone in this chat"
            and "Certain people". Everyone inside it is already an officer, so
            "Only officers" selected exactly the same people and meant nothing.
            A channel still stored as 'officers' displays as the everyone option
            (see permissionSelectValue) rather than showing a blank select. */}
        <label className="font-semibold text-gray-600">Posting <select value={permissionSelectValue(channel.post_permission, isOfficersChat)} aria-label={`Who can post in ${channelLabel(channel)}`} onChange={(event) => { const permission = event.target.value as PostingPermission; if (permission === "certain") { setConfiguring(channel); } else void onSetPermission(channel.id, permission, []); }} className="ml-1 rounded border bg-white px-1 py-1">{postingPermissionOptions(isOfficersChat).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        {channel.kind === "channel" && <>
          <button type="button" onClick={() => { const next = window.prompt("New channel name", channel.name); if (next?.trim()) void onRenameChannel(channel.id, next.trim()); }} className="rounded border px-2 py-1 font-semibold text-teal hover:bg-teal/5">Rename</button>
          <button type="button" onClick={() => { if (window.confirm(`Delete #${channel.name}? This also removes its messages.`)) void onDeleteChannel(channel.id); }} className="rounded border border-red-200 px-2 py-1 font-semibold text-red-600 hover:bg-red-50">Delete</button>
        </>}
      </div>}
    </div>)}</div>}

    {configuring && <PermissionsSheet channel={configuring} participants={participants} isOfficersChat={isOfficersChat} onClose={() => setConfiguring(null)} onSave={(permission, userIds) => onSetPermission(configuring.id, permission, userIds)} />}
  </div>;
}

function ConversationThread({ userId, conversationId, channelId, details, channelName, canPost: fallbackCanPost, targetMessageId, searchNonce, onOpenHub, onBack, onOpenInfo, onOpenProfile, onOpenEvent, onOpenPost, onInvalidate, onError }: { userId: string; conversationId: string; channelId: string | null; details: NonNullable<ReturnType<typeof useMessageDetails>["data"]>; channelName: string | null; canPost?: boolean; targetMessageId?: string | null; searchNonce?: number; onOpenHub?: () => void; onBack?: () => void; onOpenInfo: () => void; onOpenProfile: (id: string) => void; onOpenEvent: (id: string) => void; onOpenPost: (id: string) => void; onInvalidate: () => void; onError: (message: string) => void }): JSX.Element {
  const { data: page, isLoading } = useMessageThread(conversationId, channelId, userId);
  const { data: permitted } = useMessagePermission(channelId);
  const queryClient = useQueryClient();
  const unsend = useUnsendMessage(conversationId, channelId, userId, onError);
  const { outgoing, enqueue, retry } = useOutgoingMessages(conversationId, channelId, userId, onInvalidate, onError);
  const stored = useMemo(() => [...(page?.messages ?? [])].reverse(), [page?.messages]);
  // A pending message is dropped the moment its stored row arrives, matched on
  // `client_tag` — the same idempotency key the insert carries — so a send can
  // never render twice.
  const messages = useMemo(() => {
    const storedTags = new Set(stored.map((message) => message.client_tag).filter(Boolean));
    return [...stored, ...outgoing.filter((message) => !storedTags.has(message.client_tag))];
  }, [outgoing, stored]);
  const actualCanPost = channelId ? permitted === true : fallbackCanPost !== false;
  const listRef = useRef<HTMLDivElement>(null);
  // messages.length in deps: re-marks read whenever a new message streams into
  // an already-open thread (mirrors apps/mobile/components/chat/ConversationThread.tsx),
  // not just on initial open — otherwise a live message here still shows as
  // unread in the header badge until the page is reloaded.
  useEffect(() => {
    if (!conversationId) return;
    if (channelId) void markChannelRead(channelId); else void markConversationRead(conversationId);
    void queryClient.invalidateQueries({ queryKey: ["unreadSummary", userId] });
  }, [channelId, conversationId, queryClient, userId, messages.length]);
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [messages.length]);
  // Senders whose attachment payload this viewer may not read (a block in
  // either direction). Keyed under "messages" so the existing access-sync cache
  // clearing already drops it and it re-resolves after an unblock. Symmetric,
  // so it never tells the viewer who blocked whom. Storage authorization is the
  // enforcement point; this only chooses which card renders.
  const { data: restrictedSenderIds } = useQuery({
    queryKey: ["messages", "restrictedSenders", conversationId],
    queryFn: () => conversationRestrictedSenders(conversationId),
    enabled: !!conversationId,
    staleTime: 0,
  });
  const restrictedSenders = useMemo(() => new Set(restrictedSenderIds ?? []), [restrictedSenderIds]);
  const emptyLabel = channelName && channelName.startsWith("#") ? `No messages in ${channelName} yet` : "No messages yet";
  return <ThreadShell title={channelName ?? details.name} subtitle={channelName ? details.name : null} onOpenHub={onOpenHub} onBack={onBack} onOpenInfo={onOpenInfo}><div ref={listRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-5 py-5">{isLoading ? <p className="m-auto text-sm text-gray-500">Loading messages…</p> : messages.length ? messages.map((message, index) => <MessageBubble key={message.id} message={message} isOwn={message.sender_id === userId} showSender={index === 0 || messages[index - 1]?.sender_id !== message.sender_id} userId={userId} onOpenProfile={onOpenProfile} onOpenEvent={onOpenEvent} onOpenPost={onOpenPost} onUnsend={unsend} onChanged={onInvalidate} onError={onError} attachmentUnavailable={!!message.sender_id && restrictedSenders.has(message.sender_id)} isSearchTarget={!!targetMessageId && message.id === targetMessageId} searchNonce={searchNonce} />) : <EmptyThread label={emptyLabel} />}</div><Composer disabled={!actualCanPost} disabledReason={channelId && permitted === false ? "Only club officers can post in this chat." : undefined} allowPolls={details.type !== "direct"} onSend={enqueue} onPoll={async (poll) => { try { await createPoll({ conversationId, channelId, question: poll.question, options: poll.options, allowMultiple: poll.allowMultiple, startAt: poll.startAt, endAt: poll.endAt }); onInvalidate(); } catch (error) { onError(error instanceof Error ? error.message : "Couldn’t create the poll."); } }} /></ThreadShell>;
}

/**
 * Bug 6 — immediate send.
 *
 * The composer previously awaited the WHOLE round trip (for an attachment: the
 * full upload, then the insert, then a refetch) before anything appeared, so a
 * photo could be missing from the conversation for as long as the upload took
 * and then appear with no explanation.
 *
 * A local message is now appended the instant the send is requested:
 *   • text  — appears immediately, replaced by its stored row on success
 *   • media — the file is turned into a local object URL and rendered at once,
 *             so the photo is visible while its bytes are still uploading
 *
 * Nothing here weakens the write path. The same `sendMessage` insert runs with
 * the same `client_tag`, so the unique (sender_id, client_tag) index still makes
 * a retry idempotent, and the message the viewer ends up with is always the
 * stored row, never the local stand-in.
 */
function useOutgoingMessages(
  conversationId: string,
  channelId: string | null,
  userId: string,
  onSettled: () => void,
  onError: (message: string) => void
): { outgoing: ThreadMessage[]; enqueue: (text: string, file?: File) => Promise<void>; retry: (tag: string) => void } {
  const [outgoing, setOutgoing] = useState<ThreadMessage[]>([]);
  const previews = useRef(new Map<string, string>());

  useEffect(() => {
    // Clear pending state when the viewer moves to another thread, and release
    // every local preview so the blobs are not retained.
    setOutgoing([]);
    const urls = previews.current;
    return () => {
      urls.forEach((url) => releaseAttachmentUrl(url));
      urls.clear();
    };
  }, [channelId, conversationId]);

  const settle = useCallback((tag: string) => {
    const preview = previews.current.get(tag);
    if (preview) {
      releaseAttachmentUrl(preview);
      previews.current.delete(tag);
    }
    setOutgoing((current) => current.filter((message) => message.client_tag !== tag));
  }, []);

  const perform = useCallback(async (tag: string, text: string, file?: File) => {
    try {
      if (file) {
        const attachment = await uploadAttachment(conversationId, file);
        await sendMessage({ conversationId, channelId, content: text, messageType: attachment.type, attachment, tag });
      } else {
        await sendMessage({ conversationId, channelId, content: text, tag });
      }
      onSettled();
      // The stored row is matched on client_tag by the thread, but the local
      // copy is dropped here too so a slow refetch cannot leave a duplicate.
      settle(tag);
    } catch (error) {
      // A failed send becomes a visible, retryable message rather than silently
      // disappearing, which is what the old catch produced.
      setOutgoing((current) =>
        current.map((message) => (message.client_tag === tag ? { ...message, pending_state: "failed" as const } : message))
      );
      onError(error instanceof Error ? error.message : "Couldn’t send the message.");
    }
  }, [channelId, conversationId, onError, onSettled, settle]);

  const retry = useCallback((tag: string) => {
    const message = outgoing.find((item) => item.client_tag === tag);
    if (!message) return;
    setOutgoing((current) => current.map((item) => (item.client_tag === tag ? { ...item, pending_state: "sending" as const } : item)));
    void perform(tag, message.content ?? "", message.pendingFile);
  }, [outgoing, perform]);

  const enqueue = useCallback(async (text: string, file?: File) => {
    const tag = clientTag();
    const preview = file && file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
    if (preview) previews.current.set(tag, preview);
    const type: MessageTypeLocal = file ? (file.type.startsWith("image/") ? "image" : file.type.startsWith("video/") ? "video" : "file") : "text";
    setOutgoing((current) => [...current, {
      id: `pending:${tag}`,
      conversation_id: conversationId,
      channel_id: channelId,
      sender_id: userId,
      content: text.trim() || null,
      attachment_url: preview,
      attachment_name: file?.name ?? null,
      attachment_size: file?.size ?? null,
      attachment_mime: file?.type ?? null,
      message_type: type,
      shared_event_id: null,
      shared_post_id: null,
      poll_id: null,
      client_tag: tag,
      created_at: new Date().toISOString(),
      sender: { id: userId, username: "", full_name: null, avatar_url: null },
      pending_state: "sending",
      pendingFile: file,
    }]);
    await perform(tag, text, file);
  }, [channelId, conversationId, perform, userId]);

  const withRetry = useMemo(
    () => outgoing.map((message) => ({ ...message, onRetry: () => retry(message.client_tag!) })),
    [outgoing, retry]
  );

  return { outgoing: withRetry, enqueue, retry };
}

type MessageTypeLocal = ThreadMessage["message_type"];

function ThreadShell({ title, subtitle, onOpenHub, onBack, onOpenInfo, children }: { title: string; subtitle: string | null; onOpenHub?: () => void; onBack?: () => void; onOpenInfo?: () => void; children: React.ReactNode }): JSX.Element {
  // `md:h-full` (not a viewport min-height) keeps the thread exactly as tall as
  // its column, so the message list scrolls internally and the page does not.
  return <div className="flex min-h-[100vh] flex-col md:h-full md:min-h-0"><header className="relative flex min-h-[76px] shrink-0 items-center justify-center border-b px-5 text-center" style={{ borderColor: "rgba(0,0,0,0.16)" }}>{onBack && <button type="button" onClick={onBack} aria-label="Back" className="absolute left-3 rounded-full p-2 text-lg text-gray-950 hover:bg-black/5">‹</button>}<div className="flex min-w-0 items-center gap-2">{onOpenHub && <button type="button" onClick={onOpenHub} aria-label="Open channel navigator" className="rounded-full p-2 text-lg text-gray-950 hover:bg-black/5">☰</button>}<button type="button" onClick={onOpenInfo} className="min-w-0 rounded-lg px-2 py-1 transition hover:bg-black/[0.03] focus:outline-none focus:ring-2 focus:ring-teal" aria-label={`${title} information`}><span className="block truncate text-xl font-bold text-gray-950">{title}{onOpenInfo && <span className="ml-2 text-teal">›</span>}</span>{subtitle && <span className="block truncate text-sm font-semibold text-gray-500">{subtitle}</span>}</button></div></header>{children}</div>;
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

/**
 * One message.
 *
 * ONLY a text message wears the coloured bubble. Images, files, polls, shared
 * events and shared posts render bare, exactly as they do on mobile — the
 * oversized teal wrapper around a photo or a file in the correction screenshots
 * is the defect Update 3 removes. The timestamp and the actions menu sit under
 * whatever was rendered, so their placement does not depend on the payload.
 */
function MessageBubble({ message, isOwn, showSender, userId, onOpenProfile, onOpenEvent, onOpenPost, onUnsend, onChanged, onError, attachmentUnavailable, isSearchTarget, searchNonce }: { message: ThreadMessage; isOwn: boolean; showSender: boolean; userId: string; onOpenProfile: (id: string) => void; onOpenEvent: (id: string) => void; onOpenPost: (id: string) => void; onUnsend: (messageId: string) => Promise<void>; onChanged: () => void; onError: (message: string) => void; attachmentUnavailable?: boolean; isSearchTarget?: boolean; searchNonce?: number }): JSX.Element {
  const [menu, setMenu] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const closeMenu = useCallback(() => setMenu(false), []);
  useEscapeAndOutside(menuRef, closeMenu);
  // Never even request the bytes for a restricted attachment: Storage would
  // refuse them anyway, and not asking keeps the network log clean too.
  const attachment = useAttachmentUrl(message.attachment_url, attachmentUnavailable);
  const { ref: highlightRef, highlighted } = useSearchHighlight(!!isSearchTarget, searchNonce ?? 0);

  const pending = message.pending_state === "sending";
  const failed = message.pending_state === "failed";

  const mutate = async (action: () => Promise<void>, failureMessage: string) => {
    setMenu(false);
    try {
      await action();
      onChanged();
    } catch (error) {
      // Surface the real, actionable reason when the backend gave one rather
      // than flattening every distinct failure into one opaque sentence.
      onError(messageActionError(error, failureMessage));
    }
  };

  const isText = message.message_type === "text" || (!message.attachment_url && !message.poll_id && !message.shared_event_id && !message.shared_post_id && message.message_type !== "poll" && message.message_type !== "shared_event" && message.message_type !== "shared_post");
  const blockedAttachment = attachmentUnavailable && !!message.attachment_url;

  let body: JSX.Element | null = null;
  if (message.message_type === "poll" && message.poll_id) {
    body = <PollCard pollId={message.poll_id} userId={userId} onChanged={onChanged} onError={onError} />;
  } else if (message.message_type === "shared_event") {
    body = <EventShareCard eventId={message.shared_event_id} onOpenEvent={onOpenEvent} />;
  } else if (message.message_type === "shared_post") {
    body = <PostShareCard postId={message.shared_post_id} onOpenPost={onOpenPost} onOpenProfile={onOpenProfile} />;
  } else if (blockedAttachment) {
    body = <p className="max-w-[300px] rounded-2xl border bg-white px-3 py-2 text-sm text-gray-500" style={{ borderColor: "rgba(0,0,0,0.10)" }}>{ATTACHMENT_UNAVAILABLE_TEXT}</p>;
  } else if (message.message_type === "image") {
    body = <ChatImage message={message} objectUrl={attachment} onOpen={attachment ? () => window.open(attachment, "_blank", "noreferrer") : undefined} />;
  } else if (message.message_type === "video") {
    body = <ChatVideo objectUrl={attachment} />;
  } else if (message.message_type === "file") {
    body = <ChatFileCard message={message} objectUrl={attachment} pending={pending} />;
  }

  return (
    <div ref={highlightRef} className={`mb-3 flex gap-2 ${isOwn ? "justify-end" : "justify-start"}`}>
      {/* Update 1 — the sender's avatar and, below, their name are both the
          canonical profile link, resolving to the same person. */}
      {!isOwn && message.sender_id && (
        <ClickableUserIdentity userId={message.sender_id} ariaLabel={`Open ${message.sender.full_name || message.sender.username || "this person"}'s profile`} className="self-end">
          <Avatar uri={message.sender.avatar_url} size={28} name={message.sender.full_name ?? message.sender.username} />
        </ClickableUserIdentity>
      )}
      <div className={`group relative flex max-w-[78%] flex-col ${isOwn ? "items-end" : "items-start"} rounded-2xl transition-colors ${highlighted ? "bg-teal/15 ring-2 ring-teal" : ""} ${pending ? "opacity-60" : ""}`} style={highlighted ? { padding: 6, margin: -6 } : undefined}>
        {showSender && !isOwn && message.sender_id && (
          <ClickableUserIdentity userId={message.sender_id} className="mb-0.5 block max-w-full truncate text-xs font-bold text-teal">
            {message.sender.full_name || `@${message.sender.username}`}
          </ClickableUserIdentity>
        )}

        {isText ? (
          <div className={`rounded-2xl px-3 py-2 shadow-[0_2px_4px_rgba(0,0,0,0.15)] ${isOwn ? "bg-teal text-white" : "bg-white text-teal"} ${failed ? "ring-1 ring-red-400" : ""}`}>
            {message.content && <p className="whitespace-pre-wrap break-words text-sm">{message.content}</p>}
          </div>
        ) : (
          <>
            {body}
            {/* A caption travels with its media rather than becoming a second
                message, matching mobile's mediaCaption. */}
            {message.content && message.message_type !== "file" && (
              <p className="mt-1 max-w-[300px] whitespace-pre-wrap break-words text-sm text-gray-700">{message.content}</p>
            )}
          </>
        )}

        <div className="mt-1 flex items-center gap-2 text-[10px] text-gray-400">
          <time dateTime={message.created_at}>{pending ? "Sending…" : failed ? "Not sent" : shortTime(message.created_at)}</time>
          {failed && message.onRetry && (
            <button type="button" onClick={message.onRetry} className="rounded px-1 font-semibold text-red-600 hover:bg-red-50">Retry</button>
          )}
          {!pending && !failed && (
            <button type="button" aria-label="Message actions" aria-expanded={menu} onClick={() => setMenu((open) => !open)} className="rounded px-1 opacity-70 hover:bg-black/10">•••</button>
          )}
        </div>

        {menu && (
          <div ref={menuRef} role="menu" className={`absolute bottom-6 z-20 w-44 rounded-lg border bg-white p-1 text-left text-sm text-gray-800 shadow-lg ${isOwn ? "right-0" : "left-0"}`}>
            {message.content && (
              <button type="button" role="menuitem" onClick={() => { void navigator.clipboard?.writeText(message.content!); setMenu(false); }} className="block w-full rounded px-3 py-2 text-left hover:bg-gray-50">Copy</button>
            )}
            <button type="button" role="menuitem" onClick={() => void mutate(() => hideMessage(message.id, userId), "Couldn’t remove that message from your view.")} className="block w-full rounded px-3 py-2 text-left hover:bg-gray-50">Delete for me</button>
            {isOwn && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  // Not routed through `mutate`: the message is already gone
                  // from view by the time this resolves, and the hook owns both
                  // the rollback and the post-success convergence.
                  setMenu(false);
                  void onUnsend(message.id);
                }}
                className="block w-full rounded px-3 py-2 text-left text-red-600 hover:bg-red-50"
              >
                Unsend for everyone
              </button>
            )}
            {!isOwn && (
              <button type="button" role="menuitem" onClick={() => { setMenu(false); setReportOpen(true); }} className="block w-full rounded px-3 py-2 text-left text-red-600 hover:bg-red-50">Report</button>
            )}
          </div>
        )}
        {reportOpen && (
          <ReportModal
            entityType="message"
            entityId={message.id}
            onClose={() => setReportOpen(false)}
            onSubmitted={onError}
            onSubmit={(reason) => reportMessage(message.id, reason).then(onChanged)}
          />
        )}
      </div>
    </div>
  );
}

/** Keeps a real backend refusal readable instead of collapsing every distinct
 *  cause into one sentence the person cannot act on. */
function messageActionError(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : "";
  if (/not_authorized|42501/i.test(raw)) return "You can’t do that to this message.";
  if (/account_restricted/i.test(raw)) return "Your account can’t do that right now.";
  if (/Failed to (send|fetch)|NetworkError|Load failed/i.test(raw)) return "Couldn’t reach the server. Check your connection and try again.";
  return fallback;
}

/**
 * Bug 9 — the poll card, on the mobile card surface.
 *
 * The vote failure reported in the correction screenshots was NOT a broken
 * mutation. `cast_poll_vote` refuses a poll whose `start_at` is still in the
 * future ("Poll has not started yet", SQLSTATE P0001) — verified against a
 * production poll created 2026-08-07 with `start_at` 2026-08-14 — and this card
 * only ever looked at `end_at`. It therefore offered enabled vote buttons for a
 * poll that could not accept a vote, and reported the database's real, specific
 * refusal as "Couldn't record that vote."
 *
 * The window is now respected the way mobile respects it: a poll that has not
 * opened says so and cannot be voted in, and a genuine refusal is shown in the
 * words the backend used.
 */
function PollCard({ pollId, userId, onChanged, onError }: { pollId: string; userId: string; onChanged: () => void; onError: (message: string) => void }): JSX.Element {
  const { data: poll, isLoading } = useQuery({ queryKey: ["messages", "poll", pollId, userId], queryFn: () => getPoll(pollId, userId), staleTime: 0 });
  const queryClient = useQueryClient();
  const [voting, setVoting] = useState(false);
  if (isLoading) return <div className="w-full max-w-[300px] rounded-2xl border bg-white p-3 text-sm text-gray-500 shadow-[0_2px_6px_rgba(0,0,0,0.10)]" style={{ borderColor: "rgba(0,0,0,0.10)" }}>Loading poll…</div>;
  if (!poll) return <div className="w-full max-w-[300px] rounded-2xl border bg-white p-3 text-sm text-gray-500 shadow-[0_2px_6px_rgba(0,0,0,0.10)]" style={{ borderColor: "rgba(0,0,0,0.10)" }}>This poll is no longer available.</div>;

  const now = Date.now();
  const notStarted = !!poll.start_at && new Date(poll.start_at).getTime() > now;
  const closed = !!poll.end_at && new Date(poll.end_at).getTime() < now;
  const locked = notStarted || closed || voting;
  const totalVotes = poll.options.reduce((sum, option) => sum + option.votes, 0);
  const status = notStarted ? "Poll not started" : closed ? "Poll closed" : null;

  const vote = async (optionId: string) => {
    setVoting(true);
    try {
      await votePoll(pollId, optionId);
      await queryClient.invalidateQueries({ queryKey: ["messages", "poll", pollId] });
      onChanged();
    } catch (error) {
      onError(pollVoteError(error));
    } finally {
      setVoting(false);
    }
  };

  return (
    <div className="w-full max-w-[300px] rounded-2xl border bg-white p-3 text-sm shadow-[0_2px_6px_rgba(0,0,0,0.10)]" style={{ borderColor: "rgba(0,0,0,0.10)" }}>
      <p className="font-bold text-gray-950">{poll.question}</p>
      {status && <p className="mt-0.5 text-xs text-gray-500">{status}</p>}
      <div className="mt-2 space-y-1.5">
        {poll.options.map((option) => (
          <button
            key={option.id}
            type="button"
            disabled={locked}
            aria-pressed={option.selected}
            onClick={() => void vote(option.id)}
            className={`flex w-full items-center justify-between gap-2 rounded-full border px-3 py-1.5 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${option.selected ? "border-teal bg-teal/10 font-semibold text-teal" : "border-black/10 bg-white text-teal hover:bg-teal/[0.04]"}`}
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <span aria-hidden className={`inline-block h-3.5 w-3.5 shrink-0 rounded-full border-2 ${option.selected ? "border-teal bg-teal" : "border-gray-400"}`} />
              <span className="truncate">{option.option_text}</span>
            </span>
            <span className="shrink-0 text-xs text-gray-500">{option.votes}</span>
          </button>
        ))}
      </div>
      <p className="mt-2 text-right text-xs text-gray-500">
        {totalVotes} {totalVotes === 1 ? "vote" : "votes"} · {poll.allow_multiple ? "Multiple choice" : "Single choice"}
      </p>
    </div>
  );
}

/** The database refuses a vote for specific, stated reasons. Passing those
 *  through is the difference between "try later, it opens on Thursday" and an
 *  unactionable "Couldn't record that vote." */
function pollVoteError(error: unknown): string {
  const raw = error instanceof Error ? error.message : "";
  if (/has not started/i.test(raw)) return "This poll hasn’t started yet.";
  if (/has ended/i.test(raw)) return "This poll has closed.";
  if (/Not a member/i.test(raw)) return "You’re not a member of this chat.";
  if (/Poll not found/i.test(raw)) return "This poll is no longer available.";
  if (/account_restricted/i.test(raw)) return "Your account can’t vote right now.";
  return "Couldn’t record that vote.";
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
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<(Person & { role: string }) | null>(null);
  const [confirmBlock, setConfirmBlock] = useState<(Person & { role: string }) | null>(null);
  const [confirmDeleteEveryone, setConfirmDeleteEveryone] = useState(false);
  const [reportTarget, setReportTarget] = useState<{ entityType: ReportEntityType; entityId: string; entityName?: string | null; clubId?: string | null } | null>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const overflowRef = useRef<HTMLDivElement>(null);
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
  // Bug 1 — "2 participants" is meaningless on a one-to-one chat, so a direct
  // conversation carries no participant-count subtitle at all. Groups keep it.
  const subtitle = channel
    ? details.name
    : isMembersChat || isOfficersChat || isDirect ? null
    : `${details.participants.length} participants`;
  const initials = channel ? (channel.kind === "main" ? "MA" : `#${channel.name.slice(0, 1).toUpperCase()}`) : details.name.slice(0, 1).toUpperCase();
  // Bug 5 — a channel's own picture is authoritative; the conversation's is the
  // fallback for one that has never had its own (rows predating migration 079).
  const identityAvatarUrl = channel ? channel.avatar_url ?? details.avatar_url : details.avatar_url;
  /**
   * Bug 2 — where the club identity leads.
   *
   * Only on Club Chat Information (the club conversation itself), and only to
   * the app's canonical `/club/[clubId]` route — the SAME Club Profile reached
   * from Home, search and a club card. There is deliberately no chat-local
   * rendering of a club anywhere in Messages.
   *
   * A channel's info panel is excluded: its title is the channel, not the club,
   * so linking it to a club profile would be a mismatched destination.
   */
  const clubProfileHref = isParentInfo && details.club_id ? `/club/${details.club_id}` : null;

  // Same restriction as the thread: a blocked pair's attachments are withheld
  // from the shared Media/Files panels too. Storage refuses the bytes anyway.
  const { data: restrictedSenderIds } = useQuery({
    queryKey: ["messages", "restrictedSenders", conversationId],
    queryFn: () => conversationRestrictedSenders(conversationId),
    enabled: !!conversationId,
    staleTime: 0,
  });
  const restrictedSenders = useMemo(() => new Set(restrictedSenderIds ?? []), [restrictedSenderIds]);

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

  /* ── Permissions, read from the canonical backend contract ────────────────
   *
   * Bug 7. A custom group's name and image are writable ONLY by its creator —
   * that is literally the `conversations: group admin updates meta` policy
   * (`type = 'group' AND created_by = auth.uid()`). The client derives the
   * control's visibility from the same fact the database enforces, so there is
   * no second, weaker client rule: a non-creator who forced the request would
   * still be refused, and would see the refusal rather than a false success.
   *
   * A club conversation's identity is not editable through `conversations` at
   * all (no UPDATE policy exists for `club_group`/`officer_chat`); its channels
   * are edited by officers through `rename_conversation_channel` /
   * `set_channel_avatar`, which do their own officer check.
   *
   * Bug 8. Member management and whole-group deletion are gated on the same
   * creator fact and executed through `remove_group_participant` /
   * `delete_group_conversation`, both of which decide authority server-side.
   */
  const isGroupCreator = isCustomGroup && !!details.created_by && details.created_by === userId;
  const canEditIdentity = isGroupCreator;
  const canManageMembers = isGroupCreator;
  const canAddPeople = isCustomGroup || (isParentInfo && isMembersChat && isOfficer);
  const showPeople = !isDirect && (isCustomGroup || isParentInfo);

  const saveName = async () => {
    try {
      await updateGroupMeta(conversationId, { name: nameDraft.trim() || null });
      setRenaming(false);
      onChanged();
      await queryClient.invalidateQueries({ queryKey: messageKeys.details(conversationId, userId) });
    } catch (error) {
      onError(error instanceof Error && error.message === "not_authorized"
        ? "Only the person who created this group can rename it."
        : "Couldn’t update the group name.");
    }
  };
  const saveAvatar = async (file: File) => {
    try {
      const url = await uploadGroupAvatar(conversationId, file);
      await updateGroupMeta(conversationId, { avatar_url: url });
      onChanged();
      await queryClient.invalidateQueries({ queryKey: messageKeys.details(conversationId, userId) });
    } catch (error) {
      onError(error instanceof Error && error.message === "not_authorized"
        ? "Only the person who created this group can change its picture."
        : error instanceof Error ? error.message : "Couldn’t update the group picture.");
    }
  };
  const removeMember = async (person: Person) => {
    setConfirmRemove(null);
    try {
      await removeGroupParticipant(conversationId, person.user_id);
      onChanged();
      await queryClient.invalidateQueries({ queryKey: messageKeys.details(conversationId, userId) });
    } catch { onError("Couldn’t remove that person from the group."); }
  };
  const blockMember = async (person: Person) => {
    setConfirmBlock(null);
    try {
      await blockUser(person.user_id);
      onChanged();
    } catch { onError("Couldn’t block that person."); }
  };
  const leaveGroup = async () => {
    setConfirmDelete(false);
    try { await leaveGroupChat(conversationId); onChanged(); onClose(); }
    catch { onError("Couldn’t leave the group."); }
  };
  const deleteForEveryone = async () => {
    setConfirmDeleteEveryone(false);
    try { await deleteGroupConversation(conversationId); onChanged(); onClose(); }
    catch { onError("Couldn’t delete the group."); }
  };

  type OverflowAction = { label: string; icon: JSX.Element; destructive?: boolean; run: () => void };
  const overflowActions: OverflowAction[] = [];
  if (isGroupCreator) {
    // Bug 8 — mobile's creator overflow is exactly one destructive entry.
    overflowActions.push({ label: "Delete for everyone", icon: <TrashIcon size={16} />, destructive: true, run: () => setConfirmDeleteEveryone(true) });
  }
  // Official chats report as the club they belong to (matches every other
  // club-content report). Direct and custom-group chats have no other
  // "report the whole chat" surface — only individual messages/participants
  // — so this reports the conversation itself. Not offered for a
  // channel/thread view: the parent chat's Report already covers it.
  if (!isThreadInfo && isOfficialChat && details.club_id) {
    overflowActions.push({
      label: "Report",
      icon: <FlagIcon size={16} />,
      run: () => setReportTarget({ entityType: "club", entityId: details.club_id!, entityName: details.name, clubId: details.club_id }),
    });
  } else if (!isThreadInfo && (isDirect || isCustomGroup)) {
    overflowActions.push({
      label: "Report",
      icon: <FlagIcon size={16} />,
      run: () => setReportTarget({ entityType: "chat", entityId: conversationId, entityName: details.name }),
    });
  }

  const tabs: InfoTab[] = isDirect ? ["media", "events", "files"] : ["polls", "media", "events", "files"];
  // A direct chat has no Polls tab on mobile; if a stale URL still asks for it,
  // fall back rather than rendering an empty, unreachable tab.
  const activeTab: InfoTab = tabs.includes(infoTab) ? infoTab : "media";

  const peopleSection = showPeople && (
    <div className={isDirect ? "hidden" : "px-4 pb-4"}>
      <div className="flex items-baseline justify-between px-1">
        <p className="text-base font-bold text-gray-950">{isOfficersChat ? "Officers" : "People"}</p>
        <span className="text-sm text-gray-500">{details.participants.length}</span>
      </div>
      <div className="mt-2 space-y-0.5">
        {details.participants.map((person) => (
          <MemberRow
            key={person.user_id}
            person={person}
            isSelf={person.user_id === userId}
            canRemove={canManageMembers && person.user_id !== userId}
            onOpenProfile={onOpenProfile}
            onMessage={() => onOpenProfile(person.user_id)}
            onReport={() =>
              setReportTarget({ entityType: "user", entityId: person.user_id, entityName: person.full_name ?? person.username, clubId: details.club_id ?? undefined })
            }
            onBlock={() => setConfirmBlock(person)}
            onRemove={() => setConfirmRemove(person)}
          />
        ))}
      </div>
    </div>
  );

  return <aside className="relative flex min-h-0 flex-col border-l bg-[#fffdf4] shadow-xl lg:overflow-hidden lg:shadow-none" style={{ borderColor: "rgba(0,0,0,0.17)" }}>
    <div className="flex shrink-0 items-center justify-between p-4">
      <button type="button" onClick={onClose} aria-label="Close information panel" className="rounded-full p-2 text-xl text-gray-950 hover:bg-black/5">‹</button>
      {/* Bug 1 — a one-to-one chat is not a group, so it gets NO top-right
          overflow at all. The menu only exists where it has a real action:
          reporting an official club chat, or the custom-group creator's
          "Delete for everyone". Message-level action menus are untouched. */}
      {overflowActions.length > 0 && (
        <div className="relative">
          <button type="button" onClick={() => setOverflow((open) => !open)} aria-label="More chat options" aria-expanded={overflow} className="rounded-full p-2 text-gray-950 hover:bg-black/5"><EllipsisIcon size={20} /></button>
          {overflow && <div ref={overflowRef} role="menu" className="absolute right-0 z-30 mt-1 w-52 rounded-xl border bg-white p-1 text-sm shadow-lg">
            {overflowActions.map((action) => (
              <button key={action.label} type="button" role="menuitem" onClick={() => { setOverflow(false); action.run(); }} className={`flex w-full items-center gap-2 rounded px-3 py-2 text-left ${action.destructive ? "text-red-600 hover:bg-red-50" : "hover:bg-gray-50"}`}>
                {action.icon}{action.label}
              </button>
            ))}
          </div>}
        </div>
      )}
    </div>

    <div className="shrink-0 px-5 pb-4 text-center">
      {/* Update 4 / Bug 7 — the group image, with mobile's camera badge shown
          ONLY to a viewer the backend would actually accept an edit from. */}
      <div className="relative mx-auto w-20">
        {/* Bug 5 — a channel shows ITS OWN picture, falling back to the
            conversation's only when it has never had one. Reading
            `details.avatar_url` unconditionally meant every channel of a club
            rendered the same image and an officer's per-channel picture was
            invisible. */}
        {identityAvatarUrl
          ? <Avatar uri={identityAvatarUrl} size={80} name={title} className="mx-auto" />
          : <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-teal text-2xl font-bold text-white">{initials}</div>}
        {/* Bug 2 — on Club Chat Information the picture opens the REAL Club
            Profile. It is a transparent overlay button rather than a wrapper so
            the officer's camera badge below stays independently clickable. */}
        {clubProfileHref && (
          <a href={clubProfileHref} aria-label={`Open the ${details.name} club profile`} className="absolute inset-0 rounded-full focus:outline-none focus:ring-2 focus:ring-teal" />
        )}
        {canEditIdentity && <>
          <button type="button" onClick={() => avatarInputRef.current?.click()} aria-label="Change group picture" className="absolute bottom-0 right-0 flex h-7 w-7 items-center justify-center rounded-full border-2 border-[#fffdf4] bg-teal text-white shadow focus:outline-none focus:ring-2 focus:ring-teal">
            <CameraIcon size={14} />
          </button>
          <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void saveAvatar(file); event.target.value = ""; }} />
        </>}
      </div>

      {renaming ? (
        <form onSubmit={(event) => { event.preventDefault(); void saveName(); }} className="mt-3 flex items-center gap-2">
          <input autoFocus value={nameDraft} onChange={(event) => setNameDraft(event.target.value)} maxLength={60} aria-label="Group name" className="min-w-0 flex-1 rounded-xl border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-teal" style={{ borderColor: "rgba(0,0,0,0.2)" }} />
          <button className="rounded-full bg-teal px-4 py-2 text-sm font-semibold text-white">Save</button>
          <button type="button" onClick={() => setRenaming(false)} className="rounded-full px-2 py-2 text-sm font-semibold text-gray-600">Cancel</button>
        </form>
      ) : (
        <div className="mt-3 flex items-center justify-center gap-1.5">
          {/* Bug 2 — the name is the same destination as the picture above, so
              "click the picture" and "click the name" can never resolve
              differently. A real anchor, so middle-click and open-in-new-tab
              behave as they do everywhere else in the product. */}
          {clubProfileHref
            ? <a href={clubProfileHref} className="truncate rounded text-2xl font-bold text-gray-950 hover:underline focus:outline-none focus:ring-2 focus:ring-teal" aria-label={`Open the ${details.name} club profile`}>{title}</a>
            : <h2 className="truncate text-2xl font-bold text-gray-950">{title}</h2>}
          {canEditIdentity && <button type="button" onClick={() => { setNameDraft(details.name === "Group chat" ? "" : details.name); setRenaming(true); }} aria-label="Edit group name" className="shrink-0 rounded-full p-1 text-gray-500 hover:bg-black/5"><PencilIcon size={16} /></button>}
        </div>
      )}
      {subtitle && <p className="truncate text-sm text-gray-500">{subtitle}</p>}

      {/* Update 4 — mobile's action order is exactly Add, Search, Leave. */}
      <div className="mt-4 flex flex-wrap justify-center gap-6">
        {canAddPeople && <InfoAction icon={<PersonAddIcon size={22} />} label="Add" onClick={() => setAddOpen(true)} />}
        {isParentInfo && isMembersChat && isOfficer && <InfoAction icon={<ShareIcon size={22} />} label="Share" onClick={() => setShareOpen(true)} />}
        <InfoAction icon={<SearchIcon size={22} />} label="Search" onClick={() => setSearchOpen((open) => !open)} />
        {isThreadInfo && <InfoAction icon={<BellOffIcon size={22} filled={muted} />} label={muted ? "Unmute" : "Mute"} onClick={() => void toggleMute()} />}
        {isThreadInfo && isOfficer && <InfoAction icon={<LockIcon size={22} />} label="Permissions" onClick={() => setPermOpen(true)} />}
        {isParentInfo && <>
          <InfoAction icon={<BellOffIcon size={22} filled={!!convFlags?.muted} />} label={convFlags?.muted ? "Unmute" : "Mute"} onClick={() => void toggleMute()} />
          <InfoAction icon={<ArchiveIcon size={22} filled={!!convFlags?.archived} />} label={convFlags?.archived ? "Unarchive" : "Archive"} onClick={() => void toggleArchive()} />
        </>}
        {!isOfficialChat && <InfoAction icon={isDirect ? <TrashIcon size={22} /> : <ExitIcon size={22} />} label={isDirect ? "Delete" : "Leave"} onClick={() => setConfirmDelete(true)} />}
      </div>

      {searchOpen && <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search this chat" aria-label="Search this chat" className="mt-4 h-10 w-full rounded-full border bg-white px-4 text-sm outline-none focus:ring-2 focus:ring-teal" style={{ borderColor: "rgba(0,0,0,0.2)" }} />}
    </div>

    {/* Update 4 — People sits ABOVE the tab band, as it does on mobile, and the
        whole People + tabs + tab-content stack is one scrolling region so a
        long roster cannot push the tabs off screen. An in-conversation search
        replaces the content but leaves the panel (and the field) open — Bug 2. */}
    <div className="min-h-0 flex-1 overflow-y-auto">
      {query.trim().length >= 3 ? (
        <div className="space-y-2 p-4">
          {searchLoading ? <p className="py-4 text-sm text-gray-500">Searching this conversation…</p> : matches.length ? matches.map((result) => <MessageSearchRow key={result.message_id} result={result} onClick={() => onOpenMessage(result)} />) : <EmptyPanel label="No messages match that search" />}
        </div>
      ) : (
        <>
          {peopleSection}
          <div role="tablist" aria-label="Chat content" className="sticky top-0 z-10 grid border-y bg-[#fffdf4]" style={{ borderColor: "rgba(0,0,0,0.1)", gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
            {tabs.map((tab) => <InfoTabButton key={tab} tab={tab} active={activeTab === tab} onClick={() => onTab(tab)} />)}
          </div>
          <div className="p-4">
            {activeTab === "polls" && <SharedPolls messages={polls} userId={userId} onError={onError} />}
            {activeTab === "media" && <SharedMedia messages={[...media, ...videos]} restrictedSenders={restrictedSenders} />}
            {activeTab === "events" && <div className="space-y-2">{events.length ? events.map((event) => <button key={event.event_id} type="button" onClick={() => onOpenEvent(event.event_id)} className="flex w-full gap-3 rounded-xl border bg-white p-2 text-left hover:bg-teal/[0.03]">{event.cover_image_url && <img src={event.cover_image_url} alt="" className="h-14 w-14 rounded-lg object-cover" />}<span className="min-w-0"><span className="block truncate text-sm font-bold">{event.emoji ? `${event.emoji} ` : ""}{event.title}</span><span className="block text-xs text-gray-500">{event.event_date}{event.start_time ? ` · ${event.start_time}` : ""}</span></span></button>) : <EmptyPanel label="No shared events yet" />}</div>}
            {activeTab === "files" && <SharedFiles messages={files} restrictedSenders={restrictedSenders} />}
          </div>
        </>
      )}
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
    {shareOpen && <ShareInvitePanel conversationId={conversationId} conversationName={details.name} onClose={() => setShareOpen(false)} />}
    {addOpen && <AddPeoplePanel
      existingIds={new Set(details.participants.map((person) => person.user_id))}
      onClose={() => setAddOpen(false)}
      onAdd={async (ids) => {
        try {
          await addGroupParticipants(conversationId, ids);
          setAddOpen(false);
          onChanged();
          await queryClient.invalidateQueries({ queryKey: messageKeys.details(conversationId, userId) });
        } catch { onError("Couldn’t add those people to the group."); }
      }} />}
    {confirmDelete && <ConfirmSheet
      title={isDirect ? "Delete conversation?" : "Leave group?"}
      message={isDirect ? `This removes the conversation from your messages only. ${details.name} keeps their copy. If either of you messages again, the conversation comes back.` : `You'll leave ${details.name}. This has no effect on any club.`}
      confirmLabel={isDirect ? "Delete" : "Leave group"}
      // Leaving is a real, authorised backend operation (`leave_group_chat`),
      // not something that only exists on the phone — the panel used to tell
      // the person to go and use another device.
      onConfirm={() => { if (isDirect) void deleteDirect(); else void leaveGroup(); }}
      onCancel={() => setConfirmDelete(false)} />}
    {confirmDeleteEveryone && <ConfirmSheet
      title="Delete for everyone?"
      message={`This deletes ${details.name} and its messages for every member. This can't be undone.`}
      confirmLabel="Delete for everyone"
      onConfirm={() => void deleteForEveryone()}
      onCancel={() => setConfirmDeleteEveryone(false)} />}
    {confirmRemove && <ConfirmSheet
      title="Remove from group?"
      message={`${confirmRemove.full_name?.trim() || confirmRemove.username} will be removed from ${details.name}.`}
      confirmLabel="Remove"
      onConfirm={() => void removeMember(confirmRemove)}
      onCancel={() => setConfirmRemove(null)} />}
    {confirmBlock && <ConfirmSheet
      title="Block this student?"
      message={blockConfirmMessage(confirmBlock.username)}
      confirmLabel="Block"
      onConfirm={() => void blockMember(confirmBlock)}
      onCancel={() => setConfirmBlock(null)} />}
    {reportTarget && (
      <ReportModal
        {...reportTarget}
        onClose={() => setReportTarget(null)}
        onSubmitted={onError}
      />
    )}
  </aside>;
}

/**
 * Bug 8 / Update 1 — one person in the People list.
 *
 * The row is the mobile row: avatar, name over @username, a message shortcut,
 * and a three-dot menu carrying Report, Block and Remove from group — with
 * Remove present ONLY for a viewer the backend would accept it from. Report and
 * Block reuse We Glue's existing report and blocking flows rather than
 * messaging-specific copies.
 *
 * Avatar and name are the shared `PersonIdentity` control, so both open the
 * same profile (Update 1).
 */
function MemberRow({ person, isSelf, canRemove, onOpenProfile, onMessage, onReport, onBlock, onRemove }: { person: Person & { role: string }; isSelf: boolean; canRemove: boolean; onOpenProfile: (id: string) => void; onMessage: () => void; onReport: () => void; onBlock: () => void; onRemove: () => void }): JSX.Element {
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEscapeAndOutside(menuRef, useCallback(() => setMenu(false), []));
  const display = person.full_name?.trim() || person.username;
  return (
    <div className="relative flex items-center gap-2 rounded-lg px-1 py-1.5 hover:bg-black/[0.035]">
      <PersonIdentity userId={person.user_id} username={person.username} fullName={person.full_name} avatarUrl={person.avatar_url} onOpenProfile={onOpenProfile} size={36} className="flex-1" />
      {!isSelf && (
        <>
          <button type="button" onClick={onMessage} aria-label={`Message ${display}`} className="shrink-0 rounded-full p-1.5 text-gray-500 hover:bg-black/5"><ChatBubbleOutlineIcon size={18} /></button>
          <button type="button" onClick={() => setMenu((open) => !open)} aria-label={`Actions for ${display}`} aria-expanded={menu} className="shrink-0 rounded-full p-1.5 text-gray-500 hover:bg-black/5"><EllipsisIcon size={16} /></button>
        </>
      )}
      {menu && (
        <div ref={menuRef} role="menu" className="absolute right-0 top-9 z-30 w-60 rounded-xl border bg-white p-1 text-sm shadow-lg">
          <button type="button" role="menuitem" onClick={() => { setMenu(false); onReport(); }} className="flex w-full items-center gap-2 rounded px-3 py-2 text-left hover:bg-gray-50"><FlagIcon size={16} />Report {display}</button>
          <button type="button" role="menuitem" onClick={() => { setMenu(false); onBlock(); }} className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-red-600 hover:bg-red-50"><BlockIcon size={16} />Block {display}</button>
          {canRemove && <button type="button" role="menuitem" onClick={() => { setMenu(false); onRemove(); }} className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-red-600 hover:bg-red-50"><PersonRemoveIcon size={16} />Remove from group</button>}
        </div>
      )}
    </div>
  );
}

/** Update 4 — "Add", using the same people search the composer uses, so the
 *  group roster and a new conversation find people the same way. */
function AddPeoplePanel({ existingIds, onClose, onAdd }: { existingIds: Set<string>; onClose: () => void; onAdd: (ids: string[]) => Promise<void> }): JSX.Element {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Person[]>([]);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEscapeAndOutside(ref, onClose);
  const searching = query.trim().length >= 3;
  const { data: people = [], isLoading } = useMessagePeopleSearch(query);
  const { data: suggestions = [], isLoading: suggestionsLoading, isError: suggestionsFailed } = useMessageSuggestions(!searching);
  const candidates = (searching ? people : suggestions).filter((person) => !existingIds.has(person.user_id));
  const selectedIds = new Set(selected.map((person) => person.user_id));
  const toggle = (person: Person) =>
    setSelected((current) => current.some((item) => item.user_id === person.user_id) ? current.filter((item) => item.user_id !== person.user_id) : [...current, person]);
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
    <div ref={ref} role="dialog" aria-modal="true" aria-label="Add people to this group" className="flex max-h-[85vh] w-full max-w-md flex-col rounded-2xl bg-cream p-5 shadow-2xl">
      <h3 className="text-lg font-bold text-gray-950">Add people</h3>
      <ComposerSearchField value={query} onChange={setQuery} />
      <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
        {searching && isLoading ? <p className="py-4 text-sm text-gray-500">Searching…</p>
          : !searching && suggestionsLoading ? <p className="py-4 text-sm text-gray-500">Loading suggestions…</p>
          : !searching && suggestionsFailed ? <p className="py-4 text-sm text-red-600">Couldn’t load suggestions.</p>
          : candidates.length ? candidates.map((person) => <PersonRow key={person.user_id} person={person} selected={selectedIds.has(person.user_id)} onClick={() => toggle(person)} />)
          : <p className="py-4 text-sm text-gray-500">{searching ? "No people found." : "Search above to find people."}</p>}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-full px-4 py-2 text-sm font-semibold text-gray-600">Cancel</button>
        <button type="button" disabled={!selected.length || saving} onClick={() => { setSaving(true); void onAdd(selected.map((person) => person.user_id)).finally(() => setSaving(false)); }} className="rounded-full bg-teal px-5 py-2 text-sm font-semibold text-white disabled:opacity-45">{saving ? "Adding…" : `Add${selected.length ? ` ${selected.length}` : ""}`}</button>
      </div>
    </div>
  </div>;
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
 * "Who can post" — the same options mobile offers, from the one shared
 * definition in `postingPermissionOptions` so the two platforms cannot drift.
 *
 * Bug 7: an Officers conversation offers "Everyone in this chat" and "Certain
 * people" only. This does not invent a permission model; it drives the same
 * `set_channel_post_permission` RPC with the same stored values.
 *
 * "Certain people" lists `participants` — the roster of THIS conversation — so
 * it never searches the wider We Glue user base, and one or several people may
 * be selected. Posting access also cannot outlive membership: 041's
 * `cleanup_channel_posters_on_leave` trigger deletes a person's `channel_posters`
 * rows when they leave the conversation.
 */
function PermissionsSheet({ channel, participants, isOfficersChat, onClose, onSave }: { channel: Channel; participants: Array<Person & { role: string }>; isOfficersChat: boolean; onClose: () => void; onSave: (permission: PostingPermission, userIds: string[]) => Promise<void> }): JSX.Element {
  const [permission, setPermission] = useState<PostingPermission>(permissionSelectValue(channel.post_permission, isOfficersChat));
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
  const options = postingPermissionOptions(isOfficersChat);
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

/** Copy link / Show QR code / Share… / Reset link — the same four rows and
 *  the same active invitation as mobile's ShareInviteSheet, because both call
 *  the identical get_or_create_chat_invitation / rotate_chat_invitation RPCs
 *  and build the link from the same INVITE_BASE_URL + token. */
function ShareInviteQr({ value, size }: { value: string; size: number }): JSX.Element {
  const rows = useMemo(() => {
    const qr = qrcodegen(0, "M");
    qr.addData(value);
    qr.make();
    const count = qr.getModuleCount();
    const matrix: boolean[][] = [];
    for (let r = 0; r < count; r++) {
      const row: boolean[] = [];
      for (let c = 0; c < count; c++) row.push(qr.isDark(r, c));
      matrix.push(row);
    }
    return matrix;
  }, [value]);
  const cell = size / rows.length;
  return <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Invitation QR code">
    <rect width={size} height={size} fill="#fff" />
    {rows.map((row, r) => row.map((dark, c) => dark ? <rect key={`${r}-${c}`} x={c * cell} y={r * cell} width={cell} height={cell} fill="#000" /> : null))}
  </svg>;
}

function ShareInvitePanel({ conversationId, conversationName, onClose }: { conversationId: string; conversationName: string; onClose: () => void }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showQr, setShowQr] = useState(false);
  const [copied, setCopied] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEscapeAndOutside(ref, onClose);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getInviteToken(conversationId)
      .then((value) => { if (alive) setToken(value); })
      .catch(() => { if (alive) setError("You are not allowed to share this chat."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [conversationId]);

  const link = token ? `${INVITE_BASE_URL}/${token}` : null;
  const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  async function copyLink() {
    if (!link) return;
    await navigator.clipboard?.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  async function nativeShare() {
    if (!link) return;
    try {
      await navigator.share!({ title: `Join ${conversationName} on We Glue`, url: link });
    } catch {
      // dismissed — no-op, matches mobile's Share.share() catch
    }
  }
  async function resetLink() {
    setResetting(true);
    setError(null);
    try {
      const next = await rotateInviteToken(conversationId);
      setToken(next);
      setShowQr(false);
    } catch {
      setError("Could not reset the link. Please try again.");
    } finally {
      setResetting(false);
    }
  }

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
    <div ref={ref} role="dialog" aria-modal="true" aria-label={`Invite to ${conversationName}`} className="w-full max-w-md rounded-2xl bg-cream p-5 shadow-2xl">
      <h3 className="text-lg font-bold text-gray-950">Invite to {conversationName}</h3>
      <p className="mt-1 text-sm text-gray-500">Anyone from your university with this link can join. The link doesn&apos;t expire — you can reset it anytime.</p>
      {error && <p className="mt-3 text-sm font-medium text-red-600">{error}</p>}
      {loading || !link ? (
        <div className="my-8 flex justify-center"><div className="h-6 w-6 animate-spin rounded-full border-2 border-teal border-t-transparent" /></div>
      ) : showQr ? (
        <div className="mt-4 flex flex-col items-center gap-4">
          <ShareInviteQr value={link} size={220} />
          <button type="button" onClick={() => setShowQr(false)} className="text-sm font-semibold text-teal">Hide QR code</button>
        </div>
      ) : (
        <div className="mt-4">
          <button type="button" onClick={() => void copyLink()} className="flex w-full items-center gap-3 rounded-xl bg-white px-3 py-3 text-left text-[15px] font-semibold text-gray-950 hover:bg-teal/[0.04]"><ShareIcon size={20} />{copied ? "Copied!" : "Copy link"}</button>
          <button type="button" onClick={() => setShowQr(true)} className="mt-2 flex w-full items-center gap-3 rounded-xl bg-white px-3 py-3 text-left text-[15px] font-semibold text-gray-950 hover:bg-teal/[0.04]"><QrCodeIcon size={20} />Show QR code</button>
          {canNativeShare && <button type="button" onClick={() => void nativeShare()} className="mt-2 flex w-full items-center gap-3 rounded-xl bg-white px-3 py-3 text-left text-[15px] font-semibold text-gray-950 hover:bg-teal/[0.04]"><ShareIcon size={20} />Share…</button>}
          <button type="button" disabled={resetting} onClick={() => void resetLink()} className="mt-2 flex w-full items-center gap-3 rounded-xl bg-white px-3 py-3 text-left text-[15px] font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"><RefreshIcon size={20} />{resetting ? "Resetting…" : "Reset link"}</button>
        </div>
      )}
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
function SharedMedia({ messages, restrictedSenders }: { messages: ThreadMessage[]; restrictedSenders?: Set<string> }): JSX.Element { const visible = messages.filter((message) => !(message.sender_id && restrictedSenders?.has(message.sender_id))); return visible.length ? <div className="grid grid-cols-3 gap-2">{visible.map((message) => <SignedMedia key={message.id} message={message} />)}</div> : <EmptyPanel label="No photos or videos yet" />; }
function SignedMedia({ message }: { message: ThreadMessage }): JSX.Element { const [url, setUrl] = useState<string | null>(null); useEffect(() => { let alive = true; let created: string | null = null; if (message.attachment_url) void attachmentObjectUrl(message.attachment_url).then((u) => { if (alive) { created = u; setUrl(u); } else { releaseAttachmentUrl(u); } }).catch(() => {}); return () => { alive = false; releaseAttachmentUrl(created); }; }, [message.attachment_url]); return url ? <a href={url} target="_blank" rel="noreferrer" className="aspect-square overflow-hidden rounded-lg bg-black/5">{message.message_type === "video" ? <video src={url} className="h-full w-full object-cover" /> : <img src={url} alt={message.attachment_name ?? "Shared media"} className="h-full w-full object-cover" />}</a> : <div className="aspect-square animate-pulse rounded-lg bg-black/5" />; }
function SharedFiles({ messages, restrictedSenders }: { messages: ThreadMessage[]; restrictedSenders?: Set<string> }): JSX.Element { const visible = messages.filter((message) => !(message.sender_id && restrictedSenders?.has(message.sender_id))); return visible.length ? <div className="space-y-2">{visible.map((message) => <SignedFile key={message.id} message={message} />)}</div> : <EmptyPanel label="No files yet" />; }
function SignedFile({ message }: { message: ThreadMessage }): JSX.Element { const [url, setUrl] = useState<string | null>(null); useEffect(() => { let alive = true; let created: string | null = null; if (message.attachment_url) void attachmentObjectUrl(message.attachment_url).then((u) => { if (alive) { created = u; setUrl(u); } else { releaseAttachmentUrl(u); } }).catch(() => {}); return () => { alive = false; releaseAttachmentUrl(created); }; }, [message.attachment_url]); return <a href={url ?? undefined} download={message.attachment_name ?? undefined} target="_blank" rel="noreferrer" className="block rounded-lg border bg-white px-3 py-2 text-sm font-medium text-teal underline">📎 {message.attachment_name ?? "Download file"}</a>; }

function compareConversation(a: ConversationPreview, b: ConversationPreview): number { return new Date(b.last_message_at ?? 0).getTime() - new Date(a.last_message_at ?? 0).getTime(); }
function previewForSearch(type: string): string { if (type === "poll") return "Poll"; if (type === "shared_event") return "Shared an event"; if (type === "shared_post") return "Shared a post"; if (type === "image") return "Photo"; if (type === "video") return "Video"; if (type === "file") return "File"; return "Message"; }
function shortTime(value: string | null): string { if (!value) return ""; const date = new Date(value); const now = new Date(); if (date.toDateString() === now.toDateString()) return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); if ((now.getTime() - date.getTime()) < 6 * 24 * 60 * 60 * 1000) return date.toLocaleDateString([], { weekday: "short" }); return date.toLocaleDateString([], { month: "short", day: "numeric" }); }
function channelLabel(channel: { kind: "main" | "channel"; name: string }): string { return channel.kind === "main" ? "Main chat" : `#${channel.name}`; }
