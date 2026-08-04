import { describe, expect, it } from "vitest";
import {
  canManageEvent,
  canOpenEvent,
  canRsvpToEvent,
  canViewEventAttendees,
  canViewEventInClubProfile,
  eventRestriction,
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
});
