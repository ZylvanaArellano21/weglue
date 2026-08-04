"use client";

import { useState } from "react";
import { Modal } from "../shared/Modal";
import { Avatar } from "../shared/Avatar";
import { useMessageConversations, useMessageSuggestions } from "../../lib/messages/hooks";
import { getOrCreateDirectConversation, shareEventToConversation } from "../../lib/messages/service";

export function EventShareModal({
  eventId,
  userId,
  onClose,
  onShared,
}: {
  eventId: string;
  userId: string;
  onClose: () => void;
  onShared: () => void;
}): JSX.Element {
  const { data: conversations, isLoading, isError } = useMessageConversations(userId);
  const { data: people = [] } = useMessageSuggestions(true);
  const [sharingId, setSharingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const send = async (conversationId: string, marker = conversationId) => {
    if (sharingId) return;
    setError(null);
    setSharingId(marker);
    try {
      await shareEventToConversation({ conversationId, channelId: null, eventId });
      onShared();
      onClose();
    } catch {
      setError("We couldn't share this event. Please try again.");
    } finally {
      setSharingId(null);
    }
  };

  const sharePerson = async (personId: string) => {
    const marker = `person-${personId}`;
    if (sharingId) return;
    setError(null);
    setSharingId(marker);
    try {
      const conversationId = await getOrCreateDirectConversation(personId);
      await shareEventToConversation({ conversationId, channelId: null, eventId });
      onShared();
      onClose();
    } catch {
      setError("We couldn't share this event. Please try again.");
    } finally {
      setSharingId(null);
    }
  };

  return (
    <Modal onClose={onClose} labelledBy="share-event-title" maxWidth={460}>
      <div className="p-5 sm:p-6">
        <h2 id="share-event-title" className="pr-8 text-xl font-bold text-gray-900">Share in We Glue</h2>
        <p className="mt-1 text-sm text-gray-500">Choose a person or conversation to send this event.</p>
        {error && <p role="alert" className="mt-4 text-sm text-red-600">{error}</p>}
        {people.length > 0 && (
          <>
            <h3 className="mt-5 text-xs font-bold uppercase tracking-wide text-gray-400">People</h3>
            <ul className="mt-2 space-y-1">
              {people.map((person) => (
                <li key={person.user_id}>
                  <button type="button" onClick={() => void sharePerson(person.user_id)} disabled={!!sharingId} className="flex w-full items-center gap-3 rounded-lg p-2.5 text-left transition hover:bg-black/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0FA6A6] focus-visible:ring-offset-2 disabled:opacity-50">
                    <Avatar uri={person.avatar_url} size={38} name={person.full_name ?? person.username} />
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900">{person.full_name ?? person.username}</span>
                    <span className="text-xs font-semibold text-[#0FA6A6]">{sharingId === `person-${person.user_id}` ? "Sending…" : "Send"}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        {isLoading ? (
          <p className="mt-6 text-sm text-gray-500">Loading conversations…</p>
        ) : isError ? (
          <p className="mt-6 text-sm text-gray-500">Conversations could not be loaded.</p>
        ) : conversations?.length ? (
          <>
            <h3 className="mt-5 text-xs font-bold uppercase tracking-wide text-gray-400">Conversations</h3>
            <ul className="mt-2 space-y-1">
              {conversations.map((conversation) => (
                <li key={conversation.id}>
                  <button type="button" onClick={() => void send(conversation.id)} disabled={!!sharingId} className="flex w-full items-center gap-3 rounded-lg p-2.5 text-left transition hover:bg-black/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0FA6A6] focus-visible:ring-offset-2 disabled:opacity-50">
                    <Avatar uri={conversation.avatar_url} size={38} name={conversation.name} />
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900">{conversation.name}</span>
                    <span className="text-xs font-semibold text-[#0FA6A6]">{sharingId === conversation.id ? "Sending…" : "Send"}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : !people.length ? (
          <p className="mt-6 text-sm text-gray-500">No eligible recipients are available.</p>
        ) : null}
      </div>
    </Modal>
  );
}
