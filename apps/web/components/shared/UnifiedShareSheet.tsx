"use client";

import { useMemo, useState } from "react";
import { Modal } from "./Modal";
import { Avatar } from "./Avatar";
import { useMessageConversations, useMessagePeopleSearch, useMessageSuggestions } from "../../lib/messages/hooks";
import { getOrCreateDirectConversation, shareContentToConversation, type ConversationPreview, type Person, type ShareableContent } from "../../lib/messages/service";

export function UnifiedShareSheet({
  userId,
  content,
  title,
  onClose,
  onToast,
}: {
  userId: string;
  content: ShareableContent;
  title: string;
  onClose: () => void;
  onToast: (message: string, kind?: "success" | "error") => void;
}): JSX.Element {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Record<string, { kind: "person" | "conversation"; id: string }>>({});
  const [sending, setSending] = useState(false);
  const { data: suggestions = [], isLoading: loadingSuggestions } = useMessageSuggestions(!query.trim());
  const { data: conversations = [], isLoading: loadingConversations } = useMessageConversations(userId);
  const { data: searchedPeople = [], isLoading: loadingSearch } = useMessagePeopleSearch(query);
  const isSearching = query.trim().length >= 3;
  const people = isSearching ? searchedPeople : suggestions;
  const filteredConversations = useMemo(() => {
    const value = query.trim().toLowerCase();
    return value ? conversations.filter((c) => c.name.toLowerCase().includes(value)) : conversations.slice(0, 6);
  }, [conversations, query]);
  const loading = loadingSuggestions || loadingConversations || (isSearching && loadingSearch);
  const selectedCount = Object.keys(selected).length;

  const toggle = (key: string, value: { kind: "person" | "conversation"; id: string }) =>
    setSelected((current) => {
      const next = { ...current };
      if (next[key]) delete next[key]; else next[key] = value;
      return next;
    });

  const send = async () => {
    if (!selectedCount || sending) return;
    setSending(true);
    let sent = 0;
    try {
      for (const target of Object.values(selected)) {
        try {
          const conversationId = target.kind === "conversation" ? target.id : await getOrCreateDirectConversation(target.id);
          await shareContentToConversation({ conversationId, senderId: userId, content });
          sent += 1;
        } catch { /* report partial success without duplicating sends */ }
      }
      if (sent) { onToast(`Shared to ${sent} ${sent === 1 ? "destination" : "destinations"}.`); onClose(); }
      else onToast("Could not share. Try again.", "error");
    } finally { setSending(false); }
  };

  const link = typeof window === "undefined" ? "" : `${window.location.origin}/${content.type}/${content.id}`;
  const external = async (kind: string) => {
    if (!link) return;
    try {
      if (kind === "copy") { await navigator.clipboard.writeText(link); onToast("Link copied!"); }
      else if (kind === "whatsapp") window.open(`https://wa.me/?text=${encodeURIComponent(`${title} ${link}`)}`, "_blank", "noopener,noreferrer");
      else if (kind === "messages") window.open(`sms:?&body=${encodeURIComponent(`${title} ${link}`)}`, "_blank", "noopener,noreferrer");
      else if (kind === "instagram") { await navigator.clipboard.writeText(link); onToast("Link copied — paste it into Instagram."); }
      else if (navigator.share) await navigator.share({ title, url: link });
      else { await navigator.clipboard.writeText(link); onToast("Link copied!"); }
    } catch { /* user cancelled or browser blocked the action */ }
  };

  return <Modal onClose={onClose} labelledBy="unified-share-title" maxWidth={560} placement="bottom">
    <div className="max-h-[82vh] overflow-y-auto p-5 sm:p-6">
      <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-gray-300" />
      <h2 id="unified-share-title" className="text-center text-xl font-bold text-gray-900">Share</h2>
      <div className="mt-4 flex items-center gap-2 rounded-xl bg-white px-3 py-2 ring-1 ring-black/10">
        <span aria-hidden className="text-gray-400">⌕</span>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search people, groups and clubs" aria-label="Search people, groups and clubs" className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
      </div>
      <p className="mt-4 text-xs font-bold uppercase tracking-wide text-gray-500">{isSearching ? "Results" : "Suggested"}</p>
      <div className="mt-2 space-y-1">
        {loading ? <p className="py-5 text-center text-sm text-gray-500">Loading…</p> : <>
          {people.map((person: Person) => <RecipientRow key={`person:${person.user_id}`} label={person.full_name || person.username} supporting={`@${person.username}`} avatar={person.avatar_url} checked={!!selected[`person:${person.user_id}`]} onClick={() => toggle(`person:${person.user_id}`, { kind: "person", id: person.user_id })} />)}
          {filteredConversations.map((conversation: ConversationPreview) => <RecipientRow key={`conversation:${conversation.id}`} label={conversation.name} supporting="Group or club chat" avatar={conversation.avatar_url} checked={!!selected[`conversation:${conversation.id}`]} onClick={() => toggle(`conversation:${conversation.id}`, { kind: "conversation", id: conversation.id })} />)}
          {!people.length && !filteredConversations.length && <p className="py-5 text-center text-sm text-gray-500">No eligible destinations found.</p>}
        </>}</div>
      <button type="button" onClick={send} disabled={!selectedCount || sending} className="mt-4 w-full rounded-full bg-[#0FA6A6] py-2.5 text-sm font-semibold text-white disabled:opacity-50">{sending ? "Sharing…" : selectedCount ? `Share to ${selectedCount}` : "Select recipients"}</button>
      <div className="my-5 border-t" />
      <h3 className="text-sm font-bold text-gray-900">Share externally</h3>
      <div className="mt-3 grid grid-cols-5 gap-2 text-center text-xs text-gray-600">
        {[{ key: "instagram", icon: "◎", label: "Instagram" }, { key: "messages", icon: "•••", label: "Messages" }, { key: "whatsapp", icon: "◉", label: "WhatsApp" }, { key: "copy", icon: "↗", label: "Copy Link" }, { key: "more", icon: "⋯", label: "More" }].map((item) => <button type="button" key={item.key} onClick={() => void external(item.key)} className="flex flex-col items-center gap-1 rounded-xl p-2 hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0FA6A6]"><span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#0FA6A6]/10 text-lg text-[#0FA6A6]">{item.icon}</span><span>{item.label}</span></button>)}
      </div>
    </div>
  </Modal>;
}

function RecipientRow({ label, supporting, avatar, checked, onClick }: { label: string; supporting: string; avatar: string | null; checked: boolean; onClick: () => void }): JSX.Element {
  return <button type="button" onClick={onClick} aria-pressed={checked} className="flex w-full items-center gap-3 rounded-xl p-2 text-left hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0FA6A6]">
    <Avatar uri={avatar} size={40} name={label} /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-gray-900">{label}</span><span className="block truncate text-xs text-gray-500">{supporting}</span></span><span aria-hidden className={`flex h-6 w-6 items-center justify-center rounded-full border-2 ${checked ? "border-[#0FA6A6] bg-[#0FA6A6] text-white" : "border-gray-300"}`}>{checked ? "✓" : ""}</span>
  </button>;
}
