import { describe, expect, it } from "vitest";
import {
  clubChannelHref,
  clubHubHref,
  generalMessagesHref,
  messagesHref,
  personMessageHref,
} from "../messages/routes";

const CONVERSATION = "11111111-1111-4111-8111-111111111111";
const CHANNEL = "22222222-2222-4222-8222-222222222222";
const PERSON = "33333333-3333-4333-8333-333333333333";

describe("Messages route contract", () => {
  it("keeps the main Messages navigation blank and on Single", () => {
    expect(generalMessagesHref()).toBe("/messages");
  });

  it("opens a person as a draft rather than creating a direct conversation", () => {
    expect(personMessageHref(PERSON)).toBe(`/messages?draft=${PERSON}`);
  });

  it("keeps generic club navigation at the channel hub", () => {
    expect(clubHubHref(CONVERSATION)).toBe(`/messages?filter=groups&conversation=${CONVERSATION}&hub=1`);
  });

  it("keeps a specific club channel exact, including a message deep link", () => {
    expect(clubChannelHref(CONVERSATION, CHANNEL, PERSON)).toBe(`/messages?filter=groups&conversation=${CONVERSATION}&channel=${CHANNEL}&message=${PERSON}`);
  });

  it("drops malformed identifiers instead of emitting an unsafe route", () => {
    expect(messagesHref({ conversationId: "not-a-uuid", channelId: CHANNEL, draftUserId: "bad" })).toBe(`/messages?channel=${CHANNEL}`);
  });

  /**
   * Bug 3 — a shared post or event must open as an overlay ON TOP of the chat
   * it was sent in, never as a navigation away from Messages.
   *
   * Both stay on `/messages` and keep the full conversation context in the same
   * query string, which is what lets the chat render behind the overlay and
   * what makes dismissing it (or pressing Back, which drops only the overlay
   * param) return to the exact conversation, channel and info state.
   */
  describe("shared content overlays", () => {
    const POST = "44444444-4444-4444-8444-444444444444";
    const EVENT = "55555555-5555-4555-8555-555555555555";

    it("opens a shared post over the originating channel without leaving Messages", () => {
      const href = messagesHref({ filter: "groups", conversationId: CONVERSATION, channelId: CHANNEL, postId: POST });
      expect(href.startsWith("/messages?")).toBe(true);
      expect(href).toContain(`conversation=${CONVERSATION}`);
      expect(href).toContain(`channel=${CHANNEL}`);
      expect(href).toContain(`post=${POST}`);
    });

    it("opens a shared event over the originating chat without leaving Messages", () => {
      const href = messagesHref({ filter: "single", conversationId: CONVERSATION, eventId: EVENT });
      expect(href.startsWith("/messages?")).toBe(true);
      expect(href).toContain(`conversation=${CONVERSATION}`);
      expect(href).toContain(`event=${EVENT}`);
    });

    it("preserves an open info panel and its tab, so closing restores the exact context", () => {
      const href = messagesHref({
        filter: "groups",
        conversationId: CONVERSATION,
        channelId: CHANNEL,
        info: true,
        infoTab: "media",
        postId: POST,
      });
      expect(href).toContain("info=1");
      expect(href).toContain("infoTab=media");
      expect(href).toContain(`post=${POST}`);
    });

    it("never emits a /post or /event route from Messages", () => {
      for (const href of [
        messagesHref({ conversationId: CONVERSATION, postId: POST }),
        messagesHref({ conversationId: CONVERSATION, eventId: EVENT }),
      ]) {
        expect(href).not.toMatch(/^\/post\//);
        expect(href).not.toMatch(/^\/event\//);
      }
    });

    it("drops a malformed shared id rather than opening an overlay for it", () => {
      expect(messagesHref({ conversationId: CONVERSATION, postId: "nope", eventId: "also-nope" })).toBe(
        `/messages?conversation=${CONVERSATION}`
      );
    });
  });
});
