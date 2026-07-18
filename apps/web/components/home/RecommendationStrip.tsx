"use client";

import { Avatar } from "../shared/Avatar";
import { CloseIcon } from "../shared/icons";
import {
  useDismissClubRecommendations,
  type ClubRecommendationBatch,
  type RecommendedClub,
} from "../../lib/hooks/useClubRecommendations";
import { useJoinClubMutation } from "../../lib/hooks/useClubMembership";

// Desktop adaptation of apps/mobile/components/home/ClubMatchesSection.tsx.
// Lives ONLY at the top of Home → Events (below the Posts/Events selector),
// renders real CLUB cards (never event cards), shows the real server count, and
// disappears for good once dismissed or completed by joining one of its clubs —
// all persisted server-side so web and mobile agree.

interface Props {
  batch: ClubRecommendationBatch;
  userId?: string;
  onJoined: () => void;
  onJoinError: () => void;
  onOpenClub: (clubId: string) => void;
  onSeeAllClubs: () => void;
}

export function RecommendationStrip({
  batch,
  userId,
  onJoined,
  onJoinError,
  onOpenClub,
  onSeeAllClubs,
}: Props): JSX.Element {
  const { mutate: joinClub } = useJoinClubMutation(userId);
  const { mutate: dismiss } = useDismissClubRecommendations(userId);

  const handleJoin = (clubId: string) => {
    if (!userId) return;
    joinClub(clubId, { onSuccess: onJoined, onError: onJoinError });
  };

  return (
    <section className="pt-2 pb-2" aria-label="Club recommendations">
      <div className="mb-3 flex items-center gap-2 px-1">
        <h2 className="flex-1 text-[17px] font-bold text-gray-900 font-zain">
          We found {batch.count} club{batch.count === 1 ? "" : "s"} you&apos;ll love
        </h2>
        <button
          type="button"
          onClick={() => dismiss(batch.batch_id)}
          aria-label="Dismiss club matches"
          className="rounded-full p-1 text-gray-400 hover:text-gray-600"
        >
          <CloseIcon size={20} />
        </button>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-1">
        {batch.clubs.map((club) => (
          <ClubCard
            key={club.id}
            club={club}
            onOpen={() => onOpenClub(club.id)}
            onJoin={() => handleJoin(club.id)}
          />
        ))}
      </div>

      <button
        type="button"
        onClick={onSeeAllClubs}
        className="mt-3.5 h-10 w-full rounded-full border text-sm font-semibold"
        style={{ borderColor: "#0FA6A6", color: "#0FA6A6" }}
      >
        See all clubs
      </button>

      <div className="mt-4 h-px w-full" style={{ background: "#E5E7EB" }} />
    </section>
  );
}

function ClubCard({
  club,
  onOpen,
  onJoin,
}: {
  club: RecommendedClub;
  onOpen: () => void;
  onJoin: () => void;
}): JSX.Element {
  const image = club.avatar_url ?? club.cover_image_url;
  return (
    <div
      className="w-[150px] shrink-0 overflow-hidden rounded-xl bg-white"
      style={{ boxShadow: "0 4px 8px rgba(0,0,0,0.12)" }}
    >
      <button type="button" onClick={onOpen} className="block w-full" aria-label={`Open ${club.name}`}>
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={image}
            alt={club.name}
            className="h-[92px] w-full object-cover"
            style={{ background: "#E0F7F7" }}
          />
        ) : (
          <span
            className="flex h-[92px] w-full items-center justify-center text-3xl font-bold"
            style={{ background: "#E0F7F7", color: "#0FA6A6" }}
          >
            {club.name.charAt(0).toUpperCase()}
          </span>
        )}
      </button>
      <div className="px-2.5 pb-2.5 pt-2">
        <button type="button" onClick={onOpen} className="block w-full">
          <span className="block truncate text-center text-sm font-semibold text-gray-900">
            {club.name}
          </span>
        </button>
        <button
          type="button"
          onClick={onJoin}
          className="mt-2 h-[30px] w-full rounded-full text-[13px] font-semibold text-white"
          style={{ background: "#0FA6A6" }}
        >
          Join
        </button>
      </div>
    </div>
  );
}
