import { describe, expect, it } from "vitest";
import {
  buildMessageBanner,
  messageBannerType,
  messageBannerPreview,
  type NewMessageBroadcastPayload,
} from "@weglue/shared";

// ============================================================================
// Foreground message-banner mapping — regression test (realtime load reduction
// approach B). The old `useRealtimeMessageBanners` hook opened a broad
// `messages` INSERT postgres_changes subscription and did two follow-up reads
// per row to build this banner. It is replaced by a server-authored
// `new_message` broadcast payload -> buildMessageBanner, with NO client reads.
// Every behaviour the old hook had must be preserved:
//   • sender name / preview / banner type / deep-link route
//   • emoji stand-ins for typed attachments
//   • 140-char truncation
//   • never banner your own message
// ============================================================================

const base: NewMessageBroadcastPayload = {
  message_id: "11111111-1111-1111-1111-111111111111",
  conversation_id: "22222222-2222-2222-2222-222222222222",
  sender_id: "33333333-3333-3333-3333-333333333333",
  message_type: "text",
  preview: "hey there",
  sender_name: "Ada Lovelace",
  conversation_type: "direct",
  channel_id: null,
};
const ME = "99999999-9999-9999-9999-999999999999";

describe("messageBannerType", () => {
  it("maps conversation type to the notification banner type", () => {
    expect(messageBannerType("direct")).toBe("dm_message");
    expect(messageBannerType("group")).toBe("group_message");
    // Anything else is a club chat (member chat / officer chat).
    expect(messageBannerType("club")).toBe("club_chat_message");
    expect(messageBannerType(null)).toBe("club_chat_message");
    expect(messageBannerType(undefined)).toBe("club_chat_message");
  });
});

describe("messageBannerPreview", () => {
  it("uses an emoji stand-in for every typed attachment", () => {
    expect(messageBannerPreview("image", null)).toBe("📷 Photo");
    expect(messageBannerPreview("video", null)).toBe("🎬 Video");
    expect(messageBannerPreview("file", null)).toBe("📎 File");
    expect(messageBannerPreview("poll", null)).toBe("📊 Started a poll");
    expect(messageBannerPreview("shared_event", null)).toBe("📅 Shared an event");
    expect(messageBannerPreview("shared_post", null)).toBe("🖼️ Shared a post");
  });

  it("falls back to the text body and truncates at 140 chars", () => {
    expect(messageBannerPreview("text", "plain words")).toBe("plain words");
    expect(messageBannerPreview(null, "plain words")).toBe("plain words");
    const long = "x".repeat(300);
    expect(messageBannerPreview("text", long)).toHaveLength(140);
  });

  it("never returns an empty string", () => {
    expect(messageBannerPreview(null, null)).toBe("New message");
    expect(messageBannerPreview("text", null)).toBe("New message");
  });
});

describe("buildMessageBanner", () => {
  it("builds a DM banner with the sender name and a chat deep-link", () => {
    expect(buildMessageBanner(base, ME)).toEqual({
      id: base.message_id,
      type: "dm_message",
      message: "Ada Lovelace: hey there",
      actor_id: base.sender_id,
      user_id: ME,
      route: { screen: "chat", chatId: base.conversation_id },
    });
  });

  it("includes channelId in the route only when present (club/officer chats)", () => {
    const withChannel = buildMessageBanner(
      { ...base, conversation_type: "club", channel_id: "44444444-4444-4444-4444-444444444444" },
      ME,
    );
    expect(withChannel?.type).toBe("club_chat_message");
    expect(withChannel?.route).toEqual({
      screen: "chat",
      chatId: base.conversation_id,
      channelId: "44444444-4444-4444-4444-444444444444",
    });
  });

  it("renders a typed-attachment message in a group chat", () => {
    const banner = buildMessageBanner(
      { ...base, conversation_type: "group", message_type: "image", preview: null, sender_name: "Grace" },
      ME,
    );
    expect(banner).toMatchObject({ type: "group_message", message: "Grace: 📷 Photo" });
  });

  it("falls back to 'Someone' when the sender name is blank", () => {
    expect(buildMessageBanner({ ...base, sender_name: "   " }, ME)?.message).toBe("Someone: hey there");
    expect(buildMessageBanner({ ...base, sender_name: null }, ME)?.message).toBe("Someone: hey there");
  });

  it("never banners the viewer's own message (defence in depth — the trigger already excludes the sender)", () => {
    expect(buildMessageBanner({ ...base, sender_id: ME }, ME)).toBeNull();
  });

  it("returns null on a malformed payload rather than a broken banner", () => {
    expect(buildMessageBanner(null, ME)).toBeNull();
    expect(buildMessageBanner(undefined, ME)).toBeNull();
    expect(buildMessageBanner({ ...base, message_id: "" }, ME)).toBeNull();
    expect(buildMessageBanner({ ...base, conversation_id: "" }, ME)).toBeNull();
    expect(buildMessageBanner({ ...base, sender_id: "" }, ME)).toBeNull();
  });

  // ---- migration 105: conversation-scoped delivery reaches muted members,
  //      so the mute filter is client-side here (useConversationBannerChannels).
  it("suppresses the banner when the viewer has muted the conversation", () => {
    const muted = new Set([base.conversation_id]);
    expect(buildMessageBanner(base, ME, { mutedConversationIds: muted })).toBeNull();
    // a different conversation is unaffected
    expect(buildMessageBanner(base, ME, { mutedConversationIds: new Set(["other"]) })).not.toBeNull();
  });

  it("suppresses the banner when the viewer has muted the channel", () => {
    const payload = { ...base, conversation_type: "club", channel_id: "44444444-4444-4444-4444-444444444444" };
    expect(
      buildMessageBanner(payload, ME, { mutedChannelIds: new Set([payload.channel_id!]) }),
    ).toBeNull();
    // no channel_id → channel mute set is irrelevant
    expect(buildMessageBanner(base, ME, { mutedChannelIds: new Set(["x"]) })).not.toBeNull();
  });

  it("still banners when the mute sets are empty / absent", () => {
    expect(buildMessageBanner(base, ME, {})).not.toBeNull();
    expect(buildMessageBanner(base, ME, { mutedConversationIds: new Set(), mutedChannelIds: new Set() })).not.toBeNull();
  });
});
