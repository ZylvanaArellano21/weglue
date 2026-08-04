export type EventAudience = "everyone" | "members" | "specific";

export interface EventAudienceFacts {
  audience: EventAudience;
  isClubMember: boolean;
  isClubOfficer: boolean;
  isCreator: boolean;
  isSelected: boolean;
  isPast: boolean;
}

export type EventRestriction = "members_only" | "selected_members_only" | "ended" | null;

/**
 * These facts mirror the mobile event visibility gate and the database policy.
 * They deliberately contain no display strings; callers must pass canonical
 * visibility and membership facts fetched from Supabase.
 */
export function canOpenEvent(facts: EventAudienceFacts): boolean {
  if (facts.isCreator || facts.isClubOfficer) return true;
  if (facts.audience === "everyone") return true;
  if (facts.audience === "members") return facts.isClubMember;
  return facts.isSelected;
}

/** Members-only events have a deliberately limited public club-profile card. */
export function canViewEventInClubProfile(facts: EventAudienceFacts): boolean {
  return facts.audience === "members" || canOpenEvent(facts);
}

export function canRsvpToEvent(facts: EventAudienceFacts): boolean {
  return !facts.isPast && canOpenEvent(facts);
}

export function canViewEventAttendees(facts: EventAudienceFacts): boolean {
  return canOpenEvent(facts);
}

export function canSaveEvent(facts: EventAudienceFacts): boolean {
  return canOpenEvent(facts);
}

export function canManageEvent(facts: Pick<EventAudienceFacts, "isClubOfficer">): boolean {
  return facts.isClubOfficer;
}

export function eventRestriction(facts: EventAudienceFacts): EventRestriction {
  if (facts.isPast) return "ended";
  if (canOpenEvent(facts)) return null;
  return facts.audience === "members" ? "members_only" : "selected_members_only";
}

export function eventAudienceLabel(audience: EventAudience): string | null {
  if (audience === "members") return "Members only";
  if (audience === "specific") return "Selected members only";
  return null;
}

export function eventRestrictionMessage(restriction: EventRestriction): string | null {
  if (restriction === "members_only") {
    return "This event is for club members only. Join the club to RSVP and view attendees.";
  }
  if (restriction === "selected_members_only") {
    return "This event is available only to selected club members.";
  }
  if (restriction === "ended") return "This event has ended.";
  return null;
}
