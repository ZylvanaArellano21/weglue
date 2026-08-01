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
});
