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

/**
 * Guidance shown when someone taps a restricted event control. The members-only
 * copy names the club, because "join the club" is only actionable if the person
 * can tell which club is being talked about — a club profile is reachable from
 * search, a shared link, or another member's profile.
 *
 * `clubName` is optional so an unnamed caller still gets a sensible sentence
 * rather than "Join undefined to ...".
 */
export function eventRestrictionMessage(
  restriction: EventRestriction,
  clubName?: string | null,
): string | null {
  if (restriction === "members_only") {
    const name = (clubName ?? "").trim();
    return name
      ? `Join ${name} to be able to attend this event.`
      : "Join this club to be able to attend this event.";
  }
  if (restriction === "selected_members_only") {
    return "This event is available only to selected club members.";
  }
  if (restriction === "ended") return "This event has ended.";
  return null;
}
