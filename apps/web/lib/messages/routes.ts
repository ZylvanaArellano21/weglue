export type MessagesFilter = "single" | "groups";

export type MessagesDestination = {
  filter?: MessagesFilter;
  conversationId?: string | null;
  channelId?: string | null;
  draftUserId?: string | null;
  draftGroupIds?: string[] | null;
  draftGroupName?: string | null;
  hub?: boolean;
  messageId?: string | null;
  info?: boolean;
  infoTab?: "polls" | "media" | "events" | "files";
  eventId?: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isMessageUuid(value: string | null | undefined): value is string {
  return !!value && UUID.test(value);
}

/**
 * The one URL contract for every web Messages entry point. General navigation
 * leaves all destination fields absent, which intentionally renders the blank
 * Single landing state rather than selecting a recent conversation.
 */
export function messagesHref(destination: MessagesDestination = {}): string {
  const params = new URLSearchParams();
  if (destination.filter === "groups") params.set("filter", "groups");
  if (isMessageUuid(destination.conversationId)) params.set("conversation", destination.conversationId);
  if (isMessageUuid(destination.channelId)) params.set("channel", destination.channelId);
  if (isMessageUuid(destination.draftUserId)) params.set("draft", destination.draftUserId);
  if (destination.draftGroupIds?.length) {
    const ids = destination.draftGroupIds.filter(isMessageUuid);
    if (ids.length) params.set("draftGroup", ids.join(","));
  }
  if (destination.draftGroupName?.trim()) params.set("groupName", destination.draftGroupName.trim().slice(0, 60));
  if (destination.hub) params.set("hub", "1");
  if (isMessageUuid(destination.messageId)) params.set("message", destination.messageId);
  if (destination.info) params.set("info", "1");
  if (destination.infoTab) params.set("infoTab", destination.infoTab);
  if (isMessageUuid(destination.eventId)) params.set("event", destination.eventId);
  const query = params.toString();
  return query ? `/messages?${query}` : "/messages";
}

export function generalMessagesHref(): string {
  return messagesHref({ filter: "single" });
}

export function personMessageHref(userId: string): string {
  return messagesHref({ filter: "single", draftUserId: userId });
}

export function customGroupHref(conversationId: string): string {
  return messagesHref({ filter: "groups", conversationId });
}

export function clubHubHref(conversationId: string): string {
  return messagesHref({ filter: "groups", conversationId, hub: true });
}

export function clubChannelHref(conversationId: string, channelId: string, messageId?: string): string {
  return messagesHref({ filter: "groups", conversationId, channelId, messageId });
}
