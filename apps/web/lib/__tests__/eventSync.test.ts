import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { patchCachedEvent } from "../hooks/eventSync";

describe("patchCachedEvent", () => {
  it("keeps a card and expanded event detail synchronized for RSVP changes", () => {
    const queryClient = new QueryClient();
    const event = { id: "event-a", attendee_count: 1, user_rsvp_status: null, is_saved: false };
    queryClient.setQueryData(["homeEventsFeed", "viewer"], { pages: [{ sections: [{ label: "Your Clubs", data: [event] }] }] });
    queryClient.setQueryData(["eventDetail", "event-a", "viewer"], event);

    patchCachedEvent(queryClient, "event-a", (current) => ({ user_rsvp_status: "going", attendee_count: current.attendee_count + 1 }));

    expect(queryClient.getQueryData<any>(["homeEventsFeed", "viewer"]).pages[0].sections[0].data[0]).toMatchObject({ user_rsvp_status: "going", attendee_count: 2 });
    expect(queryClient.getQueryData<any>(["eventDetail", "event-a", "viewer"])).toMatchObject({ user_rsvp_status: "going", attendee_count: 2 });
  });

  it("updates saved state without changing another event", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["calendarEvents", "viewer"], [
      { id: "event-a", is_saved: false },
      { id: "event-b", is_saved: false },
    ]);
    patchCachedEvent(queryClient, "event-a", { is_saved: true });
    expect(queryClient.getQueryData<any[]>(["calendarEvents", "viewer"])).toEqual([
      { id: "event-a", is_saved: true },
      { id: "event-b", is_saved: false },
    ]);
  });
});
