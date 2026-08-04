import { describe, expect, it } from "vitest";
import { resolveNotificationVisual } from "@weglue/shared";

const actor = (id: string) => ({ id, username: id, avatar_url: `${id}.png` });
const club = { id: "club-1", name: "Tech Club", avatar_url: "club.png" };

describe("notification visual source", () => {
  it("uses the most recent distinct actors for aggregates", () => {
    const visual = resolveNotificationVisual({ type: "comment", group_count: 3, actor: actor("a"), actors: [actor("a"), actor("b"), actor("b"), actor("c")] });
    expect(visual.kind).toBe("actors");
    if (visual.kind === "actors") expect(visual.actors.map((item) => item.id)).toEqual(["a", "b", "c"]);
  });

  it("uses the hosting club for event and club notifications", () => {
    expect(resolveNotificationVisual({ type: "event_reminder_now", actor: actor("student"), entity: club }).kind).toBe("entity");
    expect(resolveNotificationVisual({ type: "member_joined", actor: actor("student"), entity: club }).kind).toBe("entity");
  });

  it("uses a single actor for direct social actions and a typed fallback otherwise", () => {
    expect(resolveNotificationVisual({ type: "like", actor: actor("student") }).kind).toBe("actor");
    expect(resolveNotificationVisual({ type: "comment" }).kind).toBe("fallback");
  });
});
