"use client";

import { useEffect, useMemo, useState } from "react";
import { Modal } from "./Modal";
import { Avatar } from "./Avatar";
import { useMessageConversations, useMessagePeopleSearch, useMessageSuggestions } from "../../lib/messages/hooks";
import { getOrCreateDirectConversation, shareContentToConversation, type ConversationPreview, type Person, type ShareableContent } from "../../lib/messages/service";

const MAX_SUGGESTIONS = 5;

export function UnifiedShareSheet({ userId, content, title, onClose, onToast }: {
  userId: string;
  content: ShareableContent;
  title: string;
  onClose: () => void;
  onToast: (message: string, kind?: "success" | "error") => void;
}): JSX.Element {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selected, setSelected] = useState<Record<string, { kind: "person" | "conversation"; id: string }>>({});
  const [sending, setSending] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const searching = debouncedQuery.length >= 2;
  const { data: suggestions = [], isLoading: loadingSuggestions, isError: suggestionsError } = useMessageSuggestions(!searching);
  const { data: conversations = [], isLoading: loadingConversations, isError: conversationsError } = useMessageConversations(userId, searching ? 100 : 12);
  const { data: peopleResults = [], isLoading: loadingPeople, isError: peopleError } = useMessagePeopleSearch(debouncedQuery);

  const eligibleConversations = useMemo(
    () => conversations.filter((conversation) => !conversation.archived),
    [conversations],
  );

  const defaultRows = useMemo(() => {
    return rankShareRecipients(eligibleConversations, suggestions, MAX_SUGGESTIONS);
  }, [eligibleConversations, suggestions]);

  const searchRows = useMemo(() => {
    const rows: Recipient[] = [
      ...eligibleConversations
        .filter((c) => destinationSearchText(c).includes(debouncedQuery.toLowerCase()))
        .map((conversation) => ({ kind: "conversation" as const, conversation })),
      ...peopleResults.map((person) => ({ kind: "person" as const, person })),
    ];
    return dedupeRecipients(rows);
  }, [debouncedQuery, eligibleConversations, peopleResults]);

  const rows = searching ? searchRows : defaultRows;
  const loading = searching ? loadingConversations || loadingPeople : loadingConversations || loadingSuggestions;
  const hasError = searching ? conversationsError || peopleError : conversationsError || suggestionsError;
  const selectedCount = Object.keys(selected).length;

  const toggle = (key: string, value: { kind: "person" | "conversation"; id: string }) => setSelected((current) => {
    const next = { ...current };
    if (next[key]) delete next[key]; else next[key] = value;
    return next;
  });

  const send = async () => {
    if (!selectedCount || sending) return;
    setSending(true);
    const targets = Object.values(selected);
    let sent = 0;
    for (const target of targets) {
      try {
        const conversationId = target.kind === "conversation" ? target.id : await getOrCreateDirectConversation(target.id);
        await shareContentToConversation({ conversationId, senderId: userId, content });
        sent += 1;
      } catch { /* partial results are reported below */ }
    }
    setSending(false);
    if (sent === targets.length) {
      onToast(`Shared to ${sent} ${sent === 1 ? "recipient" : "recipients"}.`);
      setSelected({});
      onClose();
    } else if (sent > 0) {
      onToast(`Shared to ${sent} of ${targets.length} recipients.`, "error");
    } else {
      onToast("Could not share. Try again.", "error");
    }
  };

  const link = typeof window === "undefined" ? "" : `${window.location.origin}/${content.type}/${content.id}`;
  const external = async (kind: ExternalAction) => {
    if (!link) return;
    try {
      if (kind === "copy") {
        await navigator.clipboard.writeText(link);
        onToast("Link copied!");
      } else if (kind === "whatsapp") {
        window.open(`https://wa.me/?text=${encodeURIComponent(`${title} ${link}`)}`, "_blank", "noopener,noreferrer");
      } else if (kind === "messages") {
        window.open(`sms:?&body=${encodeURIComponent(`${title} ${link}`)}`, "_blank", "noopener,noreferrer");
      } else if (kind === "instagram") {
        await navigator.clipboard.writeText(link);
        onToast("Link copied — paste it into Instagram.");
      } else if (navigator.share) {
        await navigator.share({ title, url: link });
      } else {
        await navigator.clipboard.writeText(link);
        onToast("Link copied!");
      }
    } catch { /* browser cancellation or blocked external scheme */ }
  };

  return <Modal onClose={onClose} labelledBy="unified-share-title" maxWidth={560} placement="bottom">
    <div className="flex max-h-[82vh] flex-col p-5 sm:p-6">
      <header className="shrink-0">
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-gray-300" />
        <h2 id="unified-share-title" className="text-center text-[17px] font-bold text-gray-900">Share</h2>
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3">
          <SearchGlyph />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search people, groups and clubs" aria-label="Search people, groups and clubs" className="min-w-0 flex-1 py-2.5 text-sm text-gray-900 outline-none" />
        </div>
      </header>

      <section className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1" aria-live="polite">
        <p className="mt-4 text-[13px] font-semibold text-gray-700">{searching ? "Results" : "Suggested"}</p>
        <div className="mt-1 space-y-0.5">
          {loading ? <p className="py-6 text-center text-sm text-gray-500">Loading…</p> : hasError ? <p className="py-6 text-center text-sm text-red-600">Destinations could not be loaded.</p> : rows.length === 0 ? <p className="py-6 text-center text-sm text-gray-500">{searching ? "Nothing found." : "No suggestions yet."}</p> : rows.map((row) => <RecipientRow key={recipientKey(row)} row={row} checked={!!selected[recipientKey(row)]} onClick={() => toggle(recipientKey(row), recipientValue(row))} />)}
        </div>
      </section>

      <footer className="shrink-0 border-t border-gray-200 pt-3">
        <button type="button" onClick={send} disabled={!selectedCount || sending} className="w-full rounded-full bg-[#0FA6A6] py-2.5 text-sm font-semibold text-white disabled:opacity-50">{sending ? "Sharing…" : selectedCount ? `Share with ${selectedCount} ${selectedCount === 1 ? "recipient" : "recipients"}` : "Select recipients"}</button>
        <div className="my-4 border-t border-gray-200" />
        <h3 className="text-[13px] font-semibold text-gray-700">Share externally</h3>
        <div className="mt-2 flex justify-around gap-1">
          <ExternalButton action="instagram" label="Instagram" color="#E1306C" onClick={external} />
          <ExternalButton action="messages" label="Messages" color="#34C759" onClick={external} />
          <ExternalButton action="whatsapp" label="WhatsApp" color="#25D366" onClick={external} />
          <ExternalButton action="copy" label="Copy Link" color="#0FA6A6" onClick={external} />
          <ExternalButton action="more" label="More" color="#6B7280" onClick={external} />
        </div>
      </footer>
    </div>
  </Modal>;
}

type ExternalAction = "instagram" | "messages" | "whatsapp" | "copy" | "more";
type Recipient = { kind: "person"; person: Person } | { kind: "conversation"; conversation: ConversationPreview };

function destinationSearchText(conversation: ConversationPreview): string {
  return `${conversation.name} ${conversation.club_handle ?? ""} ${conversation.type}`.toLowerCase();
}

function recipientKey(row: Recipient): string {
  return row.kind === "person" ? `person:${row.person.user_id}` : `conversation:${row.conversation.id}`;
}

function recipientValue(row: Recipient): { kind: "person" | "conversation"; id: string } {
  return row.kind === "person" ? { kind: "person", id: row.person.user_id } : { kind: "conversation", id: row.conversation.id };
}

function dedupeRecipients(rows: Recipient[]): Recipient[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    let key = recipientKey(row);
    if (row.kind === "person") key = `direct:${row.person.user_id}`;
    else if (row.conversation.type === "direct" && row.conversation.other_user_id) key = `direct:${row.conversation.other_user_id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function rankShareRecipients(conversations: ConversationPreview[], people: Person[], max = MAX_SUGGESTIONS): Recipient[] {
  const rows: Recipient[] = conversations.filter((conversation) => !conversation.archived).map((conversation) => ({ kind: "conversation", conversation }));
  const directUserIds = new Set(conversations.filter((c) => c.type === "direct" && c.other_user_id).map((c) => c.other_user_id));
  for (const person of people) if (!directUserIds.has(person.user_id)) rows.push({ kind: "person", person });
  return dedupeRecipients(rows).slice(0, max);
}

function RecipientRow({ row, checked, onClick }: { row: Recipient; checked: boolean; onClick: () => void }): JSX.Element {
  const person = row.kind === "person" ? row.person : null;
  const conversation = row.kind === "conversation" ? row.conversation : null;
  const label = person ? person.full_name || person.username : conversation!.name;
  const supporting = person ? `@${person.username} · Direct message` : conversationLabel(conversation!);
  const avatar = person?.avatar_url ?? conversation?.avatar_url ?? null;
  return <button type="button" onClick={onClick} aria-pressed={checked} className={`flex w-full items-center gap-3 rounded-xl p-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0FA6A6] ${checked ? "bg-[#0FA6A6]/10" : "hover:bg-black/5"}`}>
    <Avatar uri={avatar} size={44} name={label} />
    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-gray-900">{label}</span><span className="block truncate text-[11px] text-gray-500">{supporting}</span></span>
    <span aria-hidden className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-[1.5px] ${checked ? "border-[#0FA6A6] bg-[#0FA6A6] text-white" : "border-gray-300"}`}>{checked ? "✓" : ""}</span>
  </button>;
}

export function conversationLabel(conversation: ConversationPreview): string {
  if (conversation.type === "officer_chat") return "Club officers chat";
  if (conversation.type === "club_group") return "Club members chat";
  if (conversation.type === "group") return "Group chat";
  return "Direct message";
}

function ExternalButton({ action, label, color, onClick }: { action: ExternalAction; label: string; color: string; onClick: (action: ExternalAction) => void }): JSX.Element {
  return <button type="button" onClick={() => void onClick(action)} aria-label={label} className="flex min-w-[58px] flex-col items-center gap-1.5 rounded-xl p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0FA6A6]"><span className="flex h-[54px] w-[54px] items-center justify-center rounded-full" style={{ backgroundColor: `${color}18`, color }}><ExternalGlyph action={action} /></span><span className="text-[11px] text-gray-700">{label}</span></button>;
}

function ExternalGlyph({ action }: { action: ExternalAction }): JSX.Element {
  if (action === "instagram") return <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" /></svg>;
  if (action === "messages") return <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 11.5a7.5 7.5 0 0 1-8 7.5 8.8 8.8 0 0 1-3.3-.7L4 20l1.3-3.5A7.2 7.2 0 0 1 4 11.5 7.5 7.5 0 0 1 12 4a7.5 7.5 0 0 1 8 7.5Z" /></svg>;
  if (action === "whatsapp") return <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 11.5a8 8 0 0 1-11.8 7L4 20l1.5-4A8 8 0 1 1 20 11.5Z" /><path d="M9 8.5c.3 2 1.7 3.5 3.5 4.2.5.2.9-.2 1.2-.7l.4-.6" /></svg>;
  if (action === "copy") return <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden><path d="M9 15 15 9" /><path d="M7 17H6a4 4 0 0 1 0-8h3" /><path d="M17 7h1a4 4 0 0 1 0 8h-3" /></svg>;
  return <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="5" cy="12" r="2" /><circle cx="19" cy="5" r="2" /><circle cx="19" cy="19" r="2" /><path d="m7 11 10-5M7 13l10 5" /></svg>;
}

function SearchGlyph(): JSX.Element { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="1.8" strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg>; }
