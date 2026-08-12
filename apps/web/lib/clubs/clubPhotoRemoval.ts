// The canonical contract for removing something from a club's "Photos that
// Glue", ported from apps/mobile/app/club/[clubId]/edit.tsx handlePhotoOptions.
// Mobile is the source of truth; this module exists so the two web entry points
// (Edit Club, and the media overlay's ⋯ menu) can never drift from it or from
// each other.
//
// There are exactly TWO cases, and they are NOT the same operation:
//
//   tagged_post  A student's post that tags this club. The officer removes the
//                CLUB ASSOCIATION ONLY, via the officer-checked
//                `remove_post_from_club` RPC. That RPC clears posts.club_id,
//                deletes the post_club_tags row and deletes the club_photos row
//                — all scoped to this one club. It never touches the posts row,
//                so the post survives in Home, on the creator's profile, and
//                anywhere it was shared. This is a REMOVAL FROM A CLUB, never a
//                post deletion, and the copy must say so.
//
//   officer_upload  A photo an officer uploaded directly, with no post behind
//                it. There is nothing to preserve, so `delete_club_photo_everywhere`
//                deletes the club_photos row.
//
// Web must not offer any third option. An earlier web-only "Hide from this
// club" flipped club_photos.is_visible while LEAVING the club tag in place, so
// the post stayed an official club post (posts.club_id set) and only vanished
// from one grid. That is a different data relationship from mobile's and has
// been removed.

export type ClubPhotoSource = "officer_upload" | "tagged_post";

export interface ClubPhotoRemovalPlan {
  /** Which server operation this photo needs. */
  kind: "remove_post_from_club" | "delete_club_photo";
  title: string;
  message: string;
  confirmLabel: string;
  successMessage: string;
  errorMessage: string;
}

/**
 * Decides how a given club photo is removed, and with what wording.
 * A row counts as a tagged post only when it BOTH declares that source and
 * actually carries a post_id — without an id there is no post to detach, so it
 * is treated as a plain club photo rather than firing an RPC with a null.
 */
export function planClubPhotoRemoval(
  photo: { source: ClubPhotoSource; post_id: string | null },
  clubName: string
): ClubPhotoRemovalPlan {
  const club = clubName.trim() || "this club";

  if (photo.source === "tagged_post" && photo.post_id) {
    return {
      kind: "remove_post_from_club",
      title: `Remove this post from ${club}?`,
      message: `The post will remain on the creator’s profile and anywhere it was shared, but the ${club} tag will be removed.`,
      confirmLabel: "Remove from club",
      successMessage: `Post removed from ${club}.`,
      errorMessage: "Could not remove the post from this club. Try again.",
    };
  }

  return {
    kind: "delete_club_photo",
    title: "Remove this photo?",
    message: `This photo will be removed from ${club}’s Photos that Glue.`,
    confirmLabel: "Remove photo",
    successMessage: "Photo removed.",
    errorMessage: "Could not remove the photo. Try again.",
  };
}
