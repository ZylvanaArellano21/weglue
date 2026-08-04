import { describe, expect, it } from "vitest";
import { conversationLabel, rankShareRecipients } from "../UnifiedShareSheet";
import type { ConversationPreview, Person } from "../../../lib/messages/service";

const person: Person = { user_id: "u1", username: "marcus", full_name: "Marcus", avatar_url: null };
const conversation = (overrides: Partial<ConversationPreview>): ConversationPreview => ({
  id: "c1", type: "group", name: "Study group", avatar_url: null, club_id: null, other_user_id: null,
  last_message: "hi", last_message_at: "2026-08-04T00:00:00Z", last_sender_id: null, last_sender_name: null,
  unread_count: 0, muted: false, archived: false, message_count: 4, ...overrides,
});

describe("share destinations", () => {
  it("caps defaults and deduplicates a person already represented by a DM", () => {
    const rows = rankShareRecipients([
      conversation({ id: "dm", type: "direct", name: "Marcus", other_user_id: "u1" }),
      conversation({ id: "g2", name: "Robotics" }),
      conversation({ id: "g3", name: "Chess" }),
      conversation({ id: "g4", name: "Film" }),
      conversation({ id: "g5", name: "Art" }),
      conversation({ id: "g6", name: "Music" }),
    ], [person], 5);
    expect(rows).toHaveLength(5);
    expect(rows.filter((row) => row.kind === "person")).toHaveLength(0);
  });

  it("labels destination types like mobile", () => {
    expect(conversationLabel(conversation({ type: "direct" }))).toBe("Direct message");
    expect(conversationLabel(conversation({ type: "group" }))).toBe("Group chat");
    expect(conversationLabel(conversation({ type: "club_group" }))).toBe("Club members chat");
    expect(conversationLabel(conversation({ type: "officer_chat" }))).toBe("Club officers chat");
  });
});
