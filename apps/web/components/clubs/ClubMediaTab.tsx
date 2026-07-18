"use client";

import type { ClubPhoto } from "../../lib/clubs/clubProfileService";

// Media tab (spec §19): the real club-associated media grid (officer uploads +
// tagged posts, newest first, hidden/removed items already filtered server-side).
// Clicking an item opens the media overlay above this grid.
export function ClubMediaTab({
  photos,
  onOpenPhoto,
}: {
  photos: ClubPhoto[];
  onOpenPhoto: (index: number) => void;
}): JSX.Element {
  if (photos.length === 0) {
    return <p className="mt-8 text-center text-sm text-gray-500">No media yet.</p>;
  }

  return (
    <div className="mt-6 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5">
      {photos.map((photo, i) => (
        <button
          key={photo.id}
          type="button"
          onClick={() => onOpenPhoto(i)}
          className="relative aspect-square overflow-hidden rounded-lg bg-gray-200"
          aria-label={photo.caption ? `Open photo: ${photo.caption}` : "Open photo"}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo.url} alt={photo.caption ?? ""} className="h-full w-full object-cover transition hover:opacity-95" />
        </button>
      ))}
    </div>
  );
}
