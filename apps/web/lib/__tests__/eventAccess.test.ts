import { describe, expect, it } from "vitest";
import {
  canManageEvent,
  canOpenEvent,
  canRsvpToEvent,
  canSaveEvent,
  canViewEventAttendees,
  canViewEventInClubProfile,
  eventRestriction,
  eventRestrictionMessage,
} from "../permissions/eventAccess";

const base = {
  audience: "everyone" as const,
  isClubMember: false,
  isClubOfficer: false,
  isCreator: false,
  isSelected: false,
  isPast: false,
};

describe("event audience access", () => {
  it("lets any authenticated student open and RSVP to an upcoming everyone event", () => {
    expect(canOpenEvent(base)).toBe(true);
    expect(canRsvpToEvent(base)).toBe(true);
    expect(canViewEventAttendees(base)).toBe(true);
  });

  it("keeps a members-only card on the club profile but blocks a non-member from opening, RSVPing, and attendees", () => {
    const facts = { ...base, audience: "members" as const };
    expect(canViewEventInClubProfile(facts)).toBe(true);
    expect(canOpenEvent(facts)).toBe(false);
    expect(canRsvpToEvent(facts)).toBe(false);
    expect(canViewEventAttendees(facts)).toBe(false);
    expect(eventRestriction(facts)).toBe("members_only");
  });

  it("grants members-only actions immediately from canonical membership facts", () => {
    const facts = { ...base, audience: "members" as const, isClubMember: true };
    expect(canOpenEvent(facts)).toBe(true);
    expect(canRsvpToEvent(facts)).toBe(true);
  });

  it("never reveals a selected-members event to an unselected member or non-member", () => {
    const facts = { ...base, audience: "specific" as const, isClubMember: true };
    expect(canViewEventInClubProfile(facts)).toBe(false);
    expect(canOpenEvent(facts)).toBe(false);
    expect(eventRestriction(facts)).toBe("selected_members_only");
  });

  it("keeps mobile creator and officer exceptions, while only officers manage", () => {
    expect(canOpenEvent({ ...base, audience: "specific", isCreator: true })).toBe(true);
    expect(canOpenEvent({ ...base, audience: "specific", isClubOfficer: true })).toBe(true);
    expect(canManageEvent({ isClubOfficer: true })).toBe(true);
    expect(canManageEvent({ isClubOfficer: false })).toBe(false);
  });

  it("blocks new RSVP exactly at the past boundary without changing historical read access", () => {
    const facts = { ...base, isPast: true };
    expect(canOpenEvent(facts)).toBe(true);
    expect(canRsvpToEvent(facts)).toBe(false);
    expect(canViewEventAttendees(facts)).toBe(true);
    expect(eventRestriction(facts)).toBe("ended");
  });

  it("hides Save from a non-member on a members-only club-profile card, as mobile does", () => {
    const facts = { ...base, audience: "members" as const };
    expect(canSaveEvent(facts)).toBe(false);
    expect(canSaveEvent({ ...facts, isClubMember: true })).toBe(true);
  });
});

describe("restricted-event guidance message", () => {
  it("names the club so 'join' is actionable", () => {
    expect(eventRestrictionMessage("members_only", "Film Club")).toBe(
      "Join Film Club to be able to attend this event."
    );
    expect(eventRestrictionMessage("members_only", "Parity QA Club")).toBe(
      "Join Parity QA Club to be able to attend this event."
    );
  });

  it("falls back to a sensible sentence rather than printing an empty or undefined name", () => {
    expect(eventRestrictionMessage("members_only")).toBe(
      "Join this club to be able to attend this event."
    );
    expect(eventRestrictionMessage("members_only", null)).toBe(
      "Join this club to be able to attend this event."
    );
    expect(eventRestrictionMessage("members_only", "   ")).toBe(
      "Join this club to be able to attend this event."
    );
  });

  it("trims a padded club name instead of producing a double space", () => {
    expect(eventRestrictionMessage("members_only", "  Film Club  ")).toBe(
      "Join Film Club to be able to attend this event."
    );
  });

  it("leaves the selected-members and ended copy alone", () => {
    expect(eventRestrictionMessage("selected_members_only", "Film Club")).toBe(
      "This event is available only to selected club members."
    );
    expect(eventRestrictionMessage("ended", "Film Club")).toBe("This event has ended.");
    expect(eventRestrictionMessage(null, "Film Club")).toBeNull();
  });
});
