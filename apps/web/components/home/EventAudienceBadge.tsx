import { eventAudienceLabel, type EventAudience } from "../../lib/permissions/eventAccess";

/** Render only after the event itself has passed the audience access check. */
export function EventAudienceBadge({ audience }: { audience: EventAudience }): JSX.Element | null {
  const label = eventAudienceLabel(audience);
  if (!label) return null;
  return (
    <span className="inline-flex rounded-full bg-[#F02719]/10 px-2.5 py-1 text-[11px] font-semibold text-[#C9251A]">
      {label}
    </span>
  );
}
