export interface NotificationVisualActor {
  id: string;
  username: string;
  avatar_url: string | null;
}

export interface NotificationVisualEntity {
  id: string;
  name: string;
  avatar_url: string | null;
}

export type NotificationVisual =
  | { kind: "actors"; actors: NotificationVisualActor[] }
  | { kind: "actor"; actor: NotificationVisualActor }
  | { kind: "entity"; entity: NotificationVisualEntity }
  | { kind: "system" }
  | { kind: "fallback" };

const aggregateTypes = new Set(["like", "comment", "event_rsvp", "new_follower"]);
const entityTypes = new Set([
  "new_event", "event_updated", "event_reminder_tomorrow", "event_reminder_hour", "event_reminder_now",
  "event_last_chance", "event_canceled", "club_post", "club_joined", "member_joined", "club_chat_added",
  "officer_chat_added", "officer_role", "officer_removed", "club_removed", "club_inactive",
]);
const systemTypes = new Set(["account_verification", "security_notice", "terms_update", "privacy_update", "platform_announcement"]);

export function resolveNotificationVisual(input: {
  type: string;
  group_count?: number;
  actor?: NotificationVisualActor | null;
  actors?: NotificationVisualActor[];
  entity?: NotificationVisualEntity | null;
}): NotificationVisual {
  const actors = dedupeActors(input.actors ?? []);
  if ((input.group_count ?? 1) > 1 && actors.length > 1) return { kind: "actors", actors: actors.slice(0, 3) };
  if (input.actor && !entityTypes.has(input.type)) return { kind: "actor", actor: input.actor };
  if (input.entity && entityTypes.has(input.type)) return { kind: "entity", entity: input.entity };
  if (input.actor) return { kind: "actor", actor: input.actor };
  if (input.entity) return { kind: "entity", entity: input.entity };
  if (systemTypes.has(input.type)) return { kind: "system" };
  if (aggregateTypes.has(input.type)) return { kind: "fallback" };
  return { kind: "fallback" };
}

function dedupeActors(actors: NotificationVisualActor[]): NotificationVisualActor[] {
  const seen = new Set<string>();
  return actors.filter((actor) => {
    if (seen.has(actor.id)) return false;
    seen.add(actor.id);
    return true;
  });
}
